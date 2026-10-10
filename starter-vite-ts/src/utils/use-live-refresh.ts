import { useRef, useEffect } from 'react';

import { CONFIG } from 'src/global-config';

import { CLOUD_BACK_EVENT } from './cloud-back';

export type LiveTopic = 'delivery' | 'print' | 'orders';

/** Several rows usually change together (an order, its delivery, its courier); re-read once. */
const DEBOUNCE_MS = 300;
/** A safety net in case the stream is silently cut somewhere between here and the server. */
const FALLBACK_MS = 60_000;
/** A stream the browser gave up on is opened again after this long, doubling up to the cap. */
const REOPEN_MIN_MS = 1_000;
const REOPEN_MAX_MS = 15_000;

/**
 * Calls `refresh` whenever the server says one of `topics` changed.
 *
 * The server pushes a bare "this board changed" over Server-Sent Events
 * (`/api/v1/live/stream`); the page then re-reads through its usual endpoints. The browser
 * reconnects a stream that was cut by itself, and the page re-reads on every reconnect because
 * changes made while it was down were not heard. A slow timer covers a stream that stays
 * open but stops delivering.
 *
 * A browser does not retry a stream whose reconnect was answered with an error status: it
 * closes it for good. That is what the cloud's gateway (502) or a branch agent whose cloud is
 * away (502, agent-protocol.md §19.10) answers while the cloud is down, so a stream that finds
 * itself closed is opened again here, with a growing wait, and at once when the cloud is
 * reachable again (`gnext:cloud-back`).
 *
 * `refresh` should update the page in place, without a loading state: it runs whenever
 * anyone at the branch touches the board.
 */
export function useLiveRefresh(topics: LiveTopic[], refresh: () => void, branchId?: string | null) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const topicKey = [...topics].sort().join(',');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refreshRef.current(), DEBOUNCE_MS);
    };

    const params = new URLSearchParams({ topics: topicKey });
    if (branchId) params.set('branchId', branchId);
    const url = `${CONFIG.serverUrl || ''}/api/v1/live/stream?${params}`;

    let source: EventSource | undefined;
    let reopenTimer: ReturnType<typeof setTimeout> | undefined;
    let reopenWait = REOPEN_MIN_MS;
    let stopped = false;
    let connectedBefore = false;

    const open = () => {
      clearTimeout(reopenTimer);
      source?.close();
      const next = new EventSource(url, { withCredentials: true });
      source = next;
      next.addEventListener('ready', () => {
        reopenWait = REOPEN_MIN_MS;
        if (connectedBefore) schedule();
        connectedBefore = true;
      });
      next.addEventListener('change', schedule);
      next.addEventListener('error', () => {
        // CONNECTING: the browser is retrying by itself. CLOSED: it gave up.
        if (stopped || next.readyState !== EventSource.CLOSED) return;
        // Changes may have been missed while it was shut: the next "ready" re-reads.
        connectedBefore = true;
        clearTimeout(reopenTimer);
        reopenTimer = setTimeout(open, reopenWait);
        reopenWait = Math.min(reopenWait * 2, REOPEN_MAX_MS);
      });
    };
    open();

    // The cloud is reachable again: open the stream if it was given up on, and read now.
    const onCloudBack = () => {
      if (source?.readyState === EventSource.CLOSED) {
        reopenWait = REOPEN_MIN_MS;
        open();
      }
      schedule();
    };
    window.addEventListener(CLOUD_BACK_EVENT, onCloudBack);

    const fallback = setInterval(() => refreshRef.current(), FALLBACK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      source?.close();
      clearTimeout(reopenTimer);
      window.removeEventListener(CLOUD_BACK_EVENT, onCloudBack);
      clearTimeout(timer);
      clearInterval(fallback);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [topicKey, branchId]);
}
