import type { Config } from '../../config.js';
import { FakeEmailProvider } from './fake.js';
import { ResendEmailProvider } from './resend.js';
import type { EmailProvider } from './types.js';

export type { EmailProvider, EmailResult } from './types.js';

/** Choose the provider from configuration. `none` means email alerts are switched off. */
export function createEmailProvider(config: Config): EmailProvider | null {
  switch (config.EMAIL_PROVIDER) {
    case 'resend':
      return new ResendEmailProvider({ apiKey: config.RESEND_API_KEY!, from: config.EMAIL_FROM });
    case 'fake':
      return new FakeEmailProvider();
    default:
      return null;
  }
}
