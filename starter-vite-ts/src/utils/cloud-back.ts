import { useRef, useEffect } from 'react';

// ----------------------------------------------------------------------

/**
 * Sent on `window` when the cloud is reachable again after the Reconnecting bar was up
 * (agent-protocol.md §19.10). A screen that holds data from the cloud listens for it and reads
 * that data again, quietly, without losing what the cashier is in the middle of.
 */
export const CLOUD_BACK_EVENT = 'gnext:cloud-back';

export function dispatchCloudBack() {
  window.dispatchEvent(new Event(CLOUD_BACK_EVENT));
}

/** Calls `callback` each time the cloud comes back. The latest callback is always the one called. */
export function useCloudBack(callback: () => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const onBack = () => callbackRef.current();
    window.addEventListener(CLOUD_BACK_EVENT, onBack);
    return () => window.removeEventListener(CLOUD_BACK_EVENT, onBack);
  }, []);
}
