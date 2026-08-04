import { Test, TestingModule } from '@nestjs/testing';
import { CashDrawerService } from '../src/modules/cash-drawer/cash-drawer.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CashDrawerShift } from '../src/entities/CashDrawerShift.entity';
import { CashDrawerTransaction } from '../src/entities/CashDrawerTransaction.entity';
import { Payment } from '../src/entities/Payment.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('CashDrawerService (Unit)', () => {
  let service: CashDrawerService;
  let shiftRepo: any;
  let txRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    shiftRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    txRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashDrawerService,
        { provide: getRepositoryToken(CashDrawerShift), useValue: shiftRepo },
        { provide: getRepositoryToken(CashDrawerTransaction), useValue: txRepo },
        { provide: getRepositoryToken(Payment), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(PaymentMethod), useValue: { findOne: jest.fn() } },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<CashDrawerService>(CashDrawerService);
  });

  it('should throw ConflictException if open shift already exists when opening shift', async () => {
    shiftRepo.findOne.mockResolvedValue({ id: 's-1', shift_number: 'SHIFT-1001', status: 'OPEN' });

    await expect(
      service.openShift('t-1', { branch_id: 'b-1', terminal_id: 'term-1', user_id: 'u-1', opening_float: '5000000.0000' }, 'corr-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('should throw BadRequestException if PAY_OUT lacks reason code', async () => {
    shiftRepo.findOne.mockResolvedValue({ id: 's-1', status: 'OPEN' });

    await expect(
      service.postTransaction('t-1', 's-1', { transaction_type: 'PAY_OUT', amount: '200000.0000' }, 'corr-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
