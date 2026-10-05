import type pg from 'pg';
import type { Logger } from '../logger.js';
import type { SmsProvider } from './sms/types.js';
import { countUsage } from './usage.js';

export type NotifyEvent =
  'request_received' | 'appointment_created' | 'appointment_changed' | 'appointment_cancelled';

// Deliberately generic: texts pass through a phone and a third-party relay, so they never carry
// a name, address, phone number, or note. They only say that something needs a look.
// (Plain ASCII keeps each text a single cheap segment on every phone.)
const MESSAGES: Record<NotifyEvent, string> = {
  request_received: "AnyGer's: tiene una solicitud nueva. Revise la app:",
  appointment_created: "AnyGer's: hay una cita nueva en el calendario:",
  appointment_changed: "AnyGer's: una cita tiene cambios. Revise el calendario:",
  appointment_cancelled: "AnyGer's: hay una cita cancelada. Revise el calendario:",
};

export interface Notifier {
  /** Fire and forget: never throws and never delays the caller. */
  notify(event: NotifyEvent): void;
  /** Resolves when every text started so far has finished (used by tests and shutdown). */
  flush(): Promise<void>;
}

export const noopNotifier: Notifier = { notify: () => undefined, flush: async () => undefined };

interface Options {
  provider: SmsProvider | null;
  to: string | undefined;
  pool: pg.Pool;
  logger: Logger;
  appUrl?: string;
  /** Minimum gap between texts of the same kind, so a burst becomes one text. */
  cooldownMs: number;
  /** Hard stop per calendar month, kept under the provider's free allowance. */
  monthlyLimit: number;
  now?: () => number;
}

export function createNotifier(opts: Options): Notifier {
  const { provider, to, pool, logger } = opts;
  if (!provider || !to) return noopNotifier;

  const now = opts.now ?? Date.now;
  const lastSent = new Map<NotifyEvent, number>();
  const pending = new Set<Promise<void>>();

  async function sentThisMonth(): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT coalesce(sum(count), 0)::int AS n FROM usage_counters
       WHERE event = 'sms_sent'
         AND day >= date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date`,
    );
    return rows[0]?.n ?? 0;
  }

  async function deliver(event: NotifyEvent) {
    try {
      if ((await sentThisMonth()) >= opts.monthlyLimit) {
        lastSent.delete(event);
        logger.warn({ event }, 'sms skipped: monthly limit reached');
        return;
      }
      const body = opts.appUrl ? `${MESSAGES[event]} ${opts.appUrl}` : MESSAGES[event];
      const result = await provider!.send(to!, body);
      if (result.ok) {
        await countUsage(pool, 'sms_sent');
        logger.info({ event, provider: provider!.name }, 'sms sent');
      } else {
        lastSent.delete(event); // a failed text should not block the next attempt
        await countUsage(pool, 'sms_failed');
        logger.warn({ event, provider: provider!.name, reason: result.reason }, 'sms failed');
      }
    } catch (err) {
      lastSent.delete(event);
      logger.error({ event, errName: (err as Error).name }, 'sms error');
    }
  }

  return {
    notify(event) {
      const last = lastSent.get(event);
      if (last !== undefined && now() - last < opts.cooldownMs) {
        logger.debug({ event }, 'sms skipped: cooldown');
        return;
      }
      lastSent.set(event, now()); // claim first, so concurrent events cannot double-send
      const task = deliver(event).finally(() => pending.delete(task));
      pending.add(task);
    },
    async flush() {
      await Promise.all([...pending]);
    },
  };
}
