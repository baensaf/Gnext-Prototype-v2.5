import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AdminUser } from '../../entities/AdminUser.entity';
import { isApprover } from '../../common/utils/user-scope.util';
import { ApprovalService } from './approval.service';

const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';

const user = (over: Partial<AdminUser>): AdminUser =>
  ({
    id: 'u',
    role: 'CASHIER',
    is_active: true,
    branch_id: null,
    pin_hash: null,
    ...over,
  }) as AdminUser;

/** Only the four collaborators these two methods actually reach are stubbed. */
const serviceWith = (users: AdminUser[], failedAttempts = 0) => {
  const pinLogRepo = {
    count: jest.fn().mockResolvedValue(failedAttempts),
    create: jest.fn((row) => row),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const userRepo = { find: jest.fn().mockResolvedValue(users) };
  const auditWriter = { write: jest.fn().mockResolvedValue(undefined) };
  const service = new ApprovalService(
    null as any,
    null as any,
    null as any,
    pinLogRepo as any,
    userRepo as any,
    auditWriter as any,
    null as any,
  );
  return { service, pinLogRepo, auditWriter };
};

describe('who may approve', () => {
  it('separates the roles that carry authority from the one that is asked for it', () => {
    expect(isApprover('MANAGER')).toBe(true);
    expect(isApprover('SUPERVISOR')).toBe(true);
    expect(isApprover('SUPER_ADMIN')).toBe(true);
    expect(isApprover('CASHIER')).toBe(false);
    expect(isApprover(undefined)).toBe(false);
  });
});

describe('verifyApproverPin', () => {
  let managerPin: string;

  beforeAll(async () => {
    managerPin = await argon2.hash('2468');
  }, 20000);

  it('accepts a manager pin presented at a cashier register', async () => {
    const manager = user({ id: 'm1', role: 'MANAGER', branch_id: BRANCH_A, pin_hash: managerPin });
    const { service } = serviceWith([manager]);

    await expect(
      service.verifyApproverPin('t1', '2468', 'REFUND_ORDER', 'cashier-1', BRANCH_A),
    ).resolves.toMatchObject({ success: true, approver_user_id: 'm1', role: 'MANAGER' });
  });

  // The hole this method exists to close: verifyManagerPin accepts a hardcoded default for
  // an account with no pin, so a cashier could release their own refund with it.
  it('does not accept the prototype default pin', async () => {
    const manager = user({ id: 'm1', role: 'MANAGER', branch_id: BRANCH_A, pin_hash: managerPin });
    const { service } = serviceWith([manager]);

    await expect(
      service.verifyApproverPin('t1', '1234', 'REFUND_ORDER', 'cashier-1', BRANCH_A),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an approver releasing their own action', async () => {
    const manager = user({ id: 'm1', role: 'MANAGER', branch_id: BRANCH_A, pin_hash: managerPin });
    const { service } = serviceWith([manager]);

    await expect(
      service.verifyApproverPin('t1', '2468', 'REFUND_ORDER', 'm1', BRANCH_A),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ignores an approver who is standing in another branch', async () => {
    const elsewhere = user({ id: 'm2', role: 'MANAGER', branch_id: BRANCH_B, pin_hash: managerPin });
    const { service } = serviceWith([elsewhere]);

    await expect(
      service.verifyApproverPin('t1', '2468', 'REFUND_ORDER', 'cashier-1', BRANCH_A),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets head office release anything, wherever the register is', async () => {
    const admin = user({ id: 'a1', role: 'SUPER_ADMIN', branch_id: null, pin_hash: managerPin });
    const { service } = serviceWith([admin]);

    await expect(
      service.verifyApproverPin('t1', '2468', 'REFUND_ORDER', 'cashier-1', BRANCH_A),
    ).resolves.toMatchObject({ approver_user_id: 'a1' });
  });

  it('asks for a pin rather than failing obscurely when none was given', async () => {
    const { service } = serviceWith([]);
    await expect(
      service.verifyApproverPin('t1', '', 'REFUND_ORDER', 'cashier-1', BRANCH_A),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stops the register after five wrong pins', async () => {
    const { service } = serviceWith([], 5);
    await expect(
      service.verifyApproverPin('t1', '2468', 'REFUND_ORDER', 'cashier-1', BRANCH_A),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records the attempt against whoever is trying, not against the pin owner', async () => {
    const manager = user({ id: 'm1', role: 'MANAGER', branch_id: BRANCH_A, pin_hash: managerPin });
    const { service, pinLogRepo } = serviceWith([manager]);

    await service.verifyApproverPin('t1', '2468', 'REFUND_ORDER', 'cashier-1', BRANCH_A);

    expect(pinLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'cashier-1', is_success: true }),
    );
  });
});

describe('authorizeMoneyOut', () => {
  it('lets an approver act without anyone else supplying a pin', async () => {
    const { service, pinLogRepo } = serviceWith([]);

    await expect(
      service.authorizeMoneyOut('t1', 'REFUND_ORDER', { id: 'm1', role: 'MANAGER', branchId: BRANCH_A }),
    ).resolves.toBeNull();
    expect(pinLogRepo.count).not.toHaveBeenCalled();
  });

  it('stops a cashier who supplied no pin', async () => {
    const { service } = serviceWith([]);

    await expect(
      service.authorizeMoneyOut('t1', 'REFUND_ORDER', {
        id: 'cashier-1',
        role: 'CASHIER',
        branchId: BRANCH_A,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
