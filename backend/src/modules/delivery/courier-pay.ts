import { MoneyUtil } from '../../common/utils/money.util';

/**
 * How a courier is paid for a trip. Deliberately separate from what the customer is charged:
 * a free-delivery promotion must not zero a rider's pay, and a platform order the customer
 * paid Snappfood for still pays the rider.
 *
 * - FLAT: the courier's own amount per delivery.
 * - DELIVERY_FEE: the zone's listed delivery fee, as snapshotted on the delivery when it was
 *   created — the list price, not what the customer paid after a discount.
 * - ZONE_RATE: the courier rate set on the zone; a zone with no rate falls back to FLAT.
 */
export const COURIER_PAY_MODES = ['FLAT', 'DELIVERY_FEE', 'ZONE_RATE'] as const;
export type CourierPayMode = (typeof COURIER_PAY_MODES)[number];

export function isCourierPayMode(value: unknown): value is CourierPayMode {
  return typeof value === 'string' && (COURIER_PAY_MODES as readonly string[]).includes(value);
}

/** The COURIER_PAY setting group: head office's default, which a branch may override. */
export interface CourierPayPolicy {
  /** The rule a newly added courier starts on. */
  defaultPayMode: CourierPayMode;
  /** Whether a courier who rode out and could not deliver is still paid for the trip. */
  payFailedDeliveries: boolean;
}

export const COURIER_PAY_DEFAULTS: CourierPayPolicy = {
  defaultPayMode: 'FLAT',
  payFailedDeliveries: false,
};

/** Merges a stored COURIER_PAY value over the defaults, ignoring anything malformed. */
export function resolveCourierPayPolicy(raw: unknown): CourierPayPolicy {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    defaultPayMode: isCourierPayMode(value.defaultPayMode) ? value.defaultPayMode : COURIER_PAY_DEFAULTS.defaultPayMode,
    payFailedDeliveries:
      typeof value.payFailedDeliveries === 'boolean' ? value.payFailedDeliveries : COURIER_PAY_DEFAULTS.payFailedDeliveries,
  };
}

export interface CourierPayInput {
  mode?: string | null;
  /** The courier's own fixed amount. */
  courierRate?: string | null;
  /** The delivery fee listed for the zone when the delivery was created. */
  listedFee?: string | null;
  /** The zone's courier rate, when it has one. */
  zoneRate?: string | null;
  /** A tip for the rider, always passed through in full. */
  tip?: string | null;
}

/** What one trip pays, and the rule that actually priced it (ZONE_RATE without a rate is FLAT). */
export function computeCourierPay(input: CourierPayInput): { amount: string; basis: CourierPayMode } {
  const mode = isCourierPayMode(input.mode) ? input.mode : 'FLAT';
  const hasZoneRate = input.zoneRate !== null && input.zoneRate !== undefined && input.zoneRate !== '';

  let base: string;
  let basis: CourierPayMode = mode;
  if (mode === 'DELIVERY_FEE') {
    base = input.listedFee || '0';
  } else if (mode === 'ZONE_RATE' && hasZoneRate) {
    base = String(input.zoneRate);
  } else {
    base = input.courierRate || '0';
    basis = 'FLAT';
  }

  return {
    amount: MoneyUtil.add(MoneyUtil.format(base, 4), MoneyUtil.format(input.tip || '0', 4), 4),
    basis,
  };
}
