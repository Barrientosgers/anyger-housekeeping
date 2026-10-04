import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { type Appointment, api } from '../api';
import {
  addDays,
  addMonths,
  formatFullDate,
  formatLongDate,
  formatMonth,
  formatRange,
  formatTime,
  formatWeekday,
  monthGrid,
  sameMonth,
  todayPacific,
  weekDays,
} from '../dates';
import { LanguageToggle } from '../components';
import { errorMessage } from '../errors';

type View = 'month' | 'week' | 'day';

export default function CalendarPage({ onLogout }: { onLogout: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const today = todayPacific();

  const viewParam = params.get('view');
  const view: View = viewParam === 'week' || viewParam === 'day' ? viewParam : 'month';
  const dateParam = params.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;
  const notice = (location.state as { notice?: string } | null)?.notice;

  const days = useMemo(
    () => (view === 'month' ? monthGrid(date).flat() : view === 'week' ? weekDays(date) : [date]),
    [view, date],
  );
  const from = days[0]!;
  const to = days[days.length - 1]!;

  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState(0);

  const load = useCallback(() => {
    setAppointments(null);
    setError(null);
    api
      .list(from, to)
      .then((r) => setAppointments(r.appointments))
      .catch((err) => setError(errorMessage(t, err)));
  }, [from, to, t]);

  useEffect(load, [load]);

  useEffect(() => {
    api
      .requestCount()
      .then((r) => setPendingRequests(r.pending))
      .catch(() => undefined); // the banner is a convenience; the calendar works without it
  }, []);

  const byDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments ?? []) map.set(a.date, [...(map.get(a.date) ?? []), a]);
    return map;
  }, [appointments]);

  const go = (nextView: View, nextDate: string) =>
    setParams({ view: nextView, date: nextDate }, { replace: true });
  const step = (dir: 1 | -1) =>
    go(
      view,
      view === 'month' ? addMonths(date, dir) : addDays(date, view === 'week' ? 7 * dir : dir),
    );

  const title =
    view === 'month'
      ? formatMonth(date, lang)
      : view === 'week'
        ? formatRange(from, to, lang)
        : formatFullDate(date, lang);

  return (
    <main className="page">
      <header className="topbar">
        <h1>{t('calendar.title')}</h1>
        <LanguageToggle />
      </header>

      {pendingRequests > 0 && (
        <button className="btn alert" onClick={() => navigate('/requests')}>
          {t('requests.banner', { count: pendingRequests })}
        </button>
      )}

      {notice && (
        <p className="notice" role="status">
          {t(`notice.${notice}`)}
        </p>
      )}

      <div className="segmented" role="group" aria-label={t('calendar.viewSwitch')}>
        <button className="btn" aria-pressed={view === 'month'} onClick={() => go('month', date)}>
          {t('calendar.month')}
        </button>
        <button className="btn" aria-pressed={view === 'week'} onClick={() => go('week', date)}>
          {t('calendar.week')}
        </button>
        <button className="btn" aria-pressed={view === 'day'} onClick={() => go('day', date)}>
          {t('calendar.day')}
        </button>
      </div>

      <nav className="stepper">
        <button className="btn" onClick={() => step(-1)}>
          {t('calendar.previous')}
        </button>
        <button className="btn" onClick={() => go(view, today)}>
          {t('calendar.today')}
        </button>
        <button className="btn" onClick={() => step(1)}>
          {t('calendar.next')}
        </button>
      </nav>

      <h2 className="range-title">{title}</h2>

      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button className="btn" onClick={load}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {!error && appointments === null && <p className="status">{t('common.loading')}</p>}

      {appointments && view === 'month' && (
        <div className="month" role="grid">
          {weekDays(date).map((d) => (
            <div key={d} className="weekday" role="columnheader">
              {formatWeekday(d, lang)}
            </div>
          ))}
          {days.map((d) => {
            const count = byDate.get(d)?.length ?? 0;
            const classes = [
              'day',
              sameMonth(d, date) ? '' : 'outside',
              d === today ? 'today' : '',
            ].join(' ');
            return (
              <button
                key={d}
                className={classes}
                aria-label={`${formatLongDate(d, lang)}: ${t('calendar.count', { count })}`}
                onClick={() => go('day', d)}
              >
                <span className="num">{Number(d.slice(8))}</span>
                {count > 0 && <span className="badge">{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {appointments && view !== 'month' && (
        <div className="week">
          {days.map((d) => {
            const list = byDate.get(d) ?? [];
            return (
              <section key={d} className={`daycard${d === today ? ' today' : ''}`}>
                {view === 'week' && <h3>{formatLongDate(d, lang)}</h3>}
                {list.length === 0 && <p className="empty">{t('calendar.noAppointments')}</p>}
                {list.map((a) => (
                  <Link key={a.id} className="appt" to={`/appointment/${encodeURIComponent(a.id)}`}>
                    <strong>{formatTime(a.time, lang)}</strong>
                    <span>{a.clientName}</span>
                    <small>{a.address}</small>
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
      )}

      <footer className="page-footer footer-actions">
        <button className="btn quiet" onClick={() => navigate('/requests')}>
          {t('nav.requests')}
        </button>
        <button className="btn quiet" onClick={onLogout}>
          {t('nav.logout')}
        </button>
      </footer>

      <div className="bottombar">
        <button
          className="btn primary"
          onClick={() => navigate(`/new?date=${view === 'month' ? today : date}`)}
        >
          {t('calendar.newAppointment')}
        </button>
      </div>
    </main>
  );
}
