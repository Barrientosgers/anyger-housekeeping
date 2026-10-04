import { Router } from 'express';
import type pg from 'pg';
import { makeLimiter } from '../middleware/limits.js';
import { publicRequestInput, submitRequest } from '../services/requests.js';
import { countUsage } from '../services/usage.js';

/** The only unauthenticated write in the app. Everything here must assume a hostile caller. */
export function publicRouter(pool: pg.Pool, opts: { rateLimit: boolean }) {
  const router = Router();
  // 5 requests per hour per IP is far more than a real household needs.
  const limiter = makeLimiter(opts.rateLimit, 60 * 60_000, 5);

  router.post('/requests', limiter, async (req, res, next) => {
    try {
      const input = publicRequestInput.parse(req.body);
      const stored = await submitRequest(pool, input);
      if (stored) await countUsage(pool, 'requests_received');
      // Same answer whether stored or dropped as spam, and nothing from the input is echoed.
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
