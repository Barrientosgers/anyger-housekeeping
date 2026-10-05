import type { RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/** Per-IP rate limiter with a JSON error the UI can translate. Disabled (a no-op) in tests. */
export function makeLimiter(enabled: boolean, windowMs: number, limit: number): RequestHandler {
  if (!enabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    // One bucket per visitor (IPv6 visitors are grouped by /56 so a device cannot dodge the limit
    // by rotating addresses within its own block).
    keyGenerator: (req) => ipKeyGenerator(req.clientIp ?? req.ip ?? 'unknown'),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited' } });
    },
  });
}
