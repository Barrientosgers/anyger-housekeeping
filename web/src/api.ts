export type Freq = 'weekly' | 'biweekly' | 'monthly';
export type Scope = 'this' | 'future';

export interface Appointment {
  id: string;
  seriesId: string | null;
  originalDate: string | null;
  recurrence: { freq: Freq; untilDate: string | null; ordinal: number | null } | null;
  clientName: string;
  clientPhone: string | null;
  address: string;
  startsAt: string;
  date: string;
  time: string;
  durationMin: number;
  notes: string | null;
  status: 'scheduled' | 'cancelled';
}

export interface AppointmentInput {
  clientName: string;
  clientPhone: string;
  address: string;
  date: string;
  time: string;
  durationMin: number;
  notes: string;
  repeat: 'none' | Freq;
  repeatUntil: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'anyger',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error?.code ?? 'generic';
    if (res.status === 401 && path !== '/api/auth/login') {
      window.dispatchEvent(new Event('anyger:unauthenticated'));
    }
    throw new ApiError(res.status, code);
  }
  return data as T;
}

/** The form keeps repeatUntil as '' when blank; the API wants null. */
const withRepeat = (input: AppointmentInput, scope?: Scope) => ({
  ...input,
  repeatUntil: input.repeat === 'none' || !input.repeatUntil ? null : input.repeatUntil,
  ...(scope ? { scope } : {}),
});

type Saved = { appointment: Appointment; overlaps: number };

export const api = {
  me: () => request<{ locale: string }>('GET', '/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ locale: string }>('POST', '/api/auth/login', { email, password }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  list: (from: string, to: string) =>
    request<{ appointments: Appointment[] }>('GET', `/api/appointments?from=${from}&to=${to}`),
  get: (id: string) =>
    request<{ appointment: Appointment }>('GET', `/api/appointments/${encodeURIComponent(id)}`),
  create: (input: AppointmentInput) =>
    request<Saved>('POST', '/api/appointments', withRepeat(input)),
  update: (id: string, input: AppointmentInput, scope?: Scope) =>
    request<Saved>('PUT', `/api/appointments/${encodeURIComponent(id)}`, withRepeat(input, scope)),
  cancel: (id: string, scope?: Scope) =>
    request<{ appointment: Appointment }>(
      'POST',
      `/api/appointments/${encodeURIComponent(id)}/cancel`,
      scope ? { scope } : undefined,
    ),
};
