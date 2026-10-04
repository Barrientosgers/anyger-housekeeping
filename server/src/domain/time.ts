import { DateTime } from 'luxon';

export const TIME_ZONE = 'America/Los_Angeles';

export class TimeError extends Error {
  constructor(
    public readonly code: 'invalid_datetime' | 'nonexistent_local_time',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Convert a Pacific wall-clock date ("2026-03-14") and time ("09:00") to a UTC instant.
 *
 * - Spring forward: a time that does not exist (02:30 on 2026-03-08) is rejected.
 * - Fall back: a time that happens twice (01:30 on 2026-11-01) resolves to the first
 *   occurrence (daylight time), which is Luxon's default and is documented behavior.
 */
export function localToUtc(date: string, time: string): Date {
  const local = DateTime.fromISO(`${date}T${time}`, { zone: TIME_ZONE });
  if (!local.isValid) throw new TimeError('invalid_datetime', `Invalid date/time: ${date} ${time}`);
  // Luxon silently shifts a nonexistent time forward; a round trip detects that.
  if (local.toFormat('yyyy-MM-dd') !== date || local.toFormat('HH:mm') !== time.slice(0, 5)) {
    throw new TimeError('nonexistent_local_time', `${date} ${time} does not exist in ${TIME_ZONE}`);
  }
  return local.toUTC().toJSDate();
}

/** Pacific wall-clock date and time for a UTC instant. */
export function utcToLocal(instant: Date): { date: string; time: string } {
  const local = DateTime.fromJSDate(instant, { zone: TIME_ZONE });
  return { date: local.toFormat('yyyy-MM-dd'), time: local.toFormat('HH:mm') };
}

/**
 * UTC range covering whole Pacific days from `fromDate` through `toDate` inclusive.
 * Returned as [start, endExclusive). Days are 23, 24, or 25 hours around DST changes.
 */
export function localDaysToUtcRange(fromDate: string, toDate: string): [Date, Date] {
  const start = DateTime.fromISO(fromDate, { zone: TIME_ZONE }).startOf('day');
  const end = DateTime.fromISO(toDate, { zone: TIME_ZONE }).plus({ days: 1 }).startOf('day');
  if (!start.isValid || !end.isValid) throw new TimeError('invalid_datetime', 'Invalid date range');
  return [start.toUTC().toJSDate(), end.toUTC().toJSDate()];
}

/**
 * Like localToUtc, but for generated recurring visits: a time skipped by spring forward is
 * moved to the next valid time (02:30 becomes 03:30) instead of being rejected, so a weekly
 * 02:30 cleaning still happens on that day. Ambiguous fall-back times use the first occurrence.
 */
export function resolveLocal(date: string, time: string): Date {
  const local = DateTime.fromISO(`${date}T${time}`, { zone: TIME_ZONE });
  if (!local.isValid) throw new TimeError('invalid_datetime', `Invalid date/time: ${date} ${time}`);
  return local.toUTC().toJSDate();
}
