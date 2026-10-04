// Calendar math on plain "YYYY-MM-DD" strings. The server decides which Pacific day an
// appointment is on, so the browser never converts time zones for appointments.

const TZ = 'America/Los_Angeles';

const toUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (iso: string, n: number) => {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};

export const addMonths = (iso: string, n: number) => {
  const d = toUtc(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return toIso(d);
};

/** Weeks start on Sunday, like most US paper calendars. */
export const startOfWeek = (iso: string) => addDays(iso, -toUtc(iso).getUTCDay());

export const weekDays = (iso: string) => {
  const start = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};

/** Full weeks (Sunday to Saturday) that cover the month containing `iso`. */
export const monthGrid = (iso: string) => {
  const first = `${iso.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const weeks: string[][] = [];
  for (let start = startOfWeek(first); start <= last; start = addDays(start, 7)) {
    weeks.push(weekDays(start));
  }
  return weeks;
};

export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

/** Today's date in Pacific Time, regardless of the device's own time zone. */
export const todayPacific = (now: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

const locale = (lang: string) => (lang === 'en' ? 'en-US' : 'es-US');

const fmt = (iso: string, lang: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale(lang), { timeZone: 'UTC', ...opts }).format(toUtc(iso));

export const formatMonth = (iso: string, lang: string) =>
  fmt(iso, lang, { month: 'long', year: 'numeric' });

export const formatLongDate = (iso: string, lang: string) =>
  fmt(iso, lang, { weekday: 'long', day: 'numeric', month: 'long' });

export const formatFullDate = (iso: string, lang: string) =>
  fmt(iso, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const formatWeekday = (iso: string, lang: string) => fmt(iso, lang, { weekday: 'short' });

/** "09:00" -> "9:00 a. m." (a wall-clock label; no time zone math involved). */
export const formatTime = (hhmm: string, lang: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
};

/** "4 – 10 de octubre": a compact label for a week. */
export const formatRange = (fromIso: string, toIso: string, lang: string) =>
  new Intl.DateTimeFormat(locale(lang), {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  }).formatRange(toUtc(fromIso), toUtc(toIso));

/** 1-4 for "first" to "fourth" weekday of the month, 5 for "the last one". */
export const ordinalOf = (iso: string) => Math.ceil(Number(iso.slice(8)) / 7);

export const formatWeekdayLong = (iso: string, lang: string) => fmt(iso, lang, { weekday: 'long' });
