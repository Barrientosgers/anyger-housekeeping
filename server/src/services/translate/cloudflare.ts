import {
  cleanTranslation,
  failureOf,
  TRANSLATE_TIMEOUT_MS,
  type Lang,
  type TranslateResult,
  type Translator,
} from './types.js';

const NAMES: Record<Lang, string> = { es: 'spanish', en: 'english' };

/**
 * Cloudflare Workers AI, model @cf/meta/m2m100-1.2b. The free plan allows 10,000 "neurons" a day
 * and, once used up, requests FAIL rather than bill, which matches this project's never-pay rule.
 * Cloudflare states it does not train on or store customer content by default.
 *
 * Not yet verified against a live account: the language fields (see CLOUDFLARE_LANG_FORMAT) and the
 * exact response shape, which is parsed defensively.
 */
export class CloudflareTranslator implements Translator {
  readonly name = 'cloudflare';

  constructor(
    private readonly opts: {
      accountId: string;
      apiToken: string;
      langFormat?: 'code' | 'name';
      fetch?: typeof fetch;
    },
  ) {}

  async translate(text: string, from: Lang, to: Lang): Promise<TranslateResult> {
    const lang = (l: Lang) => (this.opts.langFormat === 'name' ? NAMES[l] : l);
    try {
      const res = await (this.opts.fetch ?? fetch)(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
          this.opts.accountId,
        )}/ai/run/@cf/meta/m2m100-1.2b`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.opts.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text, source_lang: lang(from), target_lang: lang(to) }),
          signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
        },
      );
      if (res.status === 429) return { ok: false, reason: 'quota' };
      if (!res.ok) return { ok: false, reason: 'rejected' };
      const data = (await res.json()) as {
        success?: boolean;
        result?: { translated_text?: unknown };
        translated_text?: unknown;
      };
      if (data.success === false) return { ok: false, reason: 'rejected' };
      const translated = cleanTranslation(data.result?.translated_text ?? data.translated_text);
      return translated ? { ok: true, text: translated } : { ok: false, reason: 'rejected' };
    } catch (err) {
      return { ok: false, reason: failureOf(err) };
    }
  }
}
