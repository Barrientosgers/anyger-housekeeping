import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import Login from '../pages/Login';

afterEach(() => vi.unstubAllGlobals());

describe('Login', () => {
  it('shows Spanish labels by default', () => {
    render(<Login onLoggedIn={() => undefined} />);
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('shows a plain Spanish message for wrong credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: 'invalid_credentials' } }), { status: 401 }),
        ),
    );
    render(<Login onLoggedIn={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El correo o la contraseña no es correcto.',
    );
  });

  it('calls onLoggedIn after a successful login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ locale: 'es' }), { status: 200 })),
    );
    const onLoggedIn = vi.fn();
    render(<Login onLoggedIn={onLoggedIn} />);
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'right');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
  });
});
