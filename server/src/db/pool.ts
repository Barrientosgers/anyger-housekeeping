import pg from 'pg';

export function createPool(connectionString: string, production: boolean): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 5,
    // Neon requires TLS; local Docker Postgres does not.
    ssl: production ? { rejectUnauthorized: true } : undefined,
  });
}
