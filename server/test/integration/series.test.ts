import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../src/domain/recurrence.js';
import { CSRF, loggedInAgent, resetDb, sample, setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let agent: Awaited<ReturnType<typeof loggedInAgent>>;
beforeAll(async () => (ctx = await setup()));
beforeEach(async () => {
  await resetDb(ctx.pool);
  agent = await loggedInAgent(ctx.app);
});
afterAll(() => ctx.pool.end());

// 2026-10-06 is a Tuesday.
const weekly = { ...sample, date: '2026-10-06', time: '09:00', repeat: 'weekly' };

type Visit = {
  id: string;
  date: string;
  time: string;
  startsAt: string;
  clientName: string;
  durationMin: number;
};

const createSeries = async (body: object = weekly) =>
  (await agent.post('/api/appointments').set(CSRF).send(body).expect(201)).body
    .appointment as Visit;
// The API caps a request at 62 days (the app asks one month at a time), so long ranges are chunked.
const list = async (from: string, to: string) => {
  const all: Visit[] = [];
  for (let start = from; start <= to; start = addDays(start, 60)) {
    const end = addDays(start, 59) < to ? addDays(start, 59) : to;
    const res = await agent.get(`/api/appointments?from=${start}&to=${end}`).expect(200);
    all.push(...(res.body.appointments as Visit[]));
  }
  return all.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
};
const dates = (v: Visit[]) => v.map((x) => x.date);

describe('creating a repeating series', () => {
  it('stores one rule and generates visits only for the dates on screen', async () => {
    const first = await createSeries();
    expect(first.id).toMatch(/^s:[0-9a-f-]{36}:2026-10-06$/);
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM series')).rows[0].n).toBe(1);
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM appointments')).rows[0].n).toBe(0);

    expect(dates(await list('2026-10-01', '2026-10-31'))).toEqual([
      '2026-10-06',
      '2026-10-13',
      '2026-10-20',
      '2026-10-27',
    ]);
    expect(dates(await list('2026-10-14', '2026-10-20'))).toEqual(['2026-10-20']);
    expect(await list('2026-09-01', '2026-10-05')).toEqual([]);
  });

  it('every 2 weeks and monthly (same weekday of the month)', async () => {
    await createSeries({ ...weekly, repeat: 'biweekly', clientName: 'Biweekly' });
    await createSeries({ ...weekly, date: '2026-10-13', repeat: 'monthly', clientName: 'Monthly' });
    const oct = await list('2026-10-01', '2026-12-31');
    expect(oct.filter((v) => v.clientName === 'Biweekly').map((v) => v.date)).toEqual([
      '2026-10-06',
      '2026-10-20',
      '2026-11-03',
      '2026-11-17',
      '2026-12-01',
      '2026-12-15',
      '2026-12-29',
    ]);
    expect(oct.filter((v) => v.clientName === 'Monthly').map((v) => v.date)).toEqual([
      '2026-10-13',
      '2026-11-10',
      '2026-12-08',
    ]);
  });

  it('honours an end date (inclusive)', async () => {
    await createSeries({ ...weekly, repeatUntil: '2026-10-20' });
    expect(dates(await list('2026-10-01', '2026-12-31'))).toEqual([
      '2026-10-06',
      '2026-10-13',
      '2026-10-20',
    ]);
  });

  it('rejects an end date before the start, and a first visit at a nonexistent time', async () => {
    const bad = await agent
      .post('/api/appointments')
      .set(CSRF)
      .send({ ...weekly, repeatUntil: '2026-10-01' })
      .expect(400);
    expect(bad.body.error.fields).toContain('repeatUntil');
    const dst = await agent
      .post('/api/appointments')
      .set(CSRF)
      .send({ ...weekly, date: '2027-03-14', time: '02:30' })
      .expect(400);
    expect(dst.body.error.code).toBe('nonexistent_local_time');
  });

  it('counts series separately and keeps the audit trail free of personal data', async () => {
    await createSeries();
    const usage = await ctx.pool.query('SELECT event, count FROM usage_counters');
    expect(usage.rows).toEqual([{ event: 'series_created', count: 1 }]);
    const audit = await ctx.pool.query('SELECT action, entity FROM audit_log WHERE entity = $1', [
      'series',
    ]);
    expect(audit.rows).toEqual([{ action: 'create', entity: 'series' }]);
  });
});

describe('monthly ordinal', () => {
  it('exposes "2nd Tuesday" vs "last Tuesday" so the label is right', async () => {
    await createSeries({ ...weekly, date: '2026-10-13', repeat: 'monthly', clientName: 'Second' });
    await createSeries({ ...weekly, date: '2026-12-29', repeat: 'monthly', clientName: 'Last' });
    const jan = await agent.get('/api/appointments?from=2027-01-01&to=2027-01-31').expect(200);
    const byName = Object.fromEntries(
      jan.body.appointments.map((v: { clientName: string; date: string; recurrence: object }) => [
        v.clientName,
        v,
      ]),
    );
    expect(byName.Second).toMatchObject({ date: '2027-01-12', recurrence: { ordinal: 2 } });
    expect(byName.Last).toMatchObject({ date: '2027-01-26', recurrence: { ordinal: 5 } }); // 4th by count, but "last"
  });
});

describe('daylight saving', () => {
  it('a weekly 9:00 AM visit stays 9:00 local across fall back (UTC offset changes)', async () => {
    await createSeries({ ...weekly, date: '2026-10-27' });
    const visits = await list('2026-10-27', '2026-11-10');
    expect(visits.map((v) => [v.date, v.time, v.startsAt])).toEqual([
      ['2026-10-27', '09:00', '2026-10-27T16:00:00.000Z'],
      ['2026-11-03', '09:00', '2026-11-03T17:00:00.000Z'],
      ['2026-11-10', '09:00', '2026-11-10T17:00:00.000Z'],
    ]);
  });

  it('a generated visit at a time skipped by spring forward moves to the next valid time', async () => {
    // 2027-03-07 and 2027-03-14 are Sundays; clocks jump 02:00 -> 03:00 on the 14th.
    await createSeries({ ...weekly, date: '2027-03-07', time: '02:30' });
    const visits = await list('2027-03-07', '2027-03-14');
    expect(visits.map((v) => [v.date, v.time, v.startsAt])).toEqual([
      ['2027-03-07', '02:30', '2027-03-07T10:30:00.000Z'],
      ['2027-03-14', '03:30', '2027-03-14T10:30:00.000Z'],
    ]);
  });
});

describe('editing one visit', () => {
  it('"this one" moves only that visit; others are untouched', async () => {
    const first = await createSeries();
    const second = (await list('2026-10-13', '2026-10-13'))[0]!;
    const res = await agent
      .put(`/api/appointments/${encodeURIComponent(second.id)}`)
      .set(CSRF)
      .send({ ...weekly, date: '2026-10-14', time: '13:30', scope: 'this' })
      .expect(200);
    expect(res.body.appointment).toMatchObject({ date: '2026-10-14', time: '13:30' });
    expect(res.body.appointment.id).toMatch(/^[0-9a-f-]{36}$/); // now a stored exception

    const visits = await list('2026-10-01', '2026-10-31');
    expect(visits.map((v) => [v.date, v.time])).toEqual([
      ['2026-10-06', '09:00'],
      ['2026-10-14', '13:30'],
      ['2026-10-20', '09:00'],
      ['2026-10-27', '09:00'],
    ]);
    expect(first.id).toContain('2026-10-06');
  });

  it('editing the same visit again updates the exception instead of duplicating it', async () => {
    await createSeries();
    const target = (await list('2026-10-13', '2026-10-13'))[0]!;
    const url = `/api/appointments/${encodeURIComponent(target.id)}`;
    await agent
      .put(url)
      .set(CSRF)
      .send({ ...weekly, date: '2026-10-13', time: '10:00', scope: 'this' })
      .expect(200);
    const stored = (await list('2026-10-13', '2026-10-13'))[0]!;
    await agent
      .put(`/api/appointments/${stored.id}`)
      .set(CSRF)
      .send({ ...weekly, date: '2026-10-13', time: '11:00', clientName: 'Ana', scope: 'this' })
      .expect(200);
    const visits = await list('2026-10-13', '2026-10-13');
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ time: '11:00', clientName: 'Ana' });
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM appointments')).rows[0].n).toBe(1);
  });

  it('a recurring edit requires a scope', async () => {
    await createSeries();
    const target = (await list('2026-10-13', '2026-10-13'))[0]!;
    const res = await agent
      .put(`/api/appointments/${encodeURIComponent(target.id)}`)
      .set(CSRF)
      .send(weekly)
      .expect(400);
    expect(res.body.error.code).toBe('scope_required');
  });
});

describe('editing this and following visits', () => {
  it('splits the series: earlier visits keep the old details, later ones follow the new', async () => {
    await createSeries({ ...weekly, clientName: 'Rosa' });
    const target = (await list('2026-10-20', '2026-10-20'))[0]!;
    await agent
      .put(`/api/appointments/${encodeURIComponent(target.id)}`)
      .set(CSRF)
      .send({
        ...weekly,
        clientName: 'Rosa',
        date: '2026-10-20',
        time: '14:00',
        durationMin: 60,
        scope: 'future',
      })
      .expect(200);

    const visits = await list('2026-10-01', '2026-11-10');
    expect(visits.map((v) => [v.date, v.time, v.durationMin])).toEqual([
      ['2026-10-06', '09:00', 120],
      ['2026-10-13', '09:00', 120],
      ['2026-10-20', '14:00', 60],
      ['2026-10-27', '14:00', 60],
      ['2026-11-03', '14:00', 60],
      ['2026-11-10', '14:00', 60],
    ]);
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM series')).rows[0].n).toBe(2);
  });

  it('can move the whole rhythm to another weekday and change the frequency', async () => {
    await createSeries();
    const target = (await list('2026-10-13', '2026-10-13'))[0]!;
    await agent
      .put(`/api/appointments/${encodeURIComponent(target.id)}`)
      .set(CSRF)
      .send({ ...weekly, date: '2026-10-14', repeat: 'biweekly', scope: 'future' }) // Wednesday, every 2 weeks
      .expect(200);
    expect(dates(await list('2026-10-01', '2026-11-30'))).toEqual([
      '2026-10-06',
      '2026-10-14',
      '2026-10-28',
      '2026-11-11',
      '2026-11-25',
    ]);
  });

  it('from the first visit it changes the whole series in place', async () => {
    const first = await createSeries();
    await agent
      .put(`/api/appointments/${encodeURIComponent(first.id)}`)
      .set(CSRF)
      .send({ ...weekly, time: '08:00', scope: 'future' })
      .expect(200);
    expect((await list('2026-10-01', '2026-10-31')).map((v) => v.time)).toEqual([
      '08:00',
      '08:00',
      '08:00',
      '08:00',
    ]);
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM series')).rows[0].n).toBe(1);
  });

  it('replaces later one-off edits instead of leaving orphans', async () => {
    await createSeries();
    const third = (await list('2026-10-20', '2026-10-20'))[0]!;
    await agent
      .put(`/api/appointments/${encodeURIComponent(third.id)}`)
      .set(CSRF)
      .send({ ...weekly, date: '2026-10-21', time: '16:00', scope: 'this' })
      .expect(200);
    const second = (await list('2026-10-13', '2026-10-13'))[0]!;
    await agent
      .put(`/api/appointments/${encodeURIComponent(second.id)}`)
      .set(CSRF)
      .send({ ...weekly, date: '2026-10-13', time: '11:00', scope: 'future' })
      .expect(200);
    expect((await list('2026-10-13', '2026-10-27')).map((v) => [v.date, v.time])).toEqual([
      ['2026-10-13', '11:00'],
      ['2026-10-20', '11:00'],
      ['2026-10-27', '11:00'],
    ]);
  });
});

describe('cancelling', () => {
  it('"this one" removes only that visit', async () => {
    await createSeries();
    const target = (await list('2026-10-13', '2026-10-13'))[0]!;
    const res = await agent
      .post(`/api/appointments/${encodeURIComponent(target.id)}/cancel`)
      .set(CSRF)
      .send({ scope: 'this' })
      .expect(200);
    expect(res.body.appointment.status).toBe('cancelled');
    expect(dates(await list('2026-10-01', '2026-10-31'))).toEqual([
      '2026-10-06',
      '2026-10-20',
      '2026-10-27',
    ]);
    await agent
      .put(`/api/appointments/${encodeURIComponent(target.id)}`)
      .set(CSRF)
      .send({ ...weekly, scope: 'this' })
      .expect(404);
  });

  it('"this and following" ends the series but keeps earlier visits', async () => {
    await createSeries();
    const target = (await list('2026-10-20', '2026-10-20'))[0]!;
    await agent
      .post(`/api/appointments/${encodeURIComponent(target.id)}/cancel`)
      .set(CSRF)
      .send({ scope: 'future' })
      .expect(200);
    expect(dates(await list('2026-10-01', '2026-12-31'))).toEqual(['2026-10-06', '2026-10-13']);
  });

  it('"this and following" from the first visit cancels the whole series', async () => {
    const first = await createSeries();
    await agent
      .post(`/api/appointments/${encodeURIComponent(first.id)}/cancel`)
      .set(CSRF)
      .send({ scope: 'future' })
      .expect(200);
    expect(await list('2026-10-01', '2026-12-31')).toEqual([]);
    await agent.get(`/api/appointments/${encodeURIComponent(first.id)}`).expect(404);
  });

  it('also cancels one-off edits that came after the cut', async () => {
    await createSeries();
    const third = (await list('2026-10-20', '2026-10-20'))[0]!;
    const moved = await agent
      .put(`/api/appointments/${encodeURIComponent(third.id)}`)
      .set(CSRF)
      .send({ ...weekly, date: '2026-10-21', scope: 'this' })
      .expect(200);
    const second = (await list('2026-10-13', '2026-10-13'))[0]!;
    await agent
      .post(`/api/appointments/${encodeURIComponent(second.id)}/cancel`)
      .set(CSRF)
      .send({ scope: 'future' })
      .expect(200);
    expect(dates(await list('2026-10-01', '2026-12-31'))).toEqual(['2026-10-06']);
    expect(moved.body.appointment.date).toBe('2026-10-21');
  });

  it('a recurring cancel requires a scope; a normal appointment does not', async () => {
    await createSeries();
    const target = (await list('2026-10-13', '2026-10-13'))[0]!;
    const res = await agent
      .post(`/api/appointments/${encodeURIComponent(target.id)}/cancel`)
      .set(CSRF)
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe('scope_required');
    const single = (await agent.post('/api/appointments').set(CSRF).send(sample).expect(201)).body
      .appointment;
    await agent.post(`/api/appointments/${single.id}/cancel`).set(CSRF).expect(200);
  });
});

describe('reading and overlaps', () => {
  it('opens a generated visit by id and exposes the recurrence rule', async () => {
    await createSeries({ ...weekly, repeatUntil: '2026-12-01' });
    const target = (await list('2026-10-13', '2026-10-13'))[0]!;
    const res = await agent.get(`/api/appointments/${encodeURIComponent(target.id)}`).expect(200);
    expect(res.body.appointment).toMatchObject({
      date: '2026-10-13',
      recurrence: { freq: 'weekly', untilDate: '2026-12-01' },
    });
  });

  it('returns 404 for a date the series does not occur on, and 400 for a malformed id', async () => {
    const first = await createSeries();
    const wrongDay = first.id.replace('2026-10-06', '2026-10-07');
    await agent.get(`/api/appointments/${encodeURIComponent(wrongDay)}`).expect(404);
    await agent.get('/api/appointments/s:not-a-series:2026-10-07').expect(400);
  });

  it('warns when a new appointment overlaps a generated visit', async () => {
    await createSeries(); // Tuesdays 09:00-11:00
    const res = await agent
      .post('/api/appointments')
      .set(CSRF)
      .send({ ...sample, date: '2026-10-13', time: '10:00' })
      .expect(201);
    expect(res.body.overlaps).toBe(1);
    const clear = await agent
      .post('/api/appointments')
      .set(CSRF)
      .send({ ...sample, date: '2026-10-14', time: '10:00' })
      .expect(201);
    expect(clear.body.overlaps).toBe(0);
  });
});
