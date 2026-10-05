import { failureOf, SEND_TIMEOUT_MS, type SmsProvider, type SmsResult } from './types.js';

/**
 * httpSMS (https://httpsms.com): an Android phone you own sends the text using its own plan.
 * Free plan: 200 messages/month. `from` is the sender phone's number.
 */
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'httpsms';

  constructor(private readonly opts: { apiKey: string; from: string; fetch?: typeof fetch }) {}

  async send(to: string, body: string): Promise<SmsResult> {
    try {
      const res = await (this.opts.fetch ?? fetch)('https://api.httpsms.com/v1/messages/send', {
        method: 'POST',
        headers: { 'x-api-key': this.opts.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: body, from: this.opts.from, to }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      return res.ok ? { ok: true } : { ok: false, reason: 'rejected' };
    } catch (err) {
      return { ok: false, reason: failureOf(err) };
    }
  }
}
