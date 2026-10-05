import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import connectPgSimple from 'connect-pg-simple';
import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import type pg from 'pg';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import type { Logger } from './logger.js';
import { clientIp } from './middleware/client-ip.js';
import { requireAuth, requireCsrfHeader } from './middleware/security.js';
import { type Notifier, noopNotifier } from './services/notify.js';
import type { Translator } from './services/translate/types.js';
import { appointmentsRouter } from './routes/appointments.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { requestsRouter } from './routes/requests.js';
import { translationsRouter } from './routes/translations.js';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function createApp(deps: {
  config: Config;
  pool: pg.Pool;
  logger: Logger;
  /** Defaults to on everywhere except tests; a test can force it on to check the limits. */
  rateLimit?: boolean;
  /** Sends owner texts. Defaults to doing nothing. */
  notifier?: Notifier;
  /** Translates client notes. Defaults to off. */
  translator?: Translator | null;
}) {
  const { config, pool, logger } = deps;
  const notifier = deps.notifier ?? noopNotifier;
  const production = config.NODE_ENV === 'production';
  const app = express();

  // Render terminates TLS at a proxy; trust one hop so secure cookies and req.ip work.
  if (production) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Everything the app loads comes from itself: no inline styles, no external fonts, scripts,
  // images, or connections. A strict policy means an injected tag could not run or phone home.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
    }),
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/healthz' },
      // Log method, path (no query string), status only. Never bodies or headers.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(clientIp(config.TRUST_CLOUDFLARE_IP));
  app.use(express.json({ limit: '20kb' }));

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // API responses carry personal data: never let a browser or shared cache keep them.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const PgStore = connectPgSimple(session);
  app.use(
    '/api',
    session({
      name: 'anyger.sid',
      secret: config.SESSION_SECRET,
      store: new PgStore({ pool, tableName: 'sessions' }),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: production,
        sameSite: 'lax',
        maxAge: NINETY_DAYS_MS,
      },
    }),
    requireCsrfHeader,
  );

  const limits = deps.rateLimit ?? config.NODE_ENV !== 'test';
  app.use('/api/auth', authRouter(pool, { rateLimit: limits }));
  app.use('/api/public', publicRouter(pool, { rateLimit: limits, notifier }));
  app.use('/api/requests', requireAuth, requestsRouter(pool));
  app.use(
    '/api/translations',
    requireAuth,
    translationsRouter(pool, {
      translator: deps.translator ?? null,
      dailyLimit: config.TRANSLATE_DAILY_LIMIT,
      logger,
      rateLimit: limits,
    }),
  );
  app.use('/api/appointments', requireAuth, appointmentsRouter(pool, notifier));
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'not_found')));

  // Serve the built React app in production.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  if (config.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

  // Express identifies error handlers by their four-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code } });
      return;
    }
    if (err instanceof ZodError) {
      // Field names only; never echo submitted values.
      const fields = [...new Set(err.issues.map((i) => i.path.join('.')))];
      res.status(400).json({ error: { code: 'validation', fields } });
      return;
    }
    // Errors raised by the body parser itself (bad JSON, too big, wrong encoding).
    const parseError = err as { type?: string; status?: number };
    if (parseError.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'bad_json' } });
      return;
    }
    if (parseError.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'too_large' } });
      return;
    }
    if (parseError.type === 'charset.unsupported' || parseError.type === 'encoding.unsupported') {
      res.status(415).json({ error: { code: 'unsupported' } });
      return;
    }
    if (
      typeof parseError.status === 'number' &&
      parseError.status >= 400 &&
      parseError.status < 500
    ) {
      res.status(parseError.status).json({ error: { code: 'bad_request' } });
      return;
    }
    // Log the kind of error only. Messages can echo data (database errors, for example).
    req.log.error(
      { errName: (err as Error).name, errCode: (err as { code?: string }).code },
      'unhandled error',
    );
    res.status(500).json({ error: { code: 'internal' } });
  };
  app.use(errorHandler);

  return app;
}
