import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import {
  isBranchOverridable,
  pickSettingValue,
  resolveSettingsForBranch,
} from '../../common/utils/setting-scope.util';
import { canActOnBranch, isHeadOfficeUser } from '../../common/utils/user-scope.util';
import { SettingsService } from './settings.service';

const ORG = null;
const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';

const row = (key: string, branchId: string | null, value: Record<string, any>) =>
  ({ key, branch_id: branchId, value }) as TenantSetting;

describe('setting scope resolution', () => {
  const orgRow = row('ORDER_ACTIONS', ORG, { editWindowMinutes: 10 });
  const branchRow = row('ORDER_ACTIONS', BRANCH_A, { editWindowMinutes: 5 });

  it('gives a branch its own value when it has one', () => {
    expect(pickSettingValue([orgRow, branchRow], BRANCH_A)).toEqual({ editWindowMinutes: 5 });
  });

  it('falls back to the organization value for a branch with no override', () => {
    expect(pickSettingValue([orgRow, branchRow], BRANCH_B)).toEqual({ editWindowMinutes: 10 });
  });

  it('reads the organization value when no branch is in scope', () => {
    expect(pickSettingValue([orgRow, branchRow])).toEqual({ editWindowMinutes: 10 });
  });

  it('is undefined rather than wrong when a key is not configured anywhere', () => {
    expect(pickSettingValue([], BRANCH_A)).toBeUndefined();
  });

  // Row order is whatever Postgres returns; the rule must not depend on it.
  it('does not depend on the order rows come back in', () => {
    expect(pickSettingValue([branchRow, orgRow], BRANCH_A)).toEqual({ editWindowMinutes: 5 });
    expect(pickSettingValue([branchRow, orgRow], BRANCH_B)).toEqual({ editWindowMinutes: 10 });
  });

  it('reports which level supplied each value', () => {
    const resolved = resolveSettingsForBranch([orgRow, branchRow], BRANCH_A);
    expect(resolved.ORDER_ACTIONS).toEqual({ value: { editWindowMinutes: 5 }, source: 'BRANCH' });

    const inherited = resolveSettingsForBranch([orgRow, branchRow], BRANCH_B);
    expect(inherited.ORDER_ACTIONS.source).toBe('ORG');
  });

  it('keeps money and discount authority chain-wide', () => {
    expect(isBranchOverridable('ORDER_ACTIONS')).toBe(true);
    expect(isBranchOverridable('TAX')).toBe(true);
    expect(isBranchOverridable('FINANCIAL')).toBe(false);
    expect(isBranchOverridable('DISCOUNT_AUTHORIZATIONS')).toBe(false);
  });

  // A group nobody has classified must not become branch-editable by accident.
  it('treats an unknown group as organization-wide', () => {
    expect(isBranchOverridable('SOMETHING_ADDED_LATER')).toBe(false);
  });
});

describe('user scope', () => {
  it('needs both a chain-wide role and no branch confinement', () => {
    expect(isHeadOfficeUser({ role: 'SUPER_ADMIN', branchId: null })).toBe(true);
    expect(isHeadOfficeUser({ role: 'ADMIN', branchId: null })).toBe(true);
    // An administrator pinned to a site administers that site, not the chain.
    expect(isHeadOfficeUser({ role: 'ADMIN', branchId: BRANCH_A })).toBe(false);
    expect(isHeadOfficeUser({ role: 'CASHIER', branchId: null })).toBe(false);
  });

  it('confines a branch account to its own branch', () => {
    expect(canActOnBranch({ role: 'MANAGER', branchId: BRANCH_A }, BRANCH_A)).toBe(true);
    expect(canActOnBranch({ role: 'MANAGER', branchId: BRANCH_A }, BRANCH_B)).toBe(false);
    expect(canActOnBranch({ role: 'ADMIN', branchId: null }, BRANCH_B)).toBe(true);
  });
});

describe('updateSetting authority', () => {
  // Every case here is rejected before any repository is touched, so the service can be
  // built without its injected dependencies.
  const service = new SettingsService(null as any, null as any, null as any, null as any, null as any);
  const headOffice = { role: 'SUPER_ADMIN', branchId: null };
  const downtownManager = { role: 'MANAGER', branchId: BRANCH_A };
  const value = { editWindowMinutes: 5 };

  it('refuses a branch override for a group head office keeps to itself', async () => {
    await expect(
      service.updateSetting('t1', 'FINANCIAL', { base_currency: 'IRR' }, 'c1', BRANCH_A, headOffice),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a branch manager writing the value the whole chain inherits', async () => {
    await expect(
      service.updateSetting('t1', 'ORDER_ACTIONS', value, 'c1', undefined, downtownManager),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a branch manager writing another branch', async () => {
    await expect(
      service.updateSetting('t1', 'ORDER_ACTIONS', value, 'c1', BRANCH_B, downtownManager),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a branch manager clearing another branch override', async () => {
    await expect(
      service.clearBranchOverride('t1', 'ORDER_ACTIONS', BRANCH_B, 'c1', downtownManager),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
