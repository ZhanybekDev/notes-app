import { useState } from 'react';

import { reportFailure } from '../stores/uiStore.js';

/**
 * Turns a file-returning request into a saved file.
 *
 * The anchor-and-object-URL dance is the only way a browser lets a fetched blob reach the disk
 * with a name of our choosing. The URL is revoked immediately after: it pins the blob in memory
 * for as long as it lives, and an export of a whole account is not small.
 */
export function useDownload() {
  const [busy, setBusy] = useState(false);

  const download = async (request) => {
    if (busy) return;
    setBusy(true);
    try {
      const { blob, filename } = await request();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      reportFailure(err);
    } finally {
      setBusy(false);
    }
  };

  return { busy, download };
}
