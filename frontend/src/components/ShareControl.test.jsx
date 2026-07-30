import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ShareControl from './ShareControl.jsx';
import Toaster from './Toaster.jsx';
import { useUiStore } from '../stores/uiStore.js';

function renderControl(props = {}) {
  return render(
    <MemoryRouter>
      <ShareControl onShare={() => {}} onRevoke={() => {}} {...props} />
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

    expect(screen.getByText('Link is live')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('follows the token it is given on every render', () => {
    const { rerender } = renderControl({ token: 'abc' });
    expect(screen.getByText('Link is live')).toBeInTheDocument();

    // Switching notes in the editor rerenders this control with the next note's token. Seeding the
    // token into state instead would have kept the previous note's link on screen — and copied it.
    rerender(
      <MemoryRouter>
        <ShareControl token={null} onShare={() => {}} onRevoke={() => {}} />
        <Toaster />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.queryByText('Link is live')).not.toBeInTheDocument();
  });

  it('asks the page to share, and shows the page busy tag while it does', async () => {
    const onShare = vi.fn();
    const { rerender } = renderControl({ onShare });

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(onShare).toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <ShareControl busy="share" onShare={onShare} onRevoke={() => {}} />
        <Toaster />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
  });

  it('asks the page to revoke', async () => {
    const onRevoke = vi.fn();
    renderControl({ token: 'abc', onRevoke });

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(onRevoke).toHaveBeenCalled();
  });

  it('copies the full address, not the bare token', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderControl({ token: 'abc' });

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/abc`);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('puts the link on screen for longer when the clipboard is refused', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    renderControl({ token: 'abc' });

    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    // The fallback exists for a reader who now has to select the link by hand, so it goes to the
    // assertive region, which stays twice as long as a notice.
    expect(await screen.findByText(`${window.location.origin}/s/abc`)).toBeInTheDocument();
    expect(useUiStore.getState().toasts[0].kind).toBe('error');
  });
});
