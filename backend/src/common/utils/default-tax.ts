import { EntityManager, IsNull } from 'typeorm';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { MoneyUtil } from './money.util';

/** The chain setting group that holds menu defaults. */
export const CATALOG_SETTING_KEY = 'CATALOG';

/** A new chain's default tax rate, in percent. */
export const DEFAULT_TAX_PERCENT = '10';

/**
 * The tax rate a new product starts with, as the fraction products store (10% → '0.1000').
 * Head office sets it once for the chain; changing it never touches existing products.
 */
export async function defaultTaxRate(em: EntityManager, tenantId: string): Promise<string> {
  const row = await em.findOne(TenantSetting, {
    where: { tenant_id: tenantId, key: CATALOG_SETTING_KEY, branch_id: IsNull() },
  });
  const percent = row?.value?.default_tax_rate ?? DEFAULT_TAX_PERCENT;
  return MoneyUtil.divide(percent, '100');
}

/** Why a CATALOG setting value is refused, or null. */
export function catalogSettingProblem(value: Record<string, any>): string | null {
  if (value.default_tax_rate === undefined) return null;
  const rate = value.default_tax_rate;
  if (!MoneyUtil.isValid(rate) || MoneyUtil.lessThan(rate, '0') || MoneyUtil.greaterThan(rate, '100')) {
    return 'The default tax rate is a percent from 0 to 100';
  }
  return null;
}
