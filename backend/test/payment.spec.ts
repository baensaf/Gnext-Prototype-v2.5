import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from '../src/modules/payment/payment.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Payment } from '../src/entities/Payment.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { SettlementAccount } from '../src/entities/SettlementAccount.entity';
import { PaymentDevice } from '../src/entities/PaymentDevice.entity';
import { PaymentAllocation } from '../src/entities/PaymentAllocation.entity';
import { PaymentAttempt } from '../src/entities/PaymentAttempt.entity';
import { CustomerService } from '../src/modules/customer/customer.service';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException } from '@nestjs/common';

describe('PaymentService (Unit)', () => {
  let service: PaymentService;
  let paymentRepo: any;
  let orderRepo: any;
  let methodRepo: any;
  let accountRepo: any;
  let deviceRepo: any;
  let allocRepo: any;
  let attemptRepo: any;
  let customerService: any;
  let auditWriter: any;

  beforeEach(async () => {
    paymentRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn() };
    methodRepo = { findOne: jest.fn(), find: jest.fn() };
    accountRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    deviceRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    allocRepo = { create: jest.fn(), save: jest.fn() };
    attemptRepo = { find: jest.fn().mockResolvedValue([]), create: jest.fn(), save: jest.fn() };
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
        { provide: getRepositoryToken(SettlementAccount), useValue: accountRepo },
        { provide: getRepositoryToken(PaymentDevice), useValue: deviceRepo },
        { provide: getRepositoryToken(PaymentAllocation), useValue: allocRepo },
        { provide: getRepositoryToken(PaymentAttempt), useValue: attemptRepo },
        { provide: CustomerService, useValue: customerService },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  it('should post split multi-tender payment ($10 Cash + $20 Card Terminal)', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-split',
      total_amount: '30.0000',
      paid_amount: '0.0000',
      due_amount: '30.0000',
    });
    orderRepo.save.mockImplementation((o) => Promise.resolve(o));

    methodRepo.findOne.mockImplementation(({ where }) => {
      if (where.id === 'pm-cash') return Promise.resolve({ id: 'pm-cash', code: 'PM-CASH', is_active: true });
      if (where.id === 'pm-pos') return Promise.resolve({ id: 'pm-pos', code: 'PM-POS-CARD', is_active: true });
      return Promise.resolve(null);
    });

    paymentRepo.create.mockImplementation((dto) => dto);
    paymentRepo.save.mockImplementation((dto) => Promise.resolve({ ...dto, id: 'pay-' + Math.random() }));

    const result = await service.postSplitPayment(
      't-1',
      {
        order_id: 'ord-split',
        tenders: [
          { payment_method_id: 'pm-cash', amount: '10.0000' },
          { payment_method_id: 'pm-pos', amount: '20.0000', device_id: 'dev-1' },
        ],
      },
      'corr-split',
    );

    expect(result.payments.length).toBe(2);
    expect(result.order.paid_amount).toBe('30.0000');
    expect(result.order.due_amount).toBe('0.0000');
  });

  it('should reject Mobile POS payment when misclassified as physical cash', async () => {
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', total_amount: '10.0000', paid_amount: '0.0000', due_amount: '10.0000' });
    methodRepo.findOne.mockResolvedValue({ id: 'pm-cash', code: 'PM-CASH', is_active: true });

    await expect(
      service.postSplitPayment(
        't-1',
        {
          order_id: 'ord-1',
          tenders: [{ payment_method_id: 'pm-cash', amount: '10.0000', is_mobile_pos: true }],
        },
        'corr-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should perform immutable payment reversal and recalculate order balance', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-1',
      total_amount: '100.0000',
      paid_amount: '100.0000',
      due_amount: '0.0000',
    });
    orderRepo.save.mockImplementation((o) => Promise.resolve(o));

    paymentRepo.findOne.mockResolvedValue({
      id: 'pay-orig',
      order_id: 'ord-1',
      payment_method_id: 'pm-cash',
      amount: '100.0000',
      is_reversed: false,
    });
    paymentRepo.create.mockImplementation((dto) => dto);
    paymentRepo.save.mockImplementation((dto) => Promise.resolve({ ...dto, id: 'pay-rev' }));

    const res = await service.reversePayment('t-1', 'pay-orig', 'Wrong tender type', 'corr-rev');

    expect(res.reversal.amount).toBe('-100.0000');
    expect(res.order.due_amount).toBe('100.0000');
  });
});
