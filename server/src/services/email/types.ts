/** Why an email did not go out. Never contains the address, the message, or provider secrets. */
export type EmailFailure = 'timeout' | 'network' | 'rejected';
export type EmailResult = { ok: true } | { ok: false; reason: EmailFailure };

/**
 * The only thing the app knows about sending email. Providers are swappable: the app never
 * imports Resend outside its own adapter file.
 */
export interface EmailProvider {
  readonly name: string;
  send(to: string, subject: string, body: string): Promise<EmailResult>;
}

export const EMAIL_TIMEOUT_MS = 5000;

/** Map a thrown fetch error to a failure reason without leaking its message. */
export function failureOf(err: unknown): EmailFailure {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
}
