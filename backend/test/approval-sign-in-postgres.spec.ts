import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { ApprovalService } from '../src/modules/approval/approval.service';
import { deleteTenantData } from './utils/tenant-teardown';

// R-15: a manager approves on the cashier's screen with their own username and password. Who may
// approve, and the limit on wrong tries, are the PIN's.
describe('Approval by manager sign-in (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let approvals: ApprovalService;
  let tenantId: string;
  let branchId: string;
  let otherBranchId: string;
  let cashierId: string;
  let lockedCashierId: string;
  const stamp = Date.now();

  const save = <T>(entity: any, data: Partial<T>) =>
    dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;

  const result = (username: string, password: string, requester = cashierId) =>
    approvals
      .verifyApproverSignIn(tenantId, username, password, 'ASSIGN_DEVICE_TERMINAL', requester, branchId)
      .then((r) => r.approver_user_id)
      .catch((err) => err.getResponse?.().code as string);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    approvals = moduleRef.get(ApprovalService);

    tenantId = (await save(Tenant, { code: `SIGNIN-${stamp}`, name: 'Sign-in fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'SI1', name: 'Branch one', is_active: true, time_zone: 'Asia/Tehran' })).id;
    otherBranchId = (await save(Branch, { tenant_id: tenantId, code: 'SI2', name: 'Branch two', is_active: true, time_zone: 'Asia/Tehran' })).id;
    const hash = await argon2.hash('right-pass');
    const user = (username: string, role: string, branch: string | null) =>
      save(AdminUser, { tenant_id: tenantId, username, display_name: username, password_hash: hash, role, branch_id: branch, is_active: true });
    await user(`mgr-${stamp}@fx`, 'MANAGER', branchId);
    await user(`other-mgr-${stamp}@fx`, 'MANAGER', otherBranchId);
    await user(`hq-${stamp}@fx`, 'ADMIN', null);
    cashierId = (await user(`cash-${stamp}@fx`, 'CASHIER', branchId)).id;
    lockedCashierId = (await user(`cash2-${stamp}@fx`, 'CASHIER', branchId)).id;
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it("takes this branch's manager or head office, with the right password", async () => {
    expect(await result(`MGR-${stamp}@fx`, 'right-pass')).toEqual(expect.any(String));
    expect(await result(`hq-${stamp}@fx`, 'right-pass')).toEqual(expect.any(String));
  });

  it("refuses a wrong password, another branch's manager, and a cashier", async () => {
    expect(await result(`mgr-${stamp}@fx`, 'wrong')).toBe('APPROVAL_SIGN_IN_FAILED');
    expect(await result(`other-mgr-${stamp}@fx`, 'right-pass')).toBe('APPROVAL_SIGN_IN_FAILED');
    expect(await result(`cash-${stamp}@fx`, 'right-pass')).toBe('APPROVAL_SIGN_IN_FAILED');
  });

  it('stops the person asking after five wrong tries in 15 minutes', async () => {
    for (let i = 0; i < 5; i += 1) await result(`mgr-${stamp}@fx`, 'wrong', lockedCashierId);
    expect(await result(`mgr-${stamp}@fx`, 'right-pass', lockedCashierId)).toBe('PIN_RATE_LIMITED');
  });
});
