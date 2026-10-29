import supertest from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../src/domain/recurrence.js';
import { utcToLocal } from '../../src/domain/time.js';
import { createLogger } from '../../src/logger.js';
import { createEmailNotifier } from '../../src/services/email-notify.js';
import { FakeEmailProvider } from '../../src/services/email/fake.js';
import { combineNotifiers, createNotifier } from '../../src/services/notify.js';
import { FakeSmsProvider } from '../../src/services/sms/fake.js';
import { CSRF, loggedInAgent, resetDb, sample, setup } from './helpers.js';

const ME = 'owner@example.com';
const APP_URL = 'https://app.example.com';
let clock = 1_000_000;
let cooldownMs = 0;
let monthlyLimit = 100;
let email: FakeEmailProvider;
let sms: FakeSmsProvider;
let ctx: Awaited<ReturnType<typeof setup>>;

const build = () =>
  setup({
    makeNotifier: (pool) =>
      combineNotifiers(
        createNotifier({
          provider: sms,
          to: '+15550100100',
          pool,
          logger: createLogger('silent'),
          cooldownMs: 0,
          monthlyLimit: 150,
          now: () => clock,
        }),
        createEmailNotifier({
          provider: email,
          to: ME,
          pool,
          logger: createLogger('silent'),
          appUrl: APP_URL,
          cooldownMs,
          monthlyLimit,
          now: () => clock,
        }),
      ),
  });

beforeEach(async () => {
  email = new FakeEmailProvider();
  sms = new FakeSmsProvider();
  cooldownMs = 0;
  monthlyLimit = 100;
  clock = 1_000_000;
  await ctx?.pool.end().catch(() => undefined);
  ctx = await build(); // fresh notifier per test so cooldown state never leaks
  await resetDb(ctx.pool);
});
afterAll(() => ctx.pool.end().catch(() => undefined));

const today = () => utcToLocal(new Date()).date;
const request = (over: object = {}) => ({
  clientName: 'UniqueClientName',
  clientPhone: '(555) 010-0777',
  cleaningType: 'house',
  address: '999 Private Address Ln',
  city: 'Springfield',
  zip: '90210',
  preferredDate: addDays(today(), 14),
  preferredTime: '09:00',
  repeat: 'none',
  notes: 'secret note text',
  lang: 'es',
  website: '',
  contactMethod: 'email',
  contactEmail: 'client-private@example.com',
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

describe('email alert for new booking requests', () => {
  it('emails the owner once, in both languages, with the app link', async () => {
    await submit().expect(201);
    await ctx.notifier!.flush();
    expect(email.sent).toHaveLength(1);
    const [m] = email.sent;
    expect(m!.to).toBe(ME);
    expect(m!.subject).toContain('nueva solicitud');
    expect(m!.subject).toContain('new booking request');
    expect(m!.body).toContain('Tiene una solicitud nueva');
    expect(m!.body).toContain('You have a new booking request');
    expect(m!.body).toContain(APP_URL);
  });

  it('never puts personal data in the email', async () => {
    await submit().expect(201);
    await ctx.notifier!.flush();
    for (const m of email.sent) {
      const all = `${m.subject}\n${m.body}`;
      expect(all).not.toMatch(
        /UniqueClientName|Private Address|secret note|client-private|Springfield|90210|555|010/,
      );
    }
  });

  it('stays quiet for appointments the owners make, while texts still go out', async () => {
    const agent = await loggedInAgent(ctx.app);
    const created = (await agent.post('/api/appointments').set(CSRF).send(sample).expect(201)).body
      .appointment;
    await agent
      .put(`/api/appointments/${created.id}`)
      .set(CSRF)
      .send({ ...sample, time: '11:00' });
    await agent.post(`/api/appointments/${created.id}/cancel`).set(CSRF).expect(200);
    await ctx.notifier!.flush();
    expect(email.sent).toEqual([]);
    expect(sms.sent).toHaveLength(3); // the text feature is unchanged
  });

  it('spam and invalid submissions send nothing', async () => {
    await submit(request({ website: 'http://spam.example' })).expect(201);
    await submit(request({ clientName: '' })).expect(400);
    await ctx.notifier!.flush();
    expect(email.sent).toEqual([]);
  });

  it('a burst of requests becomes one email, and the next one after the cooldown goes out', async () => {
    cooldownMs = 10 * 60_000;
    await ctx.pool.end().catch(() => undefined);
    ctx = await build();
    await resetDb(ctx.pool);
    await submit().expect(201);
    await submit().expect(201);
    await submit().expect(201);
    await ctx.notifier!.flush();
    expect(email.sent).toHaveLength(1);
    clock += 11 * 60_000;
    await submit().expect(201);
    await ctx.notifier!.flush();
    expect(email.sent).toHaveLength(2);
  });

  it('stops at the monthly limit, protecting the free allowance', async () => {
    monthlyLimit = 2;
    await ctx.pool.end().catch(() => undefined);
    ctx = await build();
    await resetDb(ctx.pool);
    for (let i = 0; i < 4; i++) {
      await submit().expect(201);
      await ctx.notifier!.flush();
    }
    expect(email.sent).toHaveLength(2);
    expect((await counters()).email_sent).toBe(2);
  });

  it('counts emails sent, and an outage never fails or delays the booking', async () => {
    await submit().expect(201);
    await ctx.notifier!.flush();
    email.failWith = { ok: false, reason: 'rejected' };
    await submit().expect(201); // the client still sees success
    await ctx.notifier!.flush();
    expect(await counters()).toMatchObject({
      requests_received: 2,
      email_sent: 1,
      email_failed: 1,
    });
    const stored = await ctx.pool.query('SELECT count(*)::int AS n FROM booking_requests');
    expect(stored.rows[0].n).toBe(2);
  });

  it('a failed email does not block the next attempt', async () => {
    cooldownMs = 10 * 60_000;
    await ctx.pool.end().catch(() => undefined);
    ctx = await build();
    await resetDb(ctx.pool);
    email.failWith = { ok: false, reason: 'timeout' };
    await submit().expect(201);
    await ctx.notifier!.flush();
    email.failWith = null;
    await submit().expect(201); // same clock tick: still inside the cooldown, but the last one failed
    await ctx.notifier!.flush();
    expect(email.sent).toHaveLength(1);
  });

  it('with no provider configured, nothing is sent and nothing breaks', async () => {
    const off = await setup({
      makeNotifier: (pool) =>
        createEmailNotifier({
          provider: null,
          to: ME,
          pool,
          logger: createLogger('silent'),
          cooldownMs: 0,
          monthlyLimit: 100,
        }),
    });
    try {
      await supertest(off.app).post('/api/public/requests').set(CSRF).send(request()).expect(201);
      await off.notifier!.flush();
      expect(email.sent).toEqual([]);
    } finally {
      await off.pool.end();
    }
  });
});
