/**
 * How a branch runs its drawers. Head office sets it once for the chain; in V1 no branch
 * overrides it (P-24).
 */
export interface ShiftPolicy {
  /** What the Open Shift dialog offers as the float. The cashier still types what they counted. */
  defaultOpeningFloat: string;
}

export const SHIFT_POLICY_DEFAULTS: ShiftPolicy = {
  // HAMI branches start every drawer at zero and empty it at each close.
  defaultOpeningFloat: '0',
};

const isAmount = (value: unknown): value is string | number =>
  (typeof value === 'string' || typeof value === 'number') && /^\d+(\.\d+)?$/.test(String(value));

/** Merges a stored SHIFT_POLICY value over the defaults, ignoring anything malformed. */
export function resolveShiftPolicy(raw: unknown): ShiftPolicy {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    defaultOpeningFloat: isAmount(value.defaultOpeningFloat)
      ? String(value.defaultOpeningFloat)
      : SHIFT_POLICY_DEFAULTS.defaultOpeningFloat,
  };
}
