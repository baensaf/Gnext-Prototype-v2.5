import type { BarPhase } from './cloud-link';

import { useState, useEffect, useSyncExternalStore } from 'react';

import { CONFIG } from 'src/global-config';

import { barPhase, unreachableSince } from './cloud-link';
import {
  isGatewayFailure,
  reportCloudAnswered,
  getCloudFailingSince,
  reportCloudUnreachable,
  getCloudLastAnsweredAt,
  subscribeCloudReachability,
} from './cloud-reachability';

// ----------------------------------------------------------------------

/**
 * How the app, served by a branch agent, knows the cloud is out of reach (agent-protocol.md
 * §19.10): the agent's own status, polled every 3 s, the app's requests that got no answer
 * (cloud-reachability.ts), and a small check of its own, combined by the rules of cloud-link.ts.
 * Only the Reconnecting bar uses it, and only in agent mode.
 */

const STATUS_URL = '/agent/api/status';
/** The agent's status is polled, and the cloud checked, this often. */
export const POLL_MS = 3_000;
/** While the cloud is out of reach it is checked again sooner. */
const POLL_DOWN_MS = 2_000;
/** A status poll that has not answered after this long counts as the agent not answering. */
const STATUS_TIMEOUT_MS = 2_500;
/** A check not answered after this long counts as the cloud being out of reach. */
const PROBE_SLOW_MS = 1_000;
/** The agent holds a read for up to 20 s while the cloud is away; this is a little over that. */
const PROBE_TIMEOUT_MS = 35_000;

let agentDownSince: number | null = null;
let probeDownSince: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setAgentDown(down: boolean) {
  if (down && agentDownSince === null) {
    agentDownSince = Date.now();
    emit();
  } else if (!down && agentDownSince !== null) {
    agentDownSince = null;
    emit();
  }
}

/** One look at the agent's status: down when its WebSocket to the cloud is, or it does not answer. */
async function pollStatus(): Promise<void> {
  try {
    const res = await fetch(STATUS_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (!res.ok) {
      setAgentDown(true);
      return;
    }
    const body: unknown = await res.json();
    const connected = (body as { cloud?: { connected?: unknown } } | null)?.cloud?.connected;
    // An answer that does not say is not taken for "down".
    if (typeof connected === 'boolean') setAgentDown(!connected);
  } catch {
    setAgentDown(true);
  }
}

/**
 * The app's own check of the cloud: one request through the agent that asks nothing of anyone, so
 * that whoever answers it, the cloud is there. It is `/api/v1/auth/me` with no session, which the
 * cloud turns down with a 401 before it looks anything up. The agent holds a read while the cloud
 * is away and answers when it is back, so a check not answered within a second says the cloud is
 * out of reach, and the answer, whenever it comes, says it is back, even when the screen makes no
 * request of its own.
 */
async function probeCloud(): Promise<void> {
  const sentAt = Date.now();
  const slow = setTimeout(() => {
    if (probeDownSince === null) {
      probeDownSince = sentAt;
      emit();
    }
  }, PROBE_SLOW_MS);

  let answered = false;
  try {
    const res = await fetch(`${CONFIG.serverUrl || ''}/api/v1/auth/me`, {
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    answered = !isGatewayFailure(res.status);
  } catch {
    answered = false;
  }
  clearTimeout(slow);

  if (answered) {
    reportCloudAnswered();
    if (probeDownSince !== null) {
      probeDownSince = null;
      emit();
    }
  } else {
    reportCloudUnreachable();
    if (probeDownSince === null) {
      probeDownSince = sentAt;
      emit();
    }
  }
}

/** Runs `task` now and again `wait()` ms after each run ends. Returns what stops it. */
function loopEvery(task: () => Promise<void>, wait: () => number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    await task();
    if (!stopped) timer = setTimeout(run, wait());
  };
  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const stopReachability = subscribeCloudReachability(listener);
  return () => {
    listeners.delete(listener);
    stopReachability();
  };
}

const snapshot = () =>
  `${agentDownSince ?? ''}|${probeDownSince ?? ''}|${getCloudFailingSince() ?? ''}`;

function currentSince(): number | null {
  return unreachableSince({
    requestsFailingSince: getCloudFailingSince(),
    probeDownSince,
    agentDownSince,
    lastAnsweredAt: getCloudLastAnsweredAt(),
  });
}

/**
 * The Reconnecting bar's phase: hidden, reconnecting (out of reach for more than 2 s), or
 * offline (for more than 2 minutes). Polls the agent and checks the cloud while mounted.
 */
export function useCloudBarPhase(): BarPhase {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const since = currentSince();
  const [now, setNow] = useState(() => Date.now());

  // The agent's status every 3 s, and the check of the cloud every 3 s (2 s while down), each loop
  // one request at a time: a check the agent holds while the cloud is away must not hold the
  // status back. A window nobody is looking at does not ask.
  useEffect(() => {
    const stops = [
      loopEvery(
        async () => {
          if (document.visibilityState !== 'hidden') await pollStatus();
        },
        () => POLL_MS
      ),
      loopEvery(
        async () => {
          if (document.visibilityState !== 'hidden') await probeCloud();
        },
        () => (probeDownSince === null ? POLL_MS : POLL_DOWN_MS)
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);

  const outOfReach = since !== null;

  // While it is out of reach: the clock for the 2 s and the 2 minutes, which also looks again at
  // whether a request has been answered since the agent said down.
  useEffect(() => {
    if (!outOfReach) return undefined;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, [outOfReach]);

  return barPhase(since, now);
}
