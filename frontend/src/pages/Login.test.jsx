import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import Login from './Login.jsx';
import { api } from '../api.js';
import { useSessionStore } from '../stores/sessionStore.js';

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

async function fillIn() {
  await userEvent.type(screen.getByLabelText('Username'), 'alice');
  await userEvent.type(screen.getByLabelText('Password'), 'secret');
}

describe('Login', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('signs in and keeps the token', async () => {
    vi.spyOn(api, 'login').mockResolvedValue({ access_token: 'jwt' });
    renderLogin();
    await fillIn();

    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(useSessionStore.getState().token).toBe('jwt'));
  });

  it('holds the button while the request is out and asks the server once', async () => {
    let finish;
    const login = vi
      .spyOn(api, 'login')
      .mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderLogin();
    await fillIn();

    const button = screen.getByRole('button', { name: 'Log in' });
    await userEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    // Impatience used to mean two accounts worth of requests.
    await userEvent.click(button);
    expect(login).toHaveBeenCalledTimes(1);

    finish({ access_token: 'jwt' });
  });

  it('gives the button back when the credentials were wrong', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new Error('Incorrect username or password'));
    renderLogin();
    await fillIn();

    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Incorrect username or password')).toBeInTheDocument();
    // The failure stays by the field, and the form is usable again for the second attempt.
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
  });
});
