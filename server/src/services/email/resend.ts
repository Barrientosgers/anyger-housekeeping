import { EMAIL_TIMEOUT_MS, failureOf, type EmailProvider, type EmailResult } from './types.js';

/** Resend's shared test sender. Without a verified domain it can only email the account owner. */
export const RESEND_DEFAULT_FROM = "AnyGer's Housekeeping <onboarding@resend.dev>";

/**
 * Resend (https://resend.com): a free plan with no card. Without a verified domain, mail can only
 * go to the address the Resend account was created with, which is exactly the owner-alert use here.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(private readonly opts: { apiKey: string; from?: string; fetch?: typeof fetch }) {}

  async send(to: string, subject: string, body: string): Promise<EmailResult> {
    try {
      const res = await (this.opts.fetch ?? fetch)('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.opts.from ?? RESEND_DEFAULT_FROM,
          to: [to],
          subject,
          text: body,
        }),
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      });
      return res.ok ? { ok: true } : { ok: false, reason: 'rejected' };
    } catch (err) {
      return { ok: false, reason: failureOf(err) };
    }
  }
}
