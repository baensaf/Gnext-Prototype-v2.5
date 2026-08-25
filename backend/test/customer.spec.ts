import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService, normalizePhone } from '../src/modules/customer/customer.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CustomerGroup } from '../src/entities/CustomerGroup.entity';
import { Customer } from '../src/entities/Customer.entity';
import { CustomerPhone } from '../src/entities/CustomerPhone.entity';
import { CustomerAddress } from '../src/entities/CustomerAddress.entity';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
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
  let auditWriter: any;

  beforeEach(async () => {
    customerRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    accountRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: getRepositoryToken(CustomerGroup), useValue: {} },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(CustomerPhone), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(CustomerAddress), useValue: {} },
        { provide: getRepositoryToken(CustomerCreditAccount), useValue: accountRepo },
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

  it('should create customer with customer code set to normalized phone number when code is omitted', async () => {
    customerRepo.findOne.mockResolvedValue(null);
    customerRepo.create.mockImplementation((dto: any) => ({ id: 'new-c-1', ...dto }));
    customerRepo.save.mockImplementation((c: any) => Promise.resolve(c));

    const saved = await service.createCustomer(
      't-1',
      {
        first_name: 'Sara',
        last_name: 'Ahmadi',
        mobile: '09121234567',
        credit_limit: '5000000',
      },
      'corr-1',
    );

    expect(customerRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 't-1',
        code: '+989121234567',
        mobile: '+989121234567',
        first_name: 'Sara',
        last_name: 'Ahmadi',
      }),
    );
    expect(saved.code).toBe('+989121234567');
  });

  it('should allow custom code when explicitly provided', async () => {
    customerRepo.findOne.mockResolvedValue(null);
    customerRepo.create.mockImplementation((dto: any) => ({ id: 'new-c-2', ...dto }));
    customerRepo.save.mockImplementation((c: any) => Promise.resolve(c));

    const saved = await service.createCustomer(
      't-1',
      {
        code: 'VIP-001',
        first_name: 'Ali',
        last_name: 'Rezaei',
        mobile: '09129998877',
      },
      'corr-2',
    );

    expect(customerRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 't-1',
        code: 'VIP-001',
        mobile: '+989129998877',
      }),
    );
    expect(saved.code).toBe('VIP-001');
  });

  it('should throw ConflictException if customer code already exists', async () => {
    customerRepo.findOne.mockResolvedValue({ id: 'c-existing', code: '+989121234567' });

    await expect(
      service.createCustomer(
        't-1',
        {
          first_name: 'Duplicate',
          last_name: 'User',
          mobile: '09121234567',
        },
        'corr-3',
      ),
    ).rejects.toThrow();
  });

  it('should throw BadRequestException if mobile phone is empty and no code is provided', async () => {
    await expect(
      service.createCustomer(
        't-1',
        {
          first_name: 'No',
          last_name: 'Phone',
          mobile: '',
        },
        'corr-4',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
