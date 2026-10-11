import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import '../i18n';
import { setLanguage } from '../i18n';
import AppointmentForm from '../pages/AppointmentForm';
import CalendarPage from '../pages/CalendarPage';
import RequestDetail from '../pages/RequestDetail';
import RequestsPage from '../pages/RequestsPage';

const REQ_ID = '44444444-4444-4444-8444-444444444444';
const request = {
  id: REQ_ID,
  clientName: 'Laura Gómez',
  clientPhone: '(555) 010-0199',
  address: '77 Sample Rd',
  unit: 'Apt 4',
  city: 'Springfield',
  zip: '90210',
  contactMethod: 'email',
  contactEmail: 'laura@example.com',
  cleaningType: 'office',
  moveType: 'none',
  preferredDate: '2026-10-20',
  preferredTime: '09:30',
  repeat: 'weekly',
  notes: '<b>Dos gatos</b>',
  lang: 'en',
  status: 'pending',
  receivedDate: '2026-10-04',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (method: string, urlPart: string) =>
  fetchMock.mock.calls.filter(([u, i]) => i?.method === method && String(u).includes(urlPart));

const browserLanguage = (lang: string) =>
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(lang);

beforeEach(() => {
  localStorage.clear();
  browserLanguage('es-US'); // jsdom reports en-US; most test cases are about the Spanish default
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/public/requests') return json({ ok: true }, 201);
    if (url === '/api/requests/count') return json({ pending: 2 });
    if (url === '/api/requests') return json({ requests: [request] });
    if (url === `/api/requests/${REQ_ID}` && init?.method === 'GET') return json({ request });
    if (url === `/api/requests/${REQ_ID}/accept`)
      return json({ appointment: { date: '2026-10-20' }, overlaps: 0 });
    if (url === `/api/requests/${REQ_ID}/decline`) return new Response(null, { status: 204 });
    if (url.startsWith('/api/appointments?')) return json({ appointments: [] });
    if (url === '/api/auth/me') return json({ error: { code: 'unauthenticated' } }, 401);
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await setLanguage('es');
  localStorage.clear();
});

const fillForm = async () => {
  await userEvent.type(screen.getByLabelText('Su nombre'), 'Laura Gómez');
  await userEvent.type(screen.getByLabelText('Su teléfono (10 dígitos)'), '555 010 0199');
  await userEvent.type(screen.getByLabelText('Ciudad'), 'Springfield');
  await userEvent.type(screen.getByLabelText('Código postal (ZIP)'), '90210');
  await userEvent.type(screen.getByLabelText('Fecha que prefiere'), '2026-10-20');
};

describe('public booking page', () => {
  it('is reachable without logging in and never asks who you are', async () => {
    render(
      <MemoryRouter initialEntries={['/book']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Pedir una limpieza' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/auth'))).toBe(false);
  });

  it('every other page still requires login', async () => {
    render(
      <MemoryRouter initialEntries={['/requests']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.queryByText('Solicitudes')).not.toBeInTheDocument();
  });

  const renderBook = () =>
    render(
      <MemoryRouter initialEntries={['/book']}>
        <App />
      </MemoryRouter>,
    );

  it('sends the request with the language in use and shows a thank-you', async () => {
    renderBook();
    await fillForm();
    await userEvent.selectOptions(screen.getByLabelText('¿Con qué frecuencia?'), 'weekly');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    expect(await screen.findByRole('heading', { name: '¡Gracias!' })).toBeInTheDocument();
    const [, init] = calls('POST', '/api/public/requests')[0]!;
    expect(JSON.parse(init.body)).toMatchObject({
      clientName: 'Laura Gómez',
      preferredDate: '2026-10-20',
      repeat: 'weekly',
      moveType: 'none',
      contactMethod: 'call',
      cleaningType: 'house',
      city: 'Springfield',
      zip: '90210',
      address: '',
      lang: 'es',
      website: '',
    });
  });

  it('asks for an email only when email is the preferred way to be contacted', async () => {
    renderBook();
    expect(screen.queryByLabelText('Su correo electrónico')).not.toBeInTheDocument();
    await fillForm();
    await userEvent.selectOptions(
      screen.getByLabelText('¿Cómo prefiere que le contactemos?'),
      'email',
    );
    await userEvent.type(screen.getByLabelText('Su correo electrónico'), 'laura@example.com');
    await userEvent.selectOptions(screen.getByLabelText('¿Qué quiere limpiar?'), 'office');
    await userEvent.selectOptions(screen.getByLabelText('¿Con qué frecuencia?'), 'move_out');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    expect(await screen.findByRole('heading', { name: '¡Gracias!' })).toBeInTheDocument();
    expect(JSON.parse(calls('POST', '/api/public/requests')[0]![1].body)).toMatchObject({
      contactMethod: 'email',
      contactEmail: 'laura@example.com',
      cleaningType: 'office',
      repeat: 'none',
      moveType: 'move_out',
    });
  });

  it('does not send an email address that was typed and then not chosen', async () => {
    renderBook();
    await fillForm();
    const how = screen.getByLabelText('¿Cómo prefiere que le contactemos?');
    await userEvent.selectOptions(how, 'email');
    await userEvent.type(screen.getByLabelText('Su correo electrónico'), 'laura@example.com');
    await userEvent.selectOptions(how, 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    await screen.findByRole('heading', { name: '¡Gracias!' });
    const body = JSON.parse(calls('POST', '/api/public/requests')[0]![1].body);
    expect(body).toMatchObject({ contactMethod: 'text', contactEmail: '' });
  });

  it('offers move-in and move-out as ways to book, in plain words', async () => {
    renderBook();
    const options = within(screen.getByLabelText('¿Con qué frecuencia?'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual([
      'Una sola vez',
      'Cada semana',
      'Cada 2 semanas',
      'Cada mes',
      'Limpieza de mudanza (entrada)',
      'Limpieza de mudanza (salida)',
    ]);
  });

  it('catches a bad phone number or ZIP before sending anything', async () => {
    renderBook();
    await fillForm();
    await userEvent.clear(screen.getByLabelText('Su teléfono (10 dígitos)'));
    await userEvent.type(screen.getByLabelText('Su teléfono (10 dígitos)'), '555-0199');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('teléfono de 10 dígitos');
    await userEvent.clear(screen.getByLabelText('Su teléfono (10 dígitos)'));
    await userEvent.type(screen.getByLabelText('Su teléfono (10 dígitos)'), '(555) 010-0199');
    await userEvent.clear(screen.getByLabelText('Código postal (ZIP)'));
    await userEvent.type(screen.getByLabelText('Código postal (ZIP)'), '9021');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('código postal de 5 dígitos');
    expect(calls('POST', '/api/public/requests')).toHaveLength(0);
  });

  it('a client who switches to English gets English and the request is marked English', async () => {
    renderBook();
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Request a cleaning' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your name'), 'Laura');
    await userEvent.type(screen.getByLabelText('Your phone number (10 digits)'), '5550100199');
    await userEvent.type(screen.getByLabelText('City'), 'Springfield');
    await userEvent.type(screen.getByLabelText('ZIP code'), '90210');
    await userEvent.type(screen.getByLabelText('Preferred date'), '2026-10-20');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('heading', { name: 'Thank you!' })).toBeInTheDocument();
    expect(JSON.parse(calls('POST', '/api/public/requests')[0]![1].body).lang).toBe('en');
  });

  it('a visitor whose browser is in English sees English, without saving a preference', async () => {
    browserLanguage('en-US');
    renderBook();
    expect(await screen.findByRole('heading', { name: 'Request a cleaning' })).toBeInTheDocument();
    expect(localStorage.getItem('anyger.lang')).toBeNull();
  });

  it('a saved language choice wins over the browser language', async () => {
    browserLanguage('en-US');
    localStorage.setItem('anyger.lang', 'es');
    renderBook();
    expect(await screen.findByRole('heading', { name: 'Pedir una limpieza' })).toBeInTheDocument();
  });

  it('hides the trap field from people and assistive tech, and sends it empty', async () => {
    renderBook();
    const trap = document.querySelector('input[name="website"]') as HTMLInputElement;
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap.tabIndex).toBe(-1);
    expect(trap.value).toBe('');
  });

  it('shows plain messages for rate limiting and for a full queue', async () => {
    fetchMock.mockImplementationOnce(async () => json({ error: { code: 'rate_limited' } }, 429));
    renderBook();
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos');
    fetchMock.mockImplementationOnce(async () => json({ error: { code: 'busy' } }, 503));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Hay muchas solicitudes'),
    );
  });
});

describe('owners: requests', () => {
  const renderOwner = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<CalendarPage onLogout={() => undefined} />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/requests/:id" element={<RequestDetail />} />
          <Route path="/requests/:id/accept" element={<AppointmentForm mode="accept" />} />
        </Routes>
      </MemoryRouter>,
    );

  it('the calendar shows how many new requests are waiting', async () => {
    renderOwner('/');
    expect(
      await screen.findByRole('button', { name: 'Tiene 2 solicitudes nuevas' }),
    ).toBeInTheDocument();
  });

  it('no banner when nothing is waiting', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/requests/count' ? json({ pending: 0 }) : json({ appointments: [] }),
    );
    renderOwner('/');
    await screen.findByRole('heading', { name: /de 20\d\d$/ });
    expect(screen.queryByText(/solicitud/i, { selector: 'button.alert' })).not.toBeInTheDocument();
  });

  it('lists requests with name, preferred time and address', async () => {
    renderOwner('/requests');
    const link = await screen.findByRole('link', { name: /Laura Gómez/ });
    expect(link).toHaveAttribute('href', `/requests/${REQ_ID}`);
    expect(link).toHaveTextContent('Oficina');
    expect(link).toHaveTextContent('77 Sample Rd, Apt 4, Springfield 90210');
    expect(link).toHaveTextContent(/9:30\sa\.\s?m\./);
  });

  it('shows an empty message when there are none', async () => {
    fetchMock.mockImplementation(async () => json({ requests: [] }));
    renderOwner('/requests');
    expect(await screen.findByText('No hay solicitudes pendientes.')).toBeInTheDocument();
  });

  it('shows the details, renders notes as text, and offers Aceptar and Rechazar', async () => {
    renderOwner(`/requests/${REQ_ID}`);
    expect(await screen.findByRole('heading', { name: 'Laura Gómez' })).toBeInTheDocument();
    expect(screen.getByText('<b>Dos gatos</b>')).toBeInTheDocument();
    expect(document.querySelector('dd b')).toBeNull();
    expect(screen.getByRole('link', { name: 'Llamar' })).toHaveAttribute('href', 'tel:5550100199');
    expect(screen.getByText(/Cada semana/)).toBeInTheDocument();
    expect(screen.getByText('Oficina')).toBeInTheDocument();
    expect(screen.getByText('77 Sample Rd, Apt 4, Springfield 90210')).toBeInTheDocument();
    expect(screen.getByText('Correo electrónico')).toBeInTheDocument(); // how they asked to be reached
    expect(screen.getByRole('link', { name: 'laura@example.com' })).toHaveAttribute(
      'href',
      'mailto:laura@example.com',
    );
    expect(screen.getByRole('link', { name: 'Aceptar' })).toHaveAttribute(
      'href',
      `/requests/${REQ_ID}/accept`,
    );
  });

  it('asks before declining, and declining sends the request', async () => {
    renderOwner(`/requests/${REQ_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Rechazar' }));
    expect(screen.getByRole('heading', { name: '¿Rechazar esta solicitud?' })).toBeInTheDocument();
    expect(calls('POST', '/decline')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'No, volver' }));
    expect(await screen.findByRole('heading', { name: 'Laura Gómez' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, rechazar' }));
    await waitFor(() => expect(calls('POST', '/decline')).toHaveLength(1));
  });

  it('accepting opens the form prefilled and creates the appointment from the confirmed details', async () => {
    renderOwner(`/requests/${REQ_ID}/accept`);
    expect(await screen.findByRole('heading', { name: 'Aceptar solicitud' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre del cliente')).toHaveValue('Laura Gómez');
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-10-20');
    expect(screen.getByLabelText('Hora')).toHaveValue('09:30');
    expect(screen.getByLabelText('Dirección')).toHaveValue(
      '77 Sample Rd, Apt 4, Springfield 90210',
    );
    expect(screen.getByLabelText('Notas (opcional)')).toHaveValue('Oficina. <b>Dos gatos</b>');
    expect(screen.getByLabelText('¿Se repite?')).toHaveValue('weekly');
    await userEvent.clear(screen.getByLabelText('Hora'));
    await userEvent.type(screen.getByLabelText('Hora'), '11:00');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(calls('POST', '/accept')).toHaveLength(1));
    expect(JSON.parse(calls('POST', '/accept')[0]![1].body)).toMatchObject({
      clientName: 'Laura Gómez',
      time: '11:00',
      repeat: 'weekly',
    });
    expect(await screen.findByText('Solicitud aceptada. La cita se guardó.')).toBeInTheDocument();
  });
});
