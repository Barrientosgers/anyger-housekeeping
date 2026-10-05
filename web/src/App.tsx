import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import AppointmentDetail from './pages/AppointmentDetail';
import AppointmentForm from './pages/AppointmentForm';
import BookingPage from './pages/BookingPage';
import CalendarPage from './pages/CalendarPage';
import CancelAppointment from './pages/CancelAppointment';
import Login from './pages/Login';
import RequestDetail from './pages/RequestDetail';
import RequestsPage from './pages/RequestsPage';

export default function App() {
  // The booking form is the only public page; everything else needs a login.
  return (
    <Routes>
      <Route path="/book" element={<BookingPage />} />
      <Route path="*" element={<SignedIn />} />
    </Routes>
  );
}

function SignedIn() {
  const { t } = useTranslation();
  const [auth, setAuth] = useState<'loading' | 'in' | 'out'>('loading');

  useEffect(() => {
    api
      .me()
      .then(() => setAuth('in'))
      .catch(() => setAuth('out'));
    const onLoggedOut = () => setAuth('out');
    window.addEventListener('anyger:unauthenticated', onLoggedOut);
    return () => window.removeEventListener('anyger:unauthenticated', onLoggedOut);
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAuth('out');
  }, []);

  if (auth === 'loading') return <p className="status">{t('common.loading')}</p>;
  if (auth === 'out') return <Login onLoggedIn={() => setAuth('in')} />;

  return (
    <Routes>
      <Route path="/" element={<CalendarPage onLogout={logout} />} />
      <Route path="/new" element={<AppointmentForm />} />
      <Route path="/appointment/:id" element={<AppointmentDetail />} />
      <Route path="/appointment/:id/edit" element={<AppointmentForm />} />
      <Route path="/appointment/:id/cancel" element={<CancelAppointment />} />
      <Route path="/requests" element={<RequestsPage />} />
      <Route path="/requests/:id" element={<RequestDetail />} />
      <Route path="/requests/:id/accept" element={<AppointmentForm mode="accept" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
