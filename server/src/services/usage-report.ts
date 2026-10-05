import type pg from 'pg';

export interface UsageReport {
  /** Anonymous counters, per month and event (appointments created, requests received, ...). */
  monthly: { month: string; event: string; total: number }[];
  /** All-time totals per event. */
  totals: Record<string, number>;
  /** How much is stored right now. Counts only: never names, addresses, or phone numbers. */
  stored: {
    appointments: number;
    cancelledAppointments: number;
    repeatingSeries: number;
    pendingRequests: number;
    users: number;
  };
}

/** Real usage numbers for the portfolio. Everything here is a count; nothing identifies anyone. */
export async function buildUsageReport(pool: pg.Pool): Promise<UsageReport> {
  const monthly = await pool.query<{ month: string; event: string; total: number }>(
    `SELECT to_char(date_trunc('month', day), 'YYYY-MM') AS month, event, sum(count)::int AS total
     FROM usage_counters GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const totals: Record<string, number> = {};
  for (const r of monthly.rows) totals[r.event] = (totals[r.event] ?? 0) + r.total;

  const n = async (sql: string) => (await pool.query<{ n: number }>(sql)).rows[0]?.n ?? 0;
  return {
    monthly: monthly.rows,
    totals,
    stored: {
      appointments: await n(
        `SELECT count(*)::int AS n FROM appointments WHERE status = 'scheduled'`,
      ),
      cancelledAppointments: await n(
        `SELECT count(*)::int AS n FROM appointments WHERE status = 'cancelled'`,
      ),
      repeatingSeries: await n(`SELECT count(*)::int AS n FROM series WHERE status = 'active'`),
      pendingRequests: await n(
        `SELECT count(*)::int AS n FROM booking_requests WHERE status = 'pending'`,
      ),
      users: await n('SELECT count(*)::int AS n FROM users'),
    },
  };
}

export function formatUsageReport(r: UsageReport): string {
  const lines = ['USAGE (anonymous counters)', ''];
  if (r.monthly.length === 0) lines.push('  nothing recorded yet');
  for (const m of r.monthly) lines.push(`  ${m.month}  ${m.event.padEnd(26)} ${m.total}`);
  lines.push('', 'ALL-TIME TOTALS');
  for (const [event, total] of Object.entries(r.totals))
    lines.push(`  ${event.padEnd(26)} ${total}`);
  lines.push('', 'CURRENTLY STORED (counts only)');
  for (const [k, v] of Object.entries(r.stored)) lines.push(`  ${k.padEnd(26)} ${v}`);
  return lines.join('\n');
}
