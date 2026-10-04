import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { TimeError } from '../domain/time.js';
import { AppError } from '../errors.js';
import {
  appointmentInput,
  cancelAppointment,
  createAppointment,
  getAppointment,
  isOccurrenceId,
  listAppointments,
  rangeQuery,
  scopeBody,
  updateAppointment,
} from '../services/appointments.js';
import { audit, countUsage } from '../services/usage.js';

// A stored appointment's uuid, or the id of a visit generated from a repeating series.
const idParam = z.string().refine((v) => z.uuid().safeParse(v).success || isOccurrenceId(v));
const MAX_RANGE_DAYS = 62;

function mapTimeError(err: unknown): never {
  if (err instanceof TimeError) throw new AppError(400, err.code);
  throw err;
}

export function appointmentsRouter(pool: pg.Pool) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const { from, to } = rangeQuery.parse(req.query);
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (!(days >= 0 && days <= MAX_RANGE_DAYS)) throw new AppError(400, 'invalid_range');
      res.json({ appointments: await listAppointments(pool, from, to) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const appt = await getAppointment(pool, idParam.parse(req.params.id));
      if (!appt) throw new AppError(404, 'not_found');
      res.json({ appointment: appt });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const input = appointmentInput.parse(req.body);
      const { created, ...result } = await createAppointment(
        pool,
        input,
        req.session.userId!,
      ).catch(mapTimeError);
      if (created === 'series') {
        await audit(pool, req.session.userId, 'create', 'series', result.appointment.seriesId!);
        await countUsage(pool, 'series_created');
      } else {
        await audit(pool, req.session.userId, 'create', 'appointment', result.appointment.id);
        await countUsage(pool, 'appointments_created');
      }
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const input = appointmentInput.parse(req.body);
      const result = await updateAppointment(pool, id, input, req.session.userId!).catch(
        mapTimeError,
      );
      if (!result) throw new AppError(404, 'not_found');
      const { audit: a, ...body } = result;
      await audit(pool, req.session.userId, a.action, a.entity, a.id);
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const { scope } = scopeBody.parse(req.body ?? {});
      const result = await cancelAppointment(pool, id, scope);
      if (!result) throw new AppError(404, 'not_found');
      await audit(
        pool,
        req.session.userId,
        result.audit.action,
        result.audit.entity,
        result.audit.id,
      );
      await countUsage(pool, 'appointments_cancelled');
      res.json({ appointment: result.appointment });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
