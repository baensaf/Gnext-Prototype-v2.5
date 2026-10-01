import { Test, TestingModule } from '@nestjs/testing';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { BranchOperatingHour } from '../src/entities/BranchOperatingHour.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('TenantService (Unit)', () => {
  let service: TenantService;
  let branchRepo: any;
  let hoursRepo: any;
  let terminalRepo: any;
  let tenantRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    tenantRepo = { findOne: jest.fn() };
    branchRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
    hoursRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    terminalRepo = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(Branch), useValue: branchRepo },
        { provide: getRepositoryToken(BranchOperatingHour), useValue: hoursRepo },
        { provide: getRepositoryToken(Terminal), useValue: terminalRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<TenantService>(TenantService);
  });

  /** A manager whose transaction runs on itself, saving into `saved`. */
  const fakeManager = (taken: string[] = []) => {
    const saved: any[] = [];
    const em: any = {
      find: jest.fn().mockResolvedValue(taken.map((code) => ({ code }))),
      create: jest.fn((_entity: any, dto: any) => ({ ...dto })),
      save: jest.fn((_entity: any, row: any) => {
        saved.push(row);
        return Promise.resolve({ id: `row-${saved.length}`, ...row });
      }),
    };
    em.transaction = jest.fn((work: any) => work(em));
    return { em, saved };
  };
  const titleFree = (clash: any = null) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(clash),
  });
  const pin = { latitude: 35.6997, longitude: 51.338 };

  it('refuses a new branch without a pin on the map', async () => {
    branchRepo.createQueryBuilder = jest.fn(() => titleFree());
    await expect(service.createBranch('t-1', { name: 'Tehran South' }, 'corr-1')).rejects.toThrow(BadRequestException);
  });

  it('refuses a title another branch of the chain already has', async () => {
    branchRepo.createQueryBuilder = jest.fn(() => titleFree({ id: 'b-1', name: 'Tehran South' }));
    await expect(service.createBranch('t-1', { name: 'tehran south', ...pin }, 'corr-1')).rejects.toThrow(ConflictException);
  });

  it('creates a branch with its pin, a made-up code and its week of hours in one go', async () => {
    branchRepo.createQueryBuilder = jest.fn(() => titleFree());
    const { em, saved } = fakeManager(['B01']);
    branchRepo.manager = em;

    const result = await service.createBranch(
      't-1',
      {
        name: 'Tehran South',
        ...pin,
        hours: [
          { day_of_week: 6, open_time: '11:00', close_time: '15:00' },
          { day_of_week: 6, open_time: '18:00', close_time: '02:00' },
          { day_of_week: 5, is_closed: true },
        ],
      },
      'corr-1',
    );

    expect(result.code).toBe('B02');
    expect(result.latitude).toBe(35.6997);
    expect(em.transaction).toHaveBeenCalledTimes(1);
    const hours = saved.filter((row) => row.day_of_week !== undefined);
    expect(hours).toHaveLength(3);
    expect(hours.find((h) => h.open_time === '18:00:00')).toMatchObject({ close_time: '02:00:00', spans_midnight: true });
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'BRANCH_CREATED' }));
  });

  it('refuses a shift past midnight that runs into the next day', async () => {
    branchRepo.createQueryBuilder = jest.fn(() => titleFree());
    await expect(
      service.createBranch(
        't-1',
        {
          name: 'Tehran South',
          ...pin,
          hours: [
            { day_of_week: 6, open_time: '18:00', close_time: '03:00' },
            { day_of_week: 0, open_time: '02:00', close_time: '15:00' },
          ],
        },
        'corr-1',
      ),
    ).rejects.toThrow('runs into');
  });

  it('should get terminals filtered by branchId', async () => {
    terminalRepo.find.mockResolvedValue([{ id: 't-1', code: 'TEH-SOUTH-POS-1' }]);
    const result = await service.getTerminals('t-1', 'b-new');
    expect(result.length).toBe(1);
    expect(terminalRepo.find).toHaveBeenCalledWith({ where: { tenant_id: 't-1', branch_id: 'b-new' }, order: { code: 'ASC' } });
  });
});
