import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
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
import { Delivery } from '../src/entities/Delivery.entity';
import { DeliveryEvent } from '../src/entities/DeliveryEvent.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { CustomerAddress } from '../src/entities/CustomerAddress.entity';
import { Customer } from '../src/entities/Customer.entity';
import { Branch } from '../src/entities/Branch.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
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
  let deliveryRepo: any;
  let deliveryEventRepo: any;
  let terminalRepo: any;
  let customerAddressRepo: any;
  let customerRepo: any;
  let auditWriter: any;
  let transitionRecorder: any;
  let branchRepo: any;
  let settingRepo: any;
  let userRepo: any;

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((u) => u),
      save: jest.fn().mockImplementation((u) => Promise.resolve({ id: 'user-courier', ...u })),
      update: jest.fn(),
    };
    branchRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    settingRepo = { find: jest.fn().mockResolvedValue([]) };
    courierRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn().mockImplementation((c) => c), save: jest.fn().mockImplementation((c) => Promise.resolve(c)) };
    assignmentRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn().mockImplementation((a) => a), save: jest.fn().mockImplementation((a) => Promise.resolve(a)) };
    orderRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
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
    deliveryRepo = { findOne: jest.fn(), find: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn().mockImplementation((d) => d), save: jest.fn().mockImplementation((d) => Promise.resolve(d)) };
    deliveryEventRepo = { create: jest.fn().mockImplementation((e) => e), save: jest.fn().mockImplementation((e) => Promise.resolve(e)), find: jest.fn() };
    terminalRepo = { findOne: jest.fn() };
    customerAddressRepo = { findOne: jest.fn() };
    customerRepo = { find: jest.fn().mockResolvedValue([]) };
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
        { provide: getRepositoryToken(Delivery), useValue: deliveryRepo },
        { provide: getRepositoryToken(DeliveryEvent), useValue: deliveryEventRepo },
        { provide: getRepositoryToken(Terminal), useValue: terminalRepo },
        { provide: getRepositoryToken(CustomerAddress), useValue: customerAddressRepo },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(Branch), useValue: branchRepo },
        { provide: getRepositoryToken(TenantSetting), useValue: settingRepo },
        { provide: getRepositoryToken(AdminUser), useValue: userRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: OrderTransitionRecorder, useValue: transitionRecorder },
        { provide: ShiftService, useValue: { requireDrawer: jest.fn(), recordCashPaymentMovement: jest.fn() } },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
  });

  it('assigns a delivery to any active courier of the branch, however many deliveries they already carry', async () => {
    deliveryRepo.findOne.mockResolvedValue({ id: 'del-1', tenant_id: 't-1', order_id: 'ord-1', state: 'UNASSIGNED' });
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', tenant_id: 't-1', state: 'CONFIRMED' });

    // An archived courier cannot be given an order.
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', tenant_id: 't-1', name: 'Ali', is_active: false });
    await expect(service.assignCourier('t-1', 'del-1', 'cour-1')).rejects.toThrow(BadRequestException);

    // An active one can, with no check-in and whatever else they are carrying.
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', tenant_id: 't-1', name: 'Ali', is_active: true });
    deliveryRepo.count.mockResolvedValue(9);
    const assigned = await service.assignCourier('t-1', 'del-1', 'cour-1');

    expect(assigned.state).toBe('ASSIGNED');
    expect(assigned.courier_id).toBe('cour-1');
    expect(deliveryEventRepo.save).toHaveBeenCalledWith(expect.objectContaining({ to_state: 'ASSIGNED' }));
  });

  it('should transition delivery states and align parent order header', async () => {
    deliveryRepo.findOne.mockResolvedValue({ id: 'del-10', tenant_id: 't-1', order_id: 'ord-10', courier_id: 'cour-1', state: 'ASSIGNED' });
    orderRepo.findOne.mockResolvedValue({ id: 'ord-10', tenant_id: 't-1', state: 'CONFIRMED' });
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1' });

    // Depart -> EN_ROUTE & order OUT_FOR_DELIVERY
    const departed = await service.departDelivery('t-1', 'del-10');
    expect(departed.state).toBe('EN_ROUTE');
    expect(orderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'OUT_FOR_DELIVERY' }));
    expect(transitionRecorder.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 't-1', fromState: 'CONFIRMED', action: 'DISPATCH' }),
    );

    // Complete -> DELIVERED & order COMPLETED
    deliveryRepo.findOne.mockResolvedValue({ id: 'del-10', tenant_id: 't-1', order_id: 'ord-10', courier_id: 'cour-1', state: 'EN_ROUTE' });
    const completed = await service.completeDelivery('t-1', 'del-10', { cashCollected: 50000, posAmount: 0 });

    expect(completed.state).toBe('DELIVERED');
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
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1' });

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
    orderRepo.find.mockResolvedValue([{
      id: 'ord-done',
      tenant_id: 't-1',
      branch_id: 'branch-1',
      order_number: 'ORD-001',
      state: 'COMPLETED',
      grand_total: '239800.0000',
      completed_at: new Date('2026-09-07T10:00:00Z'),
    }]);

    const result = await service.getDeliveries('t-1', 'branch-1');

    expect(result).toHaveLength(1);
    expect(result[0].state).toBe('DELIVERED');
    expect(deliveryRepo.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'DELIVERED' }));
    expect(deliveryEventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ from_state: 'UNASSIGNED', to_state: 'DELIVERED' }),
    );
  });

  // Audit OD7/OD8: the board read every delivery ever, one order, courier and zone at a time,
  // and every card said "Customer".
  it('reads the board in batches, only what is in play or recent, and names the customer', async () => {
    deliveryRepo.find.mockResolvedValue([
      { id: 'del-1', tenant_id: 't-1', order_id: 'ord-1', courier_id: 'cour-1', zone_id: 'zone-1', state: 'ASSIGNED' },
      { id: 'del-2', tenant_id: 't-1', order_id: 'ord-2', courier_id: null, zone_id: 'zone-1', state: 'UNASSIGNED' },
    ]);
    orderRepo.find.mockResolvedValue([
      { id: 'ord-1', branch_id: 'branch-1', order_number: 'ORD-1', call_number: 42, state: 'CONFIRMED', customer_id: 'cust-1', submitted_at: new Date('2026-09-23T10:00:00Z') },
      { id: 'ord-2', branch_id: 'branch-2', order_number: 'ORD-2', state: 'CONFIRMED', customer_id: null },
    ]);
    courierRepo.find.mockResolvedValue([{ id: 'cour-1', name: 'Sara', phone: '0912' }]);
    zoneRepo.find.mockResolvedValue([{ id: 'zone-1', name: 'Valiasr', estimated_minutes: 20 }]);
    customerRepo.find.mockResolvedValue([{ id: 'cust-1', first_name: 'Reza', last_name: 'Mohammadi', mobile: '+989121234567' }]);

    const board = await service.getDeliveries('t-1', 'branch-1');

    // Open deliveries whatever their age, and finished ones from the last hours only.
    const where = deliveryRepo.find.mock.calls[0][0].where;
    expect(where).toHaveLength(2);
    expect(where[1].updated_at).toBeDefined();
    expect(orderRepo.findOne).not.toHaveBeenCalled();
    expect(courierRepo.findOne).not.toHaveBeenCalled();
    expect(deliveryRepo.save).not.toHaveBeenCalled();

    expect(board).toHaveLength(1);
    expect(board[0]).toEqual(expect.objectContaining({
      order_number: 'ORD-1',
      call_number: 42,
      order_state: 'CONFIRMED',
      customer_name: 'Reza Mohammadi',
      customer_phone: '+989121234567',
      courier_name: 'Sara',
      zone_name: 'Valiasr',
      zone_estimated_minutes: 20,
    }));
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
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', tenant_id: 't-1', branch_id: 'downtown', state: 'CONFIRMED' });
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', tenant_id: 't-1', branch_id: 'central', name: 'Ali', is_active: true });

    await expect(service.assignCourier('t-1', 'del-1', 'cour-1')).rejects.toThrow(BadRequestException);
    expect(deliveryRepo.save).not.toHaveBeenCalled();
  });

  // Audit OD4-OD6: a board that had not refreshed could pull a courier off a ride they were on.
  describe('state guards on the dispatch steps', () => {
    it('closes the first courier’s attempt on a reassign before leaving, and refuses one once the courier has left', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', tenant_id: 't-1', order_number: 'ORD-1', state: 'CONFIRMED' });
      courierRepo.findOne.mockResolvedValue({ id: 'cour-2', tenant_id: 't-1', name: 'Mahdi', is_active: true });

      deliveryRepo.findOne.mockResolvedValue({ id: 'del-1', tenant_id: 't-1', order_id: 'ord-1', courier_id: 'cour-1', state: 'EN_ROUTE' });
      await expect(service.assignCourier('t-1', 'del-1', 'cour-2')).rejects.toThrow(ConflictException);
      expect(deliveryRepo.save).not.toHaveBeenCalled();

      deliveryRepo.findOne.mockResolvedValue({ id: 'del-1', tenant_id: 't-1', order_id: 'ord-1', courier_id: 'cour-1', state: 'ASSIGNED' });
      const first = { id: 'asgn-1', courier_id: 'cour-1', status: 'ASSIGNED' };
      assignmentRepo.findOne.mockImplementation(({ where }: any) => Promise.resolve(where.courier_id === 'cour-1' ? first : null));
      await service.assignCourier('t-1', 'del-1', 'cour-2');
      expect(assignmentRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'asgn-1', status: 'REASSIGNED' }));
      expect(assignmentRepo.save).toHaveBeenCalledWith(expect.objectContaining({ courier_id: 'cour-2', status: 'ASSIGNED' }));
    });

    it('names the courier and sends the order out in one step, and cannot swap the rider once it is out', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 'ord-1', tenant_id: 't-1', order_number: 'ORD-1', state: 'CONFIRMED' });
      courierRepo.findOne.mockResolvedValue({ id: 'cour-1', tenant_id: 't-1', name: 'Ali', is_active: true });
      const waiting: any = { id: 'del-1', tenant_id: 't-1', order_id: 'ord-1', state: 'UNASSIGNED' };
      deliveryRepo.findOne.mockImplementation(() => Promise.resolve(waiting));

      const out = await service.dispatchCourier('t-1', 'del-1', 'cour-1');
      expect(out).toEqual(expect.objectContaining({ state: 'EN_ROUTE', courier_id: 'cour-1' }));
      expect(orderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'OUT_FOR_DELIVERY' }));

      deliveryRepo.save.mockClear();
      courierRepo.findOne.mockResolvedValue({ id: 'cour-2', tenant_id: 't-1', name: 'Mahdi', is_active: true });
      await expect(service.dispatchCourier('t-1', 'del-1', 'cour-2')).rejects.toThrow(ConflictException);
      expect(deliveryRepo.save).not.toHaveBeenCalled();
    });

    it('will not write an arbitrary status onto a delivery through the old route', async () => {
      await expect(service.updateAssignmentStatus('t-1', 'del-1', 'RETURNED')).rejects.toThrow(BadRequestException);
      expect(deliveryRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('a courier is a user', () => {
    it('opens a Courier account with the mobile number as its username, at the courier\'s branch', async () => {
      courierRepo.find.mockResolvedValue([]);

      const courier = await service.createCourier('t-1', { branch_id: 'downtown', code: 'CR-11', name: 'Reza', phone: '0912 555 1234' });

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ username: '+989125551234', display_name: 'Reza', role: 'COURIER', branch_id: 'downtown', is_active: true }),
      );
      expect(courier.user_id).toBe('user-courier');
    });

    it('refuses a courier without a mobile number, since it is their username', async () => {
      courierRepo.find.mockResolvedValue([]);

      await expect(service.createCourier('t-1', { branch_id: 'downtown', code: 'CR-12', name: 'Nima' })).rejects.toThrow(BadRequestException);
      expect(userRepo.save).not.toHaveBeenCalled();
      expect(courierRepo.save).not.toHaveBeenCalled();
    });

    it('refuses a mobile number another account already uses', async () => {
      courierRepo.find.mockResolvedValue([]);
      userRepo.findOne.mockResolvedValue({ id: 'u-9', display_name: 'Someone', username: '+989125551234' });

      await expect(service.createCourier('t-1', { branch_id: 'downtown', code: 'CR-13', name: 'Reza', phone: '09125551234' })).rejects.toThrow(ConflictException);
      expect(courierRepo.save).not.toHaveBeenCalled();
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
        expect(err.getResponse().detail).toContain('Central Plaza');
      });
      expect(courierRepo.save).not.toHaveBeenCalled();
    });
  });
});
