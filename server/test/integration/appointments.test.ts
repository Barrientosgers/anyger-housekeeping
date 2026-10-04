import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CSRF, loggedInAgent, resetDb, sample, setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let agent: Awaited<ReturnType<typeof loggedInAgent>>;
beforeAll(async () => (ctx = await setup()));
beforeEach(async () => {
  await resetDb(ctx.pool);
  agent = await loggedInAgent(ctx.app);
});
afterAll(() => ctx.pool.end());

const create = (body: object = sample) => agent.post('/api/appointments').set(CSRF).send(body);

describe('appointments API', () => {
  it('creates an appointment, stores UTC, and returns Pacific local date/time', async () => {
    const res = await create().expect(201);
    expect(res.body.appointment).toMatchObject({
      clientName: 'María García',
      date: '2026-06-10',
      time: '09:00',
      startsAt: '2026-06-10T16:00:00.000Z', // PDT is UTC-7
      status: 'scheduled',
    });
    expect(res.body.overlaps).toBe(0);
    const stored = await ctx.pool.query('SELECT starts_at FROM appointments');
    expect(stored.rows[0].starts_at.toISOString()).toBe('2026-06-10T16:00:00.000Z');
  });

  it('keeps wall-clock 09:00 across daylight saving (winter vs summer UTC differ)', async () => {
    const winter = await create({ ...sample, date: '2026-01-15' }).expect(201);
    expect(winter.body.appointment.startsAt).toBe('2026-01-15T17:00:00.000Z');
    expect(winter.body.appointment.time).toBe('09:00');
  });

  it('rejects a time that does not exist on spring-forward day', async () => {
    const res = await create({ ...sample, date: '2026-03-08', time: '02:30' }).expect(400);
    expect(res.body.error.code).toBe('nonexistent_local_time');
  });

  it('validates input and never echoes submitted values', async () => {
    const res = await create({
      ...sample,
      clientName: '',
      durationMin: 5,
      clientPhone: 'abc<script>',
    }).expect(400);
    expect(res.body.error.code).toBe('validation');
    expect(res.body.error.fields).toEqual(
      expect.arrayContaining(['clientName', 'durationMin', 'clientPhone']),
    );
    expect(JSON.stringify(res.body)).not.toContain('script');
  });

  it('stores markup as plain text (encoding happens at render time)', async () => {
    const res = await create({ ...sample, notes: '<img src=x onerror=alert(1)>' }).expect(201);
    expect(res.body.appointment.notes).toBe('<img src=x onerror=alert(1)>');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('lists by Pacific date range and excludes cancelled', async () => {
    const a = await create({ ...sample, date: '2026-06-10' }).expect(201);
    await create({ ...sample, date: '2026-06-20' }).expect(201);
    await create({ ...sample, date: '2026-07-02' }).expect(201);
    await agent.post(`/api/appointments/${a.body.appointment.id}/cancel`).set(CSRF).expect(200);

    const res = await agent.get('/api/appointments?from=2026-06-01&to=2026-06-30').expect(200);
    expect(res.body.appointments.map((x: { date: string }) => x.date)).toEqual(['2026-06-20']);
  });

  it('puts a late-evening Pacific appointment on its local day, not the UTC day', async () => {
    await create({ ...sample, date: '2026-06-15', time: '22:30' }).expect(201); // 05:30Z next day
    const res = await agent.get('/api/appointments?from=2026-06-15&to=2026-06-15').expect(200);
    expect(res.body.appointments).toHaveLength(1);
  });

  it('rejects oversized or reversed ranges', async () => {
    await agent.get('/api/appointments?from=2026-01-01&to=2026-12-31').expect(400);
    await agent.get('/api/appointments?from=2026-06-10&to=2026-06-01').expect(400);
    await agent.get('/api/appointments').expect(400);
  });

  it('edits an appointment', async () => {
    const { body } = await create().expect(201);
    const res = await agent
      .put(`/api/appointments/${body.appointment.id}`)
      .set(CSRF)
      .send({ ...sample, time: '13:30', clientName: 'Ana López' })
      .expect(200);
    expect(res.body.appointment).toMatchObject({ time: '13:30', clientName: 'Ana López' });
  });

  it('cancels, and a cancelled appointment cannot be edited', async () => {
    const { body } = await create().expect(201);
    const id = body.appointment.id;
    const res = await agent.post(`/api/appointments/${id}/cancel`).set(CSRF).expect(200);
    expect(res.body.appointment.status).toBe('cancelled');
    await agent.put(`/api/appointments/${id}`).set(CSRF).send(sample).expect(404);
  });

  it('warns about overlaps but still saves', async () => {
    await create().expect(201);
    const res = await create({ ...sample, time: '10:00' }).expect(201); // overlaps 09:00-11:00
    expect(res.body.overlaps).toBe(1);
    const back = await create({ ...sample, time: '11:00' }).expect(201); // starts when other ends
    expect(back.body.overlaps).toBe(1); // overlaps only the 10:00-12:00 one
  });

  it('returns 404 for unknown ids and 400 for malformed ids', async () => {
    await agent.get('/api/appointments/00000000-0000-4000-8000-000000000000').expect(404);
    await agent.get('/api/appointments/not-a-uuid').expect(400);
  });

  it('records anonymous usage counts and an audit trail without personal data', async () => {
    const { body } = await create().expect(201);
    await agent.post(`/api/appointments/${body.appointment.id}/cancel`).set(CSRF).expect(200);
    const usage = await ctx.pool.query('SELECT event, count FROM usage_counters ORDER BY event');
    expect(usage.rows).toEqual([
      { event: 'appointments_cancelled', count: 1 },
      { event: 'appointments_created', count: 1 },
    ]);
    const audit = await ctx.pool.query('SELECT action, entity FROM audit_log ORDER BY id');
    expect(JSON.stringify(audit.rows)).not.toContain('García');
  });
});

describe('platform', () => {
  it('healthz reports ok and security headers are set', async () => {
    const res = await agent.get('/healthz').expect(200);
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
