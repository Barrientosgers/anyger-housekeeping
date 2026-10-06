import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../src/domain/recurrence.js';
import { utcToLocal } from '../../src/domain/time.js';
import {
  CSRF,
  loggedInAgent,
  resetDb,
  sample,
  setup,
  TEST_EMAIL,
  TEST_PASSWORD,
} from './helpers.js';

// Regression tests for the security review (docs/security-review.md). Each one pins a behaviour
// that was either found missing in the review or is a control SECURITY.md relies on.

let ctx: Awaited<ReturnType<typeof setup>>;
let agent: Awaited<ReturnType<typeof loggedInAgent>>;
beforeAll(async () => (ctx = await setup()));
beforeEach(async () => {
  await resetDb(ctx.pool);
  agent = await loggedInAgent(ctx.app);
});
afterAll(() => ctx.pool.end());

const today = () => utcToLocal(new Date()).date;
const form = (over: object = {}) => ({
  clientName: 'Laura',
  clientPhone: '5550100199',
  address: '77 Sample Rd',
  preferredDate: addDays(today(), 14),
  preferredTime: '09:00',
  repeat: 'none',
  notes: '',
  lang: 'es',
  website: '',
  ...over,
});
const NIL = '00000000-0000-4000-8000-000000000000';

describe('every private route requires a login', () => {
  const routes: [string, string][] = [
    ['get', '/api/auth/me'],
    ['get', '/api/appointments?from=2026-10-01&to=2026-10-31'],
    ['get', `/api/appointments/${NIL}`],
    ['post', '/api/appointments'],
    ['put', `/api/appointments/${NIL}`],
    ['post', `/api/appointments/${NIL}/cancel`],
    ['get', '/api/requests'],
    ['get', '/api/requests/count'],
    ['get', `/api/requests/${NIL}`],
    ['post', `/api/requests/${NIL}/accept`],
    ['post', `/api/requests/${NIL}/decline`],
    ['post', '/api/translations'],
  ];
  it.each(routes)('%s %s -> 401 when logged out', async (method, url) => {
    const req = (supertest(ctx.app) as unknown as Record<string, (u: string) => supertest.Test>)[
      method
    ]!(url);
    const res = await req.set(CSRF).send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'unauthenticated' } });
  });

  it('the only open routes are the booking form, login, and the health check', async () => {
    await supertest(ctx.app).get('/healthz').expect(200);
    await supertest(ctx.app).post('/api/public/requests').set(CSRF).send(form()).expect(201);
    await supertest(ctx.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'x@y.z', password: 'x' })
      .expect(401);
  });
});

describe('sessions', () => {
  const sidOf = (res: supertest.Response) =>
    String(res.headers['set-cookie']).match(/anyger\.sid=([^;]+)/)?.[1];

  it('a new session id is issued on every login (no fixation) and logout really ends it', async () => {
    const login = () =>
      supertest(ctx.app)
        .post('/api/auth/login')
        .set(CSRF)
        .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const a = await login().expect(200);
    const b = await login().expect(200);
    expect(sidOf(a)).toBeDefined();
    expect(sidOf(a)).not.toBe(sidOf(b));

    const cookie = String(a.headers['set-cookie']);
    await supertest(ctx.app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    await supertest(ctx.app).post('/api/auth/logout').set('Cookie', cookie).set(CSRF).expect(204);
    // the old cookie is now worthless, even though the browser still has it
    await supertest(ctx.app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('the cookie is HttpOnly, SameSite=Lax, and Secure in production behind HTTPS', async () => {
    const prod = await setup({ config: { NODE_ENV: 'production' }, rateLimit: false });
    try {
      const res = await supertest(prod.app)
        .post('/api/auth/login')
        .set(CSRF)
        .set('X-Forwarded-Proto', 'https')
        .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
        .expect(200);
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Secure/i);
      const expires = new Date(cookie.match(/Expires=([^;]+)/i)![1]!).getTime();
      const days = (expires - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(89); // 90 days: long enough for the owners, not forever
      expect(days).toBeLessThan(91);
    } finally {
      await prod.pool.end();
    }
  });
});

describe('response headers', () => {
  it('private data is never cacheable: every /api response says no-store', async () => {
    const checks = [
      await agent.get('/api/auth/me'),
      await agent.get('/api/appointments?from=2026-10-01&to=2026-10-31'),
      await supertest(ctx.app).get('/api/appointments?from=2026-10-01&to=2026-10-31'), // 401
      await supertest(ctx.app).post('/api/public/requests').set(CSRF).send({}), // 400
      await supertest(ctx.app).get('/api/nope'), // 404
    ];
    for (const res of checks) expect(res.headers['cache-control']).toBe('no-store');
  });

  it('standard hardening headers are present and the server does not advertise itself', async () => {
    const res = await supertest(ctx.app).get('/healthz');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('the content security policy allows only the app itself: no inline styles, no outside sources', async () => {
    const csp = String(
      (await supertest(ctx.app).get('/healthz')).headers['content-security-policy'],
    );
    const directive = (name: string) =>
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `)) ?? '';
    for (const name of ['default-src', 'script-src', 'style-src', 'font-src', 'connect-src']) {
      expect(directive(name)).toBe(`${name} 'self'`);
    }
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https:|http:|\*/);
    expect(directive('script-src-attr')).toBe("script-src-attr 'none'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('no cross-origin access: preflights and cross-origin requests get no CORS grant', async () => {
    const pre = await supertest(ctx.app)
      .options('/api/appointments')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    const real = await supertest(ctx.app).get('/healthz').set('Origin', 'https://evil.example');
    expect(real.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('hostile input', () => {
  it('SQL injection strings are stored as plain text and the tables survive', async () => {
    const evil = "Robert'); DROP TABLE appointments; --";
    const created = (
      await agent
        .post('/api/appointments')
        .set(CSRF)
        .send({ ...sample, clientName: evil, notes: "' OR '1'='1" })
        .expect(201)
    ).body.appointment;
    expect(created.clientName).toBe(evil);
    const list = await agent.get('/api/appointments?from=2026-06-01&to=2026-06-30').expect(200);
    expect(list.body.appointments[0].clientName).toBe(evil);
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM appointments')).rows[0].n).toBe(1);
  });

  it.each([
    ['/api/appointments?from=2026-06-01%27%20OR%201%3D1--&to=2026-06-30'],
    ['/api/appointments?from=2026-06-01&to=2026-06-30;DROP%20TABLE%20users'],
    ["/api/appointments/1'%20OR%20'1'='1"],
    ['/api/appointments/..%2f..%2fetc%2fpasswd'],
    ['/api/requests/1%20OR%201=1'],
  ])('injection in a URL (%s) is rejected before it reaches the database', async (url) => {
    const res = await agent.get(url);
    expect([400, 404]).toContain(res.status);
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(1);
  });

  it('prototype-pollution payloads change nothing', async () => {
    const res = await agent
      .post('/api/appointments')
      .set(CSRF)
      .set('Content-Type', 'application/json')
      .send(
        `{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"clientName":"A","address":"B","date":"2026-06-10","time":"09:00","durationMin":60}`,
      );
    expect([201, 400]).toContain(res.status);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('extra, unexpected fields are ignored rather than stored', async () => {
    const res = await agent
      .post('/api/appointments')
      .set(CSRF)
      .send({ ...sample, status: 'cancelled', created_by: 'someone-else', id: NIL, role: 'admin' })
      .expect(201);
    expect(res.body.appointment.status).toBe('scheduled');
    expect(res.body.appointment.id).not.toBe(NIL);
  });

  it('an oversized body is refused with 413, not crashed on', async () => {
    const res = await supertest(ctx.app)
      .post('/api/public/requests')
      .set(CSRF)
      .send(form({ notes: 'x'.repeat(30_000) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: { code: 'too_large' } });
  });

  it('malformed JSON gets a clean 400 with no parser details', async () => {
    const res = await supertest(ctx.app)
      .post('/api/public/requests')
      .set(CSRF)
      .set('Content-Type', 'application/json')
      .send('{"clientName": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'bad_json' } });
  });

  it('a body sent as plain text is ignored (JSON only), so it just fails validation', async () => {
    const res = await supertest(ctx.app)
      .post('/api/public/requests')
      .set(CSRF)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(form()));
    expect(res.status).toBe(400);
    expect(
      (await ctx.pool.query('SELECT count(*)::int AS n FROM booking_requests')).rows[0].n,
    ).toBe(0);
  });

  it('unknown API paths and methods give a bare JSON 404, never a stack trace or HTML', async () => {
    for (const [method, url] of [
      ['get', '/api/nope'],
      ['delete', '/api/appointments'],
      ['patch', '/api/anything'],
    ] as const) {
      const res = await (agent as unknown as Record<string, (u: string) => supertest.Test>)[
        method
      ]!(url).set(CSRF);
      expect([404, 403]).toContain(res.status);
      expect(res.text).not.toMatch(/<html|at .*\(.*:\d+:\d+\)|node_modules/i);
    }
  });
});

describe('failures never leak internals', () => {
  it('a database failure returns a bare 500 with no message, query, or stack', async () => {
    const broken = await setup({
      wrapPool: (pool) =>
        new Proxy(pool, {
          get(target, prop) {
            if (prop === 'query') {
              return (...args: unknown[]) => {
                if (String(args[0]).includes('FROM appointments')) {
                  throw Object.assign(new Error('SECRET-DB-DETAIL SELECT * FROM appointments'), {
                    code: '42P01',
                  });
                }
                return (target.query as (...a: unknown[]) => unknown)(...args);
              };
            }
            const value = (target as unknown as Record<string | symbol, unknown>)[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }),
    });
    try {
      const a = await loggedInAgent(broken.app);
      const res = await a.get('/api/appointments?from=2026-06-01&to=2026-06-30');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { code: 'internal' } });
      expect(res.text).not.toMatch(/SECRET-DB-DETAIL|SELECT|42P01|stack|node_modules/i);
    } finally {
      await broken.pool.end();
    }
  });
});

describe('rate limits identify the real visitor, not a proxy', () => {
  const limited = (trust: boolean) =>
    setup({ rateLimit: true, config: { TRUST_CLOUDFLARE_IP: trust } });
  const post = (app: Parameters<typeof supertest>[0], headers: Record<string, string> = {}) =>
    supertest(app).post('/api/public/requests').set(CSRF).set(headers).send({}); // invalid body: 400, nothing stored

  it('behind Cloudflare: each visitor gets their own bucket of 5 per hour', async () => {
    const c = await limited(true);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++)
        statuses.push((await post(c.app, { 'CF-Connecting-IP': '203.0.113.5' })).status);
      expect(statuses).toEqual([400, 400, 400, 400, 400, 429, 429]);
      // a different visitor is not affected by the first one's lockout
      expect((await post(c.app, { 'CF-Connecting-IP': '203.0.113.6' })).status).toBe(400);
    } finally {
      await c.pool.end();
    }
  });

  it('a forged X-Forwarded-For cannot reset the limit', async () => {
    const c = await limited(true);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        statuses.push(
          (
            await post(c.app, {
              'CF-Connecting-IP': '203.0.113.9',
              'X-Forwarded-For': `10.0.0.${i}`,
            })
          ).status,
        );
      }
      expect(statuses.slice(5)).toEqual([429, 429]);
    } finally {
      await c.pool.end();
    }
  });

  it('when NOT behind Cloudflare the header is ignored, so it cannot be used to dodge the limit', async () => {
    const c = await limited(false);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++)
        statuses.push((await post(c.app, { 'CF-Connecting-IP': `198.51.100.${i}` })).status);
      expect(statuses.slice(5)).toEqual([429, 429]); // all shared one bucket; the forged header changed nothing
    } finally {
      await c.pool.end();
    }
  });

  it('a malformed CF-Connecting-IP is ignored, not trusted', async () => {
    const c = await limited(true);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++)
        statuses.push((await post(c.app, { 'CF-Connecting-IP': `not-an-ip-${i}` })).status);
      expect(statuses.slice(5)).toEqual([429, 429]);
    } finally {
      await c.pool.end();
    }
  });

  it('IPv6 visitors in the same /56 block share a bucket (no dodging by rotating addresses)', async () => {
    const c = await limited(true);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++)
        statuses.push(
          (await post(c.app, { 'CF-Connecting-IP': `2001:db8:abcd:12${i}::1` })).status,
        );
      expect(statuses.slice(5)).toEqual([429, 429]);
    } finally {
      await c.pool.end();
    }
  });

  it('login attempts are limited per visitor too (10 per 15 minutes)', async () => {
    const c = await limited(true);
    try {
      const attempt = (ip: string) =>
        supertest(c.app)
          .post('/api/auth/login')
          .set(CSRF)
          .set('CF-Connecting-IP', ip)
          .send({ email: 'a@b.c', password: 'wrong' });
      for (let i = 0; i < 10; i++) expect((await attempt('203.0.113.50')).status).toBe(401);
      expect((await attempt('203.0.113.50')).status).toBe(429);
      expect((await attempt('203.0.113.51')).status).toBe(401); // somebody else can still sign in
    } finally {
      await c.pool.end();
    }
  });
});
