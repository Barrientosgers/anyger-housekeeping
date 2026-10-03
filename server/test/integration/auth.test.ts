import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CSRF, resetDb, setup, TEST_EMAIL, TEST_PASSWORD } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => (ctx = await setup()));
beforeEach(() => resetDb(ctx.pool));
afterAll(() => ctx.pool.end());

describe('auth', () => {
  it('rejects unauthenticated access to appointments', async () => {
    await supertest(ctx.app).get('/api/appointments?from=2026-06-01&to=2026-06-30').expect(401);
  });

  it('logs in with valid credentials and sets a hardened cookie', async () => {
    const res = await supertest(ctx.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: TEST_EMAIL.toUpperCase(), password: TEST_PASSWORD })
      .expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/anyger\.sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const wrong = await supertest(ctx.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: TEST_EMAIL, password: 'nope' });
    const unknown = await supertest(ctx.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'x@example.com', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('blocks state-changing requests without the CSRF header', async () => {
    await supertest(ctx.app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(403);
  });

  it('logout ends the session', async () => {
    const agent = supertest.agent(ctx.app);
    await agent
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/logout').set(CSRF).expect(204);
    await agent.get('/api/auth/me').expect(401);
  });
});
