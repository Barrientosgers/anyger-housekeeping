export interface Appointment {
  id: string;
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

type Saved = { appointment: Appointment; overlaps: number };

export const api = {
  me: () => request<{ locale: string }>('GET', '/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ locale: string }>('POST', '/api/auth/login', { email, password }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  list: (from: string, to: string) =>
    request<{ appointments: Appointment[] }>('GET', `/api/appointments?from=${from}&to=${to}`),
  get: (id: string) => request<{ appointment: Appointment }>('GET', `/api/appointments/${id}`),
  create: (input: AppointmentInput) => request<Saved>('POST', '/api/appointments', input),
  update: (id: string, input: AppointmentInput) =>
    request<Saved>('PUT', `/api/appointments/${id}`, input),
  cancel: (id: string) =>
    request<{ appointment: Appointment }>('POST', `/api/appointments/${id}/cancel`),
};
