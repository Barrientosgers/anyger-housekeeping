import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import AppointmentDetail from '../pages/AppointmentDetail';
import AppointmentForm from '../pages/AppointmentForm';
import CalendarPage from '../pages/CalendarPage';
import CancelAppointment from '../pages/CancelAppointment';

const appt = {
  id: '11111111-1111-4111-8111-111111111111',
  clientName: 'María García',
  clientPhone: '555-010-0000',
  address: '123 Example St',
  startsAt: '2026-06-10T16:00:00.000Z',
  date: '2026-06-10',
  time: '09:00',
  durationMin: 120,
  notes: '<b>Dos perros</b>',
  status: 'scheduled',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-06-10T19:00:00Z'));
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/appointments?')) return json({ appointments: [appt] });
    if (url === `/api/appointments/${appt.id}` && init?.method === 'GET')
      return json({ appointment: appt });
    if (init?.method === 'POST' && url.endsWith('/cancel'))
      return json({ appointment: { ...appt, status: 'cancelled' } });
    if (init?.method === 'POST') return json({ appointment: appt, overlaps: 1 }, 201);
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<CalendarPage onLogout={() => undefined} />} />
        <Route path="/new" element={<AppointmentForm />} />
        <Route path="/appointment/:id" element={<AppointmentDetail />} />
        <Route path="/appointment/:id/cancel" element={<CancelAppointment />} />
      </Routes>
    </MemoryRouter>,
  );

describe('calendar home screen', () => {
  it('opens on the month view in Spanish and shows the appointment count on the day', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'junio de 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mes' })).toHaveAttribute('aria-pressed', 'true');
    const day = await screen.findByRole('button', { name: /miércoles, 10 de junio: 1 cita/i });
    expect(within(day).getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Nueva cita' })).toBeInTheDocument();
  });

  it('tapping a day shows that week with the client and time as a large link', async () => {
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /10 de junio/i }));
    const link = await screen.findByRole('link', { name: /María García/ });
    expect(link).toHaveAttribute('href', `/appointment/${appt.id}`);
    expect(link).toHaveTextContent(/9:00\sa\.\s?m\./);
    expect(screen.getAllByText('Sin citas').length).toBeGreaterThan(0);
  });

  it('shows a plain-language error with a retry button when loading fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    renderAt('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay conexión');
    await userEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(await screen.findByRole('heading', { name: 'junio de 2026' })).toBeInTheDocument();
  });
});

describe('appointment form', () => {
  it('saves a new appointment and sends the Pacific date/time the user typed', async () => {
    renderAt('/new?date=2026-06-12');
    await userEvent.type(screen.getByLabelText('Nombre del cliente'), 'Ana López');
    await userEvent.type(screen.getByLabelText('Dirección'), '9 Test Ave');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/appointments', expect.anything()),
    );
    const call = fetchMock.mock.calls.find(
      ([u, i]) => u === '/api/appointments' && i?.method === 'POST',
    )!;
    expect(JSON.parse(call[1].body)).toMatchObject({
      clientName: 'Ana López',
      address: '9 Test Ave',
      date: '2026-06-12',
      time: '09:00',
      durationMin: 120,
    });
    expect(call[1].headers['X-Requested-With']).toBe('anyger');
  });

  it('explains the daylight-saving problem in plain Spanish', async () => {
    fetchMock.mockImplementation(async () =>
      json({ error: { code: 'nonexistent_local_time' } }, 400),
    );
    renderAt('/new?date=2026-03-08');
    await userEvent.type(screen.getByLabelText('Nombre del cliente'), 'Ana');
    await userEvent.type(screen.getByLabelText('Dirección'), 'Calle 1');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esa hora no existe ese día');
  });
});

describe('detail and cancel', () => {
  it('renders notes as text, never as HTML', async () => {
    renderAt(`/appointment/${appt.id}`);
    expect(await screen.findByRole('heading', { name: 'María García' })).toBeInTheDocument();
    expect(screen.getByText('<b>Dos perros</b>')).toBeInTheDocument();
    expect(document.querySelector('dd b')).toBeNull();
    expect(screen.getByRole('link', { name: 'Llamar' })).toHaveAttribute('href', 'tel:5550100000');
  });

  it('asks for confirmation before cancelling', async () => {
    renderAt(`/appointment/${appt.id}/cancel`);
    expect(
      await screen.findByText(/María García, miércoles, 10 de junio de 2026 a las 9:00/),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([u, i]) => String(u).endsWith('/cancel') && i?.method === 'POST'),
    ).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Sí, cancelar la cita' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u).endsWith('/cancel') && i?.method === 'POST',
        ),
      ).toBe(true),
    );
  });
});
