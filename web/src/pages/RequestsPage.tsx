import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { type BookingRequest, api } from '../api';
import { formatLongDate, formatTime } from '../dates';
import { errorMessage } from '../errors';
import { cleaningTypeLabel, formatAddress } from '../requestDetails';

export default function RequestsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [requests, setRequests] = useState<BookingRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listRequests()
      .then((r) => setRequests(r.requests))
      .catch((err) => setError(errorMessage(t, err)));
  }, [t]);

  return (
    <main className="page narrow">
      <h1>{t('requests.title')}</h1>
      {notice && (
        <p className="notice" role="status">
          {t(`notice.${notice}`)}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!error && requests === null && <p className="status">{t('common.loading')}</p>}
      {requests?.length === 0 && <p className="big">{t('requests.empty')}</p>}
      {requests?.map((r) => (
        <Link key={r.id} className="appt" to={`/requests/${r.id}`}>
          <strong>{r.clientName}</strong>
          <span>
            {formatLongDate(r.preferredDate, lang)}, {formatTime(r.preferredTime, lang)}
          </span>
          <small>{[cleaningTypeLabel(t, r), formatAddress(r)].filter(Boolean).join(' · ')}</small>
        </Link>
      ))}
      <button className="btn" onClick={() => navigate('/')}>
        {t('common.back')}
      </button>
    </main>
  );
}
