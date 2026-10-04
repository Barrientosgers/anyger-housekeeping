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
import { requireAuth, requireCsrfHeader } from './middleware/security.js';
import { appointmentsRouter } from './routes/appointments.js';
import { authRouter } from './routes/auth.js';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function createApp(deps: { config: Config; pool: pg.Pool; logger: Logger }) {
  const { config, pool, logger } = deps;
  const production = config.NODE_ENV === 'production';
  const app = express();

  // Render terminates TLS at a proxy; trust one hop so secure cookies and req.ip work.
  if (production) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
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
  app.use(express.json({ limit: '20kb' }));

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
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

  const isTest = config.NODE_ENV === 'test';
  app.use('/api/auth', authRouter(pool, { rateLimit: !isTest }));
  app.use('/api/appointments', requireAuth, appointmentsRouter(pool));
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
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'bad_json' } });
      return;
    }
    req.log.error(
      { errName: (err as Error).name, errMessage: (err as Error).message },
      'unhandled error',
    );
    res.status(500).json({ error: { code: 'internal' } });
  };
  app.use(errorHandler);

  return app;
}
