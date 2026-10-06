/**
 * The rules of the Reconnecting bar (agent-protocol.md §19.10), kept free of React and of other
 * `src/` imports so scripts/check-cloud-link.mjs can load this file as it is.
 *
 * Three things say the cloud is out of reach:
 *  - the app's own requests: no answer at all, or a gateway with no server behind it
 *    (cloud-reachability.ts);
 *  - the app's own check, a small request sent every few seconds even when the screen is quiet:
 *    one that is not answered within a second, or fails (agent-link.ts); and
 *  - the agent's own word, from GET /agent/api/status: its WebSocket to the cloud is down, or the
 *    agent itself does not answer.
 *
 * The check is there because the agent finds out its WebSocket is gone only after missed
 * heartbeats, which can take a while when the network is cut, and a register that sits idle makes
 * no requests of its own to notice with.
 *
 * The agent's connection is a WebSocket; ordinary requests can work when it is down (a firewall
 * that lets one through and not the other). A request that got an answer after the agent said
 * "down" shows the cloud is there, so from then on only the requests speak, until the agent says
 * "connected" and later "down" again. Without that, a branch whose WebSocket never connects would
 * show the bar for good beside a register that works.
 */

/** The bar shows once the cloud has been out of reach for this long. */
export const BAR_AFTER_MS = 2_000;
/** After this long the bar says orders cannot be sent. */
export const OFFLINE_AFTER_MS = 120_000;
/** The green "Connected again" stays this long. */
export const BACK_FOR_MS = 3_000;

export interface LinkSignals {
  /** Since when the app's requests get no answer (cloud-reachability.ts); null while they do. */
  requestsFailingSince: number | null;
  /** Since when the app's own check of the cloud has gone unanswered or failed; null while it is answered. */
  probeDownSince: number | null;
  /** Since when the agent reports its cloud connection down, or does not answer; null while up. */
  agentDownSince: number | null;
  /** When a request last got an answer from the cloud; null if none has. */
  lastAnsweredAt: number | null;
}

/** Since when the cloud has been out of reach, or null while it is reachable. */
export function unreachableSince(s: LinkSignals): number | null {
  const answeredSinceAgentDown =
    s.agentDownSince !== null && s.lastAnsweredAt !== null && s.lastAnsweredAt >= s.agentDownSince;
  const agentSays = s.agentDownSince !== null && !answeredSinceAgentDown ? s.agentDownSince : null;

  const times = [s.requestsFailingSince, s.probeDownSince, agentSays].filter(
    (t): t is number => t !== null
  );
  return times.length > 0 ? Math.min(...times) : null;
}

export type BarPhase = 'hidden' | 'reconnecting' | 'offline';

/** What the bar shows for an outage that began at `since` (null: none) at time `now`. */
export function barPhase(since: number | null, now: number): BarPhase {
  if (since === null) return 'hidden';
  const elapsed = now - since;
  if (elapsed >= OFFLINE_AFTER_MS) return 'offline';
  if (elapsed >= BAR_AFTER_MS) return 'reconnecting';
  return 'hidden';
}
