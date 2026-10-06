import { generateUuid } from './uuid';

// ----------------------------------------------------------------------

/**
 * The header that makes a write safe to repeat (agent-protocol §19.11). The cloud answers a second
 * request with the same key and body with the first answer, and does the work once. The branch agent
 * repeats such a request by itself when the cloud did not answer it (§19.10), so a Place whose
 * answer was lost is not placed twice.
 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** What the cloud answers while the first request with the same key is still being processed. */
export const IDEMPOTENCY_IN_PROGRESS = 'IDEMPOTENCY_IN_PROGRESS';

/**
 * A key for one user action: one press of Place, one cash payment. Make it when the button is
 * pressed and send it on every call of that action (the order routes and the payment's intent keep
 * their keys apart by route, so one key serves them all); the next press makes another.
 */
export const newIdempotencyKey = (): string => generateUuid();

/** The axios config that sends a key; no key sends nothing, as before. */
export const idempotencyHeaders = (key?: string) => (key ? { headers: { [IDEMPOTENCY_KEY_HEADER]: key } } : {});
