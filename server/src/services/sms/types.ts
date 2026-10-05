/** Why a text did not go out. Never contains the number, the message, or provider secrets. */
export type SmsFailure = 'timeout' | 'network' | 'rejected';
export type SmsResult = { ok: true } | { ok: false; reason: SmsFailure };

/**
 * The only thing the app knows about sending texts. Providers are swappable: the app never
 * imports Twilio or httpSMS outside their own adapter file.
 */
export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string): Promise<SmsResult>;
}

export const SEND_TIMEOUT_MS = 5000;

/** Map a thrown fetch error to a failure reason without leaking its message. */
export function failureOf(err: unknown): SmsFailure {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
}
