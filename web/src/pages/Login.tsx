import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { errorMessage } from '../errors';

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      onLoggedIn();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>{t('app.name')}</h1>
      <h2>{t('login.title')}</h2>
      <form onSubmit={submit}>
        <label>
          {t('login.email')}
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          {t('login.password')}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? t('common.loading') : t('login.submit')}
        </button>
      </form>
    </main>
  );
}
