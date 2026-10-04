import type pg from 'pg';
import { z } from 'zod';
import { addDays, type Freq, occurrenceDates, occursOn, type Rule } from '../domain/recurrence.js';
import { localDaysToUtcRange, localToUtc, resolveLocal, utcToLocal } from '../domain/time.js';
import { AppError } from '../errors.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^\d{2}:\d{2}$/);

export const appointmentInput = z
  .object({
    clientName: z.string().trim().min(1).max(120),
    clientPhone: z
      .string()
      .trim()
      .max(30)
      .regex(/^[0-9+()\-.\s]*$/)
      .optional()
      .transform((v) => (v ? v : null)),
    address: z.string().trim().min(1).max(250),
    date: dateStr,
    time: timeStr,
    durationMin: z.number().int().min(15).max(720),
    notes: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v) => (v ? v : null)),
    repeat: z.enum(['none', 'weekly', 'biweekly', 'monthly']).default('none'),
    repeatUntil: dateStr.nullish().transform((v) => v ?? null),
    scope: z.enum(['this', 'future']).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.repeatUntil && v.repeatUntil < v.date) {
      ctx.addIssue({ code: 'custom', path: ['repeatUntil'], message: 'before_start' });
    }
  });
export type AppointmentInput = z.infer<typeof appointmentInput>;

export const scopeBody = z.object({ scope: z.enum(['this', 'future']).optional() });
export type Scope = 'this' | 'future';

export const rangeQuery = z.object({ from: dateStr, to: dateStr });

// ---------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------

interface Row {
  id: string;
  client_name: string;
  client_phone: string | null;
  address: string;
  starts_at: Date;
  duration_min: number;
  notes: string | null;
  status: 'scheduled' | 'cancelled';
  series_id: string | null;
  original_date: string | null;
  freq: Freq | null;
  until_date: string | null;
}

interface SeriesRow {
  id: string;
  client_name: string;
  client_phone: string | null;
  address: string;
  notes: string | null;
  start_date: string;
  local_time: string;
  duration_min: number;
  freq: Freq;
  until_date: string | null;
  status: 'active' | 'cancelled';
}

export interface AppointmentDto {
  /** A real id for stored appointments; "s:<seriesId>:<date>" for a generated visit. */
  id: string;
  seriesId: string | null;
  originalDate: string | null;
  recurrence: { freq: Freq; untilDate: string | null } | null;
  clientName: string;
  clientPhone: string | null;
  address: string;
  startsAt: string;
  date: string;
  time: string;
  durationMin: number;
  notes: string | null;
  status: 'scheduled' | 'cancelled';
}

const SELECT = `SELECT a.id, a.client_name, a.client_phone, a.address, a.starts_at, a.duration_min,
    a.notes, a.status, a.series_id, a.original_date, s.freq, s.until_date
  FROM appointments a LEFT JOIN series s ON s.id = a.series_id`;

const OCCURRENCE_ID = /^s:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/;
export const occurrenceId = (seriesId: string, date: string) => `s:${seriesId}:${date}`;
export function parseOccurrenceId(id: string): { seriesId: string; date: string } | null {
  const m = OCCURRENCE_ID.exec(id);
  return m ? { seriesId: m[1]!, date: m[2]! } : null;
}
export const isOccurrenceId = (id: string) => OCCURRENCE_ID.test(id);

const ruleOf = (s: SeriesRow): Rule => ({
  startDate: s.start_date,
  freq: s.freq,
  untilDate: s.until_date,
});

export function toDto(row: Row): AppointmentDto {
  const local = utcToLocal(row.starts_at);
  return {
    id: row.id,
    seriesId: row.series_id,
    originalDate: row.original_date,
    recurrence: row.series_id && row.freq ? { freq: row.freq, untilDate: row.until_date } : null,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    address: row.address,
    startsAt: row.starts_at.toISOString(),
    date: local.date,
    time: local.time,
    durationMin: row.duration_min,
    notes: row.notes,
    status: row.status,
  };
}

/** A visit generated from a series rule (not stored as its own row). */
function virtualDto(s: SeriesRow, date: string, status: 'scheduled' | 'cancelled' = 'scheduled') {
  const startsAt = resolveLocal(date, s.local_time);
  const local = utcToLocal(startsAt);
  return {
    id: occurrenceId(s.id, date),
    seriesId: s.id,
    originalDate: date,
    recurrence: { freq: s.freq, untilDate: s.until_date },
    clientName: s.client_name,
    clientPhone: s.client_phone,
    address: s.address,
    startsAt: startsAt.toISOString(),
    date: local.date,
    time: local.time,
    durationMin: s.duration_min,
    notes: s.notes,
    status,
  } satisfies AppointmentDto;
}

const SERIES_COLUMNS = `id, client_name, client_phone, address, notes, start_date, local_time,
  duration_min, freq, until_date, status`;

async function loadSeries(db: pg.Pool | pg.PoolClient, id: string): Promise<SeriesRow | null> {
  const { rows } = await db.query<SeriesRow>(`SELECT ${SERIES_COLUMNS} FROM series WHERE id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
}

async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------

/** Stored appointments plus generated visits for whole Pacific days from `from` to `to`. */
export async function listAppointments(pool: pg.Pool, from: string, to: string) {
  const [start, end] = localDaysToUtcRange(from, to);
  const [stored, seriesRes] = await Promise.all([
    pool.query<Row>(
      `${SELECT} WHERE a.status = 'scheduled' AND a.starts_at >= $1 AND a.starts_at < $2`,
      [start, end],
    ),
    pool.query<SeriesRow>(
      `SELECT ${SERIES_COLUMNS} FROM series
       WHERE status = 'active' AND start_date <= $2 AND (until_date IS NULL OR until_date >= $1)`,
      [from, to],
    ),
  ]);

  // A generated visit is replaced by its exception row (moved, edited, or cancelled), if any.
  const replaced = new Set<string>();
  if (seriesRes.rows.length) {
    const { rows } = await pool.query<{ series_id: string; original_date: string }>(
      `SELECT series_id, original_date FROM appointments
       WHERE series_id = ANY($1::uuid[]) AND original_date BETWEEN $2 AND $3`,
      [seriesRes.rows.map((s) => s.id), from, to],
    );
    for (const r of rows) replaced.add(occurrenceId(r.series_id, r.original_date));
  }

  const result = stored.rows.map(toDto);
  for (const s of seriesRes.rows) {
    for (const date of occurrenceDates(ruleOf(s), from, to)) {
      if (!replaced.has(occurrenceId(s.id, date))) result.push(virtualDto(s, date));
    }
  }
  return result.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

type Target =
  | { kind: 'standalone'; row: Row }
  | { kind: 'occurrence'; series: SeriesRow; date: string; exception: Row | null };

async function resolveTarget(db: pg.Pool | pg.PoolClient, id: string): Promise<Target | null> {
  const occ = parseOccurrenceId(id);
  if (occ) {
    const series = await loadSeries(db, occ.seriesId);
    if (!series || series.status !== 'active') return null;
    const { rows } = await db.query<Row>(
      `${SELECT} WHERE a.series_id = $1 AND a.original_date = $2`,
      [occ.seriesId, occ.date],
    );
    const exception = rows[0] ?? null;
    if (!exception && !occursOn(ruleOf(series), occ.date)) return null;
    return { kind: 'occurrence', series, date: occ.date, exception };
  }
  const { rows } = await db.query<Row>(`${SELECT} WHERE a.id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  if (!row.series_id || !row.original_date) return { kind: 'standalone', row };
  const series = await loadSeries(db, row.series_id);
  if (!series) return null;
  return { kind: 'occurrence', series, date: row.original_date, exception: row };
}

export async function getAppointment(pool: pg.Pool, id: string) {
  const target = await resolveTarget(pool, id);
  if (!target) return null;
  if (target.kind === 'standalone') return toDto(target.row);
  return target.exception ? toDto(target.exception) : virtualDto(target.series, target.date);
}

/** How many other scheduled appointments overlap this time slot (a warning, not a block). */
export async function countOverlaps(
  pool: pg.Pool,
  startsAt: Date,
  durationMin: number,
  exclude?: { id?: string; seriesId?: string; date?: string },
): Promise<number> {
  const day = utcToLocal(startsAt).date;
  const dayVisits = await listAppointments(pool, addDays(day, -1), addDays(day, 1));
  const endsAt = startsAt.getTime() + durationMin * 60_000;
  return dayVisits.filter((v) => {
    if (exclude?.id && v.id === exclude.id) return false;
    if (exclude?.seriesId && v.seriesId === exclude.seriesId && v.originalDate === exclude.date) {
      return false;
    }
    const s = Date.parse(v.startsAt);
    return s < endsAt && s + v.durationMin * 60_000 > startsAt.getTime();
  }).length;
}

// ---------------------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------------------

export async function createAppointment(pool: pg.Pool, input: AppointmentInput, userId: string) {
  const startsAt = localToUtc(input.date, input.time); // strict: rejects times that don't exist

  if (input.repeat !== 'none') {
    const { rows } = await pool.query<SeriesRow>(
      `INSERT INTO series (client_name, client_phone, address, notes, start_date, local_time,
         duration_min, freq, until_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${SERIES_COLUMNS}`,
      [
        input.clientName,
        input.clientPhone,
        input.address,
        input.notes,
        input.date,
        input.time,
        input.durationMin,
        input.repeat,
        input.repeatUntil,
        userId,
      ],
    );
    const series = rows[0]!;
    const appointment = virtualDto(series, input.date);
    const overlaps = await countOverlaps(pool, startsAt, input.durationMin, {
      seriesId: series.id,
      date: input.date,
    });
    return { appointment, overlaps, created: 'series' as const };
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO appointments
       (client_name, client_phone, address, starts_at, duration_min, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.clientName,
      input.clientPhone,
      input.address,
      startsAt,
      input.durationMin,
      input.notes,
      userId,
    ],
  );
  const appointment = (await getAppointment(pool, rows[0]!.id))!;
  const overlaps = await countOverlaps(pool, startsAt, input.durationMin, { id: appointment.id });
  return { appointment, overlaps, created: 'appointment' as const };
}

// ---------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------

export async function updateAppointment(
  pool: pg.Pool,
  id: string,
  input: AppointmentInput,
  userId: string,
) {
  const target = await resolveTarget(pool, id);
  if (!target) return null;
  const startsAt = localToUtc(input.date, input.time);

  if (target.kind === 'standalone') {
    if (target.row.status !== 'scheduled') return null;
    await pool.query(
      `UPDATE appointments SET client_name = $2, client_phone = $3, address = $4, starts_at = $5,
         duration_min = $6, notes = $7, updated_at = now() WHERE id = $1`,
      [
        id,
        input.clientName,
        input.clientPhone,
        input.address,
        startsAt,
        input.durationMin,
        input.notes,
      ],
    );
    const appointment = (await getAppointment(pool, id))!;
    const overlaps = await countOverlaps(pool, startsAt, input.durationMin, { id });
    return { appointment, overlaps, audit: { action: 'update', entity: 'appointment', id } };
  }

  if (target.exception?.status === 'cancelled') return null;
  if (!input.scope) throw new AppError(400, 'scope_required');
  const { series, date } = target;

  if (input.scope === 'this') {
    await pool.query(
      `INSERT INTO appointments (client_name, client_phone, address, starts_at, duration_min, notes,
         series_id, original_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (series_id, original_date) WHERE series_id IS NOT NULL DO UPDATE SET
         client_name = EXCLUDED.client_name, client_phone = EXCLUDED.client_phone,
         address = EXCLUDED.address, starts_at = EXCLUDED.starts_at,
         duration_min = EXCLUDED.duration_min, notes = EXCLUDED.notes,
         status = 'scheduled', updated_at = now()`,
      [
        input.clientName,
        input.clientPhone,
        input.address,
        startsAt,
        input.durationMin,
        input.notes,
        series.id,
        date,
        userId,
      ],
    );
    const appointment = (await getAppointment(pool, occurrenceId(series.id, date)))!;
    const overlaps = await countOverlaps(pool, startsAt, input.durationMin, { id: appointment.id });
    return {
      appointment,
      overlaps,
      audit: { action: 'update:this', entity: 'series', id: series.id },
    };
  }

  // scope === 'future': this visit and every later one follow the new details.
  const freq: Freq = input.repeat === 'none' ? series.freq : input.repeat;
  const cutoff = date < input.date ? date : input.date; // nothing at or after this is kept from the old rule
  const fresh = await withTransaction(pool, async (db) => {
    // Exceptions at or after the cutoff belonged to the old schedule; they are replaced.
    await db.query('DELETE FROM appointments WHERE series_id = $1 AND original_date >= $2', [
      series.id,
      cutoff,
    ]);
    if (cutoff <= series.start_date) {
      // Editing from the first visit changes the whole series in place.
      const { rows } = await db.query<SeriesRow>(
        `UPDATE series SET client_name = $2, client_phone = $3, address = $4, notes = $5,
           start_date = $6, local_time = $7, duration_min = $8, freq = $9, until_date = $10,
           updated_at = now() WHERE id = $1 RETURNING ${SERIES_COLUMNS}`,
        [
          series.id,
          input.clientName,
          input.clientPhone,
          input.address,
          input.notes,
          input.date,
          input.time,
          input.durationMin,
          freq,
          input.repeatUntil,
        ],
      );
      return rows[0]!;
    }
    await db.query('UPDATE series SET until_date = $2, updated_at = now() WHERE id = $1', [
      series.id,
      addDays(cutoff, -1),
    ]);
    const { rows } = await db.query<SeriesRow>(
      `INSERT INTO series (client_name, client_phone, address, notes, start_date, local_time,
         duration_min, freq, until_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${SERIES_COLUMNS}`,
      [
        input.clientName,
        input.clientPhone,
        input.address,
        input.notes,
        input.date,
        input.time,
        input.durationMin,
        freq,
        input.repeatUntil,
        userId,
      ],
    );
    return rows[0]!;
  });
  const appointment = virtualDto(fresh, input.date);
  const overlaps = await countOverlaps(pool, startsAt, input.durationMin, {
    seriesId: fresh.id,
    date: input.date,
  });
  return {
    appointment,
    overlaps,
    audit: { action: 'update:future', entity: 'series', id: fresh.id },
  };
}

// ---------------------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------------------

export async function cancelAppointment(pool: pg.Pool, id: string, scope: Scope | undefined) {
  const target = await resolveTarget(pool, id);
  if (!target) return null;

  if (target.kind === 'standalone') {
    if (target.row.status !== 'scheduled') return null;
    await pool.query(
      `UPDATE appointments SET status = 'cancelled', updated_at = now() WHERE id = $1`,
      [id],
    );
    const appointment = (await getAppointment(pool, id))!;
    return { appointment, audit: { action: 'cancel', entity: 'appointment', id } };
  }

  if (target.exception?.status === 'cancelled') return null;
  if (!scope) throw new AppError(400, 'scope_required');
  const { series, date } = target;

  if (scope === 'this') {
    // Store a cancelled exception so the generated visit no longer appears.
    await pool.query(
      `INSERT INTO appointments (client_name, client_phone, address, starts_at, duration_min, notes,
         series_id, original_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'cancelled')
       ON CONFLICT (series_id, original_date) WHERE series_id IS NOT NULL DO UPDATE SET
         status = 'cancelled', updated_at = now()`,
      [
        series.client_name,
        series.client_phone,
        series.address,
        resolveLocal(date, series.local_time),
        series.duration_min,
        series.notes,
        series.id,
        date,
      ],
    );
  } else {
    await withTransaction(pool, async (db) => {
      await db.query(
        `UPDATE appointments SET status = 'cancelled', updated_at = now()
         WHERE series_id = $1 AND original_date >= $2`,
        [series.id, date],
      );
      if (date <= series.start_date) {
        await db.query(`UPDATE series SET status = 'cancelled', updated_at = now() WHERE id = $1`, [
          series.id,
        ]);
      } else {
        await db.query('UPDATE series SET until_date = $2, updated_at = now() WHERE id = $1', [
          series.id,
          addDays(date, -1),
        ]);
      }
    });
  }
  const appointment = virtualDto(series, date, 'cancelled');
  return { appointment, audit: { action: `cancel:${scope}`, entity: 'series', id: series.id } };
}
