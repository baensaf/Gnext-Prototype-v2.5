import i18n from 'src/locales/i18n';

import { IDEMPOTENCY_IN_PROGRESS } from './idempotency';
import { isGatewayFailure } from './cloud-reachability';

// ----------------------------------------------------------------------

/**
 * What a branch agent answers when the cloud does not (agent-protocol.md §19.10):
 *  - CLOUD_UNREACHABLE (502): the request did not reach the cloud (a read: after the agent
 *    retried it for 20 s);
 *  - CLOUD_NO_ANSWER (504): a write reached the cloud and nothing came back, so it may have
 *    been saved.
 * Plus NETWORK_ERROR, which the HTTP client makes when there was no answer at all: the agent, or
 * the network to it, is gone.
 */
export const CLOUD_UNREACHABLE = 'CLOUD_UNREACHABLE';
export const CLOUD_NO_ANSWER = 'CLOUD_NO_ANSWER';
export const NETWORK_ERROR = 'NETWORK_ERROR';
/** Made by the HTTP client for a gateway's own failure page (no JSON body) outside the agent. */
export const GATEWAY_ERROR = 'GATEWAY_ERROR';

const CONNECTION_CODES = new Set([CLOUD_UNREACHABLE, CLOUD_NO_ANSWER, NETWORK_ERROR]);

/** True for an answer that means the cloud could not be reached, not one the cloud gave. */
export function isConnectionProblem(code: unknown): boolean {
  return typeof code === 'string' && CONNECTION_CODES.has(code);
}

/**
 * Whether a failed `/auth/me` leaves it unknown if the person is signed in: the cloud did not
 * answer (the agent's 502 or 504, no answer at all) or its gateway did (502, 503, 504, with the
 * body the HTTP client makes of a page that is not the application's). A 401 is an answer, and
 * says signed out.
 */
export function isSessionUnknown(problem: unknown): boolean {
  if (typeof problem !== 'object' || problem === null) return false;
  const { code, status } = problem as { code?: unknown; status?: unknown };
  return (
    isConnectionProblem(code) ||
    code === GATEWAY_ERROR ||
    (typeof status === 'number' && isGatewayFailure(status))
  );
}

/**
 * True for the words of a write that was not sent. A screen that is showing them can take them
 * down when the cloud is back: they said "try again when connected", and it is.
 */
export function isNotSentMessage(message: string | null | undefined): boolean {
  return !!message && message === connectionProblemMessage(CLOUD_UNREACHABLE, 'post');
}

/**
 * The words for a request the agent could not get answered, put where a screen shows
 * `problem.detail`: a failed write says what the cashier needs to know about it, and the
 * cart or the form it came from is left as it was. Null for any other problem.
 *
 *  - a write that was not sent: it is safe to press the button again once connected;
 *  - a write that may have been saved: the order has to be looked at before it is repeated;
 *  - a read: nothing was lost, and the screen reads again when the cloud is back.
 */
export function connectionProblemMessage(code: unknown, method: string | undefined): string | null {
  const isRead = !method || ['get', 'head'].includes(method.toLowerCase());
  // The cloud answered, but only that the first request with this write's key is still running (the
  // agent repeated a keyed write that had not finished): the same as no answer, for the cashier.
  if ((code === CLOUD_NO_ANSWER || code === IDEMPOTENCY_IN_PROGRESS) && !isRead) {
    return i18n.t(
      'agent.reconnect.notConfirmed',
      "We couldn't confirm this was saved. Check the order before trying again."
    );
  }
  if (code === CLOUD_UNREACHABLE || code === CLOUD_NO_ANSWER) {
    return isRead
      ? i18n.t('agent.reconnect.readFailed', "Couldn't reach Gnext. Try again when connected.")
      : i18n.t('agent.reconnect.notSent', 'Not sent. Try again when connected.');
  }
  return null;
}
