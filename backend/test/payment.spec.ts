import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from '../src/modules/payment/payment.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Payment } from '../src/entities/Payment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { CustomerService } from '../src/modules/customer/customer.service';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException } from '@nestjs/common';

describe('PaymentService (Unit)', () => {
  let service: PaymentService;
  let paymentRepo: any;
  let orderRepo: any;
  let methodRepo: any;
  let customerService: any;
  let auditWriter: any;

  beforeEach(async () => {
    paymentRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn() };
    methodRepo = { findOne: jest.fn(), find: jest.fn() };
    customerService = { postCreditTransaction: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(PaymentMethod), useValue: methodRepo },
        { provide: getRepositoryToken(Tenant), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Branch), useValue: { findOne: jest.fn() } },
        { provide: CustomerService, useValue: customerService },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  it('should post split payment and update order paid_amount and due_amount', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-1',
      total_amount: '3790000.0000',
      paid_amount: '2000000.0000',
      due_amount: '1790000.0000',
    });
    orderRepo.save.mockImplementation((o) => Promise.resolve(o));

    methodRepo.findOne.mockResolvedValue({ id: 'pm-1', code: 'PM-CASH', is_active: true });
    paymentRepo.create.mockReturnValue({ id: 'pay-1' });
    paymentRepo.save.mockResolvedValue({ id: 'pay-1' });

    const result = await service.postPayment('t-1', {
      order_id: 'ord-1',
      payment_method_id: 'pm-1',
      amount: '1790000.0000',
    }, 'corr-1');

    expect(result.order.paid_amount).toBe('3790000.0000');
    expect(result.order.due_amount).toBe('0.0000');
  });

  it('should debit customer credit account when paying with PM-CUSTOMER-CREDIT', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-1',
      customer_id: 'cust-1',
      total_amount: '1000000.0000',
      paid_amount: '0.0000',
      due_amount: '1000000.0000',
      order_number: 'ORD-55',
    });
    orderRepo.save.mockImplementation((o) => Promise.resolve(o));

    methodRepo.findOne.mockResolvedValue({ id: 'pm-credit', code: 'PM-CUSTOMER-CREDIT', is_active: true });
    paymentRepo.create.mockReturnValue({ id: 'pay-2' });
    paymentRepo.save.mockResolvedValue({ id: 'pay-2' });

    await service.postPayment('t-1', {
      order_id: 'ord-1',
      payment_method_id: 'pm-credit',
      amount: '1000000.0000',
    }, 'corr-1');

    expect(customerService.postCreditTransaction).toHaveBeenCalledWith(
      't-1',
      'cust-1',
      expect.objectContaining({ transaction_type: 'DEBIT', amount: '1000000.0000' }),
      'corr-1',
    );
  });
});
