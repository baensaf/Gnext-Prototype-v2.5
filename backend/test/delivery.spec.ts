import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
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
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

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

  beforeEach(async () => {
    courierRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn().mockImplementation((c) => c), save: jest.fn().mockImplementation((c) => Promise.resolve(c)) };
    assignmentRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn().mockImplementation((a) => a), save: jest.fn().mockImplementation((a) => Promise.resolve(a)) };
    orderRepo = { findOne: jest.fn(), save: jest.fn().mockImplementation((o) => Promise.resolve(o)) };
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
        { provide: AuditWriter, useValue: auditWriter },
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

    // Complete -> DELIVERED, snapshot compensation & order COMPLETED
    deliveryRepo.findOne.mockResolvedValue({ id: 'del-10', tenant_id: 't-1', order_id: 'ord-10', courier_id: 'cour-1', state: 'EN_ROUTE' });
    const completed = await service.completeDelivery('t-1', 'del-10', { cashCollected: 50000, posAmount: 0 });

    expect(completed.state).toBe('DELIVERED');
    expect(completed.compensation_amount).toBe('15000.0000');
    expect(orderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'COMPLETED' }));
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
});
