import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryService } from '../src/modules/delivery/delivery.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Courier } from '../src/entities/Courier.entity';
import { DeliveryAssignment } from '../src/entities/DeliveryAssignment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException } from '@nestjs/common';

describe('DeliveryService (Unit)', () => {
  let service: DeliveryService;
  let courierRepo: any;
  let assignmentRepo: any;
  let orderRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    courierRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    assignmentRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryService,
        { provide: getRepositoryToken(Courier), useValue: courierRepo },
        { provide: getRepositoryToken(DeliveryAssignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
  });

  it('should assign order to available courier and set courier status to ON_DELIVERY', async () => {
    orderRepo.findOne.mockResolvedValue({ id: 'ord-del-1', fulfillment_status: 'PENDING' });
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', name: 'Ali', status: 'AVAILABLE' });
    assignmentRepo.create.mockImplementation((dto) => dto);
    assignmentRepo.save.mockImplementation((dto) => Promise.resolve({ ...dto, id: 'asgn-1' }));
    courierRepo.save.mockImplementation((c) => Promise.resolve(c));

    const assignment = await service.assignOrder('t-1', 'ord-del-1', 'cour-1', 15.0, 5.0, 'corr-del-1');

    expect(assignment.status).toBe('ASSIGNED');
    expect(courierRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'ON_DELIVERY' }));
    expect(orderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ fulfillment_status: 'OUT_FOR_DELIVERY' }));
  });

  it('should transition assignment to DELIVERED and release courier back to AVAILABLE', async () => {
    assignmentRepo.findOne.mockResolvedValue({ id: 'asgn-1', tenant_id: 't-1', courier_id: 'cour-1', order_id: 'ord-1', status: 'OUT_FOR_DELIVERY' });
    assignmentRepo.save.mockImplementation((a) => Promise.resolve(a));
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', status: 'ON_DELIVERY' });
    courierRepo.save.mockImplementation((c) => Promise.resolve(c));
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', fulfillment_status: 'OUT_FOR_DELIVERY' });

    const updated = await service.updateAssignmentStatus('t-1', 'asgn-1', 'DELIVERED', undefined, 'corr-status-1');

    expect(updated.status).toBe('DELIVERED');
    expect(courierRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'AVAILABLE' }));
    expect(orderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ fulfillment_status: 'DELIVERED' }));
  });

  it('should handle failed delivery, store failure reason, and release courier', async () => {
    assignmentRepo.findOne.mockResolvedValue({ id: 'asgn-1', tenant_id: 't-1', courier_id: 'cour-1', order_id: 'ord-1', status: 'OUT_FOR_DELIVERY' });
    assignmentRepo.save.mockImplementation((a) => Promise.resolve(a));
    courierRepo.findOne.mockResolvedValue({ id: 'cour-1', status: 'ON_DELIVERY' });
    courierRepo.save.mockImplementation((c) => Promise.resolve(c));
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', fulfillment_status: 'OUT_FOR_DELIVERY' });

    const updated = await service.updateAssignmentStatus('t-1', 'asgn-1', 'FAILED', 'Wrong address', 'corr-status-2');

    expect(updated.status).toBe('FAILED');
    expect(updated.failure_reason).toBe('Wrong address');
    expect(courierRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'AVAILABLE' }));
  });
});
