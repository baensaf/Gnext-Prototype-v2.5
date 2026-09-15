import { TenantSetting } from '../../entities/TenantSetting.entity';

/**
 * Setting groups a branch may override for itself. Everything else is decided once at
 * head office and inherited, which is the safer default for a chain: a group added later
 * stays organization-wide until someone deliberately opens it up.
 *
 * The groups here are the ones that legitimately differ between sites — local tax
 * treatment, how the register behaves, how long a cashier keeps authority over an order,
 * what a kiosk asks a customer for, and how its drawers are floated and counted.
 */
export const BRANCH_OVERRIDABLE_SETTING_GROUPS = [
  'TAX',
  'POS',
  'ORDER_ACTIONS',
  'ORDER_WORKFLOW',
  'KIOSK_CUSTOMER_IDENTITY_POLICY',
  'SHIFT_POLICY',
  // How a new courier is paid and whether a failed ride is paid: shops in one chain differ.
  'COURIER_PAY',
];

export function isBranchOverridable(key: string): boolean {
  return BRANCH_OVERRIDABLE_SETTING_GROUPS.includes(key.toUpperCase());
}

/** Where a resolved setting value came from. */
export type SettingSource = 'BRANCH' | 'ORG';

/**
 * Picks the row that applies at `branchId`: the branch's own override when it has one,
 * otherwise the organization row it inherits.
 *
 * Callers pass every row for a key rather than querying twice, because the fallback is
 * the whole point — asking only for the branch row and finding nothing is not the same
 * as there being no setting.
 */
export function pickSettingRow(
  rows: TenantSetting[],
  branchId?: string | null,
): TenantSetting | undefined {
  const override = branchId ? rows.find((r) => r.branch_id === branchId) : undefined;
  return override ?? rows.find((r) => !r.branch_id);
}

export function pickSettingValue(
  rows: TenantSetting[],
  branchId?: string | null,
): Record<string, any> | undefined {
  return pickSettingRow(rows, branchId)?.value;
}

/** Resolves every key at once, returning the value and which level supplied it. */
export function resolveSettingsForBranch(
  rows: TenantSetting[],
  branchId?: string | null,
): Record<string, { value: Record<string, any>; source: SettingSource }> {
  const byKey = new Map<string, TenantSetting[]>();
  for (const row of rows) {
    const list = byKey.get(row.key) || [];
    list.push(row);
    byKey.set(row.key, list);
  }

  const resolved: Record<string, { value: Record<string, any>; source: SettingSource }> = {};
  for (const [key, keyRows] of byKey) {
    const picked = pickSettingRow(keyRows, branchId);
    if (!picked) continue;
    resolved[key] = { value: picked.value, source: picked.branch_id ? 'BRANCH' : 'ORG' };
  }
  return resolved;
}
