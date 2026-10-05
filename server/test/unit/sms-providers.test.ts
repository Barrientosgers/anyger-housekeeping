import { describe, expect, it, vi } from 'vitest';
import { FakeSmsProvider } from '../../src/services/sms/fake.js';
import { HttpSmsProvider } from '../../src/services/sms/httpsms.js';
import { TwilioSmsProvider } from '../../src/services/sms/twilio.js';

const reply = (status: number) => vi.fn(async () => new Response('{}', { status }));
const named = (name: string) => Object.assign(new Error('x'), { name });

describe('HttpSmsProvider', () => {
  const make = (fetch: typeof globalThis.fetch) =>
    new HttpSmsProvider({ apiKey: 'KEY-123', from: '+15550100200', fetch });

  it('posts to the httpSMS API with the key header and the documented JSON body', async () => {
    const fetch = reply(200);
    const result = await make(fetch).send('+15550100100', 'hola');
    expect(result).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.httpsms.com/v1/messages/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('KEY-123');
    expect(JSON.parse(init.body as string)).toEqual({
      content: 'hola',
      from: '+15550100200',
      to: '+15550100100',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal); // there is a timeout
  });

  it.each([401, 422, 500])('maps HTTP %i to "rejected"', async (status) => {
    expect(await make(reply(status)).send('+1', 'x')).toEqual({ ok: false, reason: 'rejected' });
  });

  it('maps a network failure and a timeout, without leaking details', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('connect ECONNREFUSED 1.2.3.4 with KEY-123');
    });
    const slow = vi.fn(async () => {
      throw named('TimeoutError');
    });
    const a = await make(down).send('+1', 'x');
    const b = await make(slow).send('+1', 'x');
    expect(a).toEqual({ ok: false, reason: 'network' });
    expect(b).toEqual({ ok: false, reason: 'timeout' });
    expect(JSON.stringify([a, b])).not.toContain('KEY-123');
  });
});

describe('TwilioSmsProvider', () => {
  const make = (fetch: typeof globalThis.fetch) =>
    new TwilioSmsProvider({ accountSid: 'ACxyz', authToken: 'tok', from: '+15550100300', fetch });

  it('posts form-encoded to the Twilio Messages endpoint with basic auth', async () => {
    const fetch = reply(201);
    expect(await make(fetch).send('+15550100100', 'hola')).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACxyz/Messages.json');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('ACxyz:tok').toString('base64')}`,
    );
    const form = init.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      To: '+15550100100',
      From: '+15550100300',
      Body: 'hola',
    });
  });

  it('maps errors the same way as the other providers', async () => {
    expect(await make(reply(400)).send('+1', 'x')).toEqual({ ok: false, reason: 'rejected' });
    const down = vi.fn(async () => {
      throw new TypeError('boom');
    });
    expect(await make(down).send('+1', 'x')).toEqual({ ok: false, reason: 'network' });
  });
});

describe('FakeSmsProvider', () => {
  it('records messages and can be told to fail', async () => {
    const fake = new FakeSmsProvider();
    await fake.send('+1', 'a');
    expect(fake.sent).toEqual([{ to: '+1', body: 'a' }]);
    fake.failWith = { ok: false, reason: 'timeout' };
    expect(await fake.send('+1', 'b')).toEqual({ ok: false, reason: 'timeout' });
    expect(fake.sent).toHaveLength(1);
  });
});
