import { Test, TestingModule } from '@nestjs/testing';
import { RefundService } from '../src/modules/refund/refund.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RefundRequest } from '../src/entities/RefundRequest.entity';
import { RefundItem } from '../src/entities/RefundItem.entity';
import { RefundAllocation } from '../src/entities/RefundAllocation.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { CustomerService } from '../src/modules/customer/customer.service';
import { ApprovalService } from '../src/modules/approval/approval.service';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException } from '@nestjs/common';

describe('RefundService (Unit)', () => {
  let service: RefundService;
  let requestRepo: any;
  let itemRepo: any;
  let allocRepo: any;
  let orderRepo: any;
  let orderItemRepo: any;
  let paymentRepo: any;
  let methodRepo: any;
  let customerService: any;
  let approvalService: any;
  let auditWriter: any;

  beforeEach(async () => {
    requestRepo = { findOne: jest.fn(), find: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn(), save: jest.fn() };
    itemRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    allocRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn() };
    orderItemRepo = { find: jest.fn() };
    paymentRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    methodRepo = { findOne: jest.fn() };
    customerService = { postCreditTransaction: jest.fn() };
    approvalService = { verifyManagerPin: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundService,
        { provide: getRepositoryToken(RefundRequest), useValue: requestRepo },
        { provide: getRepositoryToken(RefundItem), useValue: itemRepo },
        { provide: getRepositoryToken(RefundAllocation), useValue: allocRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(PaymentMethod), useValue: methodRepo },
        { provide: CustomerService, useValue: customerService },
        { provide: ApprovalService, useValue: approvalService },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<RefundService>(RefundService);
  });

  it('should process full refund and restore customer credit if paid via PM-CUSTOMER-CREDIT', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-ref-1',
      order_number: 'ORD-100',
      paid_amount: '500.0000',
      due_amount: '0.0000',
      customer_id: 'cust-credit-1',
      status: 'COMPLETED',
      items: [],
    });
    orderRepo.save.mockImplementation((o) => Promise.resolve(o));

    paymentRepo.find.mockResolvedValue([
      { id: 'pay-credit', payment_method_id: 'pm-credit-id', amount: '500.0000', is_reversed: false },
    ]);

    methodRepo.findOne.mockResolvedValue({ id: 'pm-credit-id', code: 'PM-CUSTOMER-CREDIT', is_active: true });

    requestRepo.create.mockImplementation((dto) => dto);
    requestRepo.save.mockImplementation((dto) => Promise.resolve({ ...dto, id: 'ref-1', code: 'REF-1001' }));
    allocRepo.create.mockImplementation((dto) => dto);
    paymentRepo.create.mockImplementation((dto) => dto);

    const result = await service.createRefund(
      't-1',
      'u-cashier',
      { order_id: 'ord-ref-1', refund_type: 'FULL', note: 'Customer returned item' },
      'corr-ref-1',
    );

    expect(result.refund_request.total_refund_amount).toBe('500.0000');
    expect(customerService.postCreditTransaction).toHaveBeenCalledWith(
      't-1',
      'cust-credit-1',
      expect.objectContaining({ transaction_type: 'CREDIT', amount: '500.0000' }),
      'corr-ref-1',
    );
  });

  it('should enforce Manager PIN when cancelling paid order post-preparation window', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-kitchen',
      paid_amount: '100.0000',
      due_amount: '0.0000',
      status: 'IN_PREPARATION',
    });

    await expect(service.cancelPaidOrder('t-1', 'u-cashier', 'ord-kitchen', 'Customer left')).rejects.toThrow(BadRequestException);
  });
});
