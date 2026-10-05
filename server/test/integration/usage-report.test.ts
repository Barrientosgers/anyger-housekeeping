import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildUsageReport, formatUsageReport } from '../../src/services/usage-report.js';
import { resetDb, setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => (ctx = await setup()));
beforeEach(() => resetDb(ctx.pool));
afterAll(() => ctx.pool.end());

describe('usage report', () => {
  it('reports real counts by month and in total, with no personal data', async () => {
    await ctx.pool.query(`INSERT INTO usage_counters (event, day, count) VALUES
      ('appointments_created', '2026-10-05', 3), ('appointments_created', '2026-10-20', 2),
      ('appointments_created', '2026-11-02', 4), ('requests_received', '2026-10-06', 1)`);
    await ctx.pool.query(
      `INSERT INTO appointments (client_name, client_phone, address, starts_at, duration_min, status)
       VALUES ('Secret Person', '5550100999', '1 Private Ln', now(), 60, 'scheduled'),
              ('Other Person', NULL, '2 Private Ln', now(), 60, 'cancelled')`,
    );
    const report = await buildUsageReport(ctx.pool);
    expect(report.monthly).toEqual([
      { month: '2026-10', event: 'appointments_created', total: 5 },
      { month: '2026-10', event: 'requests_received', total: 1 },
      { month: '2026-11', event: 'appointments_created', total: 4 },
    ]);
    expect(report.totals).toEqual({ appointments_created: 9, requests_received: 1 });
    expect(report.stored).toMatchObject({
      appointments: 1,
      cancelledAppointments: 1,
      pendingRequests: 0,
      users: 1,
    });
    const text = formatUsageReport(report);
    expect(text).toContain('appointments_created');
    expect(text).not.toMatch(/Secret Person|Other Person|Private Ln|5550100999/);
  });

  it('says so plainly when nothing has been recorded', async () => {
    expect(formatUsageReport(await buildUsageReport(ctx.pool))).toContain('nothing recorded yet');
  });
});
