import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type Appointment, type AppointmentInput, type Freq, type Scope, api } from '../api';
import { formatFullDate, formatTime, todayPacific } from '../dates';
import { errorMessage } from '../errors';
import { repeatLabel } from '../repeat';
import { cleaningTypeLabel, formatAddress, moveLabel } from '../requestDetails';

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
const FREQS: Freq[] = ['weekly', 'biweekly', 'monthly'];

/** `accept` reuses this form to turn a booking request into an appointment. */
export default function AppointmentForm({ mode = 'normal' }: { mode?: 'normal' | 'accept' }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const accepting = mode === 'accept';
  const editing = Boolean(id) && !accepting;

  const [form, setForm] = useState<AppointmentInput>({
    clientName: '',
    clientPhone: '',
    address: '',
    date: params.get('date') ?? todayPacific(),
    time: '09:00',
    durationMin: 120,
    notes: '',
    repeat: 'none',
    repeatUntil: '',
  });
  const [original, setOriginal] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [busy, setBusy] = useState(false);
  const [choosingScope, setChoosingScope] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    if (accepting) {
      api
        .getRequest(id)
        .then(({ request: r }) =>
          setForm({
            clientName: r.clientName,
            clientPhone: r.clientPhone,
            address: formatAddress(r),
            date: r.preferredDate,
            time: r.preferredTime,
            durationMin: 120,
            // The kind of place and any move-in/out clean would otherwise be lost on the calendar.
            notes: [cleaningTypeLabel(t, r), moveLabel(t, r), r.notes].filter(Boolean).join('. '),
            repeat: r.repeat,
            repeatUntil: '',
          }),
        )
        .catch((err) => setError(errorMessage(t, err)))
        .finally(() => setLoading(false));
      return;
    }
    api
      .get(id)
      .then(({ appointment: a }) => {
        setOriginal(a);
        setForm({
          clientName: a.clientName,
          clientPhone: a.clientPhone ?? '',
          address: a.address,
          date: a.date,
          time: a.time,
          durationMin: a.durationMin,
          notes: a.notes ?? '',
          repeat: a.recurrence?.freq ?? 'none',
          repeatUntil: a.recurrence?.untilDate ?? '',
        });
      })
      .catch((err) => setError(errorMessage(t, err)))
      .finally(() => setLoading(false));
  }, [id, accepting, t]);

  const set = <K extends keyof AppointmentInput>(key: K, value: AppointmentInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isSeries = Boolean(original?.recurrence);
  // A standalone appointment keeps its own schedule; only new ones and series show the repeat choice.
  const showRepeat = !editing || isSeries;
  const repeatChanged =
    isSeries &&
    (form.repeat !== original?.recurrence?.freq ||
      form.repeatUntil !== (original?.recurrence?.untilDate ?? ''));

  async function save(scope?: Scope) {
    setBusy(true);
    setError(null);
    try {
      const saved =
        accepting && id
          ? await api.acceptRequest(id, form)
          : id
            ? await api.update(id, form, scope)
            : await api.create(form);
      const notice = accepting ? 'requestAccepted' : saved.overlaps > 0 ? 'savedOverlap' : 'saved';
      navigate(`/?view=day&date=${saved.appointment.date}`, { state: { notice } });
    } catch (err) {
      setError(errorMessage(t, err));
      setChoosingScope(false);
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (isSeries) setChoosingScope(true);
    else void save();
  }

  const durationKnown = DURATIONS.some(([m]) => m === form.durationMin);

  if (loading) return <p className="status">{t('common.loading')}</p>;

  if (choosingScope) {
    return (
      <main className="page narrow">
        <h1>{t('scope.title')}</h1>
        <p className="big">
          {form.clientName}, {formatFullDate(form.date, lang)}, {formatTime(form.time, lang)}
        </p>
        {repeatChanged && <p className="choice-note">{t('scope.repeatNote')}</p>}
        {!repeatChanged && (
          <button className="btn primary" disabled={busy} onClick={() => void save('this')}>
            {t('scope.this')}
          </button>
        )}
        <button
          className={repeatChanged ? 'btn primary' : 'btn'}
          disabled={busy}
          onClick={() => void save('future')}
        >
          {t('scope.future')}
        </button>
        <button className="btn" disabled={busy} onClick={() => setChoosingScope(false)}>
          {t('scope.back')}
        </button>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <h1>
        {accepting ? t('requests.acceptTitle') : editing ? t('form.editTitle') : t('form.newTitle')}
      </h1>
      {accepting && <p>{t('requests.acceptHint')}</p>}
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

        {showRepeat && (
          <>
            <label>
              {t('form.repeat')}
              <select
                value={form.repeat}
                onChange={(e) => set('repeat', e.target.value as AppointmentInput['repeat'])}
              >
                <option value="none">{t('form.repeat_none')}</option>
                {FREQS.map((f) => (
                  <option key={f} value={f}>
                    {repeatLabel(
                      t,
                      f,
                      form.date,
                      lang,
                      f === 'monthly' && original?.recurrence?.freq === 'monthly'
                        ? original.recurrence.ordinal
                        : null,
                    )}
                  </option>
                ))}
              </select>
            </label>
            {form.repeat !== 'none' && (
              <label>
                {t('form.repeatUntil')}
                <input
                  type="date"
                  min={form.date}
                  value={form.repeatUntil}
                  onChange={(e) => set('repeatUntil', e.target.value)}
                />
              </label>
            )}
          </>
        )}

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
