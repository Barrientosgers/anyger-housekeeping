import type pg from 'pg';
import { z } from 'zod';
import { localDaysToUtcRange, localToUtc, utcToLocal } from '../domain/time.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^\d{2}:\d{2}$/);

export const appointmentInput = z.object({
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
});
export type AppointmentInput = z.infer<typeof appointmentInput>;

export const rangeQuery = z.object({ from: dateStr, to: dateStr });

interface Row {
  id: string;
  client_name: string;
  client_phone: string | null;
  address: string;
  starts_at: Date;
  duration_min: number;
  notes: string | null;
  status: 'scheduled' | 'cancelled';
}

export function toDto(row: Row) {
  const local = utcToLocal(row.starts_at);
  return {
    id: row.id,
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

const COLUMNS = 'id, client_name, client_phone, address, starts_at, duration_min, notes, status';

export async function listAppointments(pool: pg.Pool, from: string, to: string) {
  const [start, end] = localDaysToUtcRange(from, to);
  const { rows } = await pool.query<Row>(
    `SELECT ${COLUMNS} FROM appointments
     WHERE status = 'scheduled' AND starts_at >= $1 AND starts_at < $2
     ORDER BY starts_at`,
    [start, end],
  );
  return rows.map(toDto);
}

export async function getAppointment(pool: pg.Pool, id: string) {
  const { rows } = await pool.query<Row>(`SELECT ${COLUMNS} FROM appointments WHERE id = $1`, [id]);
  return rows[0] ? toDto(rows[0]) : null;
}

/** How many other scheduled appointments overlap this time slot (a warning, not a block). */
export async function countOverlaps(
  pool: pg.Pool,
  startsAt: Date,
  durationMin: number,
  excludeId?: string,
): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM appointments
     WHERE status = 'scheduled'
       AND ($3::uuid IS NULL OR id <> $3)
       AND tstzrange(starts_at, starts_at + make_interval(mins => duration_min))
           && tstzrange($1::timestamptz, $1::timestamptz + make_interval(mins => $2::int))`,
    [startsAt, durationMin, excludeId ?? null],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function createAppointment(pool: pg.Pool, input: AppointmentInput, userId: string) {
  const startsAt = localToUtc(input.date, input.time);
  const { rows } = await pool.query<Row>(
    `INSERT INTO appointments
       (client_name, client_phone, address, starts_at, duration_min, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
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
  const dto = toDto(rows[0]!);
  const overlaps = await countOverlaps(pool, startsAt, input.durationMin, dto.id);
  return { appointment: dto, overlaps };
}

export async function updateAppointment(pool: pg.Pool, id: string, input: AppointmentInput) {
  const startsAt = localToUtc(input.date, input.time);
  const { rows } = await pool.query<Row>(
    `UPDATE appointments SET client_name = $2, client_phone = $3, address = $4, starts_at = $5,
       duration_min = $6, notes = $7, updated_at = now()
     WHERE id = $1 AND status = 'scheduled' RETURNING ${COLUMNS}`,
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
  if (!rows[0]) return null;
  const overlaps = await countOverlaps(pool, startsAt, input.durationMin, id);
  return { appointment: toDto(rows[0]), overlaps };
}

export async function cancelAppointment(pool: pg.Pool, id: string) {
  const { rows } = await pool.query<Row>(
    `UPDATE appointments SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND status = 'scheduled' RETURNING ${COLUMNS}`,
    [id],
  );
  return rows[0] ? toDto(rows[0]) : null;
}
