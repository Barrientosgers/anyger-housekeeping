import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type BookingInput, type MoveType, api } from '../api';
import { LanguageToggle } from '../components';
import { todayPacific } from '../dates';
import { errorMessage } from '../errors';
import { hasSavedLanguage } from '../i18n';
import { isValidPhone } from '../requestDetails';

/** One "how often" list for the client; the form splits it into repeat + move type. */
const FREQUENCIES = [
  { value: 'once', repeat: 'none', moveType: 'none' },
  { value: 'weekly', repeat: 'weekly', moveType: 'none' },
  { value: 'biweekly', repeat: 'biweekly', moveType: 'none' },
  { value: 'monthly', repeat: 'monthly', moveType: 'none' },
  { value: 'move_in', repeat: 'none', moveType: 'move_in' },
  { value: 'move_out', repeat: 'none', moveType: 'move_out' },
] as const;
const CONTACT_METHODS = ['call', 'text', 'email'] as const;
const CLEANING_TYPES = ['apartment', 'house', 'office'] as const;

/** The public form: no login. Clients who browse in English see English unless they chose otherwise. */
export default function BookingPage() {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState<Omit<BookingInput, 'lang'>>({
    clientName: '',
    clientPhone: '',
    contactMethod: 'call',
    contactEmail: '',
    cleaningType: 'house',
    address: '',
    unit: '',
    city: '',
    zip: '',
    preferredDate: '',
    preferredTime: '09:00',
    repeat: 'none',
    moveType: 'none',
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
    if (!isValidPhone(form.clientPhone)) return setError(t('book.phoneInvalid'));
    if (!/^\d{5}(-\d{4})?$/.test(form.zip.trim())) return setError(t('book.zipInvalid'));
    setBusy(true);
    setError(null);
    try {
      await api.submitBooking({
        ...form,
        contactEmail: form.contactMethod === 'email' ? form.contactEmail : '',
        lang: i18n.language === 'en' ? 'en' : 'es',
      });
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
            maxLength={30}
            autoComplete="tel"
            required
          />
        </label>
        <label>
          {t('book.contactMethod')}
          <select
            value={form.contactMethod}
            onChange={(e) => set('contactMethod', e.target.value as BookingInput['contactMethod'])}
          >
            {CONTACT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`book.contact_${m}`)}
              </option>
            ))}
          </select>
        </label>
        {form.contactMethod === 'email' && (
          <label>
            {t('book.email')}
            <input
              type="email"
              value={form.contactEmail}
              onChange={(e) => set('contactEmail', e.target.value)}
              maxLength={254}
              autoComplete="email"
              required
            />
          </label>
        )}
        <label>
          {t('book.cleaningType')}
          <select
            value={form.cleaningType}
            onChange={(e) => set('cleaningType', e.target.value as BookingInput['cleaningType'])}
          >
            {CLEANING_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`book.type_${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('book.address')}
          <input
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            maxLength={250}
            autoComplete="address-line1"
          />
        </label>
        <label>
          {t('book.unit')}
          <input
            value={form.unit}
            onChange={(e) => set('unit', e.target.value)}
            maxLength={40}
            autoComplete="address-line2"
          />
        </label>
        <label>
          {t('book.city')}
          <input
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
            maxLength={80}
            autoComplete="address-level2"
            required
          />
        </label>
        <label>
          {t('book.zip')}
          <input
            value={form.zip}
            onChange={(e) => set('zip', e.target.value)}
            inputMode="numeric"
            maxLength={10}
            autoComplete="postal-code"
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
            value={
              FREQUENCIES.find((f) => f.repeat === form.repeat && f.moveType === form.moveType)
                ?.value
            }
            onChange={(e) => {
              const f = FREQUENCIES.find((x) => x.value === e.target.value)!;
              setForm((prev) => ({ ...prev, repeat: f.repeat, moveType: f.moveType as MoveType }));
            }}
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {t(`book.freq_${f.value}`)}
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
