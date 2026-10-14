import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { BusinessDayService } from '../src/modules/cashier/business-day.service';
import { ShiftsController } from '../src/modules/cashier/shifts.controller';
import { BusinessDaysController } from '../src/modules/cashier/business-days.controller';
import { BRANCH_OWNED_KEY } from '../src/common/decorators/branch-owned.decorator';
import { runWithTill } from '../src/common/utils/till-context';
import { BusinessDateUtil } from '../src/common/utils/business-date.util';
import { BusinessClock } from '../src/common/utils/business-day';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { CashMovement } from '../src/entities/CashMovement.entity';
import { BusinessDayClose } from '../src/entities/BusinessDayClose.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { Payment } from '../src/entities/Payment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
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
  let dayCloseRepo: any;
  let auditWriter: any;
  let transitionRecorder: any;
  let dataSource: any;
  /** SHIFT_POLICY rows the policy lookup finds; none means the defaults. */
  let settingRows: any[];
  /** Open orders the closing till rang up, and cash payments begun at its drawer. */
  let tillOrders: any[];
  let pendingCash: any[];
  /** Orders that have a delivery row (out with a courier, or delivered and not settled). */
  let deliveryOrderIds: string[];

  beforeEach(async () => {
    shiftRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
    movementRepo = { find: jest.fn().mockResolvedValue([]), create: jest.fn(), save: jest.fn() };
    terminalRepo = { findOne: jest.fn() };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    orderRepo = { find: jest.fn().mockResolvedValue([]) };
    dayCloseRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
    auditWriter = { write: jest.fn() };
    transitionRecorder = { record: jest.fn() };

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
      // What the close check reads: the till's open orders, its unfinished cash, the other tills.
      createQueryBuilder: jest.fn(() => {
        const qb: any = {};
        for (const m of ['where', 'andWhere', 'orderBy']) qb[m] = jest.fn(() => qb);
        qb.getMany = jest.fn(async () => tillOrders);
        return qb;
      }),
      query: jest.fn(async (sql: string) => {
        if (sql.includes('order_sequence')) return [{ last_value: 1 }];
        if (sql.includes('FROM payment')) return pendingCash;
        if (sql.includes('FROM delivery')) return deliveryOrderIds.map((order_id) => ({ order_id }));
        return [];
      }),
      count: jest.fn(async () => 1),
    };

    settingRows = [];
    tillOrders = [];
    pendingCash = [];
    deliveryOrderIds = [];
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
        { provide: getRepositoryToken(BusinessDayClose), useValue: dayCloseRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: OrderTransitionRecorder, useValue: transitionRecorder },
        { provide: DataSource, useValue: dataSource },
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
      const service = { getCurrentShift: jest.fn().mockResolvedValue(null) };
      const controller = new ShiftsController(service as any);

      await controller.getCurrentShift(undefined as any, 'b-downtown', { tenantId: 't-1', userBranchId: null } as any);
      expect(service.getCurrentShift).toHaveBeenLastCalledWith('t-1', undefined, 'b-downtown');

      await controller.getCurrentShift(undefined as any, 'b-central', { tenantId: 't-1', userBranchId: 'b-downtown' } as any);
      expect(service.getCurrentShift).toHaveBeenLastCalledWith('t-1', undefined, 'b-downtown');
    });

    it('offers no way to close or reopen a business day by hand: it closes itself', () => {
      const proto: any = BusinessDaysController.prototype;
      expect(proto.closeBusinessDay).toBeUndefined();
      expect(proto.reopenBusinessDay).toBeUndefined();
      expect(proto.getOpenOrders).toBeUndefined();
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

    it('totals courier short and courier over in the statement', async () => {
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', tenant_id: 't-1', state: 'OPEN', currency_code: 'IRR' });
      movementRepo.find.mockResolvedValue([
        { type: 'OPENING_FLOAT', amount: '5000000.0000' },
        { type: 'PAID_OUT', amount: '-2000000.0000' },
        { type: 'PAID_OUT', amount: '-100000.0000' },
        { type: 'PAID_IN', amount: '30000.0000' },
      ]);
      const statement = await shiftService.getShiftStatement('t-1', 'shf-1');
      expect(statement.paidOut).toBe('2100000.0000');
      expect(statement.paidIn).toBe('30000.0000');
      expect(statement.expectedCash).toBe('2930000.0000');
    });

    it('has no manual pay in or pay out left', () => {
      expect((shiftService as any).recordMovement).toBeUndefined();
      const controller = new ShiftsController(shiftService);
      expect((controller as any).recordMovement).toBeUndefined();
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

      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '45000.0000' });
      // Loading the movements relation made the cascade null the new adjustment's shift_id.
      expect(shiftRepo.findOne.mock.calls[0][0].relations).toBeUndefined();
    });
  });

  describe('Closing a shift in one step (R13)', () => {
    it('closes on the count alone, storing the difference as a number and booking it', async () => {
      const shift: any = { id: 'shf-1', tenant_id: 't-1', branch_id: 'b-1', state: 'OPEN' };
      shiftRepo.findOne.mockResolvedValue(shift);
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '50000.0000' }]);

      // Actual 60,000 vs expected 50,000: +10,000 over, no reason and no manager asked for.
      const statement = await shiftService.closeShift('t-1', 'shf-1', { actualCash: '60000.0000' }, 'cashier-1');
      expect(shift.state).toBe('CLOSED');
      expect(shift.expected_cash).toBe('50000.0000');
      expect(shift.short_over).toBe('10000.0000');
      expect(statement.actualCash).toBe('60000.0000');
    });

    it('closes when the count matches the expected cash', async () => {
      const shift: any = { id: 'shf-1', tenant_id: 't-1', state: 'OPEN' };
      shiftRepo.findOne.mockResolvedValue(shift);
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '50000.0000' }]);

      const statement = await shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' });
      expect(shift.state).toBe('CLOSED');
      expect(statement.actualCash).toBe('50000.0000');
    });

    it('refuses to close a shift that is already closed', async () => {
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-1', tenant_id: 't-1', state: 'CLOSED' });
      await expect(shiftService.closeShift('t-1', 'shf-1', { actualCash: '1' })).rejects.toThrow(BadRequestException);
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

  describe('Drawer policy and the shift summary', () => {
    const openShift = () => ({ id: 'shf-1', tenant_id: 't-1', branch_id: 'b-1', state: 'OPEN' });
    beforeEach(() => {
      movementRepo.find.mockResolvedValue([{ type: 'OPENING_FLOAT', amount: '50000.0000' }]);
    });

    it("takes the opening float from the branch's override over head office's", async () => {
      settingRows = [
        { key: 'SHIFT_POLICY', branch_id: null, value: { defaultOpeningFloat: '100000' } },
        { key: 'SHIFT_POLICY', branch_id: 'b-1', value: { defaultOpeningFloat: '250000' } },
      ];

      await expect(shiftService.policyFor('t-1', 'b-1')).resolves.toEqual({ defaultOpeningFloat: '250000' });
      await expect(shiftService.policyFor('t-1', 'b-2')).resolves.toEqual({ defaultOpeningFloat: '100000' });
    });

    it('starts a drawer at zero when nobody has set a float', async () => {
      await expect(shiftService.policyFor('t-1', 'b-1')).resolves.toEqual({ defaultOpeningFloat: '0' });
    });

    describe('the shift summary', () => {
      beforeEach(() => {
        shiftRepo.findOne.mockResolvedValue({ ...openShift(), shift_number: 'SHF-1', opened_at: new Date() });
        movementRepo.find.mockResolvedValue([
          { type: 'OPENING_FLOAT', amount: '50000.0000' },
          { type: 'CASH_PAYMENT', amount: '300000.0000' },
        ]);
        orderRepo.find.mockResolvedValue([
          { state: 'COMPLETED', order_type: 'TAKEAWAY', grand_total: '300000.0000', discount_total: '0', delivery_fee: '0', outstanding_total: '0' },
          { state: 'COMPLETED', order_type: 'DELIVERY', grand_total: '500000.0000', discount_total: '20000.0000', delivery_fee: '40000.0000', outstanding_total: '0' },
          { state: 'CANCELLED', order_type: 'TAKEAWAY', grand_total: '90000.0000', outstanding_total: '0' },
          { state: 'DRAFT', order_type: 'TAKEAWAY', grand_total: '70000.0000', outstanding_total: '70000.0000' },
        ]);
        paymentRepo.find.mockResolvedValue([
          { method_kind: 'CASH', amount: '300000.0000' },
          { method_kind: 'CARD_POS', amount: '200000.0000' },
          { method_kind: 'CARD_POS', amount: '300000.0000' },
        ]);
      });

      it('gives the cashier every figure: orders by type, payments by kind, the drawer', async () => {
        const summary = await shiftService.getSalesSummary('t-1', 'shf-1');

        expect(summary).toMatchObject({ orderCount: 2, cancelledCount: 1, salesTotal: '800000.0000', discountTotal: '20000.0000' });
        expect(summary.byType).toEqual(
          expect.arrayContaining([
            { type: 'TAKEAWAY', count: 1, total: '300000.0000' },
            { type: 'DELIVERY', count: 1, total: '500000.0000' },
          ]),
        );
        expect(summary.tenders).toEqual(
          expect.arrayContaining([
            { kind: 'CASH', count: 1, amount: '300000.0000' },
            { kind: 'CARD_POS', count: 2, amount: '500000.0000' },
          ]),
        );
        expect(summary.cash).toMatchObject({ openingFloat: '50000.0000', expectedCash: '350000.0000', actualCash: null });
      });

      it('shows the count and the difference once the shift is closed', async () => {
        shiftRepo.findOne.mockResolvedValue({ ...openShift(), state: 'CLOSED', shift_number: 'SHF-1', actual_cash: '340000.0000', short_over: '-10000.0000' });

        const summary = await shiftService.getSalesSummary('t-1', 'shf-1');
        expect(summary).toMatchObject({ closed: true, salesTotal: '800000.0000' });
        expect(summary.cash).toMatchObject({ actualCash: '340000.0000', shortOver: '-10000.0000' });
      });
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

    it('refuses to close over an unpaid order or one waiting to be accepted, and lists them', async () => {
      tillOrders = [
        order({ id: 'waiting', state: 'PENDING_ACCEPTANCE' }),
        order({ id: 'owing', outstanding_total: '90000.0000' }),
      ];
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await expect(shiftService.getCloseCheck('t-1', 'shf-1')).resolves.toMatchObject({
        openOrders: [{ id: 'waiting', issue: 'AWAITING_ACCEPTANCE' }, { id: 'owing', issue: 'UNPAID' }],
      });
      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'cashier-1'),
      ).rejects.toMatchObject({
        status: 409,
        response: {
          code: 'SHIFT_HAS_OPEN_ORDERS',
          context: { openOrders: [{ id: 'waiting' }, { id: 'owing' }] },
        },
      });
      expect(shift.state).toBe('OPEN');
    });

    it('holds the close for cash on delivery out with a courier, or delivered and not yet settled', async () => {
      tillOrders = [
        order({ id: 'out', order_type: 'DELIVERY', state: 'OUT_FOR_DELIVERY', outstanding_total: '90000.0000' }),
      ];
      deliveryOrderIds = ['out'];
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await expect(shiftService.getCloseCheck('t-1', 'shf-1')).resolves.toMatchObject({
        openOrders: [{ id: 'out', issue: 'UNPAID', awaitingCourier: true }],
      });
      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'cashier-1'),
      ).rejects.toMatchObject({ response: { code: 'SHIFT_HAS_OPEN_ORDERS' } });
      expect(shift.state).toBe('OPEN');
    });

    it('looks at the whole branch for an order waiting to be accepted, since Snappfood orders carry no register', async () => {
      tillOrders = [order({ id: 'snapp', state: 'PENDING_ACCEPTANCE', channel: 'SNAPPFOOD', terminal_id: null, shift_id: null })];
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'cashier-1'),
      ).rejects.toMatchObject({
        response: { code: 'SHIFT_HAS_OPEN_ORDERS', context: { openOrders: [{ id: 'snapp', issue: 'AWAITING_ACCEPTANCE' }] } },
      });

      // The query is held to the shift's branch and also reads its pending orders from any register.
      const qb = dataSource.manager.createQueryBuilder.mock.results[0].value;
      const clauses = qb.andWhere.mock.calls.map((c: any[]) => String(c[0]));
      expect(clauses.some((c: string) => c.includes('o.branch_id = :branchId'))).toBe(true);
      const pending = qb.andWhere.mock.calls.find((c: any[]) => String(c[0]).includes(':pendingState'));
      expect(pending[1]).toMatchObject({ pendingState: 'PENDING_ACCEPTANCE' });
    });

    it('closes once every order is settled', async () => {
      tillOrders = [];
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'cashier-1');
      expect(shift.state).toBe('CLOSED');
    });

    it('does not hold the close for a paid order the kitchen has not handed over', async () => {
      tillOrders = [order({ state: 'CONFIRMED' })];
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'cashier-1');
      expect(shift.state).toBe('CLOSED');
    });

    it('lists the orders an earlier shift on this register left unpaid, and holds the close for them', async () => {
      tillOrders = [order({ id: 'yesterday', shift_id: 'shf-0', outstanding_total: '90000.0000' })];
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await expect(shiftService.getCloseCheck('t-1', 'shf-1')).resolves.toMatchObject({
        openOrders: [{ id: 'yesterday', issue: 'UNPAID' }],
      });
      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'cashier-1'),
      ).rejects.toMatchObject({ response: { code: 'SHIFT_HAS_OPEN_ORDERS' } });
      expect(shift.state).toBe('OPEN');
    });

    it('keeps what stays in the drawer for the next shift, and hands over the rest', async () => {
      const shift: any = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000', leftInDrawer: '20000' }, 'cashier-1');
      expect(shift.state).toBe('CLOSED');
      expect(shift.left_in_drawer).toBe('20000.0000');
    });

    it('empties the drawer when nothing is said, and refuses to leave more than was counted', async () => {
      const shift: any = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);
      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000', leftInDrawer: '60000' }, 'cashier-1'),
      ).rejects.toMatchObject({ response: { code: 'LEFT_IN_DRAWER_OUT_OF_RANGE' } });
      expect(shift.state).toBe('OPEN');

      await shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'cashier-1');
      expect(shift.left_in_drawer).toBe('0.0000');
    });

    it('offers the next shift what the last close left in the drawer', async () => {
      shiftRepo.findOne.mockResolvedValue({ id: 'shf-0', state: 'CLOSED', left_in_drawer: '0.0000' });
      await expect(shiftService.nextOpeningFloat('t-1', 'term-1')).resolves.toEqual({ amount: '0.0000', source: 'LEFT_IN_DRAWER' });
    });

    it('refuses to close over an unfinished cash payment', async () => {
      pendingCash = [{ id: 'pay-1', paymentNumber: 'PAY-1', orderId: 'o-1', orderNumber: 'ORD-1', amount: '90000.0000', status: 'PENDING' }];
      const shift = openShift();
      shiftRepo.findOne.mockResolvedValue(shift);

      await expect(
        shiftService.closeShift('t-1', 'shf-1', { actualCash: '50000.0000' }, 'cashier-1'),
      ).rejects.toMatchObject({ response: { code: 'SHIFT_HAS_PENDING_CASH', context: { pendingCash } } });
      expect(shift.state).toBe('OPEN');
    });

    it('finds nothing left behind at a clean till', async () => {
      shiftRepo.findOne.mockResolvedValue(openShift());
      await expect(shiftService.getCloseCheck('t-1', 'shf-1')).resolves.toEqual(
        expect.objectContaining({ openOrders: [], pendingCash: [] }),
      );
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

  describe('Business Day Close Rules (R13)', () => {
    it('will not close a day while a cashier shift on it is still open', async () => {
      await expect(dayService.closeBusinessDay('t-1', 'b-1', '2026-08-09')).rejects.toThrow(BadRequestException);
    });

    it('will not close a day that has not ended', async () => {
      await expect(dayService.closeBusinessDay('t-1', 'b-1', BusinessClock.fromConfig().today())).rejects.toThrow(/not ended/);
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
     * revenue orders. `awaitingCourier` names the orders with a delivery still open.
     */
    const dayCloseEm = (open: any[], revenue: any[] = [], awaitingCourier: string[] = []) => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValueOnce(open).mockResolvedValueOnce(revenue),
      };
      const em: any = {
        find: jest.fn(async () => []),
        findOne: jest.fn(async () => null),
        create: jest.fn((_entity: any, data: any) => ({ ...data })),
        save: jest.fn(async (_entity: any, data: any) => data),
        createQueryBuilder: jest.fn(() => qb),
        query: jest.fn(async () => awaitingCourier.map((id) => ({ order_id: id }))),
        count: jest.fn(async () => 0),
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

    it('completes the paid orders and carries over the rest', async () => {
      const orders = [
        order({ id: 'paid-dine-in', order_type: 'DINE_IN' }),
        order({ id: 'unpaid', outstanding_total: '50000.0000' }),
        order({ id: 'snappfood', order_type: 'AGGREGATOR', state: 'PENDING_ACCEPTANCE', status: 'PENDING_ACCEPTANCE' }),
        // Paid, but a courier finishes a delivery; its cash settles off that step.
        order({ id: 'delivery', order_type: 'DELIVERY', state: 'OUT_FOR_DELIVERY', status: 'OUT_FOR_DELIVERY' }),
      ];
      dayCloseEm(orders);

      const closed = await dayService.closeBusinessDay('t-1', 'b-1', '2026-09-10');

      expect(orders.filter((o) => o.state === 'COMPLETED').map((o) => o.id)).toEqual(['paid-dine-in']);
      expect(closed.totals).toMatchObject({ autoCompletedOrders: 1, carriedOverOrders: 3 });
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BUSINESS_DAY_AUTO_CLOSED',
          details: { autoCompletedOrderIds: ['paid-dine-in'], carriedOverOrderIds: ['unpaid', 'snappfood', 'delivery'] },
        }),
      );
    });

    it('carries over a paid Snappfood order still waiting for one of our couriers', async () => {
      const sf = order({ id: 'sf-own', order_type: 'AGGREGATOR', channel: 'AGGREGATOR', aggregator_expedition: 'DELIVERY' });
      dayCloseEm([sf], [], ['sf-own']);

      const closed = await dayService.closeBusinessDay('t-1', 'b-1', '2026-09-10');

      expect(sf.state).toBe('CONFIRMED');
      expect(closed.totals).toMatchObject({ autoCompletedOrders: 0, carriedOverOrders: 1 });
    });

    it('completes the paid orders nobody closed off, and records each', async () => {
      const paid = order({ id: 'paid', order_type: 'DINE_IN', state: 'CONFIRMED', status: 'CONFIRMED' });
      const em = dayCloseEm([paid], [paid]);

      const closed = await dayService.closeBusinessDay('t-1', 'b-1', '2026-09-10');

      expect(paid.state).toBe('COMPLETED');
      expect(transitionRecorder.record).toHaveBeenCalledWith(
        em,
        expect.objectContaining({ order: paid, fromState: 'CONFIRMED', action: 'COMPLETE' }),
      );
      expect(closed.totals).toMatchObject({ orderCount: 1, totalSales: '120000.0000', autoCompletedOrders: 1, carriedOverOrders: 0 });
    });
  });
});
