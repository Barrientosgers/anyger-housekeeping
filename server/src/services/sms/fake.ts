import type { SmsProvider, SmsResult } from './types.js';

/** Records messages instead of sending them. Used in tests and for local development. */
export class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  readonly sent: { to: string; body: string }[] = [];
  /** Set to make the next sends fail, to test that the app copes with a provider outage. */
  failWith: SmsResult | null = null;

  async send(to: string, body: string): Promise<SmsResult> {
    if (this.failWith) return this.failWith;
    this.sent.push({ to, body });
    return { ok: true };
  }
}
