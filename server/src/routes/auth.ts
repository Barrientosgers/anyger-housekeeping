import { hash, verify } from '@node-rs/argon2';
import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { makeLimiter } from '../middleware/limits.js';
import { audit } from '../services/usage.js';

// Verified when the email is unknown so response time doesn't reveal which emails exist.
const dummyHash = hash('not-a-real-password');

const loginBody = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(200),
});

export function authRouter(pool: pg.Pool, opts: { rateLimit: boolean }) {
  const router = Router();
  const limiter = makeLimiter(opts.rateLimit, 15 * 60_000, 10);

  router.post('/login', limiter, async (req, res, next) => {
    try {
      const body = loginBody.parse(req.body);
      const { rows } = await pool.query<{ id: string; password_hash: string; locale: string }>(
        'SELECT id, password_hash, locale FROM users WHERE email = $1',
        [body.email],
      );
      const user = rows[0];
      let ok = false;
      try {
        ok = await verify(user?.password_hash ?? (await dummyHash), body.password);
      } catch {
        ok = false;
      }
      if (!user || !ok) throw new AppError(401, 'invalid_credentials');

      // New session id on login prevents session fixation.
      await new Promise<void>((resolve, reject) =>
        req.session.regenerate((err) => (err ? reject(err) : resolve())),
      );
      req.session.userId = user.id;
      await audit(pool, user.id, 'login', 'user', user.id);
      res.json({ locale: user.locale });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('anyger.sid');
      res.status(204).end();
    });
  });

  router.get('/me', async (req, res, next) => {
    try {
      if (!req.session.userId) throw new AppError(401, 'unauthenticated');
      const { rows } = await pool.query<{ locale: string }>(
        'SELECT locale FROM users WHERE id = $1',
        [req.session.userId],
      );
      if (!rows[0]) throw new AppError(401, 'unauthenticated');
      res.json({ locale: rows[0].locale });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
