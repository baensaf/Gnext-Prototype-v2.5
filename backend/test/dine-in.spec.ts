import { Test, TestingModule } from '@nestjs/testing';
import { DineInService } from '../src/modules/dine-in/dine-in.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DiningArea } from '../src/entities/DiningArea.entity';
import { DiningTable } from '../src/entities/DiningTable.entity';
import { TableSession } from '../src/entities/TableSession.entity';
import { TableEvent } from '../src/entities/TableEvent.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException } from '@nestjs/common';

describe('DineInService (Unit)', () => {
  let service: DineInService;
  let areaRepo: any;
  let tableRepo: any;
  let sessionRepo: any;
  let eventRepo: any;
  let orderRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    areaRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    tableRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    sessionRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    eventRepo = { create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DineInService,
        { provide: getRepositoryToken(DiningArea), useValue: areaRepo },
        { provide: getRepositoryToken(DiningTable), useValue: tableRepo },
        { provide: getRepositoryToken(TableSession), useValue: sessionRepo },
        { provide: getRepositoryToken(TableEvent), useValue: eventRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<DineInService>(DineInService);
  });

  it('should seat guests on an available table and transition status to OCCUPIED', async () => {
    tableRepo.findOne.mockResolvedValue({ id: 'tbl-1', table_number: '1' });
    sessionRepo.findOne.mockResolvedValue(null); // Table available
    sessionRepo.create.mockImplementation((dto) => dto);
    sessionRepo.save.mockImplementation((dto) => Promise.resolve({ ...dto, id: 'sess-1' }));
    eventRepo.create.mockImplementation((dto) => dto);

    const session = await service.seatGuests('t-1', 'tbl-1', 4, undefined, 'corr-seat');

    expect(session.status).toBe('OCCUPIED');
    expect(session.guest_count).toBe(4);
    expect(eventRepo.save).toHaveBeenCalled();
  });

  it('should transfer table session from Table A to Table B', async () => {
    sessionRepo.findOne.mockImplementation(({ where }) => {
      if (where.table_id === 'tbl-A' && where.closed_at === null) {
        return Promise.resolve({ id: 'sess-A', table_id: 'tbl-A', active_order_id: 'ord-1' });
      }
      if (where.table_id === 'tbl-B' && where.closed_at === null) {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    sessionRepo.save.mockImplementation((s) => Promise.resolve(s));
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', table_number: '1' });
    tableRepo.findOne.mockResolvedValue({ id: 'tbl-B', table_number: '2' });

    const result = await service.transferTable('t-1', 'tbl-A', 'tbl-B', 'corr-transfer');

    expect(result.table_id).toBe('tbl-B');
    expect(orderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ table_number: '2' }));
  });

  it('should release table and set closed_at timestamp', async () => {
    sessionRepo.findOne.mockResolvedValue({ id: 'sess-1', table_id: 'tbl-1', status: 'OCCUPIED' });
    sessionRepo.save.mockImplementation((s) => Promise.resolve(s));

    const result = await service.releaseTable('t-1', 'tbl-1', 'AVAILABLE', 'corr-release');

    expect(result.success).toBe(true);
    expect(sessionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'AVAILABLE' }));
  });
});
