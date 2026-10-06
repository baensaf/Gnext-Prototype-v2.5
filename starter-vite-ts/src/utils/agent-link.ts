import type { BarPhase } from './cloud-link';

import { useState, useEffect, useSyncExternalStore } from 'react';

import { barPhase, unreachableSince, agentShowsRecovery } from './cloud-link';
import {
  reportCloudAnswered,
  getCloudFailingSince,
  subscribeCloudReachability,
} from './cloud-reachability';

// ----------------------------------------------------------------------

/**
 * How the app, served by a branch agent, knows the cloud is out of reach (agent-protocol.md
 * §19.8, §19.10): the agent's own word, `cloud.reachable` of GET /agent/api/status polled every
 * 3 s, and the app's requests that got no answer (cloud-reachability.ts), combined by the rules of
 * cloud-link.ts. The agent probes the cloud itself, once for the whole branch, so the page does
 * not. Only the Reconnecting bar uses this, and only in agent mode.
 */

const STATUS_URL = '/agent/api/status';
/** The agent's status is polled this often. */
export const POLL_MS = 3_000;
/** A status poll that has not answered after this long counts as the agent not answering. */
const STATUS_TIMEOUT_MS = 2_500;

let agentUnreachableSince: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setAgentUnreachable(unreachable: boolean) {
  if (unreachable && agentUnreachableSince === null) {
    agentUnreachableSince = Date.now();
    emit();
  } else if (!unreachable && agentUnreachableSince !== null) {
    agentUnreachableSince = null;
    emit();
  }
}

/**
 * One look at the agent's status: the cloud is unreachable when the agent says so, or when the
 * agent does not answer. An answer that does not say (an older agent) is not taken for either.
 */
async function pollStatus(): Promise<void> {
  const polledAt = Date.now();
  try {
    const res = await fetch(STATUS_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (!res.ok) {
      setAgentUnreachable(true);
      return;
    }
    const body: unknown = await res.json();
    const reachable = (body as { cloud?: { reachable?: unknown } } | null)?.cloud?.reachable;
    if (typeof reachable !== 'boolean') return;
    setAgentUnreachable(!reachable);
    // The agent has seen the cloud answer since our requests failed: they are not failing now.
    if (agentShowsRecovery(reachable, getCloudFailingSince(), polledAt)) reportCloudAnswered();
  } catch {
    setAgentUnreachable(true);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const stopReachability = subscribeCloudReachability(listener);
  return () => {
    listeners.delete(listener);
    stopReachability();
  };
}

const snapshot = () => `${agentUnreachableSince ?? ''}|${getCloudFailingSince() ?? ''}`;

function currentSince(): number | null {
  return unreachableSince({
    requestsFailingSince: getCloudFailingSince(),
    agentUnreachableSince,
  });
}

/**
 * The Reconnecting bar's phase: hidden, reconnecting (out of reach for more than 2 s), or
 * offline (for more than 2 minutes). Polls the agent's status while mounted.
 */
export function useCloudBarPhase(): BarPhase {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const since = currentSince();
  const [now, setNow] = useState(() => Date.now());

  // The agent's status every 3 s, one look at a time. A window nobody is looking at does not ask.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (document.visibilityState !== 'hidden') await pollStatus();
      if (!stopped) timer = setTimeout(loop, POLL_MS);
    };
    loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const outOfReach = since !== null;

  // While it is out of reach: the clock for the 2 s and the 2 minutes.
  useEffect(() => {
    if (!outOfReach) return undefined;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, [outOfReach]);

  return barPhase(since, now);
}
