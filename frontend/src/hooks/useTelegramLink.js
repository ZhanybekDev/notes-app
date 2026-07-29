import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 120000;

/**
 * Drive the Telegram linking handshake without asking the user to reload.
 *
 * Binding happens in Telegram, out of the app's sight, so the page asks its own settings endpoint
 * until the answer changes. The loop stops on success, on timeout, on a failed request and on
 * unmount — polling through an error would hide a broken session behind a spinner that never
 * resolves.
 */
export function useTelegramLink({ onLinked }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);
  const timeoutRef = useRef(null);
  const onLinkedRef = useRef(onLinked);

  useEffect(() => {
    onLinkedRef.current = onLinked;
  });

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const check = useCallback(async () => {
    try {
      const settings = await api.getSettings();
      if (!settings.telegram_linked) return false;
      stop();
      setStatus('linked');
      onLinkedRef.current?.(settings);
      return true;
    } catch (err) {
      stop();
      setError(err.message);
      setStatus('error');
      return false;
    }
  }, [stop]);

  const connect = useCallback(async () => {
    setError(null);
    setStatus('requesting');
    let url;
    try {
      ({ deep_link_url: url } = await api.linkTelegram());
    } catch (err) {
      setError(err.message);
      setStatus('error');
      return;
    }
    window.open(url, '_blank', 'noopener');
    setStatus('waiting');
    intervalRef.current = setInterval(check, POLL_INTERVAL_MS);
    timeoutRef.current = setTimeout(() => {
      stop();
      setStatus('timeout');
    }, POLL_TIMEOUT_MS);
  }, [check, stop]);

  const recheck = useCallback(async () => {
    setError(null);
    setStatus('waiting');
    const linked = await check();
    // check() has already moved to 'error' if the request failed; leave that alone.
    if (!linked) setStatus((prev) => (prev === 'error' ? prev : 'timeout'));
  }, [check]);

  return { status, error, connect, recheck };
}
