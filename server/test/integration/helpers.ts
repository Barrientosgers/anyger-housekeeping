import { hash } from '@node-rs/argon2';
import supertest from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { migrate } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { createLogger } from '../../src/logger.js';
import type { Notifier } from '../../src/services/notify.js';
import type { Translator } from '../../src/services/translate/types.js';

export const TEST_EMAIL = 'tester@example.com';
export const TEST_PASSWORD = 'correct horse battery staple';
export const CSRF = { 'X-Requested-With': 'anyger' };

export async function setup(
  opts: {
    rateLimit?: boolean;
    makeNotifier?: (pool: ReturnType<typeof createPool>) => Notifier;
    translator?: Translator | null;
  } = {},
) {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL, false);
  await migrate(pool);
  const notifier = opts.makeNotifier?.(pool);
  const app = createApp({
    config,
    pool,
    logger: createLogger('silent'),
    rateLimit: opts.rateLimit,
    notifier,
    translator: opts.translator,
  });
  return { pool, app, notifier };
}

export async function resetDb(pool: ReturnType<typeof createPool>) {
  await pool.query(
    'TRUNCATE translation_cache, booking_requests, appointments, series, audit_log, usage_counters, sessions, users CASCADE',
  );
  await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [
    TEST_EMAIL,
    await hash(TEST_PASSWORD),
  ]);
}

/** A supertest agent that keeps cookies and is already logged in. */
export async function loggedInAgent(app: Parameters<typeof supertest.agent>[0]) {
  const agent = supertest.agent(app);
  await agent
    .post('/api/auth/login')
    .set(CSRF)
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
    .expect(200);
  return agent;
}

export const sample = {
  clientName: 'María García',
  clientPhone: '(555) 010-0000',
  address: '123 Example St, Springfield',
  date: '2026-06-10',
  time: '09:00',
  durationMin: 120,
  notes: 'Dos perros',
};
