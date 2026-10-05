import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../../config.js';
import { ClaudeTranslator, type ClaudeClient } from './claude.js';
import { CloudflareTranslator } from './cloudflare.js';
import { FakeTranslator } from './fake.js';
import type { Translator } from './types.js';

export type { Lang, TranslateResult, Translator } from './types.js';

/** Choose the translator from configuration. `none` means translation is switched off. */
export function createTranslator(config: Config): Translator | null {
  switch (config.TRANSLATE_PROVIDER) {
    case 'cloudflare':
      return new CloudflareTranslator({
        accountId: config.CLOUDFLARE_ACCOUNT_ID!,
        apiToken: config.CLOUDFLARE_API_TOKEN!,
        langFormat: config.CLOUDFLARE_LANG_FORMAT,
      });
    case 'claude':
      return new ClaudeTranslator({
        client: new Anthropic({
          apiKey: config.ANTHROPIC_API_KEY!,
          maxRetries: 1,
        }) as unknown as ClaudeClient,
        model: config.ANTHROPIC_MODEL,
      });
    case 'fake':
      return new FakeTranslator();
    default:
      return null;
  }
}
