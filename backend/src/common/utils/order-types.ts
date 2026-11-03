import { TenantSetting } from '../../entities/TenantSetting.entity';

/** The order types head office can switch on and off, and the ORDER_WORKFLOW flag of each. */
export const ORDER_TYPE_SWITCHES = [
  ['DINE_IN', 'enableDineIn'],
  ['TAKEAWAY', 'enableTakeaway'],
  ['DELIVERY', 'enableDelivery'],
] as const;

/**
 * The order types a branch offers at its till. Each one is read on its own: the branch's own row
 * may hold only other ORDER_WORKFLOW settings, and then head office's choice still stands. All
 * three are on until someone says otherwise.
 */
export function offeredOrderTypes(rows: TenantSetting[], branchId?: string | null): string[] {
  const branch = branchId ? rows.find((r) => r.branch_id === branchId)?.value : undefined;
  const chain = rows.find((r) => !r.branch_id)?.value;
  return ORDER_TYPE_SWITCHES.filter(([, flag]) => (branch?.[flag] ?? chain?.[flag] ?? true) !== false).map(([type]) => type);
}
