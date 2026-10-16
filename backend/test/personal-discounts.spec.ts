import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PersonalDiscountsService, monthStartOf } from '../src/modules/discounts/personal-discounts.service';

/**
 * Personal discounts in groups (2026-10-16, Iran Burger's staff scheme): head office's groups,
 * one group per person at the branch they work at, and a month that starts again from nothing.
 */
describe('Personal discount groups', () => {
  let groupRepo: any;
  let assignmentRepo: any;
  let customerRepo: any;
  let settingRepo: any;
  let dataSource: any;
  let auditWriter: any;
  let service: PersonalDiscountsService;

  const staff = { id: 'g-staff', tenant_id: 't-1', name: 'Branch staff', percent: '25.00', any_branch: false, is_active: true };
  const owners = { id: 'g-owners', tenant_id: 't-1', name: 'Owners', percent: '35.00', any_branch: true, is_active: true };

  beforeEach(() => {
    groupRepo = {
      find: jest.fn().mockResolvedValue([staff, owners]),
      findOne: jest.fn().mockImplementation(async ({ where }: any) => [staff, owners].find((g) => g.id === where.id) || null),
    };
    assignmentRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockImplementation(async (v) => ({ id: 'cd-1', ...v })),
      update: jest.fn(),
    };
    customerRepo = { findOne: jest.fn().mockResolvedValue({ id: 'cust-1' }) };
    settingRepo = { findOne: jest.fn().mockResolvedValue(null) };
    dataSource = { query: jest.fn().mockResolvedValue([]), transaction: jest.fn() };
    auditWriter = { write: jest.fn() };
    service = new PersonalDiscountsService(groupRepo, assignmentRepo, customerRepo, settingRepo, dataSource, auditWriter);
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

  describe('putting a person in a group', () => {
    it('keeps the branch they work at and the group percent', async () => {
      const saved = await service.assign('t-1', { customer_id: 'cust-1', group_id: 'g-staff', branch_id: 'b-1' }, null, 'u-1');

      expect(saved).toEqual(expect.objectContaining({ group_id: 'g-staff', branch_id: 'b-1', discount_percentage: '25.00' }));
    });

    it("gives a branch account's person its own branch, whatever was sent", async () => {
      const saved = await service.assign('t-1', { customer_id: 'cust-1', group_id: 'g-staff', branch_id: 'b-other' }, 'b-1');

      expect(saved?.branch_id).toBe('b-1');
    });

    it('leaves the groups that work at every branch to head office', async () => {
      await expect(service.assign('t-1', { customer_id: 'cust-1', group_id: 'g-owners' }, 'b-1')).rejects.toThrow(ForbiddenException);
    });

    it("does not let a branch move another branch's person", async () => {
      assignmentRepo.findOne.mockResolvedValue({ id: 'cd-1', customer_id: 'cust-1', branch_id: 'b-2', is_active: true });

      await expect(service.assign('t-1', { customer_id: 'cust-1', group_id: 'g-staff' }, 'b-1')).rejects.toThrow(ForbiddenException);
    });

    it('moves a person to another group rather than giving them two', async () => {
      assignmentRepo.findOne.mockResolvedValue({ id: 'cd-1', customer_id: 'cust-1', group_id: 'g-staff', branch_id: 'b-1', is_active: true });

      const saved = await service.assign('t-1', { customer_id: 'cust-1', group_id: 'g-owners', branch_id: 'b-1' }, null);

      expect(assignmentRepo.create).not.toHaveBeenCalled();
      expect(saved).toEqual(expect.objectContaining({ id: 'cd-1', group_id: 'g-owners', discount_percentage: '35.00' }));
    });

    it('takes a person out with no group', async () => {
      assignmentRepo.findOne.mockResolvedValue({ id: 'cd-1', customer_id: 'cust-1', branch_id: 'b-1', is_active: true });

      await service.assign('t-1', { customer_id: 'cust-1', group_id: null }, null);

      expect(assignmentRepo.update).toHaveBeenCalledWith({ id: 'cd-1' }, expect.objectContaining({ is_active: false }));
    });

    it('needs the branch they work at', async () => {
      await expect(service.assign('t-1', { customer_id: 'cust-1', group_id: 'g-staff' }, null)).rejects.toThrow(BadRequestException);
    });
  });

  describe("what is left of the month", () => {
    it('counts down uses and the cap, and has no limit where the group has none', () => {
      const used = { uses: 3, covered: '45000000.0000', monthStart: '2026-09-23' };

      expect(service.left({ uses_per_month: 4, monthly_cap: '50000000.0000' } as any, used)).toEqual({ usesLeft: 1, monthLeft: '5000000.0000' });
      expect(service.left({ uses_per_month: null, monthly_cap: null } as any, used)).toEqual({ usesLeft: null, monthLeft: null });
    });

    it('never goes below nothing', () => {
      const used = { uses: 5, covered: '60000000.0000', monthStart: '2026-09-23' };

      expect(service.left({ uses_per_month: 4, monthly_cap: '50000000.0000' } as any, used)).toEqual({ usesLeft: 0, monthLeft: '0.0000' });
    });
  });

  describe("saving head office's groups", () => {
    it('refuses to remove a group people are still in', async () => {
      dataSource.query.mockResolvedValue([{ group_id: 'g-owners', members: 2 }]);

      await expect(
        service.saveGroups('t-1', [{ id: 'g-staff', name: 'Branch staff', percent: '25' }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a percent outside 0–100', async () => {
      await expect(
        service.saveGroups('t-1', [{ id: 'g-staff', name: 'Branch staff', percent: '120' }, { id: 'g-owners', name: 'Owners', percent: '35' }]),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
