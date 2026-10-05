import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { TimeError } from '../domain/time.js';
import { AppError } from '../errors.js';
import { appointmentInput } from '../services/appointments.js';
import {
  acceptRequest,
  countPending,
  declineRequest,
  getRequest,
  listPending,
} from '../services/requests.js';
import { audit, countUsage } from '../services/usage.js';

const idParam = z.uuid();

/** Owners' side of booking requests. Mounted behind requireAuth. */
export function requestsRouter(pool: pg.Pool) {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json({ requests: await listPending(pool) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/count', async (_req, res, next) => {
    try {
      res.json({ pending: await countPending(pool) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const request = await getRequest(pool, idParam.parse(req.params.id));
      if (!request) throw new AppError(404, 'not_found');
      res.json({ request });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/accept', async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const input = appointmentInput.parse(req.body);
      const { created, ...result } = await acceptRequest(pool, id, input, req.session.userId!);
      await audit(pool, req.session.userId, 'accept', 'request', id);
      await countUsage(pool, 'requests_accepted');
      await countUsage(pool, created === 'series' ? 'series_created' : 'appointments_created');
      res.json(result);
    } catch (err) {
      next(err instanceof TimeError ? new AppError(400, err.code) : err);
    }
  });

  router.post('/:id/decline', async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      await declineRequest(pool, id, req.session.userId!);
      await audit(pool, req.session.userId, 'decline', 'request', id);
      await countUsage(pool, 'requests_declined');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
