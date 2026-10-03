import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { type Appointment, api } from '../api';
import { formatFullDate, formatTime } from '../dates';
import { errorMessage } from '../errors';

export default function CancelAppointment() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [appt, setAppt] = useState<Appointment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(id)
      .then((r) => setAppt(r.appointment))
      .catch((err) => setError(errorMessage(t, err)));
  }, [id, t]);

  async function confirm() {
    setBusy(true);
    try {
      const { appointment } = await api.cancel(id);
      navigate(`/?view=week&date=${appointment.date}`, { state: { notice: 'cancelled' } });
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  if (!appt && !error) return <p className="status">{t('common.loading')}</p>;

  return (
    <main className="page narrow">
      <h1>{t('cancel.title')}</h1>
      {appt && (
        <p className="big">
          {t('cancel.summary', {
            name: appt.clientName,
            date: formatFullDate(appt.date, lang),
            time: formatTime(appt.time, lang),
          })}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn danger" onClick={confirm} disabled={busy || !appt}>
        {t('cancel.confirm')}
      </button>
      <button className="btn primary" onClick={() => navigate(-1)}>
        {t('cancel.keep')}
      </button>
    </main>
  );
}
