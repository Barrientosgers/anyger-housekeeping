import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslatedNote } from '../components';
import '../i18n';
import { setLanguage } from '../i18n';
import AppointmentDetail from '../pages/AppointmentDetail';
import RequestDetail from '../pages/RequestDetail';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;
let outcome: unknown;
const translateCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/translations');

beforeEach(() => {
  localStorage.clear();
  outcome = { status: 'same_language' };
  fetchMock = vi.fn(async (url: string) =>
    url === '/api/translations' ? json(outcome) : json({}),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await setLanguage('es');
  localStorage.clear();
});

const translated = {
  status: 'translated',
  sourceLang: 'en',
  targetLang: 'es',
  original: 'We have two dogs',
  translation: 'Tenemos dos perros',
  cached: false,
};

describe('TranslatedNote', () => {
  it('shows the original first and the translation beneath it, clearly labelled', async () => {
    outcome = translated;
    render(<TranslatedNote entity="request" id="r1" notes="We have two dogs" />);
    expect(await screen.findByText('Tenemos dos perros')).toBeInTheDocument();
    expect(screen.getByText('We have two dogs')).toBeInTheDocument();
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.getByText('Traducción automática')).toBeInTheDocument();
    const paragraphs = Array.from(document.querySelectorAll('p.notes')).map((p) => p.textContent);
    expect(paragraphs).toEqual(['We have two dogs', 'Tenemos dos perros']); // original first
  });

  it("asks the server for the reader's language, sending an id and never the text", async () => {
    outcome = translated;
    render(<TranslatedNote entity="appointment" id="s:abc:2026-10-13" notes="We have two dogs" />);
    await screen.findByText('Tenemos dos perros');
    const body = JSON.parse(translateCalls()[0]![1].body);
    expect(body).toEqual({ entity: 'appointment', id: 's:abc:2026-10-13', target: 'es' });
  });

  it.each(['same_language', 'disabled', 'empty', 'unknown_language'])(
    'for "%s" it shows only the original and nothing extra',
    async (status) => {
      outcome = { status };
      render(<TranslatedNote entity="request" id="r1" notes="Dos perros, por favor" />);
      await waitFor(() => expect(translateCalls()).toHaveLength(1));
      expect(screen.getByText('Dos perros, por favor')).toBeInTheDocument();
      expect(screen.queryByText('Original')).not.toBeInTheDocument();
      expect(screen.queryByText('Traducción automática')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    },
  );

  it('does not flash "Traduciendo…" for a note that needs no translation', async () => {
    render(<TranslatedNote entity="request" id="r1" notes="Dos perros" />);
    await waitFor(() => expect(translateCalls()).toHaveLength(1));
    expect(screen.queryByText('Traduciendo…')).not.toBeInTheDocument();
  });

  it('shows "Traduciendo…" only if the translation is slow', async () => {
    let release: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (release = r)));
    render(<TranslatedNote entity="request" id="r1" notes="We have two dogs" />);
    expect(screen.queryByText('Traduciendo…')).not.toBeInTheDocument(); // not immediately
    expect(await screen.findByText('Traduciendo…', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText('We have two dogs')).toBeInTheDocument(); // original visible meanwhile
    await act(async () => release(json(translated)));
    expect(await screen.findByText('Tenemos dos perros')).toBeInTheDocument();
    expect(screen.queryByText('Traduciendo…')).not.toBeInTheDocument();
  });

  it('when translation fails the original stays and a small retry appears; retry works', async () => {
    outcome = { status: 'unavailable', reason: 'timeout' };
    render(<TranslatedNote entity="request" id="r1" notes="We have two dogs" />);
    expect(await screen.findByText(/No se pudo traducir ahora/)).toBeInTheDocument();
    expect(screen.getByText('We have two dogs')).toBeInTheDocument(); // original untouched
    outcome = translated;
    await userEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(await screen.findByText('Tenemos dos perros')).toBeInTheDocument();
    expect(translateCalls()).toHaveLength(2);
  });

  it('the daily limit is explained without a pointless retry button', async () => {
    outcome = { status: 'unavailable', reason: 'limit' };
    render(<TranslatedNote entity="request" id="r1" notes="We have two dogs" />);
    expect(await screen.findByText(/límite de traducciones de hoy/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Intentar de nuevo' })).not.toBeInTheDocument();
  });

  it('even if the request itself fails (offline), the note shows and nothing crashes', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    render(<TranslatedNote entity="request" id="r1" notes="We have two dogs" />);
    expect(await screen.findByText(/No se pudo traducir ahora/)).toBeInTheDocument();
    expect(screen.getByText('We have two dogs')).toBeInTheDocument();
  });

  it('re-asks in the new language when the reader switches language', async () => {
    outcome = translated;
    render(<TranslatedNote entity="request" id="r1" notes="We have two dogs" />);
    await screen.findByText('Tenemos dos perros');
    await act(async () => {
      await setLanguage('en');
    });
    await waitFor(() => expect(translateCalls()).toHaveLength(2));
    expect(JSON.parse(translateCalls()[1]![1].body).target).toBe('en');
  });

  it('renders markup in a note and in its translation as plain text', async () => {
    outcome = { ...translated, translation: '<img src=x onerror=alert(1)>' };
    render(<TranslatedNote entity="request" id="r1" notes="<b>hi</b>" />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img, b')).toBeNull();
  });
});

describe('on the detail screens', () => {
  const req = {
    id: '44444444-4444-4444-8444-444444444444',
    clientName: 'Laura Gómez',
    clientPhone: '5550100199',
    address: '77 Sample Rd',
    preferredDate: '2026-10-20',
    preferredTime: '09:00',
    repeat: 'none',
    notes: 'We have two dogs',
    lang: 'en',
    status: 'pending',
    receivedDate: '2026-10-04',
  };

  it("a booking request shows the client's English note with its Spanish translation", async () => {
    outcome = translated;
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/translations'
        ? json(outcome)
        : url.startsWith('/api/requests/')
          ? json({ request: req })
          : json({}),
    );
    render(
      <MemoryRouter initialEntries={[`/requests/${req.id}`]}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Tenemos dos perros')).toBeInTheDocument();
    expect(screen.getByText('We have two dogs')).toBeInTheDocument();
    expect(JSON.parse(translateCalls()[0]![1].body)).toMatchObject({
      entity: 'request',
      id: req.id,
    });
  });

  it('an appointment note does the same, and the page works with translation off', async () => {
    const appt = {
      id: '11111111-1111-4111-8111-111111111111',
      seriesId: null,
      originalDate: null,
      recurrence: null,
      clientName: 'Rosa',
      clientPhone: null,
      address: '1 A St',
      startsAt: '2026-10-13T16:00:00.000Z',
      date: '2026-10-13',
      time: '09:00',
      durationMin: 120,
      notes: 'Key under the mat',
      status: 'scheduled',
    };
    outcome = { status: 'disabled' };
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/translations' ? json(outcome) : json({ appointment: appt }),
    );
    render(
      <MemoryRouter initialEntries={[`/appointment/${appt.id}`]}>
        <Routes>
          <Route path="/appointment/:id" element={<AppointmentDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Key under the mat')).toBeInTheDocument();
    await waitFor(() => expect(translateCalls()).toHaveLength(1));
    expect(screen.getByRole('link', { name: 'Editar cita' })).toBeInTheDocument(); // everything still works
  });
});
