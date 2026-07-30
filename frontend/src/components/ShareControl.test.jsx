import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ShareControl from './ShareControl.jsx';
import Toaster from './Toaster.jsx';
import { api } from '../api.js';
import { useUiStore } from '../stores/uiStore.js';

function renderControl(props = {}) {
  return render(
    <MemoryRouter>
      <ShareControl noteId={7} {...props} />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('ShareControl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('offers to share a note that has no link', () => {
    renderControl();

    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('shows the note is live once the link exists', () => {
    renderControl({ token: 'abc' });

    // The owner arrives at an already-shared note through the note itself, not through a request.
    expect(screen.getByText('Link is live')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('publishes a link and switches to the live state', async () => {
    vi.spyOn(api, 'shareNote').mockResolvedValue({ share_token: 'abc', shared_at: 'now' });
    renderControl();

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));

    expect(await screen.findByText('Link is live')).toBeInTheDocument();
  });

  it('asks once however many times it is pressed', async () => {
    let finish;
    const share = vi
      .spyOn(api, 'shareNote')
      .mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderControl();

    const button = screen.getByRole('button', { name: 'Share' });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    await userEvent.click(button);

    // Two tokens for one note would break the link that was already copied.
    expect(share).toHaveBeenCalledTimes(1);
    finish({ share_token: 'abc', shared_at: 'now' });
    await screen.findByText('Link is live');
  });

  it('revokes back to the offer, and says so', async () => {
    vi.spyOn(api, 'unshareNote').mockResolvedValue(null);
    renderControl({ token: 'abc' });

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(await screen.findByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByTestId('toast-region-status')).toHaveTextContent('Link revoked');
  });

  it('reports a failed share and keeps the offer', async () => {
    vi.spyOn(api, 'shareNote').mockRejectedValue(new Error('server error'));
    renderControl();

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(useUiStore.getState().toasts).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();
  });

  it('copies the full address, not the bare token', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderControl({ token: 'abc' });

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/abc`);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('falls back to showing the link when the clipboard is refused', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    renderControl({ token: 'abc' });

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    // An insecure origin or a declined permission is a nuisance, not a failure: the link is still
    // readable, so it goes on screen rather than into an alert.
    expect(await screen.findByText(`${window.location.origin}/s/abc`)).toBeInTheDocument();
  });
});
