import { createPool } from '../db/pool.js';
import { buildUsageReport, formatUsageReport } from '../services/usage-report.js';

// Usage: npm run usage -w server
// Reads DATABASE_URL (see docs/metrics.md for how to set it without leaving it in your shell history).
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL first (see docs/metrics.md).');
  process.exit(1);
}
const pool = createPool(databaseUrl, false);
try {
  console.log(formatUsageReport(await buildUsageReport(pool)));
} finally {
  await pool.end();
}
