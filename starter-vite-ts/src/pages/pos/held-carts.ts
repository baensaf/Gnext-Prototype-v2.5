import type { CartItem } from './order';
import type { Customer } from 'src/api/customerApi';

// ----------------------------------------------------------------------

/**
 * Carts put on hold at this register, kept in its browser and never sent to the server.
 *
 * A held cart is a customer stepping aside at the counter: nothing was ordered, printed or paid,
 * so it takes no order number, needs no reason to drop and holds up no close. It belongs to the
 * register, whoever is signed in to it, and to the shift it was held in: once that shift ends,
 * the register's held carts are gone.
 */
export interface HeldCart {
  id: string;
  shiftId: string;
  heldAt: string;
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  customer: Customer | null;
  deliveryAddressId: string;
  deliveryZoneId: string;
  /** The delivery price typed in place of the zone's, in rials; null charges the zone's. */
  manualDeliveryFee: string | null;
  notes: string;
  lines: CartItem[];
  /** What the cart came to when it was held, with tax; it is priced again on resume. */
  total: string;
  /**
   * A draft left on the server by a Place that failed halfway. Placing the cart again
   * finishes that draft instead of starting a second one.
   */
  draftOrderId: string | null;
}

const keyOf = (terminalId: string) => `gnext_held_carts:${terminalId}`;

/** This register's held carts from the shift running now; ones from an ended shift are dropped. */
export function readHeldCarts(terminalId: string, shiftId: string): HeldCart[] {
  try {
    const raw = localStorage.getItem(keyOf(terminalId));
    const all: HeldCart[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(all)) return [];
    const current = all.filter((cart) => cart && cart.shiftId === shiftId && Array.isArray(cart.lines));
    if (current.length !== all.length) writeHeldCarts(terminalId, current);
    return current;
  } catch {
    return [];
  }
}

export function writeHeldCarts(terminalId: string, carts: HeldCart[]): void {
  try {
    if (carts.length) localStorage.setItem(keyOf(terminalId), JSON.stringify(carts));
    else localStorage.removeItem(keyOf(terminalId));
  } catch {
    // Storage blocked or full: the carts live as long as the page does.
  }
}

/** The shift has closed: whatever was on hold at this register goes with it. */
export function clearHeldCarts(terminalId: string): void {
  writeHeldCarts(terminalId, []);
}
