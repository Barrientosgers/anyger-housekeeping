import type pg from 'pg';

export type UsageEvent =
  | 'appointments_created'
  | 'appointments_cancelled'
  | 'series_created'
  | 'requests_received'
  | 'requests_accepted'
  | 'requests_declined'
  | 'sms_sent'
  | 'sms_failed';

/** Anonymous daily counters: event name + date + count. No user or client identifiers. */
export async function countUsage(pool: pg.Pool, event: UsageEvent): Promise<void> {
  await pool.query(
    `INSERT INTO usage_counters (event, day, count)
     VALUES ($1, (now() AT TIME ZONE 'America/Los_Angeles')::date, 1)
     ON CONFLICT (event, day) DO UPDATE SET count = usage_counters.count + 1`,
    [event],
  );
}

export async function audit(
  pool: pg.Pool,
  userId: string | undefined,
  action: string,
  entity: string,
  entityId: string,
): Promise<void> {
  await pool.query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES ($1, $2, $3, $4)',
    [userId ?? null, action, entity, entityId],
  );
}
