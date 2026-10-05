import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { type Appointment, api } from '../api';
import { formatFullDate, formatTime } from '../dates';
import { errorMessage } from '../errors';
import { TranslatedNote } from '../components';
import { repeatLabel } from '../repeat';

export default function AppointmentDetail() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [appt, setAppt] = useState<Appointment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get(id)
      .then((r) => setAppt(r.appointment))
      .catch((err) => setError(errorMessage(t, err)));
  }, [id, t]);

  const back = () => navigate(appt ? `/?view=day&date=${appt.date}` : '/');

  if (error)
    return (
      <main className="page narrow">
        <p className="error" role="alert">
          {error}
        </p>
        <button className="btn" onClick={() => navigate('/')}>
          {t('common.back')}
        </button>
      </main>
    );
  if (!appt) return <p className="status">{t('common.loading')}</p>;

  const rec = appt.recurrence;
  const repeatText = rec
    ? (() => {
        const base = repeatLabel(t, rec.freq, appt.originalDate ?? appt.date, lang, rec.ordinal);
        return rec.untilDate
          ? t('detail.until', { repeat: base, date: formatFullDate(rec.untilDate, lang) })
          : base;
      })()
    : null;
  const key = encodeURIComponent(appt.id);

  return (
    <main className="page narrow">
      <h1>{appt.clientName}</h1>
      {appt.status === 'cancelled' && <p className="error">{t('notice.cancelled')}</p>}
      <dl className="facts">
        <dt>{t('detail.when')}</dt>
        <dd>
          {formatFullDate(appt.date, lang)}, {formatTime(appt.time, lang)}
        </dd>
        {repeatText && (
          <>
            <dt>{t('detail.repeats')}</dt>
            <dd>{repeatText}</dd>
          </>
        )}
        <dt>{t('detail.where')}</dt>
        <dd>{appt.address}</dd>
        {appt.clientPhone && (
          <>
            <dt>{t('detail.phone')}</dt>
            <dd>
              {appt.clientPhone}{' '}
              <a className="link" href={`tel:${appt.clientPhone.replace(/[^0-9+]/g, '')}`}>
                {t('detail.call')}
              </a>
            </dd>
          </>
        )}
        {appt.notes && (
          <>
            <dt>{t('detail.notes')}</dt>
            <dd>
              <TranslatedNote entity="appointment" id={appt.id} notes={appt.notes} />
            </dd>
          </>
        )}
      </dl>
      {appt.status === 'scheduled' && (
        <>
          <Link className="btn primary" to={`/appointment/${key}/edit`}>
            {t('detail.edit')}
          </Link>
          <Link className="btn danger" to={`/appointment/${key}/cancel`}>
            {t('detail.cancel')}
          </Link>
        </>
      )}
      <button className="btn" onClick={back}>
        {t('common.back')}
      </button>
    </main>
  );
}
