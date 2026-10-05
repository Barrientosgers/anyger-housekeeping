import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

/** Per-IP rate limiter with a JSON error the UI can translate. Disabled (a no-op) in tests. */
export function makeLimiter(enabled: boolean, windowMs: number, limit: number): RequestHandler {
  if (!enabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited' } });
    },
  });
}
