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
  /** The chain's branches as assertTitleFree reads them, archived ones included. */
  const existingBranches = (rows: any[] = []) => branchRepo.find.mockResolvedValue(rows);
  const pin = { latitude: 35.6997, longitude: 51.338 };
  /** A whole week: Saturday 18:00-02:00, Friday closed, other days 11:00-04:00. */
  const week = [
    { day_of_week: 6, open_time: '18:00', close_time: '02:00' },
    { day_of_week: 5, is_closed: true },
    ...[0, 1, 2, 3, 4].map((day) => ({ day_of_week: day, open_time: '11:00', close_time: '04:00' })),
  ];

  it('refuses a new branch without a pin on the map', async () => {
    existingBranches();
    await expect(service.createBranch('t-1', { name: 'Tehran South', hours: week }, 'corr-1')).rejects.toThrow(BadRequestException);
  });

  it('refuses a new branch without hours for all seven days', async () => {
    existingBranches();
    await expect(service.createBranch('t-1', { name: 'Tehran South', ...pin, hours: week.slice(0, 3) }, 'corr-1')).rejects.toThrow(
      'all seven days',
    );
  });

  // Codex review 2, F-23: seven values are not seven days, and an open day says both times.
  it('refuses a week with a day that does not exist, or an open day without its times', async () => {
    existingBranches();
    const badDay = week.map((h) => (h.day_of_week === 5 ? { ...h, day_of_week: 7 } : h));
    await expect(service.createBranch('t-1', { name: 'Tehran South', ...pin, hours: badDay }, 'corr-1')).rejects.toThrow(
      'not a day of the week',
    );
    const noClose = week.map((h) => (h.day_of_week === 0 ? { day_of_week: 0, open_time: '11:00' } : h));
    await expect(service.createBranch('t-1', { name: 'Tehran South', ...pin, hours: noClose }, 'corr-1')).rejects.toThrow(
      'not a time',
    );
  });

  it('refuses a title another branch of the chain already has, ignoring case and spaces', async () => {
    existingBranches([{ id: 'b-1', name: 'Tehran South', deleted_at: null }]);
    await expect(service.createBranch('t-1', { name: '  tehran south ', ...pin, hours: week }, 'corr-1')).rejects.toThrow(ConflictException);
  });

  it('keeps an archived branch title reserved', async () => {
    existingBranches([{ id: 'b-1', name: 'Tehran South', deleted_at: new Date() }]);
    await expect(service.createBranch('t-1', { name: 'Tehran South', ...pin, hours: week }, 'corr-1')).rejects.toThrow('reserved');
  });

  it('creates a branch with its pin, a made-up code and its week of hours in one go', async () => {
    existingBranches();
    const { em, saved } = fakeManager(['B01']);
    branchRepo.manager = em;

    const result = await service.createBranch('t-1', { name: 'Tehran South', ...pin, hours: week }, 'corr-1');

    expect(result.code).toBe('B02');
    expect(result.latitude).toBe(35.6997);
    expect(em.transaction).toHaveBeenCalledTimes(1);
    const hours = saved.filter((row) => row.day_of_week !== undefined);
    expect(hours).toHaveLength(7);
    expect(hours.find((h) => h.open_time === '18:00:00')).toMatchObject({ close_time: '02:00:00', spans_midnight: true });
    expect(hours.find((h) => h.day_of_week === 5)).toMatchObject({ is_closed: true });
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'BRANCH_CREATED' }));
  });

  it('refuses hours past midnight that close after the next day opens', async () => {
    existingBranches();
    const late = week.map((h) => (h.day_of_week === 6 ? { ...h, close_time: '12:00' } : h));
    await expect(service.createBranch('t-1', { name: 'Tehran South', ...pin, hours: late }, 'corr-1')).rejects.toThrow(
      'after the next day opens',
    );
  });

  it('refuses a second opening time on the same day (V4)', async () => {
    existingBranches();
    const split = [...week, { day_of_week: 6, open_time: '11:00', close_time: '15:00' }];
    await expect(service.createBranch('t-1', { name: 'Tehran South', ...pin, hours: split }, 'corr-1')).rejects.toThrow(
      'more than one opening time',
    );
  });

  it('should get terminals filtered by branchId', async () => {
    terminalRepo.find.mockResolvedValue([{ id: 't-1', code: 'TEH-SOUTH-POS-1' }]);
    const result = await service.getTerminals('t-1', 'b-new');
    expect(result.length).toBe(1);
    expect(terminalRepo.find).toHaveBeenCalledWith({ where: { tenant_id: 't-1', branch_id: 'b-new' }, order: { code: 'ASC' } });
  });
});
