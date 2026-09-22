import { AsyncLocalStorage } from 'async_hooks';

/**
 * Which register the request came from.
 *
 * A device set up as a register sends its terminal id on every request. Cash has to be
 * counted in the drawer of the register it changes hands at, and that is not always the
 * register the order was rung up on: a dine-in bill is often paid at a different counter
 * from the one that took it. The payment, reversal and refund paths sit several calls deep
 * — a paid order's cancel runs a refund inside the order's own transaction — so the
 * register rides along with the request instead of being threaded through every signature.
 *
 * Absent (a device not set up as a register, a test, a background job) it reads as null,
 * and callers fall back to the register named on the order.
 */

export const TILL_TERMINAL_HEADER = 'x-terminal-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tillStore = new AsyncLocalStorage<{ terminalId: string | null; actorId?: string | null }>();

/** The header's value when it is a well-formed id, else null. */
export function parseTillTerminalHeader(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && UUID.test(value.trim()) ? value.trim() : null;
}

export function runWithTill<T>(terminalId: string | null, fn: () => T): T {
  return tillStore.run({ terminalId, actorId: null }, fn);
}

/** The register the current request came from, if it named one. */
export function currentTillTerminalId(): string | null {
  return tillStore.getStore()?.terminalId ?? null;
}

/**
 * Who is signed in on the current request, recorded by the session guard once it has read
 * the account. The audit writer falls back to it, so an event a service writes without
 * naming its actor still says who did it.
 */
export function setRequestActor(actorId: string | null): void {
  const store = tillStore.getStore();
  if (store) store.actorId = actorId;
}

export function currentRequestActorId(): string | null {
  return tillStore.getStore()?.actorId ?? null;
}
