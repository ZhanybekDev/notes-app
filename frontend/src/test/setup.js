import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetStores } from '../stores/index.js';

afterEach(() => {
  cleanup();
  // Stores first: resetting a persisted store writes to localStorage, so clearing before the reset
  // would leave those entries behind for the next test.
  resetStores();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('lang');
});
