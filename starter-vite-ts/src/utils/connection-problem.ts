import i18n from 'src/locales/i18n';

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

const CONNECTION_CODES = new Set([CLOUD_UNREACHABLE, CLOUD_NO_ANSWER, NETWORK_ERROR]);

/** True for an answer that means the cloud could not be reached, not one the cloud gave. */
export function isConnectionProblem(code: unknown): boolean {
  return typeof code === 'string' && CONNECTION_CODES.has(code);
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
  if (code === CLOUD_NO_ANSWER && !isRead) {
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
