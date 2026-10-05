import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { type BookingRequest, api } from '../api';
import { formatFullDate, formatTime } from '../dates';
import { errorMessage } from '../errors';
import { TranslatedNote } from '../components';
import { repeatLabel } from '../repeat';

export default function RequestDetail() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [req, setReq] = useState<BookingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getRequest(id)
      .then((r) => setReq(r.request))
      .catch((err) => setError(errorMessage(t, err)));
  }, [id, t]);

  async function decline() {
    setBusy(true);
    try {
      await api.declineRequest(id);
      navigate('/requests', { state: { notice: 'requestDeclined' } });
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  if (!req && !error) return <p className="status">{t('common.loading')}</p>;
  if (!req)
    return (
      <main className="page narrow">
        <p className="error" role="alert">
          {error}
        </p>
        <button className="btn" onClick={() => navigate('/requests')}>
          {t('common.back')}
        </button>
      </main>
    );

  if (confirmingDecline) {
    return (
      <main className="page narrow">
        <h1>{t('requests.declineTitle')}</h1>
        <p className="big">{req.clientName}</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn danger" onClick={decline} disabled={busy}>
          {t('requests.declineConfirm')}
        </button>
        <button className="btn primary" onClick={() => setConfirmingDecline(false)}>
          {t('requests.declineKeep')}
        </button>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <h1>{req.clientName}</h1>
      <dl className="facts">
        <dt>{t('requests.wants')}</dt>
        <dd>
          {formatFullDate(req.preferredDate, lang)}, {formatTime(req.preferredTime, lang)}
          <br />
          {req.repeat === 'none'
            ? t('requests.once')
            : repeatLabel(t, req.repeat, req.preferredDate, lang)}
        </dd>
        <dt>{t('requests.where')}</dt>
        <dd>{req.address}</dd>
        <dt>{t('requests.phone')}</dt>
        <dd>
          {req.clientPhone}{' '}
          <a className="link" href={`tel:${req.clientPhone.replace(/[^0-9+]/g, '')}`}>
            {t('detail.call')}
          </a>
        </dd>
        {req.notes && (
          <>
            <dt>{t('requests.notes')}</dt>
            <dd>
              <TranslatedNote entity="request" id={req.id} notes={req.notes} />
            </dd>
          </>
        )}
        <dt>{t('requests.clientLang')}</dt>
        <dd>{t(`requests.${req.lang}`)}</dd>
      </dl>
      <p className="small-print">
        {t('requests.received', { date: formatFullDate(req.receivedDate, lang) })}
      </p>
      <Link className="btn primary" to={`/requests/${req.id}/accept`}>
        {t('requests.accept')}
      </Link>
      <button className="btn danger" onClick={() => setConfirmingDecline(true)}>
        {t('requests.decline')}
      </button>
      <button className="btn" onClick={() => navigate('/requests')}>
        {t('common.back')}
      </button>
    </main>
  );
}
