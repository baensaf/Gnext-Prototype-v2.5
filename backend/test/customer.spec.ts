import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService, normalizePhone, normalizeBirthDate } from '../src/modules/customer/customer.service';
import { getRepositoryToken } from '@nestjs/typeorm';
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
  let addressRepo: any;

  beforeEach(async () => {
    customerRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    accountRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };
    addressRepo = { create: jest.fn((dto: any) => dto), save: jest.fn((a: any) => Promise.resolve(a)), update: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(CustomerPhone), useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(CustomerAddress), useValue: addressRepo },
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

  it('refuses a second customer with the same mobile written another way', async () => {
    customerRepo.findOne.mockResolvedValue(null);
    // CUST-1001 keeps the number as 0912…; the till types it as +98 912 ….
    customerRepo.find.mockResolvedValue([{ id: 'c-1', code: 'CUST-1001', first_name: 'Reza', last_name: 'Mohammadi', mobile: '09121234567' }]);

    await expect(
      service.createCustomer('t-1', { first_name: 'Reza', last_name: 'M', mobile: '+98 912 123 4567' }, 'corr-3'),
    ).rejects.toThrow(ConflictException);
    expect(customerRepo.save).not.toHaveBeenCalled();
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

  describe('birth date', () => {
    it('keeps the calendar day, dropping any time that came with it', () => {
      // Midnight Tehran sent as an instant is the previous day in UTC. Truncating rather
      // than converting is what stops an evening birthday sliding back a day.
      expect(normalizeBirthDate('1990-03-21T00:00:00+03:30')).toBe('1990-03-21');
      expect(normalizeBirthDate('1990-03-21')).toBe('1990-03-21');
    });

    it('treats blank and missing alike as no birthday', () => {
      expect(normalizeBirthDate(undefined)).toBeNull();
      expect(normalizeBirthDate(null)).toBeNull();
      expect(normalizeBirthDate('   ')).toBeNull();
    });

    it('refuses a date that is not a real day', () => {
      // 31 February parses in JavaScript by rolling into March, which would silently store
      // a birthday nobody typed.
      expect(() => normalizeBirthDate('1990-02-31')).toThrow(BadRequestException);
      expect(() => normalizeBirthDate('21-03-1990')).toThrow(BadRequestException);
    });

    it('refuses a birthday in the future', () => {
      const nextYear = new Date().getFullYear() + 1;
      expect(() => normalizeBirthDate(`${nextYear}-01-01`)).toThrow(BadRequestException);
    });
  });

  describe('blocking a customer', () => {
    beforeEach(() => {
      customerRepo.findOne.mockResolvedValue({
        id: 'c-9',
        tenant_id: 't-1',
        first_name: 'Reza',
        last_name: 'Karimi',
        is_blocked: false,
      });
      customerRepo.save.mockImplementation((c: any) => Promise.resolve(c));
    });

    it('records who, when and why, so the cashier can be told', async () => {
      const saved = await service.setBlocked(
        't-1',
        'c-9',
        true,
        '  repeated false addresses  ',
        'corr-5',
        'u-1',
      );

      expect(saved.is_blocked).toBe(true);
      expect(saved.blocked_reason).toBe('repeated false addresses');
      expect(saved.blocked_by).toBe('u-1');
      expect(saved.blocked_at).toBeInstanceOf(Date);
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CUSTOMER_BLOCKED' }),
      );
    });

    it('refuses to block without a reason', async () => {
      await expect(service.setBlocked('t-1', 'c-9', true, '   ', 'corr-6', 'u-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('clears the reason and the stamps when the block is lifted', async () => {
      const saved = await service.setBlocked('t-1', 'c-9', false, undefined, 'corr-7', 'u-2');

      expect(saved.is_blocked).toBe(false);
      expect(saved.blocked_reason).toBeNull();
      expect(saved.blocked_at).toBeNull();
      expect(saved.blocked_by).toBeNull();
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CUSTOMER_UNBLOCKED' }),
      );
    });
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

  describe('one-step registration (2026-10-03)', () => {
    beforeEach(() => {
      customerRepo.findOne.mockResolvedValue(null);
      customerRepo.find.mockResolvedValue([]);
      customerRepo.create.mockImplementation((dto: any) => ({ id: 'new-c', ...dto }));
      customerRepo.save.mockImplementation((c: any) => Promise.resolve(c));
      accountRepo.create.mockImplementation((dto: any) => dto);
    });

    it('takes the whole name in one box, the mobile as the code, gender and wedding date', async () => {
      const saved = await service.createCustomer(
        't-1',
        { name: '  Sara Ahmadi ', mobile: '09121234567', gender: 'female', marriage_date: '2015-06-01' } as any,
        'corr',
      );
      expect(saved).toMatchObject({ first_name: 'Sara Ahmadi', last_name: '', code: '+989121234567', gender: 'FEMALE', marriage_date: '2015-06-01' });
    });

    it('refuses an empty name, an unknown gender and a wedding date in the future', async () => {
      await expect(service.createCustomer('t-1', { name: ' ', mobile: '09121234567' } as any, 'corr')).rejects.toThrow(BadRequestException);
      await expect(service.createCustomer('t-1', { name: 'A', mobile: '09121234567', gender: 'X' } as any, 'corr')).rejects.toThrow('gender');
      await expect(service.createCustomer('t-1', { name: 'A', mobile: '09121234567', marriage_date: '2999-01-01' } as any, 'corr')).rejects.toThrow('marriage_date');
      expect(customerRepo.save).not.toHaveBeenCalled();
    });

    it('saves the addresses typed with the customer, the first as default, with an optional pin', async () => {
      await service.createCustomer(
        't-1',
        {
          name: 'Sara',
          mobile: '09121234567',
          addresses: [
            { title: 'Home', address_text: 'Valiasr St. 12', postal_code: '1234567890', latitude: 35.7, longitude: 51.4 },
            { title: '', address_text: 'Office tower' },
          ],
        } as any,
        'corr',
      );
      expect(addressRepo.save).toHaveBeenCalledTimes(2);
      expect(addressRepo.create.mock.calls[0][0]).toMatchObject({ customer_id: 'new-c', title: 'Home', latitude: '35.7000000', longitude: '51.4000000', is_default: true });
      expect(addressRepo.create.mock.calls[1][0]).toMatchObject({ title: 'Home', address_text: 'Office tower', latitude: null, is_default: false });
    });

    it('refuses an address with no text or half a pin before saving anything', async () => {
      await expect(
        service.createCustomer('t-1', { name: 'Sara', mobile: '09121234567', addresses: [{ title: 'Home', address_text: ' ' }] } as any, 'corr'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createCustomer('t-1', { name: 'Sara', mobile: '09121234567', addresses: [{ address_text: 'x', latitude: 35 }] } as any, 'corr'),
      ).rejects.toThrow(BadRequestException);
      expect(customerRepo.save).not.toHaveBeenCalled();
    });
  });
});

