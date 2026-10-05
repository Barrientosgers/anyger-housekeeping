import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { isOccurrenceId } from '../services/appointments.js';
import { makeLimiter } from '../middleware/limits.js';
import { translateNote } from '../services/translations.js';
import type { Logger } from '../logger.js';
import type { Translator } from '../services/translate/types.js';
import type pg from 'pg';

const body = z
  .object({
    entity: z.enum(['request', 'appointment']),
    id: z.string().max(80),
    target: z.enum(['es', 'en']),
  })
  .refine((v) =>
    v.entity === 'request'
      ? z.uuid().safeParse(v.id).success
      : z.uuid().safeParse(v.id).success || isOccurrenceId(v.id),
  );

/** Owners only (mounted behind requireAuth). Takes an id, never text, so it is not an open proxy. */
export function translationsRouter(
  pool: pg.Pool,
  deps: { translator: Translator | null; dailyLimit: number; logger: Logger; rateLimit: boolean },
) {
  const router = Router();
  const limiter = makeLimiter(deps.rateLimit, 10 * 60_000, 60);

  router.post('/', limiter, async (req, res, next) => {
    try {
      const { entity, id, target } = body.parse(req.body);
      const outcome = await translateNote(
        { pool, translator: deps.translator, dailyLimit: deps.dailyLimit, logger: deps.logger },
        entity,
        id,
        target,
      );
      if (!outcome) throw new AppError(404, 'not_found');
      res.json(outcome);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
