import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTheme } from './theme.js';
import { usePrefsStore } from './stores/prefsStore.js';

function mockPrefersDark(prefersDark) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('dark') ? prefersDark : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// The preference is state now, so it is set through the store's action and applied by the
// subscription initTheme() installs. What is asserted has not changed: the attribute on <html>.
const setTheme = (theme) => {
  usePrefsStore.getState().setTheme(theme);
  applyTheme(usePrefsStore.getState().theme);
};

describe('theme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('applies explicit light preference', () => {
    mockPrefersDark(true);
    setTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies explicit dark preference', () => {
    mockPrefersDark(false);
    setTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolves "system" to the OS preference', () => {
    mockPrefersDark(true);
    setTheme('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    mockPrefersDark(false);
    applyTheme(usePrefsStore.getState().theme);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('ignores a preference it does not know', () => {
    mockPrefersDark(false);
    setTheme('dark');
    setTheme('neon');
    expect(usePrefsStore.getState().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
