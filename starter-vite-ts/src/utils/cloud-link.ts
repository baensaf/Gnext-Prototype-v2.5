/**
 * The rules of the Reconnecting bar (agent-protocol.md §19.10), kept free of React and of other
 * `src/` imports so scripts/check-cloud-link.mjs can load this file as it is.
 *
 * Two things say the cloud is out of reach:
 *  - the app's own requests: no answer at all, or a gateway with no server behind it
 *    (cloud-reachability.ts); and
 *  - the agent's own word, from GET /agent/api/status: `cloud.reachable` is false, which the agent
 *    decides by probing the cloud and by what became of the requests it passed on, or the agent
 *    itself does not answer.
 *
 * The outage began at the earlier of the two.
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
  /** Since when the agent says the cloud is unreachable, or does not answer; null while it says not. */
  agentUnreachableSince: number | null;
}

/** Since when the cloud has been out of reach, or null while it is reachable. */
export function unreachableSince(s: LinkSignals): number | null {
  if (s.requestsFailingSince === null) return s.agentUnreachableSince;
  if (s.agentUnreachableSince === null) return s.requestsFailingSince;
  return Math.min(s.requestsFailingSince, s.agentUnreachableSince);
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

/**
 * Whether a poll of the agent that began at `polledAt` shows the cloud is back after the app's
 * requests failed at `failingSince`: the agent says reachable, and the failure came before the
 * question was asked. A screen that has asked nothing since would otherwise keep the bar up for
 * good, as nothing clears a failure but an answer.
 */
export function agentShowsRecovery(
  agentReachable: boolean,
  failingSince: number | null,
  polledAt: number
): boolean {
  return agentReachable && failingSince !== null && failingSince < polledAt;
}
