import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost/db',
  SESSION_SECRET: 'x'.repeat(40),
};
const err = (env: Record<string, string>) => {
  try {
    loadConfig({ ...base, ...env } as NodeJS.ProcessEnv);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

describe('text message configuration', () => {
  it('texting is off by default and needs no extra settings', () => {
    expect(loadConfig(base as NodeJS.ProcessEnv).SMS_PROVIDER).toBe('none');
  });

  it('treats blank variables as not set', () => {
    const c = loadConfig({
      ...base,
      NOTIFY_PHONE_NUMBER: '',
      APP_URL: '',
      HTTPSMS_API_KEY: '',
    } as NodeJS.ProcessEnv);
    expect(c.NOTIFY_PHONE_NUMBER).toBeUndefined();
  });

  it('a provider with no destination number is rejected at startup', () => {
    expect(err({ SMS_PROVIDER: 'fake' })).toContain('NOTIFY_PHONE_NUMBER');
  });

  it('httpsms needs its key and sender number', () => {
    const msg = err({ SMS_PROVIDER: 'httpsms', NOTIFY_PHONE_NUMBER: '+15550100100' })!;
    expect(msg).toContain('HTTPSMS_API_KEY');
    expect(msg).toContain('HTTPSMS_FROM');
  });

  it('twilio needs all three of its settings', () => {
    const msg = err({ SMS_PROVIDER: 'twilio', NOTIFY_PHONE_NUMBER: '+15550100100' })!;
    expect(msg).toContain('TWILIO_ACCOUNT_SID');
    expect(msg).toContain('TWILIO_AUTH_TOKEN');
    expect(msg).toContain('TWILIO_FROM_NUMBER');
  });

  it('phone numbers must be in international format', () => {
    expect(err({ SMS_PROVIDER: 'fake', NOTIFY_PHONE_NUMBER: '555-010-0100' })).toContain(
      'NOTIFY_PHONE_NUMBER',
    );
  });

  it('a complete httpsms setup loads', () => {
    const c = loadConfig({
      ...base,
      SMS_PROVIDER: 'httpsms',
      NOTIFY_PHONE_NUMBER: '+15550100100',
      HTTPSMS_API_KEY: 'k',
      HTTPSMS_FROM: '+15550100200',
      SMS_MONTHLY_LIMIT: '150',
    } as NodeJS.ProcessEnv);
    expect(c.SMS_PROVIDER).toBe('httpsms');
    expect(c.SMS_COOLDOWN_MINUTES).toBe(10);
  });

  it('never puts a secret value in the error message', () => {
    const msg = err({
      SMS_PROVIDER: 'httpsms',
      NOTIFY_PHONE_NUMBER: '+15550100100',
      HTTPSMS_API_KEY: 'super-secret-key-123',
      HTTPSMS_FROM: 'not-a-number',
    })!;
    expect(msg).not.toContain('super-secret-key-123');
    expect(msg).not.toContain('not-a-number');
    expect(msg).toContain('HTTPSMS_FROM');
  });
});

describe('translation configuration', () => {
  it('is off by default', () => {
    const c = loadConfig(base as NodeJS.ProcessEnv);
    expect(c.TRANSLATE_PROVIDER).toBe('none');
    expect(c.TRANSLATE_DAILY_LIMIT).toBe(200);
    expect(c.ANTHROPIC_MODEL).toBe('claude-opus-5-5');
  });

  it('cloudflare needs its account id and token; claude needs its key', () => {
    const cf = err({ TRANSLATE_PROVIDER: 'cloudflare' })!;
    expect(cf).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(cf).toContain('CLOUDFLARE_API_TOKEN');
    expect(err({ TRANSLATE_PROVIDER: 'claude' })).toContain('ANTHROPIC_API_KEY');
  });

  it('a complete setup loads, and secrets never appear in errors', () => {
    expect(
      loadConfig({
        ...base,
        TRANSLATE_PROVIDER: 'cloudflare',
        CLOUDFLARE_ACCOUNT_ID: 'acc',
        CLOUDFLARE_API_TOKEN: 'tok',
      } as NodeJS.ProcessEnv).CLOUDFLARE_LANG_FORMAT,
    ).toBe('code');
    const msg = err({
      TRANSLATE_PROVIDER: 'cloudflare',
      CLOUDFLARE_API_TOKEN: 'sekret-token-xyz',
      CLOUDFLARE_LANG_FORMAT: 'bogus',
    })!;
    expect(msg).not.toContain('sekret-token-xyz');
    expect(msg).toContain('CLOUDFLARE_LANG_FORMAT');
  });
});
