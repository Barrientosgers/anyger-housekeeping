// Recurrence rules on plain Pacific calendar dates ("YYYY-MM-DD"). No time zones are involved
// here: a rule says which DAYS a visit happens, and time.ts turns day + wall-clock time into UTC.

export type Freq = 'weekly' | 'biweekly' | 'monthly';

export interface Rule {
  startDate: string;
  freq: Freq;
  untilDate: string | null; // inclusive
}

const DAY_MS = 86_400_000;
const toMs = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso: string, n: number) => toIso(toMs(iso) + n * DAY_MS);
export const weekdayOf = (iso: string) => new Date(toMs(iso)).getUTCDay();

/** 1-4 for the first to fourth weekday of the month; 5 means "the last one". */
export function ordinalOf(iso: string): 1 | 2 | 3 | 4 | 5 {
  return Math.ceil(Number(iso.slice(8)) / 7) as 1 | 2 | 3 | 4 | 5;
}

function nthWeekday(year: number, month0: number, weekday: number, ordinal: number): string {
  if (ordinal < 5) {
    const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
    const day = 1 + ((weekday - firstDow + 7) % 7) + 7 * (ordinal - 1);
    return toIso(Date.UTC(year, month0, day));
  }
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month0, lastDay)).getUTCDay();
  return toIso(Date.UTC(year, month0, lastDay - ((lastDow - weekday + 7) % 7)));
}

/**
 * The dates a series occurs on within [from, to] (inclusive), ignoring edits and cancellations.
 *
 * - weekly / biweekly: every 7 / 14 days from startDate.
 * - monthly: the same weekday of the month as startDate (e.g. the 2nd Tuesday). If startDate
 *   falls in days 29-31 the rule means "the last <weekday> of the month".
 */
export function occurrenceDates(rule: Rule, from: string, to: string): string[] {
  const lo = from > rule.startDate ? from : rule.startDate;
  const hi = rule.untilDate && rule.untilDate < to ? rule.untilDate : to;
  if (lo > hi) return [];

  const out: string[] = [];
  if (rule.freq === 'weekly' || rule.freq === 'biweekly') {
    const stepMs = (rule.freq === 'weekly' ? 7 : 14) * DAY_MS;
    const startMs = toMs(rule.startDate);
    const hiMs = toMs(hi);
    for (
      let ms = startMs + Math.ceil((toMs(lo) - startMs) / stepMs) * stepMs;
      ms <= hiMs;
      ms += stepMs
    ) {
      out.push(toIso(ms));
    }
    return out;
  }

  const weekday = weekdayOf(rule.startDate);
  const ordinal = ordinalOf(rule.startDate);
  let year = Number(lo.slice(0, 4));
  let month0 = Number(lo.slice(5, 7)) - 1;
  const lastYear = Number(hi.slice(0, 4));
  const lastMonth0 = Number(hi.slice(5, 7)) - 1;
  while (year < lastYear || (year === lastYear && month0 <= lastMonth0)) {
    const d = nthWeekday(year, month0, weekday, ordinal);
    if (d >= lo && d <= hi) out.push(d);
    if (++month0 === 12) {
      month0 = 0;
      year++;
    }
  }
  return out;
}

/** True when `date` is one of the series' generated visits. */
export const occursOn = (rule: Rule, date: string) =>
  occurrenceDates(rule, date, date).length === 1;
