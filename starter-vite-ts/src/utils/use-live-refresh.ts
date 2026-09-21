import { useRef, useEffect } from 'react';

import { CONFIG } from 'src/global-config';

export type LiveTopic = 'delivery' | 'kds' | 'print';

/** Several rows usually change together (an order, its delivery, its courier); re-read once. */
const DEBOUNCE_MS = 300;
/** A safety net in case the stream is silently cut somewhere between here and the server. */
const FALLBACK_MS = 60_000;

/**
 * Calls `refresh` whenever the server says one of `topics` changed.
 *
 * The server pushes a bare "this board changed" over Server-Sent Events
 * (`/api/v1/live/stream`); the page then re-reads through its usual endpoints. The browser
 * reconnects a dropped stream by itself, and the page re-reads on every reconnect because
 * changes made while it was down were not heard. A slow timer covers a stream that stays
 * open but stops delivering.
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
    const source = new EventSource(`${CONFIG.serverUrl || ''}/api/v1/live/stream?${params}`, {
      withCredentials: true,
    });

    let connectedBefore = false;
    source.addEventListener('ready', () => {
      if (connectedBefore) schedule();
      connectedBefore = true;
    });
    source.addEventListener('change', schedule);

    const fallback = setInterval(() => refreshRef.current(), FALLBACK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      source.close();
      clearTimeout(timer);
      clearInterval(fallback);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [topicKey, branchId]);
}
