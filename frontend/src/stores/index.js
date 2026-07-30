import { useNotesStore } from './notesStore.js';

// Every store belongs here the moment it is created. A store missing from this list does not fail
// loudly: tests keep passing while its state leaks from one to the next, and the failure surfaces
// later in a test that is correct on its own.
const stores = [useNotesStore];

/** Restore every store to the state its initializer produced. Used by the test setup. */
export function resetStores() {
  for (const store of stores) {
    store.setState(store.getInitialState(), true);
  }
}
