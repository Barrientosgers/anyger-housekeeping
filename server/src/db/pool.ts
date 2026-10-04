import pg from 'pg';

// Return Postgres `date` columns as plain "YYYY-MM-DD" strings. The default parser builds a
// JS Date at server-local midnight, which silently shifts days across time zones.
pg.types.setTypeParser(1082, (value: string) => value);

export function createPool(connectionString: string, production: boolean): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 5,
    // Neon requires TLS; local Docker Postgres does not.
    ssl: production ? { rejectUnauthorized: true } : undefined,
  });
}
