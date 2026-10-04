import { describe, expect, it } from 'vitest';
import { localDaysToUtcRange, localToUtc, TimeError, utcToLocal } from '../../src/domain/time.js';

const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

describe('localToUtc', () => {
  it('uses PST (UTC-8) in winter', () => {
    expect(localToUtc('2026-01-15', '09:00').toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });

  it('uses PDT (UTC-7) in summer', () => {
    expect(localToUtc('2026-07-15', '09:00').toISOString()).toBe('2026-07-15T16:00:00.000Z');
  });

  it('spring forward 2026-03-08: before and after the jump differ by one hour of clock time', () => {
    expect(localToUtc('2026-03-08', '01:30').toISOString()).toBe('2026-03-08T09:30:00.000Z'); // PST
    expect(localToUtc('2026-03-08', '03:30').toISOString()).toBe('2026-03-08T10:30:00.000Z'); // PDT
  });

  it('rejects a time skipped by spring forward (02:30 on 2026-03-08)', () => {
    expect(() => localToUtc('2026-03-08', '02:30')).toThrowError(TimeError);
    try {
      localToUtc('2026-03-08', '02:30');
    } catch (e) {
      expect((e as TimeError).code).toBe('nonexistent_local_time');
    }
  });

  it('fall back 2026-11-01: an ambiguous time resolves to the first (PDT) occurrence', () => {
    expect(localToUtc('2026-11-01', '01:30').toISOString()).toBe('2026-11-01T08:30:00.000Z');
    expect(localToUtc('2026-11-01', '09:00').toISOString()).toBe('2026-11-01T17:00:00.000Z'); // PST
  });

  it('keeps 09:00 local across the DST change (UTC offset moves, wall clock does not)', () => {
    const before = localToUtc('2026-03-07', '09:00'); // PST
    const after = localToUtc('2026-03-09', '09:00'); // PDT
    expect(before.toISOString()).toBe('2026-03-07T17:00:00.000Z');
    expect(after.toISOString()).toBe('2026-03-09T16:00:00.000Z');
  });

  it.each([
    ['2026-02-30', '09:00'],
    ['not-a-date', '09:00'],
    ['2026-05-01', '25:00'],
  ])('rejects invalid input %s %s', (d, t) => {
    expect(() => localToUtc(d, t)).toThrowError(TimeError);
  });
});

describe('utcToLocal', () => {
  it('round-trips through localToUtc', () => {
    for (const [d, t] of [
      ['2026-01-15', '09:00'],
      ['2026-07-04', '14:45'],
      ['2026-03-08', '03:30'],
      ['2026-11-01', '09:00'],
    ] as const) {
      expect(utcToLocal(localToUtc(d, t))).toEqual({ date: d, time: t });
    }
  });

  it('puts late-evening Pacific on the correct local day even though UTC is the next day', () => {
    expect(utcToLocal(new Date('2026-07-16T06:30:00Z'))).toEqual({
      date: '2026-07-15',
      time: '23:30',
    });
  });
});

describe('localDaysToUtcRange', () => {
  it('normal day is 24 hours', () => {
    const [s, e] = localDaysToUtcRange('2026-05-10', '2026-05-10');
    expect(hoursBetween(s, e)).toBe(24);
  });

  it('spring-forward day is 23 hours', () => {
    const [s, e] = localDaysToUtcRange('2026-03-08', '2026-03-08');
    expect(hoursBetween(s, e)).toBe(23);
  });

  it('fall-back day is 25 hours', () => {
    const [s, e] = localDaysToUtcRange('2026-11-01', '2026-11-01');
    expect(hoursBetween(s, e)).toBe(25);
  });

  it('multi-day range is end-exclusive', () => {
    const [s, e] = localDaysToUtcRange('2026-05-10', '2026-05-12');
    expect(s.toISOString()).toBe('2026-05-10T07:00:00.000Z');
    expect(e.toISOString()).toBe('2026-05-13T07:00:00.000Z');
  });
});
