import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type BookingInput, api } from '../api';
import { LanguageToggle } from '../components';
import { todayPacific } from '../dates';
import { errorMessage } from '../errors';
import { hasSavedLanguage } from '../i18n';

const FREQS = ['none', 'weekly', 'biweekly', 'monthly'] as const;

/** The public form: no login. Clients who browse in English see English unless they chose otherwise. */
export default function BookingPage() {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState<Omit<BookingInput, 'lang'>>({
    clientName: '',
    clientPhone: '',
    address: '',
    preferredDate: '',
    preferredTime: '09:00',
    repeat: 'none',
    notes: '',
    website: '',
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSavedLanguage() && navigator.language.toLowerCase().startsWith('en')) {
      void i18n.changeLanguage('en'); // not saved: only the toggle remembers a choice
    }
  }, [i18n]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.submitBooking({ ...form, lang: i18n.language === 'en' ? 'en' : 'es' });
      setDone(true);
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="page narrow">
        <h1>{t('book.thanksTitle')}</h1>
        <p className="big" role="status">
          {t('book.thanksBody')}
        </p>
      </main>
    );
  }

  return (
    <main className="page narrow">
      <header className="topbar">
        <h1>{t('app.name')}</h1>
        <LanguageToggle />
      </header>
      <h2>{t('book.title')}</h2>
      <p>{t('book.intro')}</p>
      <form onSubmit={submit}>
        <label>
          {t('book.name')}
          <input
            value={form.clientName}
            onChange={(e) => set('clientName', e.target.value)}
            maxLength={120}
            autoComplete="name"
            required
          />
        </label>
        <label>
          {t('book.phone')}
          <input
            type="tel"
            value={form.clientPhone}
            onChange={(e) => set('clientPhone', e.target.value)}
            minLength={7}
            maxLength={30}
            autoComplete="tel"
            required
          />
        </label>
        <label>
          {t('book.address')}
          <input
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            maxLength={250}
            autoComplete="street-address"
            required
          />
        </label>
        <label>
          {t('book.date')}
          <input
            type="date"
            min={todayPacific()}
            value={form.preferredDate}
            onChange={(e) => set('preferredDate', e.target.value)}
            required
          />
        </label>
        <label>
          {t('book.time')}
          <input
            type="time"
            value={form.preferredTime}
            onChange={(e) => set('preferredTime', e.target.value)}
            required
          />
        </label>
        <label>
          {t('book.repeat')}
          <select
            value={form.repeat}
            onChange={(e) => set('repeat', e.target.value as BookingInput['repeat'])}
          >
            {FREQS.map((f) => (
              <option key={f} value={f}>
                {f === 'none'
                  ? t('book.once')
                  : t(`form.repeat_${f === 'monthly' ? 'monthlyPlain' : f}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('book.notes')}
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            maxLength={1000}
            rows={4}
          />
        </label>

        {/* Honeypot: invisible to people and screen readers, tempting to bots. */}
        <div className="hp" aria-hidden="true">
          <label>
            Website
            <input
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={(e) => set('website', e.target.value)}
            />
          </label>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? t('book.sending') : t('book.submit')}
        </button>
        <p className="small-print">{t('book.privacy')}</p>
      </form>
    </main>
  );
}
