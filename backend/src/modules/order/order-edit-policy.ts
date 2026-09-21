import { OrderState } from '../../entities/OrderHeader.entity';
import { MoneyUtil } from '../../common/utils/money.util';

/**
 * Order edit authority, per Build Specification 6.1 and 7.9.
 *
 * Editability is deliberately NOT derived from the order state alone. It is a
 * function of three independent axes:
 *
 *   1. is the check still open        (state is not COMPLETED / CANCELLED)
 *   2. how long since it was submitted (the cashier's own authority window)
 *   3. has money landed on it          (a reduction now implies a refund)
 *
 * This module is pure: no repositories, no clock, no I/O. Callers pass a
 * context and get a decision back, which keeps the rules unit-testable and
 * lets the same predicate serve the API, the UI, and future reporting.
 */

export type EditDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'FORBID';

export type OrderEditAction =
  | 'ADD_ITEM'
  | 'VOID_ITEM'
  | 'REPLACE_ITEM'
  | 'CANCEL_ORDER'
  | 'CHANGE_ORDER_TYPE';

/** Tenant-configurable windows, measured in minutes from `submitted_at`. */
export interface OrderActionConfig {
  editWindowMinutes: number;
  cancelWindowMinutes: number;
}

/** Spec 12: default seed is a 10 minute edit window and a 10 minute cancel window. */
export const ORDER_ACTION_DEFAULTS: OrderActionConfig = {
  editWindowMinutes: 10,
  cancelWindowMinutes: 10,
};

export interface OrderEditContext {
  state: OrderState;
  /** Null on a DRAFT that was never submitted. */
  submittedAt: Date | null;
  /** Sum of succeeded payments less succeeded refunds. */
  paidTotal: string;
}

/** Only supplied for line-scoped actions (VOID_ITEM, REPLACE_ITEM). */
export interface OrderLineContext {
  /** OrderItem.state: ACTIVE, VOID or REPLACED. */
  state: string;
}

export interface OrderEditPolicyResult {
  decision: EditDecision;
  /** Stable machine code, suitable for an error body or an i18n key. */
  reason: string;
}

const ALLOW = (reason: string): OrderEditPolicyResult => ({ decision: 'ALLOW', reason });
const APPROVE = (reason: string): OrderEditPolicyResult => ({ decision: 'REQUIRE_APPROVAL', reason });
const FORBID = (reason: string): OrderEditPolicyResult => ({ decision: 'FORBID', reason });

/**
 * Merge a raw `ORDER_ACTIONS` tenant setting value over the defaults. Unknown
 * and malformed entries fall back rather than throwing: a bad setting row must
 * not take ordering offline, and the settings endpoint validates on write.
 */
export function resolveOrderActionConfig(raw?: Record<string, any> | null): OrderActionConfig {
  const pick = (key: keyof OrderActionConfig): number => {
    const candidate = Number(raw?.[key]);
    return Number.isInteger(candidate) && candidate >= 0 ? candidate : ORDER_ACTION_DEFAULTS[key];
  };
  return {
    editWindowMinutes: pick('editWindowMinutes'),
    cancelWindowMinutes: pick('cancelWindowMinutes'),
  };
}

/**
 * Whole minutes elapsed since submission. A missing `submittedAt` returns null
 * so the caller can distinguish "not submitted yet" from "submitted just now";
 * clock skew that puts submission in the future is clamped to 0.
 */
export function minutesSinceSubmission(submittedAt: Date | null, now: Date): number | null {
  if (!submittedAt) return null;
  const elapsedMs = now.getTime() - new Date(submittedAt).getTime();
  return elapsedMs <= 0 ? 0 : Math.floor(elapsedMs / 60000);
}

function isWithinWindow(ctx: OrderEditContext, windowMinutes: number, now: Date): boolean {
  const elapsed = minutesSinceSubmission(ctx.submittedAt, now);
  // A submitted order with no timestamp is a data anomaly. An authority gate
  // fails closed: require approval rather than granting an unaudited edit.
  if (elapsed === null) return false;
  // Spec 7.9: exactly at the boundary is outside the cashier window.
  return elapsed < windowMinutes;
}

function hasMoneyOnOrder(ctx: OrderEditContext): boolean {
  return MoneyUtil.greaterThan(ctx.paidTotal || '0.0000', '0.0000');
}

/**
 * Resolve whether `action` may proceed, needs a manager approval request, or is
 * refused outright.
 *
 * Note on ADD_ITEM after preparation starts: spec 6.1 reads "Edit/cancel always
 * requires approval after preparation starts", but that rule exists to control
 * removals, which are the shrinkage vector. Appending to an open check is the
 * ordinary coursing flow in table service (a dessert ordered after the mains
 * have fired), it only ever raises the outstanding balance, and gating it
 * behind a manager PIN would make the common case unusable. ADD_ITEM is
 * therefore allowed while the check is open and the food has not left the
 * building; every removal keeps the spec's approval requirement.
 */
export function resolveOrderEditDecision(
  action: OrderEditAction,
  ctx: OrderEditContext,
  config: OrderActionConfig,
  now: Date = new Date(),
  line?: OrderLineContext,
): OrderEditPolicyResult {
  const isRemoval = action === 'VOID_ITEM' || action === 'REPLACE_ITEM';

  // A line may only be acted on once. Voiding a void, or replacing a line that
  // has already been superseded, would fork the supersession chain.
  if (isRemoval && line && line.state !== 'ACTIVE') {
    return FORBID(`LINE_NOT_ACTIVE:${line.state}`);
  }

  switch (ctx.state) {
    // Spec 6.1: nothing is fired, nothing is paid, lines are freely mutable.
    case 'DRAFT':
      return ALLOW('DRAFT_FREELY_EDITABLE');

    // Spec 6.1: never delete, never reopen, never edit. Cancelling a completed
    // order is the separate paid-cancellation orchestration, not an edit.
    case 'COMPLETED':
      return FORBID('ORDER_COMPLETED');

    case 'CANCELLED':
      return FORBID('ORDER_CANCELLED');

    // Spec 6.1: "Item edits forbidden. Cancellation requires approval."
    // The food is with a courier; there is nothing left to amend. Nor can it stop being a
    // delivery while a courier is carrying it.
    case 'OUT_FOR_DELIVERY':
      return action === 'CANCEL_ORDER'
        ? APPROVE('OUT_FOR_DELIVERY_CANCEL_NEEDS_APPROVAL')
        : FORBID('OUT_FOR_DELIVERY_ITEMS_LOCKED');

    // Spec 6.1: once a cook has picked the ticket up, every removal is an
    // approved correction regardless of how recently the order was submitted.
    case 'PREPARING':
    case 'READY':
      if (action === 'ADD_ITEM') return ALLOW('OPEN_CHECK_APPEND');
      return APPROVE(
        ctx.state === 'PREPARING' ? 'PREPARATION_STARTED' : 'ITEMS_READY',
      );

    case 'SUBMITTED':
    case 'CONFIRMED': {
      if (action === 'ADD_ITEM') return ALLOW('OPEN_CHECK_APPEND');

      // Changing what kind of order this is moves money — the delivery fee comes off or
      // goes on — so it is treated exactly like a removal rather than like an append:
      // inside the cashier's window and with nothing collected it is theirs to fix, and
      // past either of those it is a manager's.
      if (action === 'CHANGE_ORDER_TYPE' && hasMoneyOnOrder(ctx)) {
        return APPROVE('TYPE_CHANGE_AGAINST_PAID_ORDER');
      }

      // Spec 6.1: "Cannot reduce paid order below net paid amount." The new
      // total is not known here, so any removal against collected money is
      // escalated and the refund plan is settled by the edit command itself.
      if (isRemoval && hasMoneyOnOrder(ctx)) {
        return APPROVE('REMOVAL_AGAINST_PAID_ORDER');
      }

      // A cancel is the total removal: it takes the order to zero and hands the
      // whole collected amount back. The cashier window governs how long an
      // unpaid mistake may be undone unsupervised; it never covers giving money
      // out of the drawer, so money on the order outranks it.
      if (action === 'CANCEL_ORDER' && hasMoneyOnOrder(ctx)) {
        return APPROVE('CANCEL_AGAINST_PAID_ORDER');
      }

      const windowMinutes =
        action === 'CANCEL_ORDER' ? config.cancelWindowMinutes : config.editWindowMinutes;

      return isWithinWindow(ctx, windowMinutes, now)
        ? ALLOW('WITHIN_CASHIER_WINDOW')
        : APPROVE('CASHIER_WINDOW_ELAPSED');
    }

    default:
      // Unreachable for OrderState, but a new state must fail closed rather
      // than silently inherit edit rights.
      return FORBID('UNKNOWN_ORDER_STATE');
  }
}
