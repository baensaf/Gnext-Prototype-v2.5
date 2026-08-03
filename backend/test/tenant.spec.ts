import { Test, TestingModule } from '@nestjs/testing';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { BranchOperatingHour } from '../src/entities/BranchOperatingHour.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { BranchStatusSnapshot } from '../src/entities/BranchStatusSnapshot.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('TenantService (Unit)', () => {
  let service: TenantService;
  let branchRepo: any;
  let hoursRepo: any;
  let terminalRepo: any;
  let tenantRepo: any;
  let statusRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    tenantRepo = { findOne: jest.fn() };
    branchRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
    hoursRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    terminalRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
    statusRepo = { findOne: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(Branch), useValue: branchRepo },
        { provide: getRepositoryToken(BranchOperatingHour), useValue: hoursRepo },
        { provide: getRepositoryToken(Terminal), useValue: terminalRepo },
        { provide: getRepositoryToken(BranchStatusSnapshot), useValue: statusRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<TenantService>(TenantService);
  });

  it('should throw ConflictException when creating branch with duplicate code', async () => {
    branchRepo.findOne.mockResolvedValue({ id: 'b-1', code: 'TEH-CENTRAL' });
    await expect(service.createBranch('t-1', { code: 'TEH-CENTRAL', name: 'Tehran Central' }, 'corr-1')).rejects.toThrow(ConflictException);
  });

  it('should create branch and initialize 7-day operating hours', async () => {
    branchRepo.findOne.mockResolvedValue(null);
    branchRepo.create.mockImplementation((dto: any) => ({ id: 'b-new', ...dto }));
    branchRepo.save.mockImplementation((b: any) => Promise.resolve(b));
    hoursRepo.create.mockImplementation((dto: any) => ({ id: 'h-new', ...dto }));
    hoursRepo.save.mockImplementation((h: any) => Promise.resolve(h));

    const result = await service.createBranch('t-1', { code: 'TEH-SOUTH', name: 'Tehran South' }, 'corr-1');

    expect(result.code).toBe('TEH-SOUTH');
    expect(hoursRepo.save).toHaveBeenCalledTimes(7);
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'BRANCH_CREATED' }));
  });

  it('should get terminals filtered by branchId', async () => {
    terminalRepo.find.mockResolvedValue([{ id: 't-1', code: 'TEH-SOUTH-POS-1' }]);
    const result = await service.getTerminals('t-1', 'b-new');
    expect(result.length).toBe(1);
    expect(terminalRepo.find).toHaveBeenCalledWith({ where: { tenant_id: 't-1', branch_id: 'b-new' }, order: { code: 'ASC' } });
  });
});
