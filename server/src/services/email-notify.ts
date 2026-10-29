import type pg from 'pg';
import type { Logger } from '../logger.js';
import type { EmailProvider } from './email/types.js';
import type { Notifier } from './notify.js';
import { noopNotifier } from './notify.js';
import { countUsage } from './usage.js';

// Deliberately generic, like the texts: email crosses a third-party service and sits in an inbox
// indefinitely, so it never carries a name, address, phone number, or note. Both languages, so it
// is readable by whoever reads the inbox.
const SUBJECT = "AnyGer's: nueva solicitud / new booking request";
const BODY = [
  'Tiene una solicitud nueva. Abra la app para verla:',
  'You have a new booking request. Open the app to see it:',
].join('\n');

interface Options {
  provider: EmailProvider | null;
  to: string | undefined;
  pool: pg.Pool;
  logger: Logger;
  appUrl?: string;
  /** Minimum gap between emails, so a burst of requests becomes one email. */
  cooldownMs: number;
  /** Hard stop per calendar month, kept well under the provider's free allowance. */
  monthlyLimit: number;
  now?: () => number;
}

/** Emails the owner about new booking requests only (other events stay quiet by design). */
export function createEmailNotifier(opts: Options): Notifier {
  const { provider, to, pool, logger } = opts;
  if (!provider || !to) return noopNotifier;

  const now = opts.now ?? Date.now;
  let lastSent: number | undefined;
  const pending = new Set<Promise<void>>();

  async function sentThisMonth(): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT coalesce(sum(count), 0)::int AS n FROM usage_counters
       WHERE event = 'email_sent'
         AND day >= date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date`,
    );
    return rows[0]?.n ?? 0;
  }

  async function deliver() {
    try {
      if ((await sentThisMonth()) >= opts.monthlyLimit) {
        lastSent = undefined;
        logger.warn('email skipped: monthly limit reached');
        return;
      }
      const body = opts.appUrl ? `${BODY}\n${opts.appUrl}` : BODY;
      const result = await provider!.send(to!, SUBJECT, body);
      if (result.ok) {
        await countUsage(pool, 'email_sent');
        logger.info({ provider: provider!.name }, 'email sent');
      } else {
        lastSent = undefined; // a failed email should not block the next attempt
        await countUsage(pool, 'email_failed');
        logger.warn({ provider: provider!.name, reason: result.reason }, 'email failed');
      }
    } catch (err) {
      lastSent = undefined;
      logger.error({ errName: (err as Error).name }, 'email error');
    }
  }

  return {
    notify(event) {
      if (event !== 'request_received') return;
      if (lastSent !== undefined && now() - lastSent < opts.cooldownMs) {
        logger.debug('email skipped: cooldown');
        return;
      }
      lastSent = now(); // claim first, so concurrent requests cannot double-send
      const task = deliver().finally(() => pending.delete(task));
      pending.add(task);
    },
    async flush() {
      await Promise.all([...pending]);
    },
  };
}
