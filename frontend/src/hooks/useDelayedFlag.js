import { useEffect, useState } from 'react';

/**
 * True only once `active` has been true for longer than `delay`.
 *
 * A skeleton that flashes for 80ms reads as a glitch, not as progress, so a fast answer should show
 * nothing at all. The timer is torn down on every change of `active`: typing in the search box gives
 * a chain of loading → ready → loading, and without the reset a timer accumulated during one request
 * would raise the flag in the middle of an already-loaded list.
 */
export function useDelayedFlag(active, delay = 300) {
  const [raised, setRaised] = useState(false);

  useEffect(() => {
    if (!active) {
      setRaised(false);
      return undefined;
    }
    const timer = setTimeout(() => setRaised(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);

  return raised;
}
