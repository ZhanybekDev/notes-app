import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTheme, initTheme } from './theme.js';
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

/** Same as above, but hands back a way to flip the OS preference and fire the listener. */
function controllablePrefersDark(initial) {
  let prefersDark = initial;
  const listeners = [];
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    get matches() {
      return query.includes('dark') ? prefersDark : false;
    },
    media: query,
    addEventListener: (_event, callback) => listeners.push(callback),
    removeEventListener: vi.fn(),
    addListener: (callback) => listeners.push(callback),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  return (next) => {
    prefersDark = next;
    listeners.forEach((callback) => callback({ matches: next }));
  };
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

describe('initTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('applies the stored preference before anything changes', () => {
    mockPrefersDark(false);
    usePrefsStore.setState({ theme: 'dark' });
    document.documentElement.removeAttribute('data-theme');

    initTheme();

    // The whole point of the first call: subscribe() fires only on a change, so without it a
    // dark-theme user gets a light first frame.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('follows a later change through its subscription', () => {
    mockPrefersDark(false);
    initTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    usePrefsStore.getState().setTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('repaints when the OS flips and the preference is "system"', () => {
    const setPrefersDark = controllablePrefersDark(false);
    initTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    setPrefersDark(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores the OS while an explicit preference is in force', () => {
    const setPrefersDark = controllablePrefersDark(false);
    usePrefsStore.setState({ theme: 'light' });
    initTheme();

    setPrefersDark(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
