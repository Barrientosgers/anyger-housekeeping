import { describe, expect, it } from 'vitest';
import {
  addDays,
  occurrenceDates,
  occursOn,
  ordinalOf,
  type Rule,
} from '../../src/domain/recurrence.js';
import { localToUtc, resolveLocal } from '../../src/domain/time.js';

const rule = (over: Partial<Rule> = {}): Rule => ({
  startDate: '2026-10-06', // a Tuesday
  freq: 'weekly',
  untilDate: null,
  ...over,
});

describe('weekly and biweekly', () => {
  it('repeats every 7 days from the start date', () => {
    expect(occurrenceDates(rule(), '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-06',
      '2026-10-13',
      '2026-10-20',
      '2026-10-27',
    ]);
  });

  it('never produces dates before the start date', () => {
    expect(occurrenceDates(rule(), '2026-09-01', '2026-10-07')).toEqual(['2026-10-06']);
    expect(occurrenceDates(rule(), '2026-09-01', '2026-10-05')).toEqual([]);
  });

  it('starts the window mid-series and stays aligned to the start date', () => {
    expect(occurrenceDates(rule(), '2026-10-14', '2026-10-27')).toEqual([
      '2026-10-20',
      '2026-10-27',
    ]);
  });

  it('every 2 weeks skips alternate weeks', () => {
    expect(occurrenceDates(rule({ freq: 'biweekly' }), '2026-10-01', '2026-11-30')).toEqual([
      '2026-10-06',
      '2026-10-20',
      '2026-11-03',
      '2026-11-17',
    ]);
  });

  it('every 2 weeks keeps its rhythm when the window starts on an off week', () => {
    expect(occurrenceDates(rule({ freq: 'biweekly' }), '2026-10-07', '2026-10-19')).toEqual([]);
  });

  it('end date is inclusive', () => {
    expect(occurrenceDates(rule({ untilDate: '2026-10-20' }), '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-06',
      '2026-10-13',
      '2026-10-20',
    ]);
  });

  it('an end date before the window ends the series', () => {
    expect(occurrenceDates(rule({ untilDate: '2026-10-10' }), '2026-11-01', '2026-11-30')).toEqual(
      [],
    );
  });

  it('crosses year boundaries', () => {
    expect(occurrenceDates(rule({ startDate: '2026-12-29' }), '2026-12-25', '2027-01-12')).toEqual([
      '2026-12-29',
      '2027-01-05',
      '2027-01-12',
    ]);
  });
});

describe('monthly (same weekday of the month)', () => {
  it('2nd Tuesday every month', () => {
    const r = rule({ freq: 'monthly', startDate: '2026-10-13' });
    expect(ordinalOf('2026-10-13')).toBe(2);
    expect(occurrenceDates(r, '2026-10-01', '2027-02-28')).toEqual([
      '2026-10-13',
      '2026-11-10',
      '2026-12-08',
      '2027-01-12',
      '2027-02-09',
    ]);
  });

  it('1st Saturday works when the month starts on that weekday', () => {
    const r = rule({ freq: 'monthly', startDate: '2026-08-01' }); // Saturday, the 1st
    expect(occurrenceDates(r, '2026-08-01', '2026-10-31')).toEqual([
      '2026-08-01',
      '2026-09-05',
      '2026-10-03',
    ]);
  });

  it('a start on the 29th-31st means "the last <weekday>" and never skips short months', () => {
    const r = rule({ freq: 'monthly', startDate: '2026-12-29' }); // last Tuesday of December
    expect(ordinalOf('2026-12-29')).toBe(5);
    expect(occurrenceDates(r, '2026-12-01', '2027-04-30')).toEqual([
      '2026-12-29',
      '2027-01-26',
      '2027-02-23',
      '2027-03-30',
      '2027-04-27',
    ]);
  });

  it('respects window and end date', () => {
    const r = rule({ freq: 'monthly', startDate: '2026-10-13', untilDate: '2026-12-31' });
    expect(occurrenceDates(r, '2026-11-01', '2027-03-01')).toEqual(['2026-11-10', '2026-12-08']);
  });

  it('a window inside a month with no occurrence returns nothing', () => {
    const r = rule({ freq: 'monthly', startDate: '2026-10-13' });
    expect(occurrenceDates(r, '2026-11-11', '2026-11-30')).toEqual([]);
  });
});

describe('helpers', () => {
  it('occursOn is true only for generated dates', () => {
    expect(occursOn(rule(), '2026-10-13')).toBe(true);
    expect(occursOn(rule(), '2026-10-14')).toBe(false);
  });
  it('addDays handles month ends', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('recurrence and daylight saving', () => {
  const visits = (r: Rule, from: string, to: string, time: string) =>
    occurrenceDates(r, from, to).map((d) => ({ d, utc: resolveLocal(d, time).toISOString() }));

  it('a weekly 9:00 AM visit stays at 9:00 local while the UTC time moves at fall back (2026-11-01)', () => {
    const r = rule({ startDate: '2026-10-27' }); // Tuesdays
    expect(visits(r, '2026-10-27', '2026-11-10', '09:00')).toEqual([
      { d: '2026-10-27', utc: '2026-10-27T16:00:00.000Z' }, // PDT, UTC-7
      { d: '2026-11-03', utc: '2026-11-03T17:00:00.000Z' }, // PST, UTC-8
      { d: '2026-11-10', utc: '2026-11-10T17:00:00.000Z' },
    ]);
  });

  it('a weekly 9:00 AM visit stays at 9:00 local at spring forward (2027-03-14)', () => {
    const r = rule({ startDate: '2027-03-09' }); // Tuesdays
    expect(visits(r, '2027-03-09', '2027-03-16', '09:00')).toEqual([
      { d: '2027-03-09', utc: '2027-03-09T17:00:00.000Z' }, // PST
      { d: '2027-03-16', utc: '2027-03-16T16:00:00.000Z' }, // PDT
    ]);
  });

  it('a generated visit at a skipped time moves forward instead of failing (2027-03-14 02:30)', () => {
    expect(() => localToUtc('2027-03-14', '02:30')).toThrow(); // strict, for typed-in times
    expect(resolveLocal('2027-03-14', '02:30').toISOString()).toBe('2027-03-14T10:30:00.000Z'); // 03:30 PDT
  });

  it('an ambiguous fall-back time resolves to the first occurrence', () => {
    expect(resolveLocal('2026-11-01', '01:30').toISOString()).toBe('2026-11-01T08:30:00.000Z');
  });
});
