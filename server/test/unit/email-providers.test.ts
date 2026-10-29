import { describe, expect, it, vi } from 'vitest';
import { FakeEmailProvider } from '../../src/services/email/fake.js';
import { RESEND_DEFAULT_FROM, ResendEmailProvider } from '../../src/services/email/resend.js';

const reply = (status: number) => vi.fn(async () => new Response('{}', { status }));
const named = (name: string) => Object.assign(new Error('x'), { name });

describe('ResendEmailProvider', () => {
  const make = (fetch: typeof globalThis.fetch, from?: string) =>
    new ResendEmailProvider({ apiKey: 're_KEY-123', from, fetch });

  it('posts to the Resend API with a bearer key and the documented JSON body', async () => {
    const fetch = reply(200);
    const result = await make(fetch).send('me@example.com', 'Asunto', 'Hola');
    expect(result).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_KEY-123');
    expect(JSON.parse(init.body as string)).toEqual({
      from: RESEND_DEFAULT_FROM,
      to: ['me@example.com'],
      subject: 'Asunto',
      text: 'Hola',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal); // there is a timeout
  });

  it('uses a custom sender when one is configured', async () => {
    const fetch = reply(200);
    await make(fetch, 'Me <me@mydomain.example>').send('a@example.com', 's', 'b');
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).from).toBe('Me <me@mydomain.example>');
  });

  it.each([401, 403, 422, 429, 500])('maps HTTP %i to "rejected"', async (status) => {
    expect(await make(reply(status)).send('a@example.com', 's', 'b')).toEqual({
      ok: false,
      reason: 'rejected',
    });
  });

  it('maps a network failure and a timeout, without leaking details', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('connect ECONNREFUSED 1.2.3.4 with re_KEY-123');
    });
    const slow = vi.fn(async () => {
      throw named('TimeoutError');
    });
    const a = await make(down).send('a@example.com', 's', 'b');
    const b = await make(slow).send('a@example.com', 's', 'b');
    expect(a).toEqual({ ok: false, reason: 'network' });
    expect(b).toEqual({ ok: false, reason: 'timeout' });
    expect(JSON.stringify([a, b])).not.toMatch(/re_KEY|ECONNREFUSED|a@example/);
  });
});

describe('FakeEmailProvider', () => {
  it('records emails and can be told to fail', async () => {
    const fake = new FakeEmailProvider();
    await fake.send('a@example.com', 's', 'b');
    expect(fake.sent).toEqual([{ to: 'a@example.com', subject: 's', body: 'b' }]);
    fake.failWith = { ok: false, reason: 'timeout' };
    expect(await fake.send('a@example.com', 's', 'c')).toEqual({ ok: false, reason: 'timeout' });
    expect(fake.sent).toHaveLength(1);
  });
});
