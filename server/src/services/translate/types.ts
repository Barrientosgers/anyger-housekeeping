export type Lang = 'es' | 'en';

/** Why a translation did not happen. Never contains the text, keys, or provider messages. */
export type TranslateFailure = 'timeout' | 'network' | 'rejected' | 'quota';
export type TranslateResult = { ok: true; text: string } | { ok: false; reason: TranslateFailure };

/**
 * The only thing the app knows about machine translation. Providers are swappable: the app never
 * imports Cloudflare or Anthropic outside their own adapter file.
 */
export interface Translator {
  readonly name: string;
  translate(text: string, from: Lang, to: Lang): Promise<TranslateResult>;
}

export const TRANSLATE_TIMEOUT_MS = 8000;
export const MAX_TRANSLATION_CHARS = 4000;

export function failureOf(err: unknown): TranslateFailure {
  const e = err as { name?: string; status?: number } | null;
  if (
    e?.name === 'TimeoutError' ||
    e?.name === 'AbortError' ||
    e?.name === 'APIConnectionTimeoutError'
  ) {
    return 'timeout';
  }
  if (e?.status === 429) return 'quota';
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) return 'rejected';
  return 'network';
}

/** Trim and sanity-check provider output so a bad response can never reach the UI or the cache. */
export function cleanTranslation(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text.length > 0 && text.length <= MAX_TRANSLATION_CHARS ? text : null;
}
