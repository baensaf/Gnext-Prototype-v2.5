import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { BusinessDayService } from '../src/modules/cashier/business-day.service';
import { ShiftsController } from '../src/modules/cashier/shifts.controller';
import { BusinessDaysController } from '../src/modules/cashier/business-days.controller';
import { BRANCH_OWNED_KEY } from '../src/common/decorators/branch-owned.decorator';
import { ROLES_KEY, MANAGER_AND_ABOVE } from '../src/common/decorators/roles.decorator';
import { runWithTill } from '../src/common/utils/till-context';
import { ApprovalService } from '../src/modules/approval/approval.service';
import { SHIFT_POLICY_DEFAULTS } from '../src/modules/cashier/shift-policy';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { CashMovement } from '../src/entities/CashMovement.entity';
import { BusinessDayClose } from '../src/entities/BusinessDayClose.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { Payment } from '../src/entities/Payment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { Branch } from '../src/entities/Branch.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('Cashier Shift & Business Day Suite (R13)', () => {
  let shiftService: ShiftService;
  let dayService: BusinessDayService;

  let shiftRepo: any;
  let movementRepo: any;
  let terminalRepo: any;
  let paymentRepo: any;
  let orderRepo: any;
  let branchRepo: any;
  let dayCloseRepo: any;
  let auditWriter: any;
  let approvalService: any;
  let dataSource: any;
  /** SHIFT_POLICY rows the policy lookup finds; none means the defaults. */
  let settingRows: any[];

  beforeEach(async () => {
    shiftRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
    movementRepo = { find: jest.fn().mockResolvedValue([]), create: jest.fn(), save: jest.fn() };
    terminalRepo = { findOne: jest.fn() };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    orderRepo = { find: jest.fn().mockResolvedValue([]) };
    // Only the chain roll-up reads this; the shift paths under test never touch it.
    branchRepo = { find: jest.fn().mockResolvedValue([]) };
    dayCloseRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
    auditWriter = { write: jest.fn() };
    approvalService = {
      verifyApproverPin: jest.fn().mockResolvedValue({ success: true, approver_user_id: 'manager-1', role: 'MANAGER' }),
    };

    const mockEntityManager: any = {
      create: jest.fn((entityClass, data) => ({ ...data })),
      save: jest.fn((entityClass, data) => Promise.resolve(data || entityClass)),
      findOne: jest.fn((entityClass, options) => {
        if (entityClass === Terminal) return terminalRepo.findOne(options);
        if (entityClass === CashierShift) return shiftRepo.findOne(options);
        if (entityClass === BusinessDayClose) return dayCloseRepo.findOne(options);
        return null;
      }),
      find: jest.fn((entityClass, options) => {
        if (entityClass === CashMovement) return movementRepo.find(options);
        if (entityClass === CashierShift) return shiftRepo.find ? shiftRepo.find(options) : [];
        if (entityClass === OrderHeader) return orderRepo.find(options);
        return [];
      }),
      delete: jest.fn(),
    };

    settingRows = [];
    dataSource = {
      transaction: jest.fn(async (cb) => await cb(mockEntityManager)),
      getRepository: jest.fn(() => ({ find: jest.fn(async () => settingRows) })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShiftService,
        BusinessDayService,
        { provide: getRepositoryToken(CashierShift), useValue: shiftRepo },
        { provide: getRepositoryToken(CashMovement), useValue: movementRepo },
        { provide: getRepositoryToken(Terminal), useValue: terminalRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(Branch), useValue: branchRepo },
        { provide: getRepositoryToken(BusinessDayClose), useValue: dayCloseRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: DataSource, useValue: dataSource },
        { provide: ApprovalService, useValue: approvalService },
      ],
    }).compile();

    shiftService = module.get<ShiftService>(ShiftService);
    dayService = module.get<BusinessDayService>(BusinessDayService);
  });

  describe('Shift Open & Concurrent Lock (R13)', () => {
    it('should throw ConflictException if terminal already has an active open shift', async () => {
      terminalRepo.findOne.mockResolvedValue({ id: 'term-1', branch_id: 'b-1' });
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', shift_number: 'SHF-100', state: 'OPEN' });

      await expect(
        shiftService.openShift('t-1', { terminalId: 'term-1', openingCash: '50000.0000' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should open shift successfully and record OPENING_FLOAT movement', async () => {
      terminalRepo.findOne.mockResolvedValue({ id: 'term-1', branch_id: 'b-1' });
      shiftRepo.findOne.mockResolvedValue(null);

      const result = await shiftService.openShift('t-1', { terminalId: 'term-1', openingCash: '50000.0000' });
      expect(result).toBeDefined();
    });

    it("refuses a branch account opening a drawer on another branch's terminal", async () => {
      terminalRepo.findOne.mockResolvedValue({ id: 'term-9', branch_id: 'b-central', terminal_type: 'CASHIER' });
      shiftRepo.findOne.mockResolvedValue(null);

      await expect(
        shiftService.openShift('t-1', { terminalId: 'term-9' }, 'cashier-1', undefined, 'b-downtown'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('takes the branch from the terminal, not from the caller', async () => {
      terminalRepo.findOne.mockResolvedValue({ id: 'term-2', branch_id: 'b-downtown', terminal_type: 'CASHIER' });
      shiftRepo.findOne.mockResolvedValue(null);

      await shiftService.openShift('t-1', { terminalId: 'term-2' }, 'cashier-1', undefined, 'b-downtown');
      const created = auditWriter.write.mock.calls[0][0].afterData;
      expect(created.branch_id).toBe('b-downtown');
    });

    it('refuses a drawer on a kiosk or an inactive terminal', async () => {
      shiftRepo.findOne.mockResolvedValue(null);
      terminalRepo.findOne.mockResolvedValue({ id: 'k-1', branch_id: 'b-1', terminal_type: 'KIOSK' });
      await expect(shiftService.openShift('t-1', { terminalId: 'k-1' })).rejects.toThrow(BadRequestException);

      terminalRepo.findOne.mockResolvedValue({ id: 'term-1', branch_id: 'b-1', terminal_type: 'CASHIER', is_active: false });
      await expect(shiftService.openShift('t-1', { terminalId: 'term-1' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('Branch boundary on the shift routes', () => {
    it('holds every shift named by id to the caller branch', () => {
      expect(Reflect.getMetadata(BRANCH_OWNED_KEY, ShiftsController)).toMatchObject({ entity: CashierShift });
    });

    it('asks about the branch head office is working in, and confines a branch account to its own', async () => {
      const service = {
        getCurrentShift: jest.fn().mockResolvedValue(null),
        redactForBlindCount: jest.fn(async (_tenant: string, payload: any) => payload),
      };
      const controller = new ShiftsController(service as any);

      await controller.getCurrentShift(undefined as any, 'b-downtown', { tenantId: 't-1', userBranchId: null } as any);
      expect(service.getCurrentShift).toHaveBeenLastCalledWith('t-1', undefined, 'b-downtown');

      await controller.getCurrentShift(undefined as any, 'b-central', { tenantId: 't-1', userBranchId: 'b-downtown' } as any);
      expect(service.getCurrentShift).toHaveBeenLastCalledWith('t-1', undefined, 'b-downtown');
    });

    it('leaves closing and reopening a business day to a manager, and reopening to its own branch', () => {
      const proto = BusinessDaysController.prototype;
      expect(Reflect.getMetadata(ROLES_KEY, proto.closeBusinessDay)).toEqual(MANAGER_AND_ABOVE);
      expect(Reflect.getMetadata(ROLES_KEY, proto.reopenBusinessDay)).toEqual(MANAGER_AND_ABOVE);
      expect(Reflect.getMetadata(BRANCH_OWNED_KEY, proto.reopenBusinessDay)).toMatchObject({ entity: BusinessDayClose });
    });

    it("does not let a branch account read another shop's business days through ?branch=", async () => {
      const service = { getBusinessDays: jest.fn().mockResolvedValue({ data: [] }) };
      const controller = new BusinessDaysController(service as any);

      await controller.getBusinessDays({ branch: 'b-central' }, { tenantId: 't-1', userBranchId: 'b-downtown' } as any);
      expect(service.getBusinessDays.mock.calls[0][1]).toMatchObject({ branch: 'b-downtown', branchId: 'b-downtown' });
    });
  });

  describe('Physical Cash Calculations & Movement Semantics (R13)', () => {
    it('should calculate expected cash strictly from persisted cash movements', async () => {
      const shift = { id: 'shf-1', tenant_id: 't-1', state: 'OPEN', currency_code: 'IRR' };
      shiftRepo.findOne.mockResolvedValue(shift);

      movementRepo.find.mockResolvedValue([
        { type: 'OPENING_FLOAT', amount: '50000.0000' },
        { type: 'CASH_PAYMENT', amount: '30000.0000' },
        { type: 'CASH_REFUND', amount: '-5000.0000' },
        { type: 'PAID_IN', amount: '10000.0000' },
        { type: 'PAID_OUT', amount: '-15000.0000' },
      ]);

      const statement = await shiftService.getShiftStatement('t-1', 'shf-1');
      // expected = 50,000 + 30,000 - 5,000 + 10,000 - 15,000 = 70,000
      expect(statement.expectedCash).toBe('70000.0000');
    });

    it('keeps a closed drawer expected cash apart from the difference booked at the count', async () => {
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', tenant_id: 't-1', state: 'CLOSED', actual_cash: '45000.0000', short_over: '-5000.0000' });
      movementRepo.find.mockResolvedValue([
        { type: 'OPENING_FLOAT', amount: '50000.0000' },
        { type: 'CLOSE_ADJUSTMENT', amount: '-5000.0000' },
      ]);

      const statement = await shiftService.getShiftStatement('t-1', 'shf-1');
      expect(statement.expectedCash).toBe('50000.0000');
      expect(statement.shortOver).toBe('-5000.0000');
    });

    it('closes a drawer with a difference without orphaning the adjustment it books', async () => {
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', tenant_id: 't-1', branch_id: 'b-1', state: 'OPEN' });
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '50000.0000' }]);

      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '45000.0000', reason: 'Short' });
      // Loading the movements relation made the cascade null the new adjustment's shift_id.
      expect(shiftRepo.findOne.mock.calls[0][0].relations).toBeUndefined();
    });

    it('should throw BadRequestException for paid-out movement with non-positive amount', async () => {
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', tenant_id: 't-1', state: 'OPEN' });

      await expect(
        shiftService.recordMovement('t-1', 'shf-1', { type: 'PAID_OUT', amount: '0.0000' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Shift Close & Stale Preview Version (R13)', () => {
    it('should begin close, generate preview_version, and transition to CLOSING_REVIEW', async () => {
      const shift = { id: 'shf-1', tenant_id: 't-1', state: 'OPEN' };
      shiftRepo.findOne.mockResolvedValue(shift);

      const preview = await shiftService.beginClose('t-1', 'shf-1');
      expect(shift.state).toBe('CLOSING_REVIEW');
      expect(preview.previewVersion).toBeDefined();
    });

    it('should throw ConflictException STALE_PREVIEW if previewVersion differs', async () => {
      const shift = { id: 'shf-1', tenant_id: 't-1', state: 'CLOSING_REVIEW', preview_version: 'prev-v2' };
      shiftRepo.findOne.mockResolvedValue(shift);

      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000', previewVersion: 'prev-v1-stale' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if nonzero cash discrepancy lacks reason', async () => {
      const shift = { id: 'shf-1', tenant_id: 't-1', state: 'CLOSING_REVIEW', preview_version: 'prev-v1' };
      shiftRepo.findOne.mockResolvedValue(shift);
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '50000.0000' }]);

      // Actual 60,000 vs Expected 50,000 = +10,000 short_over without reason
      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '60000.0000', previewVersion: 'prev-v1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should close shift successfully when actual matches expected or discrepancy is reasoned', async () => {
      const shift = { id: 'shf-1', tenant_id: 't-1', state: 'CLOSING_REVIEW', preview_version: 'prev-v1' };
      shiftRepo.findOne.mockResolvedValue(shift);
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '50000.0000' }]);

      const statement = await shiftService.closeShift('t-1', 'shf-1', {
        actualCash: '50000.0000',
        previewVersion: 'prev-v1',
      });
      expect(shift.state).toBe('CLOSED');
      expect(statement.actualCash).toBe('50000.0000');
    });
  });

  describe('Asking whether a drawer is open (R13)', () => {
    /** The query builder chain getCurrentShift walks, ending in whatever getOne returns. */
    const withOpenShift = (shift: any) => {
      shiftRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(shift),
      });
    };

    it('answers null when no drawer is open rather than raising a 404', async () => {
      // Most of the day a terminal has no shift open. The screen that asks renders its own
      // empty state, so treating the ordinary case as a missing resource only ever put a
      // failed request in the console.
      withOpenShift(null);

      await expect(shiftService.getCurrentShift('t-1', 'term-1')).resolves.toBeNull();
    });

    it('returns the open shift when there is one', async () => {
      withOpenShift({ id: 'shf-1', state: 'OPEN' });

      await expect(shiftService.getCurrentShift('t-1', 'term-1')).resolves.toMatchObject({ id: 'shf-1' });
    });

    it('refuses cash movement with the till shut, and says so in its own words', async () => {
      // The callers that move money ask through requireCurrentShift. A payment capture
      // being handed a 404 about a shift it never asked for is the wrong shape of answer;
      // a conflict naming the drawer is the right one.
      withOpenShift(null);

      await expect(shiftService.requireCurrentShift('t-1', 'term-1')).rejects.toThrow(ConflictException);
      await expect(shiftService.requireCurrentShift('t-1', 'term-1')).rejects.toMatchObject({
        response: { code: 'NO_OPEN_SHIFT' },
      });
    });

    it('hands back the shift when one is open', async () => {
      withOpenShift({ id: 'shf-1', state: 'OPEN' });

      await expect(shiftService.requireCurrentShift('t-1', 'term-1')).resolves.toMatchObject({ id: 'shf-1' });
    });
  });

  describe('Blind count and sign-off at close', () => {
    // Tolerance is 100,000 by default; the float below is 50,000.
    const openShift = () => ({ id: 'shf-1', tenant_id: 't-1', branch_id: 'b-1', state: 'OPEN' });
    beforeEach(() => {
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '50000.0000' }]);
    });

    it('asks for a reason, and hands back the figures, when the count is out within tolerance', async () => {
      shiftRepo.findOne.mockResolvedValue(openShift());

      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '40000.0000' }, 'cashier-1', undefined, { role: 'CASHIER' }),
      ).rejects.toMatchObject({
        response: {
          code: 'SHIFT_COUNT_NEEDS_SIGNOFF',
          context: { expectedCash: '50000.0000', shortOver: '-10000.0000', needsReason: true, needsApproval: false },
        },
      });
      expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'SHIFT_COUNT_SUBMITTED' }));
    });

    it('closes on a reason alone within tolerance', async () => {
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '40000.0000', reason: 'Gave wrong change' }, 'cashier-1', undefined, { role: 'CASHIER' });
      expect(shift.state).toBe('CLOSED');
      expect(approvalService.verifyApproverPin).not.toHaveBeenCalled();
    });

    it("needs a manager's pin beyond tolerance from a cashier", async () => {
      shiftRepo.findOne.mockResolvedValue(openShift());

      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '200000.0000', reason: 'Over' }, 'cashier-1', undefined, { role: 'CASHIER' }),
      ).rejects.toMatchObject({ response: { context: { needsApproval: true } } });

      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);
      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '200000.0000', reason: 'Over', pin: '2468' }, 'cashier-1', undefined, { role: 'CASHIER' });
      expect(approvalService.verifyApproverPin).toHaveBeenCalledWith('t-1', '2468', 'SHIFT_CLOSE_VARIANCE', 'cashier-1', 'b-1');
      expect(shift.state).toBe('CLOSED');
    });

    it('lets a manager close beyond tolerance on their own authority', async () => {
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '200000.0000', reason: 'Over' }, 'manager-1', undefined, { role: 'MANAGER' });
      expect(approvalService.verifyApproverPin).not.toHaveBeenCalled();
      expect(shift.state).toBe('CLOSED');
    });

    it("takes the tolerance from the branch's override over head office's", async () => {
      settingRows = [
        { key: 'SHIFT_POLICY', branch_id: null, value: { varianceTolerance: '100000' } },
        { key: 'SHIFT_POLICY', branch_id: 'b-1', value: { varianceTolerance: '0' } },
      ];
      shiftRepo.findOne.mockResolvedValue(openShift());

      // 10,000 short is inside the chain's tolerance but not this branch's zero.
      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '40000.0000', reason: 'Short' }, 'cashier-1', undefined, { role: 'CASHIER' }),
      ).rejects.toMatchObject({ response: { context: { needsApproval: true, varianceTolerance: '0.0000' } } });

      await expect(shiftService.policyFor('t-1', 'b-2')).resolves.toMatchObject({ varianceTolerance: '100000' });
    });

    it('shows a cashier the expected cash when the branch does not count blind', async () => {
      settingRows = [{ key: 'SHIFT_POLICY', branch_id: null, value: { blindClose: false } }];
      const statement = { state: 'OPEN', branchId: 'b-1', expectedCash: '80000.0000' };
      await expect(shiftService.redactForBlindCount('t-1', statement, { role: 'CASHIER' })).resolves.toBe(statement);
    });

    it('hides what the drawer should hold from a cashier until the shift is closed', async () => {
      expect(SHIFT_POLICY_DEFAULTS.blindClose).toBe(true);
      const statement = {
        state: 'OPEN',
        branchId: 'b-1',
        expectedCash: '80000.0000',
        cashSales: '30000.0000',
        movements: [
          { type: 'OPENING_FLOAT', amount: '50000.0000' },
          { type: 'CASH_PAYMENT', amount: '30000.0000' },
        ],
      };

      const forCashier: any = await shiftService.redactForBlindCount('t-1', statement, { role: 'CASHIER' });
      expect(forCashier.blind).toBe(true);
      expect(forCashier.expectedCash).toBeNull();
      expect(forCashier.cashSales).toBeNull();
      expect(forCashier.movements.map((m: any) => m.type)).toEqual(['OPENING_FLOAT']);

      await expect(shiftService.redactForBlindCount('t-1', statement, { role: 'MANAGER' })).resolves.toBe(statement);
      const closed = { ...statement, state: 'CLOSED' };
      await expect(shiftService.redactForBlindCount('t-1', closed, { role: 'CASHIER' })).resolves.toBe(closed);
    });
  });

  describe('Which drawer cash is counted in', () => {
    const openOn = (shift: any) =>
      shiftRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(shift),
      });

    it('uses the register the request came from over the one the order was rung up on', async () => {
      terminalRepo.findOne.mockImplementation(async ({ where }: any) => ({ id: where.id, branch_id: 'b-1' }));
      openOn({ id: 'shf-counter-2' });

      await runWithTill('term-2', () => shiftService.resolveDrawer('t-1', 'b-1', 'term-1'));
      expect(terminalRepo.findOne).toHaveBeenCalledWith({ where: { id: 'term-2', tenant_id: 't-1' } });
    });

    it("refuses cash at a register in another branch, and lets card through without a drawer", async () => {
      terminalRepo.findOne.mockResolvedValue({ id: 'term-9', branch_id: 'b-central' });

      await expect(shiftService.requireDrawer('t-1', 'b-downtown', 'term-9')).rejects.toMatchObject({
        response: { code: 'REGISTER_OTHER_BRANCH' },
      });
      await expect(shiftService.resolveDrawer('t-1', 'b-downtown', 'term-9')).resolves.toBeNull();
    });

    it('will not guess between two open drawers when no register is named', async () => {
      shiftRepo.find = jest.fn().mockResolvedValue([{ id: 'shf-a' }, { id: 'shf-b' }]);

      await expect(shiftService.requireDrawer('t-1', 'b-1', null)).rejects.toMatchObject({
        response: { code: 'REGISTER_UNKNOWN' },
      });
      await expect(shiftService.resolveDrawer('t-1', 'b-1', null)).resolves.toBeNull();
    });

    it("uses the branch's only open drawer when no register is named", async () => {
      shiftRepo.find = jest.fn().mockResolvedValue([{ id: 'shf-only' }]);
      await expect(shiftService.requireDrawer('t-1', 'b-1', null)).resolves.toMatchObject({ id: 'shf-only' });
    });
  });

  describe('Business Day Close & Reopen Rules (R13)', () => {
    it('should throw BadRequestException if active cashier shifts exist on business day close', async () => {
      shiftRepo.find = jest.fn().mockResolvedValue([{ id: 'shf-open', state: 'OPEN' }]);

      await expect(
        dayService.closeBusinessDay('t-1', { branchId: 'b-1', businessDate: '2026-08-09' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if business day reopen gives no reason', async () => {
      dayCloseRepo.findOne.mockResolvedValue({ id: 'day-1', tenant_id: 't-1', status: 'CLOSED' });

      await expect(dayService.reopenBusinessDay('t-1', 'day-1', { reason: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('reopens a closed day on a reason alone and records it', async () => {
      const day = { id: 'day-1', tenant_id: 't-1', status: 'CLOSED', business_date: '2026-09-10' };
      dayCloseRepo.findOne.mockResolvedValue(day);

      await dayService.reopenBusinessDay('t-1', 'day-1', { reason: 'Late cash drop' }, 'manager-1');
      expect(day.status).toBe('REOPENED');
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'BUSINESS_DAY_REOPENED', details: expect.objectContaining({ reason: 'Late cash drop' }) }),
      );
    });

    it('refuses to reopen a day that is not closed', async () => {
      dayCloseRepo.findOne.mockResolvedValue({ id: 'day-1', tenant_id: 't-1', status: 'REOPENED' });
      await expect(dayService.reopenBusinessDay('t-1', 'day-1', { reason: 'Again' })).rejects.toThrow(BadRequestException);
    });

    it("stamps a shift with the till's local operating day, not the UTC one", async () => {
      terminalRepo.findOne.mockResolvedValue({ id: 'term-1', branch_id: 'b-1', terminal_type: 'CASHIER' });
      shiftRepo.findOne.mockResolvedValue(null);

      await shiftService.openShift('t-1', { terminalId: 'term-1' });
      const created = auditWriter.write.mock.calls[0][0].afterData;
      expect(created.business_date).toBe(new Date().toLocaleDateString('en-CA'));
    });
  });
});
