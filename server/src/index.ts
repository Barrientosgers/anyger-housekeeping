import * as Sentry from '@sentry/node';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { createLogger } from './logger.js';
import { createNotifier } from './services/notify.js';
import { purgeOldRequests } from './services/requests.js';
import { createSmsProvider } from './services/sms/index.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    // Strip anything that could carry personal data before an event leaves the server.
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
      }
      delete event.user;
      return event;
    },
  });
}

const pool = createPool(config.DATABASE_URL, config.NODE_ENV === 'production');
const applied = await migrate(pool);
if (applied.length) logger.info({ applied }, 'migrations applied');

// Keep personal data short-lived: remove old booking requests now and twice a day.
const purge = () =>
  purgeOldRequests(pool)
    .then((n) => n && logger.info({ removed: n }, 'old booking requests purged'))
    .catch((err: Error) => logger.error({ errMessage: err.message }, 'purge failed'));
void purge();
setInterval(purge, 12 * 60 * 60 * 1000).unref();

const smsProvider = createSmsProvider(config);
logger.info({ smsProvider: smsProvider?.name ?? 'none' }, 'text messages');
const notifier = createNotifier({
  provider: smsProvider,
  to: config.NOTIFY_PHONE_NUMBER,
  pool,
  logger,
  appUrl: config.APP_URL,
  cooldownMs: config.SMS_COOLDOWN_MINUTES * 60_000,
  monthlyLimit: config.SMS_MONTHLY_LIMIT,
});

const app = createApp({ config, pool, logger, notifier });
const server = app.listen(config.PORT, () =>
  logger.info({ port: config.PORT }, 'server listening'),
);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(
      () =>
        void notifier
          .flush()
          .then(() => pool.end())
          .then(() => process.exit(0)),
    );
  });
}
