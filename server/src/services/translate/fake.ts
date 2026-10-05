import type { Lang, TranslateResult, Translator } from './types.js';

/** Deterministic stand-in for tests and local development. Counts calls; can be told to fail. */
export class FakeTranslator implements Translator {
  readonly name = 'fake';
  calls = 0;
  failWith: TranslateResult | null = null;

  async translate(text: string, from: Lang, to: Lang): Promise<TranslateResult> {
    this.calls++;
    if (this.failWith) return this.failWith;
    return { ok: true, text: `[${from}->${to}] ${text}` };
  }
}
