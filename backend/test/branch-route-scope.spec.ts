import { NotFoundException } from '@nestjs/common';
import { TenantController } from '../src/modules/tenant/tenant.controller';
import { NO_BRANCH_SCOPE } from '../src/common/utils/user-scope.util';

// Codex review 2, F-22: a branch named in the address is checked against the caller's own
// branch, not only the chain. Head office reaches any branch of its chain.
describe('branch routes by id', () => {
  const service = {
    getBranchById: jest.fn().mockResolvedValue({ id: 'b-2' }),
    getBranchHours: jest.fn().mockResolvedValue([]),
  };
  const controller = new TenantController(service as any);
  const req = (userBranchId: string | null) => ({ tenantId: 't-1', userBranchId }) as any;

  it('lets a branch account read only its own branch and hours', async () => {
    await expect(controller.getBranchById('b-1', req('b-1'))).resolves.toBeDefined();
    await expect(controller.getBranchById('b-2', req('b-1'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.getBranchHours('b-2', req('b-1'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gives an account with no branch no branch at all', async () => {
    await expect(controller.getBranchById('b-1', req(NO_BRANCH_SCOPE))).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.getBranchHours('b-1', req(NO_BRANCH_SCOPE))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets head office read any branch of its chain', async () => {
    await expect(controller.getBranchHours('b-2', req(null))).resolves.toEqual([]);
    expect(service.getBranchHours).toHaveBeenLastCalledWith('t-1', 'b-2');
  });
});
