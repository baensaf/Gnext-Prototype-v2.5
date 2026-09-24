import { useState, useEffect, useSyncExternalStore } from 'react';

// ----------------------------------------------------------------------

/**
 * Whether the cloud answers, as the app's own requests find it (agent-protocol.md §13.14). The
 * HTTP client reports each request: an answer from the server clears the failure; no answer at
 * all, or the gateway saying the server is not there, starts it. Nothing here probes anything.
 */

let failingSince: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function reportCloudAnswered() {
  if (failingSince !== null) {
    failingSince = null;
    emit();
  }
}

export function reportCloudUnreachable() {
  if (failingSince === null) {
    failingSince = Date.now();
    emit();
  }
}

/** A gateway answering for a server that is not there. */
export function isGatewayFailure(status?: number) {
  return status === 502 || status === 503 || status === 504;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => failingSince;

/**
 * True once the cloud has not answered for `afterMs`: the requests that failed started the
 * clock, and one that got an answer stops it. The browser going offline counts as a failure.
 */
export function useCloudUnreachable(afterMs = 30_000): boolean {
  const since = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const offline = () => reportCloudUnreachable();
    window.addEventListener('offline', offline);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) reportCloudUnreachable();
    return () => window.removeEventListener('offline', offline);
  }, []);

  useEffect(() => {
    if (since === null) return undefined;
    const wait = since + afterMs - Date.now();
    if (wait <= 0) {
      setNow(Date.now());
      return undefined;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), wait);
    return () => window.clearTimeout(timer);
  }, [since, afterMs]);

  return since !== null && now - since >= afterMs;
}
