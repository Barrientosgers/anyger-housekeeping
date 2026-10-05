import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../src/domain/recurrence.js';
import { utcToLocal } from '../../src/domain/time.js';
import { createLogger } from '../../src/logger.js';
import { createNotifier } from '../../src/services/notify.js';
import { FakeSmsProvider } from '../../src/services/sms/fake.js';
import { CSRF, loggedInAgent, resetDb, sample, setup } from './helpers.js';

const DAD = '+15550100100';
const APP_URL = 'https://app.example.com';
let clock = 1_000_000;
let sms: FakeSmsProvider;
let ctx: Awaited<ReturnType<typeof setup>>;
let agent: Awaited<ReturnType<typeof loggedInAgent>>;
let cooldownMs = 0;
let monthlyLimit = 150;

const build = () =>
  setup({
    makeNotifier: (pool) =>
      createNotifier({
        provider: sms,
        to: DAD,
        pool,
        logger: createLogger('silent'),
        appUrl: APP_URL,
        cooldownMs,
        monthlyLimit,
        now: () => clock,
      }),
  });

beforeAll(async () => {
  sms = new FakeSmsProvider();
  ctx = await build();
});
beforeEach(async () => {
  sms.sent.length = 0;
  sms.failWith = null;
  cooldownMs = 0;
  monthlyLimit = 150;
  clock = 1_000_000;
  // fresh notifier per test so cooldown state never leaks between tests
  await ctx.pool.end().catch(() => undefined);
  ctx = await build();
  await resetDb(ctx.pool);
  agent = await loggedInAgent(ctx.app);
});
afterAll(() => ctx.pool.end().catch(() => undefined));

const today = () => utcToLocal(new Date()).date;
const request = (over: object = {}) => ({
  clientName: 'UniqueClientName',
  clientPhone: '(555) 010-0777',
  address: '999 Private Address Ln',
  preferredDate: addDays(today(), 14),
  preferredTime: '09:00',
  repeat: 'none',
  notes: 'secret note text',
  lang: 'es',
  website: '',
  ...over,
});
const submit = (body: object = request()) =>
  supertest(ctx.app).post('/api/public/requests').set(CSRF).send(body);
const counters = async () =>
  Object.fromEntries(
    (await ctx.pool.query('SELECT event, count FROM usage_counters')).rows.map(
      (r: { event: string; count: number }) => [r.event, r.count],
    ),
  );

describe('texts to the owner', () => {
  it('a new booking request texts your dad a generic message with the app link', async () => {
    await submit().expect(201);
    await ctx.notifier!.flush();
    expect(sms.sent).toEqual([
      { to: DAD, body: `AnyGer's: tiene una solicitud nueva. Revise la app: ${APP_URL}` },
    ]);
  });

  it('never puts personal data in a text', async () => {
    await submit().expect(201);
    await agent
      .post('/api/appointments')
      .set(CSRF)
      .send({
        ...sample,
        clientName: 'UniqueClientName',
        address: '999 Private Address Ln',
        notes: 'secret note text',
      })
      .expect(201);
    await ctx.notifier!.flush();
    expect(sms.sent.length).toBeGreaterThanOrEqual(2);
    for (const m of sms.sent) {
      expect(m.body).not.toMatch(/UniqueClientName|Private Address|secret note|555|010/);
      expect(m.body.length).toBeLessThan(120); // single-segment friendly
    }
  });

  it('spam caught by the trap field sends nothing', async () => {
    await submit(request({ website: 'http://spam.example' })).expect(201);
    await submit(request({ clientName: '' })).expect(400);
    await ctx.notifier!.flush();
    expect(sms.sent).toEqual([]);
  });

  it('creating, editing, and cancelling an appointment each send their own text', async () => {
    const created = (await agent.post('/api/appointments').set(CSRF).send(sample).expect(201)).body
      .appointment;
    await agent
      .put(`/api/appointments/${created.id}`)
      .set(CSRF)
      .send({ ...sample, time: '11:00' })
      .expect(200);
    await agent.post(`/api/appointments/${created.id}/cancel`).set(CSRF).expect(200);
    await ctx.notifier!.flush();
    expect(sms.sent.map((m) => m.body.split(':')[1]?.trim())).toEqual([
      'hay una cita nueva en el calendario',
      'una cita tiene cambios. Revise el calendario',
      'hay una cita cancelada. Revise el calendario',
    ]);
  });

  it('a repeating series also counts as a new appointment', async () => {
    await agent
      .post('/api/appointments')
      .set(CSRF)
      .send({ ...sample, repeat: 'weekly' })
      .expect(201);
    await ctx.notifier!.flush();
    expect(sms.sent).toHaveLength(1);
  });

  it('accepting a request does not text (the owners just did it themselves)', async () => {
    await submit().expect(201);
    await ctx.notifier!.flush();
    sms.sent.length = 0;
    const id = (await ctx.pool.query('SELECT id FROM booking_requests')).rows[0].id;
    await agent
      .post(`/api/requests/${id}/accept`)
      .set(CSRF)
      .send({ ...sample, date: addDays(today(), 15) })
      .expect(200);
    await agent.post(`/api/requests/${id}/decline`).set(CSRF).expect(409);
    await ctx.notifier!.flush();
    expect(sms.sent).toEqual([]);
  });

  it('counts texts that were sent', async () => {
    await submit().expect(201);
    await ctx.notifier!.flush();
    expect((await counters()).sms_sent).toBe(1);
  });
});

describe('guards against floods and cost', () => {
  it('a burst of the same kind becomes one text, other kinds still go out', async () => {
    cooldownMs = 10 * 60_000;
    ctx = await build();
    await resetDb(ctx.pool);
    agent = await loggedInAgent(ctx.app);
    await submit().expect(201);
    await submit().expect(201);
    await submit().expect(201);
    await agent.post('/api/appointments').set(CSRF).send(sample).expect(201);
    await ctx.notifier!.flush();
    expect(sms.sent).toHaveLength(2); // one request text + one appointment text
  });

  it('after the cooldown passes, the next one is sent', async () => {
    cooldownMs = 10 * 60_000;
    ctx = await build();
    await resetDb(ctx.pool);
    await submit().expect(201);
    await ctx.notifier!.flush();
    clock += 11 * 60_000;
    await submit().expect(201);
    await ctx.notifier!.flush();
    expect(sms.sent).toHaveLength(2);
  });

  it('stops at the monthly limit, protecting the free allowance', async () => {
    monthlyLimit = 2;
    ctx = await build();
    await resetDb(ctx.pool);
    await ctx.pool.query(
      `INSERT INTO usage_counters (event, day, count)
       VALUES ('sms_sent', (now() AT TIME ZONE 'America/Los_Angeles')::date, 2)`,
    );
    await submit().expect(201);
    await ctx.notifier!.flush();
    expect(sms.sent).toEqual([]);
  });
});

describe('when texting breaks', () => {
  it('a provider outage never fails or slows the request, and is counted', async () => {
    sms.failWith = { ok: false, reason: 'timeout' };
    await submit().expect(201);
    await agent.post('/api/appointments').set(CSRF).send(sample).expect(201);
    await ctx.notifier!.flush();
    expect((await counters()).sms_failed).toBe(2);
    expect((await counters()).sms_sent).toBeUndefined();
    expect(
      (await ctx.pool.query('SELECT count(*)::int AS n FROM booking_requests')).rows[0].n,
    ).toBe(1);
  });

  it('a failed text does not block the next attempt even during the cooldown', async () => {
    cooldownMs = 10 * 60_000;
    ctx = await build();
    await resetDb(ctx.pool);
    sms.failWith = { ok: false, reason: 'network' };
    await submit().expect(201);
    await ctx.notifier!.flush();
    sms.failWith = null;
    await submit().expect(201);
    await ctx.notifier!.flush();
    expect(sms.sent).toHaveLength(1);
  });

  it('a provider that throws is contained', async () => {
    const throwing = {
      name: 'boom',
      send: async () => {
        throw new Error('kaboom');
      },
    };
    const c = await setup({
      makeNotifier: (pool) =>
        createNotifier({
          provider: throwing,
          to: DAD,
          pool,
          logger: createLogger('silent'),
          cooldownMs: 0,
          monthlyLimit: 150,
        }),
    });
    await resetDb(c.pool);
    await supertest(c.app).post('/api/public/requests').set(CSRF).send(request()).expect(201);
    await c.notifier!.flush();
    await c.pool.end();
  });

  it('with no provider configured the app works and sends nothing', async () => {
    const c = await setup({
      makeNotifier: (pool) =>
        createNotifier({
          provider: null,
          to: DAD,
          pool,
          logger: createLogger('silent'),
          cooldownMs: 0,
          monthlyLimit: 150,
        }),
    });
    await resetDb(c.pool);
    await supertest(c.app).post('/api/public/requests').set(CSRF).send(request()).expect(201);
    await c.notifier!.flush();
    expect(sms.sent).toEqual([]);
    await c.pool.end();
  });
});
