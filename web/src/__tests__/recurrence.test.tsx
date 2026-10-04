import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { setLanguage } from '../i18n';
import AppointmentDetail from '../pages/AppointmentDetail';
import AppointmentForm from '../pages/AppointmentForm';
import CancelAppointment from '../pages/CancelAppointment';
import Login from '../pages/Login';

const SERIES = '22222222-2222-4222-8222-222222222222';
const visit = {
  id: `s:${SERIES}:2026-10-13`,
  seriesId: SERIES,
  originalDate: '2026-10-13',
  recurrence: { freq: 'weekly', untilDate: null, ordinal: null },
  clientName: 'Rosa Martínez',
  clientPhone: null,
  address: '412 Maple Ave',
  startsAt: '2026-10-13T16:00:00.000Z',
  date: '2026-10-13',
  time: '09:00',
  durationMin: 120,
  notes: null,
  status: 'scheduled',
};
const single = {
  ...visit,
  id: '33333333-3333-4333-8333-333333333333',
  seriesId: null,
  originalDate: null,
  recurrence: null,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (method: string) => fetchMock.mock.calls.filter(([, i]) => i?.method === method);

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'GET') {
      const id = decodeURIComponent(url.split('/api/appointments/')[1] ?? '');
      return json({ appointment: id === single.id ? single : visit });
    }
    if (url.endsWith('/cancel')) return json({ appointment: { ...visit, status: 'cancelled' } });
    return json({ appointment: visit, overlaps: 0 }, init?.method === 'POST' ? 201 : 200);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await setLanguage('es');
  localStorage.clear();
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>calendar</p>} />
        <Route path="/new" element={<AppointmentForm />} />
        <Route path="/appointment/:id" element={<AppointmentDetail />} />
        <Route path="/appointment/:id/edit" element={<AppointmentForm />} />
        <Route path="/appointment/:id/cancel" element={<CancelAppointment />} />
      </Routes>
    </MemoryRouter>,
  );
const editPath = (id: string) => `/appointment/${encodeURIComponent(id)}/edit`;

describe('language toggle', () => {
  it('switches the whole screen to English in one tap, and back, remembering the choice', async () => {
    render(<Login onLoggedIn={() => undefined} />);
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('anyger.lang')).toBe('en');
    await userEvent.click(screen.getByRole('button', { name: 'Español' }));
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    expect(localStorage.getItem('anyger.lang')).toBe('es');
  });
});

describe('new appointment: repeat', () => {
  it('offers plain-language repeat choices, including the weekday for monthly', async () => {
    renderAt('/new?date=2026-10-13');
    const select = screen.getByLabelText('¿Se repite?');
    const labels = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual([
      'No se repite',
      'Cada semana',
      'Cada 2 semanas',
      'Cada mes, el segundo martes',
    ]);
    expect(screen.queryByLabelText('Repetir hasta (opcional)')).not.toBeInTheDocument();
  });

  it('describes monthly in English too', async () => {
    await setLanguage('en');
    renderAt('/new?date=2026-10-13');
    expect(
      screen.getByRole('option', { name: 'Every month, on the 2nd Tuesday' }),
    ).toBeInTheDocument();
  });

  it('sends the repeat rule and end date to the API', async () => {
    renderAt('/new?date=2026-10-13');
    await userEvent.type(screen.getByLabelText('Nombre del cliente'), 'Ana López');
    await userEvent.type(screen.getByLabelText('Dirección'), '9 Test Ave');
    await userEvent.selectOptions(screen.getByLabelText('¿Se repite?'), 'weekly');
    await userEvent.type(screen.getByLabelText('Repetir hasta (opcional)'), '2026-12-01');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(JSON.parse(calls('POST')[0]![1].body)).toMatchObject({
      repeat: 'weekly',
      repeatUntil: '2026-12-01',
      date: '2026-10-13',
    });
  });

  it('a one-time appointment sends repeat "none" and no end date', async () => {
    renderAt('/new?date=2026-10-13');
    await userEvent.type(screen.getByLabelText('Nombre del cliente'), 'Ana');
    await userEvent.type(screen.getByLabelText('Dirección'), 'Calle 1');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(JSON.parse(calls('POST')[0]![1].body)).toMatchObject({
      repeat: 'none',
      repeatUntil: null,
    });
  });
});

describe('editing a repeating appointment', () => {
  it('asks "only this one or this and the following" before saving', async () => {
    renderAt(editPath(visit.id));
    await userEvent.clear(await screen.findByLabelText('Hora'));
    await userEvent.type(screen.getByLabelText('Hora'), '10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByRole('heading', { name: '¿Qué quiere cambiar?' }),
    ).toBeInTheDocument();
    expect(calls('PUT')).toHaveLength(0); // nothing saved yet
    await userEvent.click(screen.getByRole('button', { name: 'Solo esta cita' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/appointments/${encodeURIComponent(visit.id)}`,
      expect.anything(),
    );
    expect(JSON.parse(calls('PUT')[0]![1].body)).toMatchObject({ scope: 'this', time: '10:00' });
  });

  it('"this and the following" sends scope future', async () => {
    renderAt(editPath(visit.id));
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Esta y las siguientes' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(JSON.parse(calls('PUT')[0]![1].body).scope).toBe('future');
  });

  it('can go back from the question without saving', async () => {
    renderAt(editPath(visit.id));
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Volver' }));
    expect(await screen.findByLabelText('Nombre del cliente')).toBeInTheDocument();
    expect(calls('PUT')).toHaveLength(0);
  });

  it('changing how it repeats only offers "this and the following"', async () => {
    renderAt(editPath(visit.id));
    await userEvent.selectOptions(await screen.findByLabelText('¿Se repite?'), 'biweekly');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByText(/Cambiar cómo se repite aplica a esta cita y a las siguientes/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Solo esta cita' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Esta y las siguientes' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(JSON.parse(calls('PUT')[0]![1].body)).toMatchObject({
      repeat: 'biweekly',
      scope: 'future',
    });
  });

  it('a one-time appointment saves directly, without a question or a repeat choice', async () => {
    renderAt(editPath(single.id));
    await screen.findByLabelText('Nombre del cliente');
    expect(screen.queryByLabelText('¿Se repite?')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(JSON.parse(calls('PUT')[0]![1].body)).not.toHaveProperty('scope');
  });
});

describe('detail and cancel for a repeating appointment', () => {
  it('shows how it repeats', async () => {
    renderAt(`/appointment/${encodeURIComponent(visit.id)}`);
    expect(await screen.findByText('Se repite')).toBeInTheDocument();
    expect(screen.getByText('Cada semana')).toBeInTheDocument();
  });

  it('says "last Tuesday" for a last-weekday series', async () => {
    fetchMock.mockImplementation(async () =>
      json({
        appointment: {
          ...visit,
          recurrence: { freq: 'monthly', untilDate: null, ordinal: 5 },
          date: '2027-01-26',
          originalDate: '2027-01-26',
        },
      }),
    );
    renderAt(`/appointment/${encodeURIComponent(visit.id)}`);
    expect(await screen.findByText('Cada mes, el último martes')).toBeInTheDocument();
  });

  it('offers two clearly different cancel buttons and sends the chosen scope', async () => {
    renderAt(`/appointment/${encodeURIComponent(visit.id)}/cancel`);
    expect(
      await screen.findByRole('heading', { name: '¿Cancelar esta cita que se repite?' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar esta y las siguientes' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(JSON.parse(calls('POST')[0]![1].body)).toEqual({ scope: 'future' });
  });

  it('cancelling only this one sends scope this', async () => {
    renderAt(`/appointment/${encodeURIComponent(visit.id)}/cancel`);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar solo esta cita' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(JSON.parse(calls('POST')[0]![1].body)).toEqual({ scope: 'this' });
  });

  it('a one-time appointment keeps the simple yes/no cancel', async () => {
    renderAt(`/appointment/${single.id}/cancel`);
    expect(await screen.findByRole('button', { name: 'Sí, cancelar la cita' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancelar solo esta cita' }),
    ).not.toBeInTheDocument();
  });
});
