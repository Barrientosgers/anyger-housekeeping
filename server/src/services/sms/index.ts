import type { Config } from '../../config.js';
import { FakeSmsProvider } from './fake.js';
import { HttpSmsProvider } from './httpsms.js';
import { TwilioSmsProvider } from './twilio.js';
import type { SmsProvider } from './types.js';

export type { SmsProvider, SmsResult } from './types.js';

/** Choose the provider from configuration. `none` means texting is switched off. */
export function createSmsProvider(config: Config): SmsProvider | null {
  switch (config.SMS_PROVIDER) {
    case 'httpsms':
      return new HttpSmsProvider({ apiKey: config.HTTPSMS_API_KEY!, from: config.HTTPSMS_FROM! });
    case 'twilio':
      return new TwilioSmsProvider({
        accountSid: config.TWILIO_ACCOUNT_SID!,
        authToken: config.TWILIO_AUTH_TOKEN!,
        from: config.TWILIO_FROM_NUMBER!,
      });
    case 'fake':
      return new FakeSmsProvider();
    default:
      return null;
  }
}
