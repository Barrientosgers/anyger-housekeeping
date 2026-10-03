import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL first.');
  process.exit(1);
}
const pool = createPool(databaseUrl, false);
const applied = await migrate(pool);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
await pool.end();
