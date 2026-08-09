import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService, normalizePhone } from '../src/modules/customer/customer.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CustomerGroup } from '../src/entities/CustomerGroup.entity';
import { Customer } from '../src/entities/Customer.entity';
import { CustomerPhone } from '../src/entities/CustomerPhone.entity';
import { CustomerAddress } from '../src/entities/CustomerAddress.entity';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
import { CustomerCreditTransaction } from '../src/entities/CustomerCreditTransaction.entity';
import { CustomFieldDefinition } from '../src/entities/CustomFieldDefinition.entity';
import { CustomerCustomValue } from '../src/entities/CustomerCustomValue.entity';
import { CustomerTag } from '../src/entities/CustomerTag.entity';
import { CustomerTagLink } from '../src/entities/CustomerTagLink.entity';
import { CustomerSegment } from '../src/entities/CustomerSegment.entity';
import { CustomerConsent } from '../src/entities/CustomerConsent.entity';
import { CustomerMerge } from '../src/entities/CustomerMerge.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

describe('CustomerService (Unit)', () => {
  let service: CustomerService;
  let customerRepo: any;
  let accountRepo: any;
  let txRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    customerRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    accountRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    txRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: getRepositoryToken(CustomerGroup), useValue: {} },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(CustomerPhone), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(CustomerAddress), useValue: {} },
        { provide: getRepositoryToken(CustomerCreditAccount), useValue: accountRepo },
        { provide: getRepositoryToken(CustomerCreditTransaction), useValue: txRepo },
        { provide: getRepositoryToken(CustomFieldDefinition), useValue: {} },
        { provide: getRepositoryToken(CustomerCustomValue), useValue: {} },
        { provide: getRepositoryToken(CustomerTag), useValue: {} },
        { provide: getRepositoryToken(CustomerTagLink), useValue: {} },
        { provide: getRepositoryToken(CustomerSegment), useValue: {} },
        { provide: getRepositoryToken(CustomerConsent), useValue: {} },
        { provide: getRepositoryToken(CustomerMerge), useValue: {} },
        { provide: getRepositoryToken(OrderHeader), useValue: {} },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
  });

  it('should normalize Iranian mobile numbers to +98 format', () => {
    expect(normalizePhone('09121234567')).toBe('+989121234567');
    expect(normalizePhone('989121234567')).toBe('+989121234567');
    expect(normalizePhone('+989121234567')).toBe('+989121234567');
  });

  it('should detect candidate duplicates by exact normalized phone match', async () => {
    customerRepo.find.mockResolvedValue([
      { id: 'c-1', first_name: 'Ali', last_name: 'Reza', mobile: '09121111111', is_active: true },
      { id: 'c-2', first_name: 'Ali', last_name: 'Rezai', mobile: '+989121111111', is_active: true },
    ]);

    const candidates = await service.getDuplicateCandidates('t-1');
    expect(candidates.length).toBe(1);
    expect(candidates[0].match_score).toBe(100);
    expect(candidates[0].target_customer_id).toBe('c-1');
    expect(candidates[0].source_customer_id).toBe('c-2');
  });

  it('should post charge transaction and update credit account balance', async () => {
    accountRepo.findOne.mockResolvedValue({
      id: 'acc-1',
      customer_id: 'cust-1',
      credit_limit: '10000000.0000',
      current_balance: '2500000.0000',
      is_blocked: false,
    });
    accountRepo.save.mockImplementation((acc) => Promise.resolve(acc));
    txRepo.create.mockReturnValue({ id: 'tx-1' });
    txRepo.save.mockResolvedValue({ id: 'tx-1' });

    const result = await service.postCreditTransaction(
      't-1',
      'cust-1',
      { transaction_type: 'CHARGE', amount: '1000000.0000', note: 'Top up' },
      'corr-1',
    );

    expect(result.account.current_balance).toBe('3500000.0000');
  });

  it('should throw BadRequestException if customer credit account is blocked', async () => {
    accountRepo.findOne.mockResolvedValue({
      id: 'acc-1',
      customer_id: 'cust-1',
      current_balance: '0.0000',
      is_blocked: true,
    });

    await expect(
      service.postCreditTransaction('t-1', 'cust-1', { transaction_type: 'CHARGE', amount: '1000.0000' }, 'corr-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
