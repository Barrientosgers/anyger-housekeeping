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
  listAppointments,
  rangeQuery,
  updateAppointment,
} from '../services/appointments.js';
import { audit, countUsage } from '../services/usage.js';

const idParam = z.string().uuid();
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
      const result = await createAppointment(pool, input, req.session.userId!).catch(mapTimeError);
      await audit(pool, req.session.userId, 'create', 'appointment', result.appointment.id);
      await countUsage(pool, 'appointments_created');
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const input = appointmentInput.parse(req.body);
      const result = await updateAppointment(pool, id, input).catch(mapTimeError);
      if (!result) throw new AppError(404, 'not_found');
      await audit(pool, req.session.userId, 'update', 'appointment', id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const id = idParam.parse(req.params.id);
      const appt = await cancelAppointment(pool, id);
      if (!appt) throw new AppError(404, 'not_found');
      await audit(pool, req.session.userId, 'cancel', 'appointment', id);
      await countUsage(pool, 'appointments_cancelled');
      res.json({ appointment: appt });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
