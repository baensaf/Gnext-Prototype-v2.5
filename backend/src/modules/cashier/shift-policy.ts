/**
 * How a branch runs its drawers. Head office sets it once for the chain; a branch may
 * override it (see BRANCH_OVERRIDABLE_SETTING_GROUPS) like the order-editing windows.
 */
export interface ShiftPolicy {
  /** What the Open Shift dialog offers as the float. The cashier still types what they counted. */
  defaultOpeningFloat: string;
  /**
   * The largest over or short, either way, a drawer may close on without a manager's pin.
   * Any difference at all still needs a reason.
   */
  varianceTolerance: string;
  /** The person counting down a drawer is not shown what it should hold until they have counted. */
  blindClose: boolean;
}

export const SHIFT_POLICY_DEFAULTS: ShiftPolicy = {
  defaultOpeningFloat: '5000000',
  varianceTolerance: '100000',
  blindClose: true,
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
    varianceTolerance: isAmount(value.varianceTolerance)
      ? String(value.varianceTolerance)
      : SHIFT_POLICY_DEFAULTS.varianceTolerance,
    blindClose: typeof value.blindClose === 'boolean' ? value.blindClose : SHIFT_POLICY_DEFAULTS.blindClose,
  };
}
