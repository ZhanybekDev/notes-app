import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isAvailable, read, remove, resetAvailability, write } from './safeStorage.js';

describe('safeStorage', () => {
  beforeEach(() => {
    resetAvailability();
    vi.restoreAllMocks();
  });

  it('reads and writes through localStorage when it works', () => {
    write('notes_lang', 'ru');
    expect(read('notes_lang')).toBe('ru');
    remove('notes_lang');
    expect(read('notes_lang')).toBeNull();
    expect(isAvailable()).toBe(true);
  });

  it('never throws when storage refuses, and reports it once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);

    expect(read('notes_theme')).toBeNull();
    expect(() => write('notes_theme', 'dark')).not.toThrow();
    expect(() => remove('notes_theme')).not.toThrow();

    expect(isAvailable()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
