import type pg from 'pg';
import { z } from 'zod';
import { addDays } from '../domain/recurrence.js';
import { localToUtc, TimeError, utcToLocal } from '../domain/time.js';
import { AppError } from '../errors.js';
import { type AppointmentInput, createAppointment } from './appointments.js';

/** Stop accepting new requests once this many are waiting. Caps what a flood can store. */
export const MAX_PENDING = 100;
/** Personal data does not linger: decided requests go after 30 days, unanswered ones after 60. */
export const DECIDED_RETENTION_DAYS = 30;
export const PENDING_RETENTION_DAYS = 60;
const MAX_DAYS_AHEAD = 365;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A trimmed optional text field: empty or missing becomes null; otherwise it must pass `schema`. */
function optionalText(schema: z.ZodType<string>) {
  return z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() || null : v),
    schema.nullable().optional().default(null),
  );
}

/** US phone numbers: 10 digits, or 11 with a leading 1. Stored as "(555) 010-0199" so every
 * request looks the same. Returns null when it is not a plausible number. */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10 || d[0] === '0' || d[0] === '1') return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export const publicRequestInput = z
  .object({
    clientName: z.string().trim().min(1).max(120),
    clientPhone: z
      .string()
      .trim()
      .max(30)
      .regex(/^[0-9+()\-.\s]+$/)
      .transform(normalizePhone)
      .refine((v): v is string => v !== null),
    contactMethod: z.enum(['call', 'text', 'email']).default('call'),
    contactEmail: optionalText(z.email().max(254)),
    cleaningType: z.enum(['apartment', 'house', 'office']),
    // Street and unit are optional; city and ZIP are what the owners need to judge distance.
    address: optionalText(z.string().max(250)),
    unit: optionalText(z.string().max(40)),
    city: z.string().trim().min(1).max(80),
    zip: z
      .string()
      .trim()
      .regex(/^\d{5}(-\d{4})?$/),
    preferredDate: dateStr,
    preferredTime: z.string().regex(/^\d{2}:\d{2}$/),
    repeat: z.enum(['none', 'weekly', 'biweekly', 'monthly']).default('none'),
    moveType: z.enum(['none', 'move_in', 'move_out']).default('none'),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => (v ? v : null)),
    lang: z.enum(['es', 'en']).default('es'),
    // Honeypot: a hidden field real people never fill in. Bots usually do.
    website: z.string().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.contactMethod === 'email' && !v.contactEmail) {
      ctx.addIssue({ code: 'custom', path: ['contactEmail'], message: 'required' });
    }
    if (v.moveType !== 'none' && v.repeat !== 'none') {
      ctx.addIssue({ code: 'custom', path: ['moveType'], message: 'move_is_one_time' });
    }
    const today = utcToLocal(new Date()).date;
    if (v.preferredDate < today || v.preferredDate > addDays(today, MAX_DAYS_AHEAD)) {
      ctx.addIssue({ code: 'custom', path: ['preferredDate'], message: 'out_of_range' });
    }
  });
export type PublicRequestInput = z.infer<typeof publicRequestInput>;

interface Row {
  id: string;
  client_name: string;
  client_phone: string;
  address: string | null;
  unit: string | null;
  city: string | null;
  zip: string | null;
  contact_method: 'call' | 'text' | 'email';
  contact_email: string | null;
  cleaning_type: 'apartment' | 'house' | 'office' | null;
  move_type: 'none' | 'move_in' | 'move_out';
  preferred_date: string;
  preferred_time: string;
  repeat: 'none' | 'weekly' | 'biweekly' | 'monthly';
  notes: string | null;
  lang: 'es' | 'en';
  status: 'pending' | 'accepted' | 'declined';
  created_at: Date;
}

const COLUMNS =
  'id, client_name, client_phone, address, unit, city, zip, contact_method, contact_email, cleaning_type, move_type, preferred_date, preferred_time, repeat, notes, lang, status, created_at';

const toDto = (r: Row) => ({
  id: r.id,
  clientName: r.client_name,
  clientPhone: r.client_phone,
  address: r.address,
  unit: r.unit,
  city: r.city,
  zip: r.zip,
  contactMethod: r.contact_method,
  contactEmail: r.contact_email,
  cleaningType: r.cleaning_type,
  moveType: r.move_type,
  preferredDate: r.preferred_date,
  preferredTime: r.preferred_time,
  repeat: r.repeat,
  notes: r.notes,
  lang: r.lang,
  status: r.status,
  receivedDate: utcToLocal(r.created_at).date,
});
export type RequestDto = ReturnType<typeof toDto>;

// ---------------------------------------------------------------------------------------
// Public side
// ---------------------------------------------------------------------------------------

/** Store a request from the public form. Returns false when it was silently dropped as spam. */
export async function submitRequest(pool: pg.Pool, input: PublicRequestInput): Promise<boolean> {
  if (input.website) return false; // honeypot filled: pretend success, store nothing

  try {
    localToUtc(input.preferredDate, input.preferredTime); // rejects times that do not exist
  } catch (err) {
    if (err instanceof TimeError) throw new AppError(400, err.code);
    throw err;
  }

  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM booking_requests WHERE status = 'pending'`,
  );
  if ((rows[0]?.n ?? 0) >= MAX_PENDING) throw new AppError(503, 'busy');

  await pool.query(
    `INSERT INTO booking_requests
       (client_name, client_phone, address, unit, city, zip, contact_method, contact_email,
        cleaning_type, move_type, preferred_date, preferred_time, repeat, notes, lang)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      input.clientName,
      input.clientPhone,
      input.address,
      input.unit,
      input.city,
      input.zip,
      input.contactMethod,
      // An email the client typed but did not choose to be contacted by is not kept.
      input.contactMethod === 'email' ? input.contactEmail : null,
      input.cleaningType,
      input.moveType,
      input.preferredDate,
      input.preferredTime,
      input.repeat,
      input.notes,
      input.lang,
    ],
  );
  return true;
}

// ---------------------------------------------------------------------------------------
// Owners' side
// ---------------------------------------------------------------------------------------

export async function listPending(pool: pg.Pool): Promise<RequestDto[]> {
  const { rows } = await pool.query<Row>(
    `SELECT ${COLUMNS} FROM booking_requests WHERE status = 'pending' ORDER BY created_at`,
  );
  return rows.map(toDto);
}

export async function countPending(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM booking_requests WHERE status = 'pending'`,
  );
  return rows[0]?.n ?? 0;
}

export async function getRequest(pool: pg.Pool, id: string): Promise<RequestDto | null> {
  const { rows } = await pool.query<Row>(`SELECT ${COLUMNS} FROM booking_requests WHERE id = $1`, [
    id,
  ]);
  return rows[0] ? toDto(rows[0]) : null;
}

/** Claim a pending request so two people cannot decide it at once. */
async function claim(pool: pg.Pool, id: string, status: 'accepted' | 'declined', userId: string) {
  const { rowCount } = await pool.query(
    `UPDATE booking_requests SET status = $2, decided_at = now(), decided_by = $3
     WHERE id = $1 AND status = 'pending'`,
    [id, status, userId],
  );
  if (rowCount) return;
  const exists = await getRequest(pool, id);
  throw new AppError(exists ? 409 : 404, exists ? 'already_decided' : 'not_found');
}

/**
 * Accept a request: the owners may have adjusted the details, so the appointment (or repeating
 * series) is created from what they confirm, not from what the client typed.
 */
export async function acceptRequest(
  pool: pg.Pool,
  id: string,
  input: AppointmentInput,
  userId: string,
) {
  try {
    localToUtc(input.date, input.time);
  } catch (err) {
    if (err instanceof TimeError) throw new AppError(400, err.code);
    throw err;
  }
  await claim(pool, id, 'accepted', userId);
  try {
    const result = await createAppointment(pool, input, userId);
    await pool.query(
      'UPDATE booking_requests SET appointment_id = $2, series_id = $3 WHERE id = $1',
      [
        id,
        result.created === 'appointment' ? result.appointment.id : null,
        result.created === 'series' ? result.appointment.seriesId : null,
      ],
    );
    return result;
  } catch (err) {
    // Creation failed: put the request back so it is not lost.
    await pool.query(
      `UPDATE booking_requests SET status = 'pending', decided_at = NULL, decided_by = NULL WHERE id = $1`,
      [id],
    );
    throw err;
  }
}

export async function declineRequest(pool: pg.Pool, id: string, userId: string) {
  await claim(pool, id, 'declined', userId);
}

/** Delete old requests so personal data is not kept longer than needed. Returns rows removed. */
export async function purgeOldRequests(pool: pg.Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM booking_requests
     WHERE (status <> 'pending' AND decided_at < now() - make_interval(days => $1))
        OR (status = 'pending' AND created_at < now() - make_interval(days => $2))`,
    [DECIDED_RETENTION_DAYS, PENDING_RETENTION_DAYS],
  );
  return rowCount ?? 0;
}
