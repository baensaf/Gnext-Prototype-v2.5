import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DeliveryService } from '../src/modules/delivery/delivery.service';
import { Courier } from '../src/entities/Courier.entity';
import { DeliveryAssignment } from '../src/entities/DeliveryAssignment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { CourierSettlement } from '../src/entities/CourierSettlement.entity';
import { CourierSettlementLine } from '../src/entities/CourierSettlementLine.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { ApprovalRequest } from '../src/entities/ApprovalRequest.entity';
import { DeliveryZone } from '../src/entities/DeliveryZone.entity';
import { CourierAttendance } from '../src/entities/CourierAttendance.entity';
import { CourierTerminalAssignment } from '../src/entities/CourierTerminalAssignment.entity';
import { Delivery } from '../src/entities/Delivery.entity';
import { DeliveryEvent } from '../src/entities/DeliveryEvent.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { CustomerAddress } from '../src/entities/CustomerAddress.entity';
import { Branch } from '../src/entities/Branch.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { OrderTransitionRecorder } from '../src/modules/order-lifecycle/order-transition-recorder.service';
import { ShiftService } from '../src/modules/cashier/shift.service';

describe('DeliveryService (R19 Unit & Integration)', () => {
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
  let customerAddressRepo: any;
  let auditWriter: any;
  let transitionRecorder: any;
  let branchRepo: any;
  let settingRepo: any;

  beforeEach(async () => {
    branchRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    settingRepo = { find: jest.fn().mockResolvedValue([]) };
    courierRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn().mockImplementation((c) => c), save: jest.fn().mockImplementation((c) => Promise.resolve(c)) };
    assignmentRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn().mockImplementation((a) => a), save: jest.fn().mockImplementation((a) => Promise.resolve(a)) };
    orderRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((o) => Promise.resolve(o)),
      // Order moves are saved in a transaction with their history; hand the save back to the
      // repository the assertions watch.
      manager: { transaction: jest.fn(async (cb: any) => cb({ save: (_entity: any, order: any) => orderRepo.save(order) })) },
    };
    transitionRecorder = { record: jest.fn() };
    settlementRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
    settlementLineRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    paymentMethodRepo = { findOne: jest.fn() };
    approvalRepo = { findOne: jest.fn() };
    zoneRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn().mockImplementation((z) => z), save: jest.fn().mockImplementation((z) => Promise.resolve(z)), softDelete: jest.fn() };
    attendanceRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn().mockImplementation((a) => a), save: jest.fn().mockImplementation((a) => Promise.resolve(a)) };
    terminalAssignRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation((t) => t), save: jest.fn().mockImplementation((t) => Promise.resolve(t)) };
    deliveryRepo = { findOne: jest.fn(), find: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn().mockImplementation((d) => d), save: jest.fn().mockImplementation((d) => Promise.resolve(d)) };
    deliveryEventRepo = { create: jest.fn().mockImplementation((e) => e), save: jest.fn().mockImplementation((e) => Promise.resolve(e)), find: jest.fn() };
    terminalRepo = { findOne: jest.fn() };
    customerAddressRepo = { findOne: jest.fn() };
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
        { provide: getRepositoryToken(CustomerAddress), useValue: customerAddressRepo },
        { provide: getRepositoryToken(Branch), useValue: branchRepo },
        { provide: getRepositoryToken(TenantSetting), useValue: settingRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: OrderTransitionRecorder, useValue: transitionRecorder },
        { provide: ShiftService, useValue: { requireDrawer: jest.fn(), recordCashPaymentMovement: jest.fn() } },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
  });

  it('should enforce courier eligibility check (checked-in & available) when assigning delivery', async () => {
    deliveryRepo.findOne.mockResolvedValue({ id: 'del-1', tenant_id: 't-1', order_id: 'ord-1', state: 'UNASSIGNED' });
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', tenant_id: 't-1', state: 'READY' });
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', tenant_id: 't-1', name: 'Ali', is_active: true });

    // Scenario 1: Not checked in today
    attendanceRepo.findOne.mockResolvedValue(null);
    await expect(service.assignCourier('t-1', 'del-1', 'cour-1')).rejects.toThrow(BadRequestException);

    // Scenario 2: Checked in but BUSY
    attendanceRepo.findOne.mockResolvedValue({ status: 'CHECKED_IN', availability_status: 'BUSY' });
    await expect(service.assignCourier('t-1', 'del-1', 'cour-1')).rejects.toThrow(BadRequestException);

    // Scenario 3: Checked in and AVAILABLE -> succeeds
    attendanceRepo.findOne.mockResolvedValue({ status: 'CHECKED_IN', availability_status: 'AVAILABLE' });
    const assigned = await service.assignCourier('t-1', 'del-1', 'cour-1');

    expect(assigned.state).toBe('ASSIGNED');
    expect(assigned.courier_id).toBe('cour-1');
    expect(deliveryEventRepo.save).toHaveBeenCalledWith(expect.objectContaining({ to_state: 'ASSIGNED' }));
  });

  it('should enforce mobile POS terminal exclusivity assignment', async () => {
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', tenant_id: 't-1', name: 'Ali' });
    terminalRepo.findOne.mockResolvedValue({ id: 'term-1', tenant_id: 't-1', name: 'Mobile POS 1' });

    // Scenario: Terminal already assigned to another active courier
    terminalAssignRepo.findOne.mockResolvedValue({ id: 'ass-other', courier_id: 'cour-2', is_active: true });

    await expect(service.assignMobileTerminal('t-1', 'cour-1', 'term-1')).rejects.toThrow(BadRequestException);
  });

  it('should transition delivery states and align parent order header', async () => {
    deliveryRepo.findOne.mockResolvedValue({ id: 'del-10', tenant_id: 't-1', order_id: 'ord-10', courier_id: 'cour-1', state: 'ASSIGNED' });
    orderRepo.findOne.mockResolvedValue({ id: 'ord-10', tenant_id: 't-1', state: 'READY' });
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', compensation_per_delivery: '15000.0000' });

    // Depart -> EN_ROUTE & order OUT_FOR_DELIVERY
    const departed = await service.departDelivery('t-1', 'del-10');
    expect(departed.state).toBe('EN_ROUTE');
    expect(orderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'OUT_FOR_DELIVERY' }));
    expect(transitionRecorder.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 't-1', fromState: 'READY', action: 'DISPATCH' }),
    );

    // Complete -> DELIVERED, snapshot compensation & order COMPLETED
    deliveryRepo.findOne.mockResolvedValue({ id: 'del-10', tenant_id: 't-1', order_id: 'ord-10', courier_id: 'cour-1', state: 'EN_ROUTE' });
    const completed = await service.completeDelivery('t-1', 'del-10', { cashCollected: 50000, posAmount: 0 });

    expect(completed.state).toBe('DELIVERED');
    expect(completed.compensation_amount).toBe('15000.0000');
    expect(orderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'COMPLETED' }));
    // An order the courier completes still gets its history row, sync event and loyalty cashback.
    expect(transitionRecorder.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 't-1', fromState: 'OUT_FOR_DELIVERY', action: 'COMPLETE' }),
    );
  });

  // F10: a cash-on-delivery order used to be marked COMPLETED the moment it was delivered, with
  // nothing paid, and whatever cash the courier typed became what they were expected to bring.
  it('keeps an order that still owes money open on delivery, and expects the balance back', async () => {
    deliveryRepo.findOne.mockResolvedValue({ id: 'del-cod', tenant_id: 't-1', order_id: 'ord-cod', courier_id: 'cour-1', state: 'EN_ROUTE' });
    orderRepo.findOne.mockResolvedValue({ id: 'ord-cod', tenant_id: 't-1', state: 'OUT_FOR_DELIVERY', outstanding_total: '565000.0000' });
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', compensation_per_delivery: '15000.0000' });

    const delivered = await service.completeDelivery('t-1', 'del-cod', { cashCollected: 500000, posAmount: 0 });

    expect(delivered.state).toBe('DELIVERED');
    expect(delivered.cash_expected).toBe('565000.0000');
    expect(delivered.mobile_pos_expected).toBe('0.0000');
    expect(orderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'OUT_FOR_DELIVERY', fulfillment_status: 'DELIVERED' }));
    expect(orderRepo.save).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'COMPLETED' }));
    expect(transitionRecorder.record).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'COMPLETE' }));
  });

  it('reconciles a stale delivery with a completed parent order before returning the board', async () => {
    const staleDelivery = { id: 'del-stale', tenant_id: 't-1', order_id: 'ord-done', state: 'UNASSIGNED' };
    deliveryRepo.find.mockResolvedValue([staleDelivery]);
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-done',
      tenant_id: 't-1',
      branch_id: 'branch-1',
      order_number: 'ORD-001',
      state: 'COMPLETED',
      grand_total: '239800.0000',
      completed_at: new Date('2026-09-07T10:00:00Z'),
    });

    const result = await service.getDeliveries('t-1', 'branch-1');

    expect(result).toHaveLength(1);
    expect(result[0].state).toBe('DELIVERED');
    expect(deliveryRepo.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'DELIVERED' }));
    expect(deliveryEventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ from_state: 'UNASSIGNED', to_state: 'DELIVERED' }),
    );
  });

  it('rejects courier assignment when the parent order is already completed', async () => {
    deliveryRepo.findOne.mockResolvedValue({ id: 'del-1', tenant_id: 't-1', order_id: 'ord-1', state: 'UNASSIGNED' });
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', tenant_id: 't-1', state: 'COMPLETED' });

    await expect(service.assignCourier('t-1', 'del-1', 'cour-1')).rejects.toThrow(BadRequestException);
    expect(deliveryRepo.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'DELIVERED' }));
    expect(courierRepo.findOne).not.toHaveBeenCalled();
  });

  it("refuses to hand one branch's order to a courier who works at another", async () => {
    deliveryRepo.findOne.mockResolvedValue({ id: 'del-1', tenant_id: 't-1', order_id: 'ord-1', state: 'UNASSIGNED' });
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', tenant_id: 't-1', branch_id: 'downtown', state: 'READY' });
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', tenant_id: 't-1', branch_id: 'central', name: 'Ali', is_active: true });
    attendanceRepo.findOne.mockResolvedValue({ status: 'CHECKED_IN', availability_status: 'AVAILABLE' });

    await expect(service.assignCourier('t-1', 'del-1', 'cour-1')).rejects.toThrow(BadRequestException);
    expect(deliveryRepo.save).not.toHaveBeenCalled();
  });

  describe('courier pay rules', () => {
    const enRoute = { id: 'del-1', tenant_id: 't-1', order_id: 'ord-1', zone_id: 'zone-1', courier_id: 'cour-1', state: 'EN_ROUTE', fee: '25000.0000' };

    beforeEach(() => {
      // A fresh order each read: completing one marks it COMPLETED in place.
      orderRepo.findOne.mockImplementation(() =>
        Promise.resolve({ id: 'ord-1', tenant_id: 't-1', branch_id: 'downtown', state: 'OUT_FOR_DELIVERY' }),
      );
    });

    it("pays a DELIVERY_FEE courier the zone's listed fee plus any tip, and records the rule", async () => {
      deliveryRepo.findOne.mockResolvedValue({ ...enRoute });
      courierRepo.findOne.mockResolvedValue({ id: 'cour-1', pay_mode: 'DELIVERY_FEE', compensation_per_delivery: '10000.0000' });
      assignmentRepo.findOne.mockResolvedValue({ id: 'asgn-1', status: 'OUT_FOR_DELIVERY', tip_amount: '5000.00' });

      const done = await service.completeDelivery('t-1', 'del-1', {});

      expect(done.compensation_amount).toBe('30000.0000');
      expect(done.compensation_basis).toBe('DELIVERY_FEE');
      expect(assignmentRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'DELIVERED', compensation_amount: '30000.00' }));
    });

    it("pays a ZONE_RATE courier the zone's courier rate, and their own rate where the zone has none", async () => {
      courierRepo.findOne.mockResolvedValue({ id: 'cour-1', pay_mode: 'ZONE_RATE', compensation_per_delivery: '10000.0000' });
      assignmentRepo.findOne.mockResolvedValue(null);

      deliveryRepo.findOne.mockResolvedValue({ ...enRoute });
      zoneRepo.findOne.mockResolvedValue({ id: 'zone-1', courier_pay: '18000.0000' });
      expect((await service.completeDelivery('t-1', 'del-1', {})).compensation_amount).toBe('18000.0000');

      deliveryRepo.findOne.mockResolvedValue({ ...enRoute });
      zoneRepo.findOne.mockResolvedValue({ id: 'zone-1', courier_pay: null });
      const fallback = await service.completeDelivery('t-1', 'del-1', {});
      expect(fallback.compensation_amount).toBe('10000.0000');
      expect(fallback.compensation_basis).toBe('FLAT');
    });

    it('pays a failed ride only when the branch policy says so, and only if the courier rode out', async () => {
      courierRepo.findOne.mockResolvedValue({ id: 'cour-1', pay_mode: 'FLAT', compensation_per_delivery: '10000.0000' });

      deliveryRepo.findOne.mockResolvedValue({ ...enRoute });
      assignmentRepo.findOne.mockResolvedValue({ id: 'asgn-1', status: 'OUT_FOR_DELIVERY' });
      await service.failDelivery('t-1', 'del-1', 'Nobody home');
      expect(assignmentRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED', compensation_amount: '0.00' }));

      settingRepo.find.mockResolvedValue([{ key: 'COURIER_PAY', branch_id: 'downtown', value: { payFailedDeliveries: true } }]);
      deliveryRepo.findOne.mockResolvedValue({ ...enRoute });
      assignmentRepo.findOne.mockResolvedValue({ id: 'asgn-2', status: 'OUT_FOR_DELIVERY' });
      await service.failDelivery('t-1', 'del-1', 'Nobody home');
      expect(assignmentRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED', compensation_amount: '10000.00' }));

      deliveryRepo.findOne.mockResolvedValue({ ...enRoute, state: 'ASSIGNED' });
      assignmentRepo.findOne.mockResolvedValue({ id: 'asgn-3', status: 'ASSIGNED' });
      await service.failDelivery('t-1', 'del-1', 'Kitchen could not make it');
      expect(assignmentRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FAILED', compensation_amount: '0.00' }));
    });

    it("starts a new courier on the branch's default pay rule unless one is chosen", async () => {
      courierRepo.find.mockResolvedValue([]);
      settingRepo.find.mockResolvedValue([{ key: 'COURIER_PAY', branch_id: null, value: { defaultPayMode: 'DELIVERY_FEE' } }]);

      const defaulted = await service.createCourier('t-1', { branch_id: 'downtown', code: 'CR-9', name: 'Reza', phone: '09129999999' });
      expect(defaulted.pay_mode).toBe('DELIVERY_FEE');

      const chosen = await service.createCourier('t-1', { branch_id: 'downtown', code: 'CR-10', name: 'Mina', phone: '09128888888', pay_mode: 'FLAT' });
      expect(chosen.pay_mode).toBe('FLAT');
    });
  });

  describe('one courier record across branches', () => {
    it('refuses to add a courier twice when the same mobile is typed another way', async () => {
      courierRepo.find.mockResolvedValue([
        { id: 'cour-1', code: 'CR-001', name: 'Ali Rezaei', phone: '09120000001', branch_id: 'central', is_active: true },
      ]);
      branchRepo.findOne.mockResolvedValue({ id: 'central', name: 'Central Plaza' });

      const attempt = service.createCourier('t-1', { branch_id: 'downtown', code: 'CR-099', name: 'Ali R.', phone: '+98 912 000 0001' });

      await expect(attempt).rejects.toThrow(ConflictException);
      await attempt.catch((err: any) => {
        expect(err.getResponse().code).toBe('COURIER_EXISTS');
        expect(err.getResponse().context.courier).toEqual(expect.objectContaining({ id: 'cour-1', branch_name: 'Central Plaza' }));
      });
      expect(courierRepo.save).not.toHaveBeenCalled();
    });

    it('moves a courier who is between shifts, and records where from', async () => {
      courierRepo.findOne.mockResolvedValue({ id: 'cour-1', tenant_id: 't-1', branch_id: 'central', name: 'Ali', is_active: true });
      branchRepo.findOne.mockResolvedValue({ id: 'downtown', tenant_id: 't-1', name: 'Downtown Express' });
      attendanceRepo.findOne.mockResolvedValue({ status: 'CHECKED_OUT' });
      terminalAssignRepo.findOne.mockResolvedValue(null);

      await service.moveCourier('t-1', 'cour-1', 'downtown', 'user-1');

      expect(courierRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'cour-1', branch_id: 'downtown' }));
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'COURIER_MOVED', beforeData: { branch_id: 'central' }, afterData: { branch_id: 'downtown' } }),
      );
    });

    it.each([
      ['still carrying orders', () => deliveryRepo.count.mockResolvedValue(2)],
      ['still checked in at the old shop', () => attendanceRepo.findOne.mockResolvedValue({ status: 'CHECKED_IN' })],
      ["still holding the old shop's mobile POS", () => terminalAssignRepo.findOne.mockResolvedValue({ id: 'cta-1', is_active: true })],
    ])('will not move a courier %s', async (_label, arrange) => {
      courierRepo.findOne.mockResolvedValue({ id: 'cour-1', tenant_id: 't-1', branch_id: 'central', name: 'Ali', is_active: true });
      branchRepo.findOne.mockResolvedValue({ id: 'downtown', tenant_id: 't-1', name: 'Downtown Express' });
      arrange();

      await expect(service.moveCourier('t-1', 'cour-1', 'downtown')).rejects.toThrow(ConflictException);
      expect(courierRepo.save).not.toHaveBeenCalled();
    });

    it('will not check a courier in at a branch they do not work for', async () => {
      courierRepo.findOne.mockResolvedValue({ id: 'cour-1', tenant_id: 't-1', branch_id: 'central', name: 'Ali' });

      await expect(
        service.recordAttendance('t-1', { courier_id: 'cour-1', branch_id: 'downtown', status: 'CHECKED_IN' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.recordAttendance('t-1', { courier_id: 'cour-1', branch_id: 'central', status: 'CHECKED_IN' }, 'user-1', 'downtown'),
      ).rejects.toThrow(ForbiddenException);
      expect(attendanceRepo.save).not.toHaveBeenCalled();
    });
  });
});
