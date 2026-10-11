import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../../src/domain/recurrence.js';
import { utcToLocal } from '../../src/domain/time.js';
import { purgeOldRequests } from '../../src/services/requests.js';
import { CSRF, loggedInAgent, resetDb, sample, setup } from './helpers.js';

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
  clientName: 'Laura Gómez',
  clientPhone: '(555) 010-0199',
  cleaningType: 'house',
  address: '77 Sample Rd',
  city: 'Springfield',
  zip: '90210',
  preferredDate: addDays(today(), 14),
  preferredTime: '09:00',
  repeat: 'none',
  notes: 'Dos gatos',
  lang: 'es',
  website: '',
  ...over,
});
const submit = (body: object = form()) =>
  supertest(ctx.app).post('/api/public/requests').set(CSRF).send(body); // no login

const rows = async () =>
  (await ctx.pool.query('SELECT * FROM booking_requests ORDER BY created_at')).rows;

describe('public booking form', () => {
  it('needs no login and stores a pending request', async () => {
    const res = await submit().expect(201);
    expect(res.body).toEqual({ ok: true });
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      client_name: 'Laura Gómez',
      status: 'pending',
      lang: 'es',
      repeat: 'none',
    });
  });

  it('never echoes what was submitted', async () => {
    const res = await submit(form({ clientName: 'UniqueNameXyz' })).expect(201);
    expect(JSON.stringify(res.body)).not.toContain('UniqueNameXyz');
  });

  it('silently drops a submission when the hidden trap field is filled (bots)', async () => {
    const res = await submit(form({ website: 'http://spam.example' })).expect(201);
    expect(res.body).toEqual({ ok: true }); // looks like success to the bot
    expect(await rows()).toHaveLength(0);
    expect((await ctx.pool.query('SELECT * FROM usage_counters')).rows).toEqual([]);
  });

  it('counts received requests anonymously', async () => {
    await submit().expect(201);
    expect((await ctx.pool.query('SELECT event, count FROM usage_counters')).rows).toEqual([
      { event: 'requests_received', count: 1 },
    ]);
  });

  it('rejects bad input with field names only, never values', async () => {
    const res = await submit(
      form({ clientName: '', clientPhone: 'abc<script>', preferredTime: '9am', repeat: 'daily' }),
    ).expect(400);
    expect(res.body.error.code).toBe('validation');
    expect(res.body.error.fields).toEqual(
      expect.arrayContaining(['clientName', 'clientPhone', 'preferredTime', 'repeat']),
    );
    expect(JSON.stringify(res.body)).not.toContain('script');
    expect(await rows()).toHaveLength(0);
  });

  it('rejects dates in the past or more than a year away', async () => {
    const past = await submit(form({ preferredDate: addDays(today(), -1) })).expect(400);
    expect(past.body.error.fields).toContain('preferredDate');
    await submit(form({ preferredDate: addDays(today(), 400) })).expect(400);
    await submit(form({ preferredDate: today() })).expect(201); // today is fine
  });

  it('rejects a preferred time that does not exist (spring forward), but allows the next valid one', async () => {
    // Freeze "today" so 2027-03-14 is always in range, whenever this test runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    try {
      const res = await submit(
        form({ preferredDate: '2027-03-14', preferredTime: '02:30' }),
      ).expect(400);
      expect(res.body.error.code).toBe('nonexistent_local_time');
      await submit(form({ preferredDate: '2027-03-14', preferredTime: '03:30' })).expect(201);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects oversized notes and a too-short phone number', async () => {
    await submit(form({ notes: 'x'.repeat(1001) })).expect(400);
    await submit(form({ clientPhone: '12345' })).expect(400);
  });

  it('normalizes phone numbers and rejects ones that cannot be real', async () => {
    await submit(form({ clientPhone: '1-555-010-0199' })).expect(201);
    expect((await rows())[0].client_phone).toBe('(555) 010-0199');
    for (const bad of ['555-0199', '(055) 010-0199', '(155) 010-0199', '555 010 01999']) {
      const res = await submit(form({ clientPhone: bad })).expect(400);
      expect(res.body.error.fields).toContain('clientPhone');
    }
  });

  it('requires city and a valid ZIP, but not the street or unit', async () => {
    await submit(form({ address: '', unit: '' })).expect(201);
    const [row] = await rows();
    expect(row).toMatchObject({ address: null, unit: null, city: 'Springfield', zip: '90210' });
    await submit(form({ zip: '9021' })).expect(400);
    await submit(form({ zip: 'abcde' })).expect(400);
    await submit(form({ zip: '90210-1234' })).expect(201);
    const res = await submit(form({ city: '  ', zip: '' })).expect(400);
    expect(res.body.error.fields).toEqual(expect.arrayContaining(['city', 'zip']));
  });

  it('stores the cleaning type and how often, including move-in and move-out', async () => {
    await submit(form({ cleaningType: 'office', repeat: 'biweekly' })).expect(201);
    await submit(form({ cleaningType: 'apartment', moveType: 'move_out' })).expect(201);
    const stored = await rows();
    expect(stored[0]).toMatchObject({
      cleaning_type: 'office',
      repeat: 'biweekly',
      move_type: 'none',
    });
    expect(stored[1]).toMatchObject({
      cleaning_type: 'apartment',
      repeat: 'none',
      move_type: 'move_out',
    });
    await submit(form({ cleaningType: 'castle' })).expect(400);
    await submit(form({ cleaningType: undefined })).expect(400);
    const both = await submit(form({ moveType: 'move_in', repeat: 'weekly' })).expect(400);
    expect(both.body.error.fields).toContain('moveType');
  });

  it('keeps the contact preference, and needs an email only when email is chosen', async () => {
    await submit(form()).expect(201); // default: call
    await submit(form({ contactMethod: 'text' })).expect(201);
    const noEmail = await submit(form({ contactMethod: 'email' })).expect(400);
    expect(noEmail.body.error.fields).toContain('contactEmail');
    await submit(form({ contactMethod: 'email', contactEmail: 'not-an-email' })).expect(400);
    await submit(form({ contactMethod: 'email', contactEmail: 'laura@example.com' })).expect(201);
    // An email typed but not chosen as the way to reach them is not kept.
    await submit(form({ contactMethod: 'call', contactEmail: 'extra@example.com' })).expect(201);
    const stored = await rows();
    expect(stored.map((r) => [r.contact_method, r.contact_email])).toEqual([
      ['call', null],
      ['text', null],
      ['email', 'laura@example.com'],
      ['call', null],
    ]);
  });

  it('keeps markup as plain text', async () => {
    await submit(form({ notes: '<img src=x onerror=alert(1)>' })).expect(201);
    expect((await rows())[0].notes).toBe('<img src=x onerror=alert(1)>');
  });

  it('still requires the custom header (blocks cross-site form posts)', async () => {
    await supertest(ctx.app).post('/api/public/requests').send(form()).expect(403);
  });

  it('stops storing once too many requests are waiting', async () => {
    await ctx.pool.query(
      `INSERT INTO booking_requests (client_name, client_phone, address, preferred_date, preferred_time)
       SELECT 'x', '5550100000', 'y', current_date + 5, '09:00' FROM generate_series(1, 100)`,
    );
    const res = await submit().expect(503);
    expect(res.body.error.code).toBe('busy');
    expect(await rows()).toHaveLength(100);
  });

  it('is rate limited per IP with a translatable error', async () => {
    const limited = await setup({ rateLimit: true });
    try {
      const post = () => supertest(limited.app).post('/api/public/requests').set(CSRF).send(form());
      for (let i = 0; i < 5; i++) await post().expect(201);
      const res = await post().expect(429);
      expect(res.body).toEqual({ error: { code: 'rate_limited' } });
    } finally {
      await limited.pool.end();
    }
  });
});

describe('owners: reviewing requests', () => {
  const idOf = async () => (await rows())[0].id as string;

  it('requires login for every owner route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    await supertest(ctx.app).get('/api/requests').expect(401);
    await supertest(ctx.app).get('/api/requests/count').expect(401);
    await supertest(ctx.app).get(`/api/requests/${id}`).expect(401);
    await supertest(ctx.app).post(`/api/requests/${id}/accept`).set(CSRF).send({}).expect(401);
    await supertest(ctx.app).post(`/api/requests/${id}/decline`).set(CSRF).expect(401);
  });

  it('shows the owners everything the client chose, including the new details', async () => {
    await submit(
      form({
        contactMethod: 'email',
        contactEmail: 'laura@example.com',
        cleaningType: 'office',
        unit: 'Suite 4',
      }),
    );
    const id = await idOf();
    const { request } = (await agent.get(`/api/requests/${id}`).expect(200)).body;
    expect(request).toMatchObject({
      contactMethod: 'email',
      contactEmail: 'laura@example.com',
      cleaningType: 'office',
      moveType: 'none',
      address: '77 Sample Rd',
      unit: 'Suite 4',
      city: 'Springfield',
      zip: '90210',
      clientPhone: '(555) 010-0199',
    });
  });

  it('lists pending requests oldest first and counts them', async () => {
    await submit(form({ clientName: 'First' }));
    await submit(form({ clientName: 'Second' }));
    const list = await agent.get('/api/requests').expect(200);
    expect(list.body.requests.map((r: { clientName: string }) => r.clientName)).toEqual([
      'First',
      'Second',
    ]);
    expect((await agent.get('/api/requests/count').expect(200)).body).toEqual({ pending: 2 });
  });

  it('opens one request', async () => {
    await submit();
    const res = await agent.get(`/api/requests/${await idOf()}`).expect(200);
    expect(res.body.request).toMatchObject({
      clientName: 'Laura Gómez',
      preferredTime: '09:00',
      status: 'pending',
      lang: 'es',
    });
    await agent.get('/api/requests/not-a-uuid').expect(400);
    await agent.get('/api/requests/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('accepting creates the appointment from the details the owners confirm', async () => {
    await submit();
    const id = await idOf();
    const date = addDays(today(), 15);
    const res = await agent
      .post(`/api/requests/${id}/accept`)
      .set(CSRF)
      .send({ ...sample, clientName: 'Laura Gómez', date, time: '10:30', durationMin: 180 })
      .expect(200);
    expect(res.body.appointment).toMatchObject({
      date,
      time: '10:30',
      durationMin: 180,
      status: 'scheduled',
    });

    const [stored] = await rows();
    expect(stored).toMatchObject({ status: 'accepted', appointment_id: res.body.appointment.id });
    expect((await agent.get('/api/requests/count')).body).toEqual({ pending: 0 });
    const cal = await agent.get(`/api/appointments?from=${date}&to=${date}`).expect(200);
    expect(cal.body.appointments).toHaveLength(1);
  });

  it('accepting a repeating request creates a series', async () => {
    await submit(form({ repeat: 'weekly' }));
    const id = await idOf();
    const date = addDays(today(), 15);
    const res = await agent
      .post(`/api/requests/${id}/accept`)
      .set(CSRF)
      .send({ ...sample, date, repeat: 'weekly' })
      .expect(200);
    expect(res.body.appointment.recurrence).toMatchObject({ freq: 'weekly' });
    const [stored] = await rows();
    expect(stored.series_id).toBe(res.body.appointment.seriesId);
    const counters = await ctx.pool.query('SELECT event FROM usage_counters ORDER BY event');
    expect(counters.rows.map((r: { event: string }) => r.event)).toEqual([
      'requests_accepted',
      'requests_received',
      'series_created',
    ]);
  });

  it('cannot be accepted twice', async () => {
    await submit();
    const id = await idOf();
    const body = { ...sample, date: addDays(today(), 15) };
    await agent.post(`/api/requests/${id}/accept`).set(CSRF).send(body).expect(200);
    const again = await agent.post(`/api/requests/${id}/accept`).set(CSRF).send(body).expect(409);
    expect(again.body.error.code).toBe('already_decided');
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM appointments')).rows[0].n).toBe(1);
  });

  it('a failed accept leaves the request pending (nothing is lost)', async () => {
    await submit();
    const id = await idOf();
    const bad = await agent
      .post(`/api/requests/${id}/accept`)
      .set(CSRF)
      .send({ ...sample, date: '2027-03-14', time: '02:30' })
      .expect(400);
    expect(bad.body.error.code).toBe('nonexistent_local_time');
    expect((await rows())[0].status).toBe('pending');
    await agent
      .post(`/api/requests/${id}/accept`)
      .set(CSRF)
      .send({ ...sample, clientName: '' })
      .expect(400);
    expect((await rows())[0].status).toBe('pending');
  });

  it('declining removes it from the pending list and cannot be repeated', async () => {
    await submit();
    const id = await idOf();
    await agent.post(`/api/requests/${id}/decline`).set(CSRF).expect(204);
    expect((await rows())[0]).toMatchObject({ status: 'declined' });
    expect((await agent.get('/api/requests').expect(200)).body.requests).toEqual([]);
    await agent.post(`/api/requests/${id}/decline`).set(CSRF).expect(409);
    await agent.post(`/api/requests/${id}/accept`).set(CSRF).send(sample).expect(409);
  });

  it('keeps personal data out of the audit trail', async () => {
    await submit();
    await agent
      .post(`/api/requests/${await idOf()}/decline`)
      .set(CSRF)
      .expect(204);
    const audit = await ctx.pool.query(
      `SELECT action, entity FROM audit_log WHERE entity = 'request'`,
    );
    expect(audit.rows).toEqual([{ action: 'decline', entity: 'request' }]);
    expect(JSON.stringify(audit.rows)).not.toContain('Laura');
  });
});

describe('retention', () => {
  it('deletes old decided and stale pending requests, keeps recent ones', async () => {
    const insert = (
      name: string,
      status: string,
      createdDaysAgo: number,
      decidedDaysAgo: number | null,
    ) =>
      ctx.pool.query(
        `INSERT INTO booking_requests (client_name, client_phone, address, preferred_date, preferred_time,
           status, created_at, decided_at)
         VALUES ($1, '5550100000', 'y', current_date + 5, '09:00', $2,
           now() - make_interval(days => $3),
           CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(days => $4::int) END)`,
        [name, status, createdDaysAgo, decidedDaysAgo],
      );
    await insert('old-declined', 'declined', 50, 40);
    await insert('old-accepted', 'accepted', 50, 31);
    await insert('recent-declined', 'declined', 10, 5);
    await insert('stale-pending', 'pending', 61, null);
    await insert('fresh-pending', 'pending', 20, null);

    expect(await purgeOldRequests(ctx.pool)).toBe(3);
    const left = (await rows()).map((r: { client_name: string }) => r.client_name).sort();
    expect(left).toEqual(['fresh-pending', 'recent-declined']);
  });
});
