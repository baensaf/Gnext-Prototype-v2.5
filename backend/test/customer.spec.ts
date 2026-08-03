import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from '../src/modules/customer/customer.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CustomerGroup } from '../src/entities/CustomerGroup.entity';
import { Customer } from '../src/entities/Customer.entity';
import { CustomerAddress } from '../src/entities/CustomerAddress.entity';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
import { CustomerCreditTransaction } from '../src/entities/CustomerCreditTransaction.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException } from '@nestjs/common';

describe('CustomerService (Unit)', () => {
  let service: CustomerService;
  let accountRepo: any;
  let txRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    accountRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    txRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: getRepositoryToken(CustomerGroup), useValue: {} },
        { provide: getRepositoryToken(Customer), useValue: {} },
        { provide: getRepositoryToken(CustomerAddress), useValue: {} },
        { provide: getRepositoryToken(CustomerCreditAccount), useValue: accountRepo },
        { provide: getRepositoryToken(CustomerCreditTransaction), useValue: txRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
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
