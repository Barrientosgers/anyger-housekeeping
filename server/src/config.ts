import { z } from 'zod';

// Render and .env files can leave a variable blank; treat blank as "not set".
const optional = <T extends z.ZodType>(type: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), type.optional());
const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'must be in +15551234567 format');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SENTRY_DSN: z.string().optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    // Set to true only when the app is behind Cloudflare (Render is): see middleware/client-ip.ts.
    TRUST_CLOUDFLARE_IP: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Text messages to the owner. "none" turns sending off (the default); nothing else changes.
    SMS_PROVIDER: z.enum(['none', 'fake', 'httpsms', 'twilio']).default('none'),
    NOTIFY_PHONE_NUMBER: optional(e164),
    APP_URL: optional(z.url()), // appended to texts so one tap opens the app
    SMS_MONTHLY_LIMIT: z.coerce.number().int().min(1).default(150),
    SMS_COOLDOWN_MINUTES: z.coerce.number().int().min(0).default(10),
    HTTPSMS_API_KEY: optional(z.string().min(1)),
    HTTPSMS_FROM: optional(e164),
    TWILIO_ACCOUNT_SID: optional(z.string().min(1)),
    TWILIO_AUTH_TOKEN: optional(z.string().min(1)),
    TWILIO_FROM_NUMBER: optional(e164),

    // Translation of client notes (Phase 5). "none" switches it off; the app works without it.
    TRANSLATE_PROVIDER: z.enum(['none', 'fake', 'cloudflare', 'claude']).default('none'),
    TRANSLATE_DAILY_LIMIT: z.coerce.number().int().min(1).default(200),
    CLOUDFLARE_ACCOUNT_ID: optional(z.string().min(1)),
    CLOUDFLARE_API_TOKEN: optional(z.string().min(1)),
    // Cloudflare's docs are unclear whether m2m100 wants "es" or "spanish"; this makes it a setting.
    CLOUDFLARE_LANG_FORMAT: z.enum(['code', 'name']).default('code'),
    ANTHROPIC_API_KEY: optional(z.string().min(1)),
    ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-5-5'),
  })
  .superRefine((v, ctx) => {
    // Fail closed at startup: a half-configured provider must not silently drop texts.
    const need = (names: (keyof typeof v)[]) => {
      for (const name of names) {
        if (!v[name]) ctx.addIssue({ code: 'custom', path: [name], message: 'required' });
      }
    };
    if (v.TRANSLATE_PROVIDER === 'cloudflare')
      need(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
    if (v.TRANSLATE_PROVIDER === 'claude') need(['ANTHROPIC_API_KEY']);
    if (v.SMS_PROVIDER === 'none') return;
    need(['NOTIFY_PHONE_NUMBER']);
    if (v.SMS_PROVIDER === 'httpsms') need(['HTTPSMS_API_KEY', 'HTTPSMS_FROM']);
    if (v.SMS_PROVIDER === 'twilio') {
      need(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']);
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Report which variables are wrong, never their values.
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return parsed.data;
}
