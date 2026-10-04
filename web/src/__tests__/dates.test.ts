import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  formatTime,
  monthGrid,
  startOfWeek,
  todayPacific,
  weekDays,
} from '../dates';

describe('date helpers', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is unaffected by daylight saving (pure calendar math)', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('clamps the day when stepping months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('weeks start on Sunday', () => {
    expect(startOfWeek('2026-10-03')).toBe('2026-09-27'); // Saturday -> previous Sunday
    expect(startOfWeek('2026-09-27')).toBe('2026-09-27');
    expect(weekDays('2026-10-03')).toHaveLength(7);
  });

  it('builds a month grid of full Sunday-Saturday weeks', () => {
    const grid = monthGrid('2026-02-10'); // Feb 2026 starts on Sunday and has 28 days
    expect(grid).toHaveLength(4);
    expect(grid[0]![0]).toBe('2026-02-01');
    expect(grid[3]![6]).toBe('2026-02-28');
    const oct = monthGrid('2026-10-15');
    expect(oct[0]![0]).toBe('2026-09-27');
    expect(oct.at(-1)![6]).toBe('2026-10-31');
  });

  it("uses Pacific Time for 'today', not UTC", () => {
    // 2026-07-16 03:00 UTC is still July 15 in Pacific.
    expect(todayPacific(new Date('2026-07-16T03:00:00Z'))).toBe('2026-07-15');
    expect(todayPacific(new Date('2026-01-16T07:59:00Z'))).toBe('2026-01-15');
    expect(todayPacific(new Date('2026-01-16T08:01:00Z'))).toBe('2026-01-16');
  });

  it('formats wall-clock times for each language', () => {
    expect(formatTime('09:00', 'en')).toMatch(/^9:00\sAM$/);
    expect(formatTime('13:30', 'en')).toMatch(/^1:30\sPM$/);
    expect(formatTime('13:30', 'es')).toMatch(/^1:30\sp\.\s?m\.$/);
  });
});

describe('week label', () => {
  it('formats a compact range in Spanish with lowercase month', async () => {
    const { formatRange } = await import('../dates');
    expect(formatRange('2026-10-04', '2026-10-10', 'es')).toMatch(/^4\s?[–-]\s?10 de octubre$/);
  });
});
