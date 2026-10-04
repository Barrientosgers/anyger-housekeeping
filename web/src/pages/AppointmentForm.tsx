import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type AppointmentInput, api } from '../api';
import { todayPacific } from '../dates';
import { errorMessage } from '../errors';

const DURATIONS: [number, string][] = [
  [60, 'hours_1'],
  [90, 'hours_1_5'],
  [120, 'hours_2'],
  [150, 'hours_2_5'],
  [180, 'hours_3'],
  [240, 'hours_4'],
  [300, 'hours_5'],
  [360, 'hours_6'],
  [480, 'hours_8'],
];

export default function AppointmentForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const editing = Boolean(id);

  const [form, setForm] = useState<AppointmentInput>({
    clientName: '',
    clientPhone: '',
    address: '',
    date: params.get('date') ?? todayPacific(),
    time: '09:00',
    durationMin: 120,
    notes: '',
  });
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get(id)
      .then(({ appointment: a }) =>
        setForm({
          clientName: a.clientName,
          clientPhone: a.clientPhone ?? '',
          address: a.address,
          date: a.date,
          time: a.time,
          durationMin: a.durationMin,
          notes: a.notes ?? '',
        }),
      )
      .catch((err) => setError(errorMessage(t, err)))
      .finally(() => setLoading(false));
  }, [id, t]);

  const set = <K extends keyof AppointmentInput>(key: K, value: AppointmentInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = id ? await api.update(id, form) : await api.create(form);
      navigate(`/?view=day&date=${saved.appointment.date}`, {
        state: { notice: saved.overlaps > 0 ? 'savedOverlap' : 'saved' },
      });
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  const durationKnown = DURATIONS.some(([m]) => m === form.durationMin);

  if (loading) return <p className="status">{t('common.loading')}</p>;

  return (
    <main className="page narrow">
      <h1>{editing ? t('form.editTitle') : t('form.newTitle')}</h1>
      <form onSubmit={submit}>
        <label>
          {t('form.clientName')}
          <input
            value={form.clientName}
            onChange={(e) => set('clientName', e.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label>
          {t('form.clientPhone')}
          <input
            type="tel"
            value={form.clientPhone}
            onChange={(e) => set('clientPhone', e.target.value)}
            maxLength={30}
          />
        </label>
        <label>
          {t('form.address')}
          <input
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            maxLength={250}
            required
          />
        </label>
        <label>
          {t('form.date')}
          <input
            type="date"
            value={form.date}
            onChange={(e) => set('date', e.target.value)}
            required
          />
        </label>
        <label>
          {t('form.time')}
          <input
            type="time"
            value={form.time}
            onChange={(e) => set('time', e.target.value)}
            required
          />
        </label>
        <label>
          {t('form.duration')}
          <select
            value={form.durationMin}
            onChange={(e) => set('durationMin', Number(e.target.value))}
          >
            {!durationKnown && (
              <option value={form.durationMin}>
                {t('form.otherMinutes', { count: form.durationMin })}
              </option>
            )}
            {DURATIONS.map(([minutes, key]) => (
              <option key={minutes} value={minutes}>
                {t(`form.${key}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('form.notes')}
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            maxLength={2000}
            rows={4}
          />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
        <button className="btn" type="button" onClick={() => navigate(-1)}>
          {t('common.back')}
        </button>
      </form>
    </main>
  );
}
