import { failureOf, SEND_TIMEOUT_MS, type SmsProvider, type SmsResult } from './types.js';

/**
 * Twilio adapter. NOT used in production: Twilio is not free beyond a short trial, and the
 * project is free-tier only. It exists to show (and test) that the provider interface is
 * genuinely swappable. Unit-tested against a mocked fetch only, never against the live API.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  constructor(
    private readonly opts: {
      accountSid: string;
      authToken: string;
      from: string;
      fetch?: typeof fetch;
    },
  ) {}

  async send(to: string, body: string): Promise<SmsResult> {
    const { accountSid, authToken, from } = this.opts;
    try {
      const res = await (this.opts.fetch ?? fetch)(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: to, From: from, Body: body }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        },
      );
      return res.ok ? { ok: true } : { ok: false, reason: 'rejected' };
    } catch (err) {
      return { ok: false, reason: failureOf(err) };
    }
  }
}
