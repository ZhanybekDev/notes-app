import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import App from './App.jsx';
import { LangProvider } from './i18n.jsx';
import { api } from './api.js';
import { useSessionStore } from './stores/sessionStore.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature';

const SETTINGS = {
  timezone: 'UTC',
  reminder_time: '09:00:00',
  notifications_enabled: false,
  telegram_linked: false,
  telegram_username: null,
  bot_configured: true,
};

function renderApp(path = '/notes') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LangProvider>
        <App />
      </LangProvider>
    </MemoryRouter>,
  );
}

describe('App routing follows the session store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listNotes').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(api, 'tags').mockResolvedValue([]);
    vi.spyOn(api, 'getSettings').mockResolvedValue(SETTINGS);
  });

  it('sends a visitor without a token to the login form', async () => {
    renderApp('/notes');
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });

  it('lets a signed-in visitor reach the notes', async () => {
    useSessionStore.getState().login(JWT);
    renderApp('/notes');
    expect(await screen.findByText('Nothing selected')).toBeInTheDocument();
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });

  it('returns to the login form when the session ends', async () => {
    useSessionStore.getState().login(JWT);
    renderApp('/notes');
    await screen.findByText('Nothing selected');

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });

  it('reacts to a session dropped elsewhere without a reload', async () => {
    useSessionStore.getState().login(JWT);
    renderApp('/notes');
    await screen.findByText('Nothing selected');

    // What another tab signing out looks like from here.
    useSessionStore.getState().logout();
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
  });
});

describe('a 401 ends the session', () => {
  beforeEach(() => {
    // Without this the api.tags stub from the block above is still in place and never reaches fetch.
    vi.restoreAllMocks();
  });

  it('logs out instead of leaving a dead token in place', async () => {
    useSessionStore.getState().login(JWT);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({}),
    });

    await expect(api.tags()).rejects.toThrow('Unauthorized');
    await waitFor(() => expect(useSessionStore.getState().token).toBeNull());
  });
});
