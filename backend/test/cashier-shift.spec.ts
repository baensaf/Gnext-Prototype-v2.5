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
import { BusinessDateUtil } from '../src/common/utils/business-date.util';
import { BusinessClock } from '../src/common/utils/business-day';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { CashMovement } from '../src/entities/CashMovement.entity';
import { BusinessDayClose } from '../src/entities/BusinessDayClose.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { Payment } from '../src/entities/Payment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { Branch } from '../src/entities/Branch.entity';
import { TableSession } from '../src/entities/TableSession.entity';
import { AuditEvent } from '../src/entities/AuditEvent.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { OrderTransitionRecorder } from '../src/modules/order-lifecycle/order-transition-recorder.service';

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
  let transitionRecorder: any;
  let approvalService: any;
  let dataSource: any;
  /** SHIFT_POLICY rows the policy lookup finds; none means the defaults. */
  let settingRows: any[];
  let auditEvents: any[];
  /** Open orders the closing till rang up, and cash payments begun at its drawer. */
  let tillOrders: any[];
  let pendingCash: any[];

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
    transitionRecorder = { record: jest.fn() };
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
        if (entityClass === AuditEvent) return auditEvents;
        return [];
      }),
      delete: jest.fn(),
      // What the close check reads: the till's open orders, its unfinished cash, the other tills.
      createQueryBuilder: jest.fn(() => {
        const qb: any = {};
        for (const m of ['where', 'andWhere', 'orderBy']) qb[m] = jest.fn(() => qb);
        qb.getMany = jest.fn(async () => tillOrders);
        return qb;
      }),
      query: jest.fn(async (sql: string) => (sql.includes('FROM payment') ? pendingCash : [])),
      count: jest.fn(async () => 1),
    };

    settingRows = [];
    auditEvents = [];
    tillOrders = [];
    pendingCash = [];
    dataSource = {
      transaction: jest.fn(async (cb) => await cb(mockEntityManager)),
      manager: mockEntityManager,
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
        { provide: OrderTransitionRecorder, useValue: transitionRecorder },
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

    it('posts a safe drop as cash leaving the drawer, and totals it apart from pay-outs', async () => {
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', tenant_id: 't-1', state: 'OPEN', currency_code: 'IRR' });
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '5000000.0000' }]);
      const saved = await shiftService.recordMovement('t-1', 'shf-1', { type: 'SAFE_DROP', amount: '2000000' });
      expect(saved.amount).toBe('-2000000.0000');

      movementRepo.find.mockResolvedValue([
        { type: 'OPENING_FLOAT', amount: '5000000.0000' },
        { type: 'SAFE_DROP', amount: '-2000000.0000' },
        { type: 'PAID_OUT', amount: '-100000.0000' },
      ]);
      const statement = await shiftService.getShiftStatement('t-1', 'shf-1');
      expect(statement.safeDrops).toBe('2000000.0000');
      expect(statement.paidOut).toBe('100000.0000');
      expect(statement.expectedCash).toBe('2900000.0000');
    });

    it('refuses a pay-out with no reason', async () => {
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', tenant_id: 't-1', state: 'OPEN', currency_code: 'IRR' });
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '5000000.0000' }]);
      await expect(shiftService.recordMovement('t-1', 'shf-1', { type: 'PAID_OUT', amount: '50000' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        shiftService.recordMovement('t-1', 'shf-1', { type: 'PAID_OUT', amount: '50000', reason: 'Milk for the kitchen' }),
      ).resolves.toMatchObject({ amount: '-50000.0000' });
    });

    it('refuses taking more cash out than the drawer holds', async () => {
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', tenant_id: 't-1', state: 'OPEN', currency_code: 'IRR' });
      movementRepo.find.mockResolvedValue([
        { type: 'OPENING_FLOAT', amount: '5000000.0000' },
        { type: 'CASH_PAYMENT', amount: '1000000.0000' },
      ]);
      await expect(
        shiftService.recordMovement('t-1', 'shf-1', { type: 'PAID_OUT', amount: '6000001', reason: 'Too much' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        shiftService.recordMovement('t-1', 'shf-1', { type: 'SAFE_DROP', amount: '6000000' }),
      ).resolves.toMatchObject({ amount: '-6000000.0000' });
    });

    it('holds a blind count to the first figure given, unless a manager recounts', async () => {
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', tenant_id: 't-1', branch_id: 'b-1', state: 'CLOSING_REVIEW' });
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '50000.0000' }]);
      auditEvents = [{ action: 'SHIFT_COUNT_SUBMITTED', details: { actualCash: '45000.0000' } }];

      // Typing in the expected figure after seeing it is refused...
      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000' }, 'u-cashier', 'c', { role: 'CASHIER' }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BLIND_COUNT_RECORDED' }) });
      // ...the recorded count closes with its reason...
      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '45000', reason: 'Short' }, 'u-cashier', 'c', { role: 'CASHIER' }),
      ).resolves.toBeDefined();
      // ...and a return to open starts a fresh count.
      auditEvents = [...auditEvents, { action: 'SHIFT_RETURN_TO_OPEN', details: null }];
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', tenant_id: 't-1', branch_id: 'b-1', state: 'CLOSING_REVIEW' });
      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000' }, 'u-cashier', 'c', { role: 'CASHIER' }),
      ).resolves.toBeDefined();
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

  describe('What a till leaves behind at close', () => {
    const openShift = () => ({ id: 'shf-1', tenant_id: 't-1', branch_id: 'b-1', terminal_id: 'term-1', state: 'OPEN' });
    const order = (over: any) => ({
      id: 'o-1',
      order_number: 'ORD-1',
      order_type: 'TAKEAWAY',
      state: 'CONFIRMED',
      outstanding_total: '0.0000',
      grand_total: '90000.0000',
      business_date: '2026-09-23',
      ...over,
    });
    beforeEach(() => {
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '50000.0000' }]);
    });

    it('needs a manager PIN to leave held or unpaid orders open, before any count is taken', async () => {
      tillOrders = [order({ id: 'held', state: 'DRAFT' }), order({ id: 'owing', outstanding_total: '90000.0000' })];
      shiftRepo.findOne.mockResolvedValue(openShift());

      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'cashier-1', undefined, { role: 'CASHIER' }),
      ).rejects.toMatchObject({
        response: {
          code: 'SHIFT_HAS_OPEN_ORDERS',
          context: { openOrders: [{ id: 'held', issue: 'NOT_SUBMITTED' }, { id: 'owing', issue: 'UNPAID' }] },
        },
      });
      expect(auditWriter.write).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'SHIFT_COUNT_SUBMITTED' }));

      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);
      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000', openOrdersPin: '2468' }, 'cashier-1', undefined, { role: 'CASHIER' });
      expect(approvalService.verifyApproverPin).toHaveBeenCalledWith('t-1', '2468', 'SHIFT_CLOSE_OPEN_ORDERS', 'cashier-1', 'b-1');
      expect(shift.state).toBe('CLOSED');
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SHIFT_CLOSED',
          details: { openOrderIds: ['held', 'owing'], openOrdersApprovedBy: 'manager-1' },
        }),
      );
    });

    it('does not hold the close for a paid order the kitchen has not handed over', async () => {
      tillOrders = [order({ state: 'READY' })];
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'cashier-1', undefined, { role: 'CASHIER' });
      expect(shift.state).toBe('CLOSED');
      expect(approvalService.verifyApproverPin).not.toHaveBeenCalled();
    });

    it('lets a manager leave orders open on their own authority', async () => {
      tillOrders = [order({ outstanding_total: '90000.0000' })];
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'manager-1', undefined, { role: 'MANAGER' });
      expect(approvalService.verifyApproverPin).not.toHaveBeenCalled();
      expect(shift.state).toBe('CLOSED');
    });

    it('refuses to close over an unfinished cash payment, even for a manager', async () => {
      pendingCash = [{ id: 'pay-1', paymentNumber: 'PAY-1', orderId: 'o-1', orderNumber: 'ORD-1', amount: '90000.0000', status: 'PENDING' }];
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000', openOrdersPin: '2468' }, 'manager-1', undefined, { role: 'MANAGER' }),
      ).rejects.toMatchObject({ response: { code: 'SHIFT_HAS_PENDING_CASH', context: { pendingCash } } });
      expect(shift.state).toBe('OPEN');
    });

    it('says whether this was the last till open at the branch', async () => {
      shiftRepo.findOne.mockResolvedValue(openShift());
      await expect(shiftService.getCloseCheck('t-1', 'shf-1')).resolves.toMatchObject({
        openOrders: [],
        pendingCash: [],
        otherOpenTills: 0,
        dayClosed: false,
      });
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
      // The business clock (Tehran), not the machine's: CI runs in UTC, where the two dates
      // differ every evening from 20:30 until midnight UTC.
      expect(created.business_date).toBe(BusinessClock.fromConfig().today());
    });
  });

  describe('Open orders at business day close', () => {
    /**
     * An EntityManager for the close: its first query finds `open`, the second the day's
     * revenue orders, and `sessions` are the seated tables it can free. `awaitingCourier` names
     * the orders with a delivery still open.
     */
    const dayCloseEm = (open: any[], revenue: any[] = [], sessions: any[] = [], awaitingCourier: string[] = []) => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValueOnce(open).mockResolvedValueOnce(revenue),
      };
      const em: any = {
        find: jest.fn(async (entity: any) => (entity === TableSession ? sessions : [])),
        findOne: jest.fn(async () => null),
        create: jest.fn((_entity: any, data: any) => ({ ...data })),
        save: jest.fn(async (_entity: any, data: any) => data),
        createQueryBuilder: jest.fn(() => qb),
        query: jest.fn(async () => awaitingCourier.map((id) => ({ order_id: id }))),
      };
      dataSource.transaction.mockImplementation(async (cb: any) => cb(em));
      dataSource.manager = em;
      return em;
    };

    const order = (overrides: any) => ({
      id: 'ord-x',
      order_number: 'ORD-1',
      order_type: 'TAKEAWAY',
      channel: 'POS',
      state: 'CONFIRMED',
      status: 'CONFIRMED',
      outstanding_total: '0.0000',
      grand_total: '120000.0000',
      business_date: '2026-09-10',
      placed_at: new Date('2026-09-10T12:00:00Z'),
      ...overrides,
    });

    it('sorts the open orders into those the close completes and those it waits on', async () => {
      dayCloseEm([
        order({ id: 'paid-dine-in', order_type: 'DINE_IN', table_id: 'tbl-1' }),
        order({ id: 'unpaid', outstanding_total: '50000.0000' }),
        order({ id: 'draft', state: 'DRAFT', status: 'DRAFT' }),
        order({ id: 'snappfood', order_type: 'AGGREGATOR', state: 'PENDING_ACCEPTANCE', status: 'PENDING_ACCEPTANCE' }),
        order({ id: 'delivery', order_type: 'DELIVERY', state: 'OUT_FOR_DELIVERY', status: 'OUT_FOR_DELIVERY' }),
      ]);

      const result = await dayService.getOpenOrders('t-1', { branchId: 'b-1', businessDate: '2026-09-10' });

      expect(result.toComplete.map((o) => o.id)).toEqual(['paid-dine-in']);
      expect(result.needsDecision.map((o) => [o.id, o.issue])).toEqual([
        ['unpaid', 'UNPAID'],
        ['draft', 'NOT_SUBMITTED'],
        ['snappfood', 'AWAITING_ACCEPTANCE'],
        // Paid, but a courier finishes a delivery; its cash settles off that step.
        ['delivery', 'DELIVERY_NOT_FINISHED'],
      ]);
    });

    it('waits on a paid Snappfood order still waiting for one of our couriers', async () => {
      dayCloseEm(
        [order({ id: 'sf-own', order_type: 'AGGREGATOR', channel: 'AGGREGATOR', aggregator_expedition: 'DELIVERY' })],
        [],
        [],
        ['sf-own'],
      );

      const result = await dayService.getOpenOrders('t-1', { branchId: 'b-1', businessDate: '2026-09-10' });

      expect(result.toComplete).toEqual([]);
      expect(result.needsDecision.map((o) => [o.id, o.issue])).toEqual([['sf-own', 'DELIVERY_NOT_FINISHED']]);
    });

    it('will not close the day while an order still owes money, and completes nothing', async () => {
      const paid = order({ id: 'paid' });
      const em = dayCloseEm([paid, order({ id: 'unpaid', outstanding_total: '50000.0000' })]);

      await expect(
        dayService.closeBusinessDay('t-1', { branchId: 'b-1', businessDate: '2026-09-10' }),
      ).rejects.toMatchObject({
        response: {
          code: 'OPEN_ORDERS_NEED_DECISION',
          context: { needsDecision: [expect.objectContaining({ id: 'unpaid', issue: 'UNPAID' })] },
        },
      });
      expect(paid.state).toBe('CONFIRMED');
      expect(transitionRecorder.record).not.toHaveBeenCalled();
      expect(em.save).not.toHaveBeenCalledWith(BusinessDayClose, expect.anything());
    });

    it('completes the paid orders nobody closed off, frees their tables, and records each', async () => {
      const paid = order({ id: 'paid', order_type: 'DINE_IN', table_id: 'tbl-1', state: 'READY', status: 'READY' });
      const session: any = { id: 'sess-1', table_id: 'tbl-1', closed_at: null, status: 'OCCUPIED' };
      const em = dayCloseEm([paid], [paid], [session]);

      const closed = await dayService.closeBusinessDay('t-1', { branchId: 'b-1', businessDate: '2026-09-10' }, 'manager-1');

      expect(paid.state).toBe('COMPLETED');
      expect(session.closed_at).toBeInstanceOf(Date);
      expect(transitionRecorder.record).toHaveBeenCalledWith(
        em,
        expect.objectContaining({ order: paid, fromState: 'READY', action: 'COMPLETE', userId: 'manager-1' }),
      );
      expect(closed.totals).toMatchObject({ orderCount: 1, totalSales: '120000.0000', autoCompletedOrders: 1, carriedOverOrders: 0 });
    });

    it('closes with unfinished orders carried over when the manager gives a reason', async () => {
      const unpaid = order({ id: 'unpaid', outstanding_total: '50000.0000' });
      dayCloseEm([unpaid]);

      const closed = await dayService.closeBusinessDay(
        't-1',
        { branchId: 'b-1', businessDate: '2026-09-10', carryOverReason: 'Customer pays tomorrow' },
        'manager-1',
      );

      expect(unpaid.state).toBe('CONFIRMED');
      expect(closed.totals).toMatchObject({ carriedOverOrders: 1, carryOverReason: 'Customer pays tomorrow' });
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BUSINESS_DAY_CLOSED',
          details: expect.objectContaining({ carriedOverOrderIds: ['unpaid'] }),
        }),
      );
    });

    it('does not take a blank reason as a decision to carry orders over', async () => {
      dayCloseEm([order({ id: 'draft', state: 'DRAFT', status: 'DRAFT' })]);

      await expect(
        dayService.closeBusinessDay('t-1', { branchId: 'b-1', businessDate: '2026-09-10', carryOverReason: '   ' }),
      ).rejects.toMatchObject({ response: { code: 'OPEN_ORDERS_NEED_DECISION' } });
    });

    it("keeps the open-order check to managers, and a branch account to its own branch", async () => {
      expect(Reflect.getMetadata(ROLES_KEY, BusinessDaysController.prototype.getOpenOrders)).toEqual(MANAGER_AND_ABOVE);

      const service = { getOpenOrders: jest.fn().mockResolvedValue({ toComplete: [], needsDecision: [] }) };
      const controller = new BusinessDaysController(service as any);
      await controller.getOpenOrders(
        { branchId: 'b-central', businessDate: '2026-09-10' },
        { tenantId: 't-1', userBranchId: 'b-downtown' } as any,
      );
      expect(service.getOpenOrders).toHaveBeenCalledWith('t-1', expect.objectContaining({ branchId: 'b-downtown' }));
    });
  });
});
