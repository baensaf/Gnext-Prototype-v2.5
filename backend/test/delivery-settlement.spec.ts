import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryService } from '../src/modules/delivery/delivery.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Courier } from '../src/entities/Courier.entity';
import { DeliveryAssignment } from '../src/entities/DeliveryAssignment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { CourierSettlement } from '../src/entities/CourierSettlement.entity';
import { CourierSettlementLine } from '../src/entities/CourierSettlementLine.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { ApprovalRequest } from '../src/entities/ApprovalRequest.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { OrderTransitionRecorder } from '../src/modules/order-lifecycle/order-transition-recorder.service';
import { ShiftService } from '../src/modules/cashier/shift.service';
import { CashMovement } from '../src/entities/CashMovement.entity';
import { ConflictException, BadRequestException } from '@nestjs/common';

import { DeliveryZone } from '../src/entities/DeliveryZone.entity';
import { CourierAttendance } from '../src/entities/CourierAttendance.entity';
import { CourierTerminalAssignment } from '../src/entities/CourierTerminalAssignment.entity';
import { Delivery } from '../src/entities/Delivery.entity';
import { DeliveryEvent } from '../src/entities/DeliveryEvent.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { CustomerAddress } from '../src/entities/CustomerAddress.entity';
import { Branch } from '../src/entities/Branch.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';

describe('DeliveryService (Courier Settlement)', () => {
  let service: DeliveryService;
  let courierRepo: any;
  let assignmentRepo: any;
  let orderRepo: any;
  let settlementRepo: any;
  let settlementLineRepo: any;
  let paymentRepo: any;
  let paymentMethodRepo: any;
  let approvalRepo: any;
  let zoneRepo: any;
  let attendanceRepo: any;
  let terminalAssignRepo: any;
  let deliveryRepo: any;
  let deliveryEventRepo: any;
  let terminalRepo: any;
  let auditWriter: any;
  let em: any;
  let shiftService: any;

  beforeEach(async () => {
    courierRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    assignmentRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    // Closing a batch posts payments inside one transaction; this manager hands the test its EntityManager.
    em = {
      findOne: jest.fn(),
      save: jest.fn((_entity: any, obj: any) => Promise.resolve(obj)),
      create: jest.fn((_entity: any, obj: any) => ({ ...obj })),
    };
    orderRepo = { findOne: jest.fn(), save: jest.fn(), manager: { transaction: jest.fn((cb: any) => cb(em)) } };
    shiftService = {
      requireDrawer: jest.fn().mockResolvedValue({ id: 'shift-1', currency_code: 'IRR' }),
      recordCashPaymentMovement: jest.fn().mockResolvedValue({}),
    };
    settlementRepo = { findOne: jest.fn(), find: jest.fn(), count: jest.fn(), create: jest.fn(), save: jest.fn() };
    settlementLineRepo = { findOne: jest.fn(), find: jest.fn(), count: jest.fn(), create: jest.fn(), save: jest.fn() };
    paymentRepo = { find: jest.fn(), count: jest.fn().mockResolvedValue(0) };
    paymentMethodRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([
        { id: 'pm-cash', kind: 'CASH' },
        { id: 'pm-mpos', kind: 'MOBILE_POS' },
      ]),
    };
    approvalRepo = { findOne: jest.fn() };
    zoneRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    attendanceRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    terminalAssignRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    deliveryRepo = { findOne: jest.fn(), find: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn(), save: jest.fn() };
    deliveryEventRepo = { create: jest.fn(), save: jest.fn() };
    terminalRepo = { findOne: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryService,
        { provide: getRepositoryToken(Courier), useValue: courierRepo },
        { provide: getRepositoryToken(DeliveryAssignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(CourierSettlement), useValue: settlementRepo },
        { provide: getRepositoryToken(CourierSettlementLine), useValue: settlementLineRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(PaymentMethod), useValue: paymentMethodRepo },
        { provide: getRepositoryToken(ApprovalRequest), useValue: approvalRepo },
        { provide: getRepositoryToken(DeliveryZone), useValue: zoneRepo },
        { provide: getRepositoryToken(CourierAttendance), useValue: attendanceRepo },
        { provide: getRepositoryToken(CourierTerminalAssignment), useValue: terminalAssignRepo },
        { provide: getRepositoryToken(Delivery), useValue: deliveryRepo },
        { provide: getRepositoryToken(DeliveryEvent), useValue: deliveryEventRepo },
        { provide: getRepositoryToken(Terminal), useValue: terminalRepo },
        {
          provide: getRepositoryToken(CustomerAddress),
          useValue: { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) },
        },
        // Only the chain roll-up reads branches; nothing under test here does.
        { provide: getRepositoryToken(Branch), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(TenantSetting), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: OrderTransitionRecorder, useValue: { record: jest.fn() } },
        { provide: ShiftService, useValue: shiftService },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
  });

  // The courier owes what the customer still owed: cash, less the part they put on the
  // mobile card reader. A card taken at the counter before dispatch is not theirs to return.
  it('expects back the unpaid balance, split into cash and mobile POS as the courier declared', async () => {
    courierRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'Courier 1', code: 'C01' });
    assignmentRepo.find.mockResolvedValue([
      { id: 'asgn-1', order_id: 'ord-1', courier_id: 'c-1', status: 'DELIVERED', delivery_fee: '10.00', is_settled: false },
      { id: 'asgn-2', order_id: 'ord-2', courier_id: 'c-1', status: 'DELIVERED', delivery_fee: '15.00', is_settled: false },
      { id: 'asgn-3', order_id: 'ord-3', courier_id: 'c-1', status: 'DELIVERED', delivery_fee: '15.00', is_settled: false },
    ]);
    settlementLineRepo.findOne.mockResolvedValue(null);

    orderRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.id === 'ord-1') return Promise.resolve({ id: 'ord-1', order_number: 'ORD-1001', total_amount: '100.00', outstanding_total: '100.00' });
      if (where.id === 'ord-2') return Promise.resolve({ id: 'ord-2', order_number: 'ORD-1002', total_amount: '200.00', outstanding_total: '200.00' });
      // Paid by card at the counter before it left: the courier brings nothing back.
      if (where.id === 'ord-3') return Promise.resolve({ id: 'ord-3', order_number: 'ORD-1003', total_amount: '500.00', outstanding_total: '0.0000' });
      return Promise.resolve(null);
    });
    deliveryRepo.findOne.mockImplementation(({ where }: any) =>
      Promise.resolve(where.order_id === 'ord-2' ? { order_id: 'ord-2', mobile_pos_expected: '200.0000' } : { order_id: where.order_id, mobile_pos_expected: '0.0000' }),
    );

    const preview = await service.previewSettlement('t-1', 'c-1');

    expect(preview.line_count).toBe(3);
    expect(preview.expected_cash_amount).toBe('100.00');
    expect(preview.expected_pos_amount).toBe('200.00');
    expect(preview.net_settlement_amount).toBe('300.00');
  });

  it('should throw ConflictException if trying to include an already settled delivery assignment', async () => {
    courierRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'Courier 1' });
    assignmentRepo.find.mockResolvedValue([
      { id: 'asgn-settled', order_id: 'ord-1', courier_id: 'c-1', is_settled: true },
    ]);

    await expect(service.previewSettlement('t-1', 'c-1', ['asgn-settled'])).rejects.toThrow(ConflictException);
  });

  it("deducts the couriers' pay already priced on each attempt, and expects no cash from a failed ride", async () => {
    courierRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'Courier 1', code: 'C01' });
    assignmentRepo.find.mockResolvedValue([
      { id: 'asgn-done', order_id: 'ord-1', courier_id: 'c-1', status: 'DELIVERED', delivery_fee: '10.00', compensation_amount: '30.00', is_settled: false },
      { id: 'asgn-failed', order_id: 'ord-2', courier_id: 'c-1', status: 'FAILED', delivery_fee: '10.00', compensation_amount: '12.00', is_settled: false },
    ]);
    orderRepo.findOne.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, total_amount: '100.00', outstanding_total: '100.00' }));
    paymentRepo.find.mockResolvedValue([{ payment_method_code: 'CASH', amount: '100.00' }]);
    settlementRepo.create.mockImplementation((dto: any) => dto);
    settlementRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'settle-1' }));
    settlementLineRepo.create.mockImplementation((dto: any) => dto);
    settlementLineRepo.save.mockImplementation((dto: any) => Promise.resolve(dto));
    assignmentRepo.findOne.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'asgn-done'
        ? { id: 'asgn-done', order_id: 'ord-1', status: 'DELIVERED', delivery_fee: '10.00' }
        : { id: 'asgn-failed', order_id: 'ord-2', status: 'FAILED', delivery_fee: '10.00' }),
    );

    const preview = await service.previewSettlement('t-1', 'c-1');
    expect(preview.expected_cash_amount).toBe('100.00');
    expect(preview.total_compensation_amount).toBe('42.00');
    expect(preview.net_settlement_amount).toBe('58.00');

    const batch = await service.createSettlement('t-1', 'user-1', { courier_id: 'c-1', branch_id: 'b-1' });
    expect(batch.total_compensation_amount).toBe('42.00');
    expect(batch.net_settlement_amount).toBe('58.00');
    expect(batch.lines.find((l: any) => l.delivery_assignment_id === 'asgn-failed').expected_cash).toBe('0.00');
  });

  it('leaves settled deliveries out of a preview that names none, so a courier can be settled again', async () => {
    courierRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'Courier 1', code: 'C01' });
    assignmentRepo.find.mockResolvedValue([
      { id: 'asgn-old', order_id: 'ord-1', courier_id: 'c-1', status: 'DELIVERED', delivery_fee: '10.00', is_settled: true },
      { id: 'asgn-new', order_id: 'ord-2', courier_id: 'c-1', status: 'DELIVERED', delivery_fee: '15.00', is_settled: false },
    ]);
    orderRepo.findOne.mockResolvedValue({ id: 'ord-2', order_number: 'ORD-1002', total_amount: '200.00' });
    paymentRepo.find.mockResolvedValue([]);

    const preview = await service.previewSettlement('t-1', 'c-1');

    expect(preview.assignment_ids).toEqual(['asgn-new']);
    expect(preview.lines).toHaveLength(1);
  });

  it('settles only the deliveries the branch sold, so a courier who moved still owes the old shop', async () => {
    courierRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'Courier 1', code: 'C01', branch_id: 'b-new' });
    assignmentRepo.find.mockResolvedValue([
      { id: 'asgn-old-shop', order_id: 'ord-old', courier_id: 'c-1', status: 'DELIVERED', delivery_fee: '10.00', is_settled: false },
      { id: 'asgn-new-shop', order_id: 'ord-new', courier_id: 'c-1', status: 'DELIVERED', delivery_fee: '15.00', is_settled: false },
    ]);
    orderRepo.findOne.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.id === 'ord-old'
          ? { id: 'ord-old', branch_id: 'b-old', total_amount: '100.00', outstanding_total: '100.00' }
          : { id: 'ord-new', branch_id: 'b-new', total_amount: '200.00' },
      ),
    );
    paymentRepo.find.mockResolvedValue([]);

    const preview = await service.previewSettlement('t-1', 'c-1', undefined, 'b-old');

    expect(preview.assignment_ids).toEqual(['asgn-old-shop']);
    expect(preview.expected_cash_amount).toBe('100.00');
  });

  it('should create a DRAFT courier settlement batch', async () => {
    courierRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'Courier 1', code: 'C01', branch_id: 'b-1' });
    assignmentRepo.find.mockResolvedValue([
      { id: 'asgn-1', order_id: 'ord-1', courier_id: 'c-1', status: 'DELIVERED', delivery_fee: '10.00', is_settled: false },
    ]);
    assignmentRepo.findOne.mockResolvedValue({ id: 'asgn-1', order_id: 'ord-1', courier_id: 'c-1', status: 'DELIVERED', delivery_fee: '10.00', is_settled: false });
    settlementLineRepo.findOne.mockResolvedValue(null);
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', order_number: 'ORD-1001', total_amount: '100.00', outstanding_total: '100.00' });
    paymentRepo.find.mockResolvedValue([{ payment_method_id: 'pm-cash', amount: '100.00' }]);
    paymentMethodRepo.findOne.mockResolvedValue({ id: 'pm-cash', kind: 'CASH', code: 'CASH' });

    settlementRepo.create.mockImplementation((dto: any) => dto);
    settlementRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'settle-1' }));
    settlementLineRepo.create.mockImplementation((dto: any) => dto);
    settlementLineRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'line-1' }));

    const result = await service.createSettlement('t-1', 'user-1', { courier_id: 'c-1' });

    expect(result.status).toBe('DRAFT');
    expect(result.expected_cash_amount).toBe('100.00');
    expect(result.lines.length).toBe(1);
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'COURIER_SETTLEMENT_CREATED' }));
  });

  it('should calculate cash and POS discrepancy on settlement update', async () => {
    const settlement = {
      id: 'settle-1',
      tenant_id: 't-1',
      status: 'DRAFT',
      expected_cash_amount: '100.00',
      actual_cash_amount: '100.00',
      expected_pos_amount: '200.00',
      actual_pos_amount: '200.00',
      cash_discrepancy_amount: '0.00',
      pos_discrepancy_amount: '0.00',
      total_compensation_amount: '0.00',
      total_adjustment_amount: '0.00',
      net_settlement_amount: '300.00',
    };
    settlementRepo.findOne.mockResolvedValue(settlement);
    settlementLineRepo.find.mockResolvedValue([]);
    settlementRepo.save.mockImplementation((s: any) => Promise.resolve(s));

    const updated = await service.updateSettlement('t-1', 'settle-1', {
      actual_cash_amount: 90,
      actual_pos_amount: 200,
      total_compensation_amount: 5,
    });

    expect(updated.cash_discrepancy_amount).toBe('-10.00');
    expect(updated.pos_discrepancy_amount).toBe('0.00');
    expect(updated.net_settlement_amount).toBe('285.00');
  });

  it('should require approval when closing settlement with a discrepancy', async () => {
    const settlement = {
      id: 'settle-1',
      tenant_id: 't-1',
      status: 'UNDER_REVIEW',
      cash_discrepancy_amount: '-10.00',
      pos_discrepancy_amount: '0.00',
    };
    settlementRepo.findOne.mockResolvedValue(settlement);
    approvalRepo.findOne.mockResolvedValue(null);

    await expect(service.closeSettlement('t-1', 'settle-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('should close settlement when approved and mark delivery assignments as settled', async () => {
    const settlement = {
      id: 'settle-1',
      tenant_id: 't-1',
      status: 'UNDER_REVIEW',
      cash_discrepancy_amount: '0.00',
      pos_discrepancy_amount: '0.00',
    };
    settlementRepo.findOne.mockResolvedValue(settlement);
    settlementLineRepo.find.mockResolvedValue([{ id: 'line-1', delivery_assignment_id: 'asgn-1' }]);

    em.findOne.mockResolvedValue({ id: 'asgn-1', is_settled: false, settlement_id: null });

    const closed = await service.closeSettlement('t-1', 'settle-1', 'user-1');

    expect(closed.status).toBe('CLOSED');
    expect(em.save).toHaveBeenCalledWith(DeliveryAssignment, expect.objectContaining({ is_settled: true, settlement_id: 'settle-1' }));
    // Nothing was owed on these lines, so no drawer is needed and nothing is paid.
    expect(shiftService.requireDrawer).not.toHaveBeenCalled();
    expect(em.save).not.toHaveBeenCalledWith(Payment, expect.anything());
  });

  // The audit (F10) closed a batch for a 565,000 cash-on-delivery order and the order still
  // owed 565,000 afterwards, with no payment and the cash in no drawer.
  describe('closing a batch receives the money the courier collected', () => {
    const codOrder = () => ({
      id: 'ord-cod',
      tenant_id: 't-1',
      order_number: 'ORD-COD',
      state: 'OUT_FOR_DELIVERY',
      currency_code: 'IRR',
      business_date: '2026-09-16',
      grand_total: '565000.0000',
      paid_total: '0.0000',
      outstanding_total: '565000.0000',
    });
    let order: any;

    beforeEach(() => {
      order = codOrder();
      settlementLineRepo.find.mockResolvedValue([
        { id: 'line-1', delivery_assignment_id: 'asgn-1', order_id: 'ord-cod', delivery_status: 'DELIVERED', expected_cash: '565000.00', expected_pos: '0.00' },
      ]);
      orderRepo.findOne.mockResolvedValue(codOrder());
      courierRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'Ali Rezaei' });
      em.findOne.mockImplementation((entity: any) =>
        Promise.resolve(entity === OrderHeader ? order : { id: 'asgn-1', is_settled: false }),
      );
    });

    it('pays the order in full, puts the cash in the drawer, and completes the order', async () => {
      settlementRepo.findOne.mockResolvedValue({
        id: 'settle-1', tenant_id: 't-1', branch_id: 'b-1', courier_id: 'c-1', settlement_number: 'SET-1',
        status: 'UNDER_REVIEW', actual_cash_amount: '565000.00', cash_discrepancy_amount: '0.00', pos_discrepancy_amount: '0.00',
      });

      await service.closeSettlement('t-1', 'settle-1', 'user-1');

      expect(shiftService.requireDrawer).toHaveBeenCalledWith('t-1', 'b-1', null);
      expect(em.save).toHaveBeenCalledWith(Payment, expect.objectContaining({ method_kind: 'CASH', amount: '565000.0000', status: 'SUCCEEDED', shift_id: 'shift-1', reference: 'SET-1' }));
      expect(shiftService.recordCashPaymentMovement).toHaveBeenCalledWith('t-1', 'shift-1', undefined, '565000.0000', 'user-1', em);
      expect(order).toEqual(expect.objectContaining({ paid_total: '565000.0000', outstanding_total: '0.0000', state: 'COMPLETED' }));
      expect(em.save).not.toHaveBeenCalledWith(CashMovement, expect.anything());
    });

    it("records a shortage against the courier's handover, not as money the customer still owes", async () => {
      settlementRepo.findOne.mockResolvedValue({
        id: 'settle-1', tenant_id: 't-1', branch_id: 'b-1', courier_id: 'c-1', settlement_number: 'SET-1',
        status: 'UNDER_REVIEW', actual_cash_amount: '500000.00', cash_discrepancy_amount: '-65000.00', pos_discrepancy_amount: '0.00',
      });
      approvalRepo.findOne.mockResolvedValue({ id: 'apr-1', status: 'APPROVED' });

      await service.closeSettlement('t-1', 'settle-1', 'user-1', 'apr-1');

      expect(order).toEqual(expect.objectContaining({ outstanding_total: '0.0000', state: 'COMPLETED' }));
      expect(em.save).toHaveBeenCalledWith(
        CashMovement,
        expect.objectContaining({ shift_id: 'shift-1', type: 'PAID_OUT', amount: '-65000.0000', reason_text: 'Courier Ali Rezaei short on SET-1' }),
      );
    });

    it('books the part taken on the mobile card reader as mobile POS, not cash', async () => {
      settlementLineRepo.find.mockResolvedValue([
        { id: 'line-1', delivery_assignment_id: 'asgn-1', order_id: 'ord-cod', delivery_status: 'DELIVERED', expected_cash: '65000.00', expected_pos: '500000.00' },
      ]);
      settlementRepo.findOne.mockResolvedValue({
        id: 'settle-1', tenant_id: 't-1', branch_id: 'b-1', courier_id: 'c-1', settlement_number: 'SET-1',
        status: 'UNDER_REVIEW', actual_cash_amount: '65000.00', cash_discrepancy_amount: '0.00', pos_discrepancy_amount: '0.00',
      });

      await service.closeSettlement('t-1', 'settle-1', 'user-1');

      expect(em.save).toHaveBeenCalledWith(Payment, expect.objectContaining({ method_kind: 'MOBILE_POS', amount: '500000.0000' }));
      expect(em.save).toHaveBeenCalledWith(Payment, expect.objectContaining({ method_kind: 'CASH', amount: '65000.0000' }));
      expect(order.state).toBe('COMPLETED');
    });

    it('refuses to close without an open drawer to take the cash', async () => {
      settlementRepo.findOne.mockResolvedValue({
        id: 'settle-1', tenant_id: 't-1', branch_id: 'b-1', courier_id: 'c-1', settlement_number: 'SET-1',
        status: 'UNDER_REVIEW', actual_cash_amount: '565000.00', cash_discrepancy_amount: '0.00', pos_discrepancy_amount: '0.00',
      });
      shiftService.requireDrawer.mockRejectedValue(new ConflictException({ code: 'NO_OPEN_SHIFT' }));

      await expect(service.closeSettlement('t-1', 'settle-1', 'user-1')).rejects.toThrow(ConflictException);
      expect(orderRepo.manager.transaction).not.toHaveBeenCalled();
    });
  });

  it('will not reverse a batch whose collections were already paid onto the orders', async () => {
    settlementRepo.findOne.mockResolvedValue({ id: 'settle-1', tenant_id: 't-1', status: 'CLOSED', settlement_number: 'SET-1' });
    paymentRepo.count.mockResolvedValue(1);

    await expect(service.reverseSettlement('t-1', 'settle-1', 'user-1', 'mistake')).rejects.toThrow(ConflictException);
    expect(settlementRepo.save).not.toHaveBeenCalled();
  });

  it('should reverse a closed settlement and unlock delivery assignments', async () => {
    const settlement = {
      id: 'settle-1',
      tenant_id: 't-1',
      status: 'CLOSED',
    };
    settlementRepo.findOne.mockResolvedValue(settlement);
    settlementRepo.save.mockImplementation((s: any) => Promise.resolve(s));
    settlementLineRepo.find.mockResolvedValue([{ id: 'line-1', delivery_assignment_id: 'asgn-1' }]);

    const assignment = { id: 'asgn-1', is_settled: true, settlement_id: 'settle-1' };
    assignmentRepo.findOne.mockResolvedValue(assignment);
    assignmentRepo.save.mockImplementation((a: any) => Promise.resolve(a));

    const reversed = await service.reverseSettlement('t-1', 'settle-1', 'user-1', 'Data correction');

    expect(reversed.status).toBe('REVERSED');
    expect(assignmentRepo.save).toHaveBeenCalledWith(expect.objectContaining({ is_settled: false, settlement_id: null }));
  });

  it('should handle review and return state transitions (DRAFT <-> UNDER_REVIEW)', async () => {
    const draftSettlement = { id: 'settle-1', tenant_id: 't-1', status: 'DRAFT' };
    settlementRepo.findOne.mockResolvedValue(draftSettlement);
    settlementRepo.save.mockImplementation((s: any) => Promise.resolve(s));

    const reviewed = await service.reviewSettlement('t-1', 'settle-1', 'user-1');
    expect(reviewed.status).toBe('UNDER_REVIEW');

    const underReviewSettlement = { id: 'settle-1', tenant_id: 't-1', status: 'UNDER_REVIEW' };
    settlementRepo.findOne.mockResolvedValue(underReviewSettlement);

    const returned = await service.returnSettlement('t-1', 'settle-1', 'user-1', 'Needs verification');
    expect(returned.status).toBe('DRAFT');
  });

  it('should enforce immutability on CLOSED settlements when updating', async () => {
    const closedSettlement = { id: 'settle-closed', tenant_id: 't-1', status: 'CLOSED' };
    settlementRepo.findOne.mockResolvedValue(closedSettlement);

    await expect(service.updateSettlement('t-1', 'settle-closed', { actual_cash_amount: 500 })).rejects.toThrow(BadRequestException);
  });

  it('should generate settlement statement DTO', async () => {
    const settlement = {
      id: 'settle-1',
      tenant_id: 't-1',
      courier_id: 'c-1',
      settlement_number: 'SET-1001',
      settlement_date: new Date(),
      status: 'CLOSED',
      expected_cash_amount: '100.00',
      actual_cash_amount: '100.00',
      cash_discrepancy_amount: '0.00',
      expected_pos_amount: '200.00',
      actual_pos_amount: '200.00',
      pos_discrepancy_amount: '0.00',
      total_compensation_amount: '15.00',
      total_adjustment_amount: '0.00',
      net_settlement_amount: '285.00',
    };
    settlementRepo.findOne.mockResolvedValue(settlement);
    settlementLineRepo.find.mockResolvedValue([{ id: 'line-1', order_number: 'ORD-1001' }]);
    courierRepo.findOne.mockResolvedValue({ id: 'c-1', name: 'Courier Ali', code: 'C01' });

    const statement = await service.getSettlementStatement('t-1', 'settle-1');

    expect(statement.settlement_number).toBe('SET-1001');
    expect(statement.courier.name).toBe('Courier Ali');
    expect(statement.summary.net_settlement_amount).toBe('285.00');
    expect(statement.lines.length).toBe(1);
  });
});
