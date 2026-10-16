import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CustomerGroupsService, monthStartOf } from '../src/modules/discounts/customer-groups.service';

/**
 * Customer groups and group discounts (2026-10-16): head office's groups, members added by
 * head office or by a branch in the groups open to branches, and discounts whose month starts
 * again from nothing.
 */
describe('Customer groups', () => {
  let groupRepo: any;
  let memberRepo: any;
  let discountRepo: any;
  let customerRepo: any;
  let settingRepo: any;
  let dataSource: any;
  let auditWriter: any;
  let service: CustomerGroupsService;

  const staff = { id: 'g-staff', tenant_id: 't-1', name: 'Branch staff', branch_can_assign: true, is_active: true };
  const owners = { id: 'g-owners', tenant_id: 't-1', name: 'Owners', branch_can_assign: false, is_active: true };

  beforeEach(() => {
    groupRepo = {
      find: jest.fn().mockResolvedValue([staff, owners]),
      findOne: jest.fn().mockImplementation(async ({ where }: any) => [staff, owners].find((g) => g.id === where.id) || null),
    };
    memberRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockImplementation(async (v) => v),
      delete: jest.fn(),
    };
    discountRepo = { find: jest.fn().mockResolvedValue([]) };
    customerRepo = { find: jest.fn().mockImplementation(async ({ where }: any) => (where.id._value || []).map((id: string) => ({ id }))) };
    settingRepo = { findOne: jest.fn().mockResolvedValue(null) };
    dataSource = { query: jest.fn().mockResolvedValue([]), transaction: jest.fn() };
    auditWriter = { write: jest.fn() };
    service = new CustomerGroupsService(groupRepo, memberRepo, discountRepo, customerRepo, settingRepo, dataSource, auditWriter);
  });

  describe('the month', () => {
    it('starts on the first of the Jalali month', () => {
      // 2026-10-16 is 24 Mehr 1405; 1 Mehr is 2026-09-23.
      expect(monthStartOf('JALALI', new Date('2026-10-16T09:00:00Z'))).toBe('2026-09-23');
    });

    it('starts on the first of the Gregorian month when head office uses it', () => {
      expect(monthStartOf('GREGORIAN', new Date('2026-10-16T09:00:00Z'))).toBe('2026-10-01');
    });

    it("is the business clock's day, not UTC's", () => {
      // 22:00 UTC on 22 Sep is 01:30 on 23 Sep in Tehran: 1 Mehr, a new month.
      expect(monthStartOf('JALALI', new Date('2026-09-22T22:00:00Z'))).toBe('2026-09-23');
    });
  });

  describe('adding people to a group', () => {
    it('adds several customers at once, at the branch head office picked', async () => {
      const result = await service.addMembers('t-1', 'g-owners', { customer_ids: ['c-1', 'c-2'], branch_id: 'b-1' }, null, 'u-1');

      expect(result).toEqual({ added: 2, already: 0 });
      expect(memberRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ group_id: 'g-owners', customer_id: 'c-1', branch_id: 'b-1' }),
        expect.objectContaining({ group_id: 'g-owners', customer_id: 'c-2', branch_id: 'b-1' }),
      ]);
    });

    it("puts a branch account's people at its own branch, whatever was sent", async () => {
      await service.addMembers('t-1', 'g-staff', { customer_ids: ['c-1'], branch_id: 'b-other' }, 'b-1');

      expect(memberRepo.save).toHaveBeenCalledWith([expect.objectContaining({ branch_id: 'b-1' })]);
    });

    it('leaves the groups not open to branches to head office', async () => {
      await expect(service.addMembers('t-1', 'g-owners', { customer_ids: ['c-1'] }, 'b-1')).rejects.toThrow(ForbiddenException);
    });

    it('leaves someone already in the group as they were', async () => {
      memberRepo.find.mockResolvedValue([{ customer_id: 'c-1', group_id: 'g-staff' }]);

      const result = await service.addMembers('t-1', 'g-staff', { customer_ids: ['c-1', 'c-2'] }, null);

      expect(result).toEqual({ added: 1, already: 1 });
    });
  });

  describe('taking people out', () => {
    it("does not let a branch take out another branch's person", async () => {
      memberRepo.findOne.mockResolvedValue({ id: 'm-1', group_id: 'g-staff', customer_id: 'c-1', branch_id: 'b-2' });

      await expect(service.removeMember('t-1', 'g-staff', 'c-1', 'b-1')).rejects.toThrow(ForbiddenException);
    });

    it('lets head office take anyone out', async () => {
      memberRepo.findOne.mockResolvedValue({ id: 'm-1', group_id: 'g-owners', customer_id: 'c-1', branch_id: 'b-2' });

      expect(await service.removeMember('t-1', 'g-owners', 'c-1', null)).toEqual({ removed: 1 });
      expect(memberRepo.delete).toHaveBeenCalledWith({ id: 'm-1' });
    });
  });

  describe("what is left of a discount's month", () => {
    it('counts down uses and the cap, and has no limit where the discount has none', () => {
      const used = { uses: 3, covered: '45000000.0000', monthStart: '2026-09-23' };

      expect(service.left({ uses_per_month: 4, monthly_cap: '50000000.0000' }, used)).toEqual({ usesLeft: 1, monthLeft: '5000000.0000' });
      expect(service.left({ uses_per_month: null, monthly_cap: null }, used)).toEqual({ usesLeft: null, monthLeft: null });
    });

    it('never goes below nothing', () => {
      const used = { uses: 5, covered: '60000000.0000', monthStart: '2026-09-23' };

      expect(service.left({ uses_per_month: 4, monthly_cap: '50000000.0000' }, used)).toEqual({ usesLeft: 0, monthLeft: '0.0000' });
    });
  });

  describe("saving head office's discounts", () => {
    it('refuses a percent outside 0–100', async () => {
      await expect(service.saveDiscounts('t-1', [{ name: 'Staff', percent: '120', group_ids: ['g-staff'] }])).rejects.toThrow(BadRequestException);
    });

    it('refuses a discount that covers no group', async () => {
      await expect(service.saveDiscounts('t-1', [{ name: 'Staff', percent: '20', group_ids: ['g-gone'] }])).rejects.toThrow(BadRequestException);
    });
  });
});
