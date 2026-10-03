import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense for a same-origin JSON API: state-changing requests must carry a custom
 * header. Browsers cannot attach it cross-site without a CORS preflight, and this server
 * does not enable CORS. Combined with SameSite=Lax session cookies.
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (!SAFE_METHODS.has(req.method) && req.get('x-requested-with') !== 'anyger') {
    return next(new AppError(403, 'csrf'));
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.userId) return next(new AppError(401, 'unauthenticated'));
  next();
}
