import type { EmailProvider, EmailResult } from './types.js';

/** Records emails instead of sending them. Used in tests and for local development. */
export class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake';
  readonly sent: { to: string; subject: string; body: string }[] = [];
  /** Set to make the next sends fail, to test that the app copes with a provider outage. */
  failWith: EmailResult | null = null;

  async send(to: string, subject: string, body: string): Promise<EmailResult> {
    if (this.failWith) return this.failWith;
    this.sent.push({ to, subject, body });
    return { ok: true };
  }
}
