import { Test, TestingModule } from '@nestjs/testing';
import { DineInService } from '../src/modules/dine-in/dine-in.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DiningArea } from '../src/entities/DiningArea.entity';
import { DiningTable } from '../src/entities/DiningTable.entity';
import { TableSession } from '../src/entities/TableSession.entity';
import { TableOccupancyEvent } from '../src/entities/TableOccupancyEvent.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderLink } from '../src/entities/OrderLink.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { OrderTransitionRecorder } from '../src/modules/order-lifecycle/order-transition-recorder.service';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

describe('DineInService & Operations (Unit)', () => {
  let service: DineInService;
  let areaRepo: any;
  let tableRepo: any;
  let sessionRepo: any;
  let occupancyRepo: any;
  let orderRepo: any;
  let auditWriter: any;
  let transitionRecorder: any;
  let dataSource: any;

  beforeEach(async () => {
    areaRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn(), findOne: jest.fn() };
    tableRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
    sessionRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    occupancyRepo = { create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
    auditWriter = { write: jest.fn() };
    transitionRecorder = { record: jest.fn() };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb({
        findOne: jest.fn(),
        find: jest.fn(),
        save: jest.fn((entity, obj) => Promise.resolve(obj || entity)),
        create: jest.fn((entity, obj) => obj),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DineInService,
        { provide: getRepositoryToken(DiningArea), useValue: areaRepo },
        { provide: getRepositoryToken(DiningTable), useValue: tableRepo },
        { provide: getRepositoryToken(TableSession), useValue: sessionRepo },
        { provide: getRepositoryToken(TableOccupancyEvent), useValue: occupancyRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: OrderTransitionRecorder, useValue: transitionRecorder },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<DineInService>(DineInService);
  });

  it('should seat guests on an available table and transition status to OCCUPIED', async () => {
    tableRepo.findOne.mockResolvedValue({ id: 'tbl-1', table_number: '1' });
    sessionRepo.findOne.mockResolvedValue(null); // Table available
    sessionRepo.create.mockImplementation((dto) => dto);
    sessionRepo.save.mockImplementation((dto) => Promise.resolve({ ...dto, id: 'sess-1' }));
    occupancyRepo.create.mockImplementation((dto) => dto);

    const session = await service.seatGuests('t-1', 'tbl-1', 4, undefined, 'corr-seat');

    expect(session.status).toBe('OCCUPIED');
    expect(session.guest_count).toBe(4);
    expect(occupancyRepo.save).toHaveBeenCalled();
  });

  /** An EntityManager for releaseTable, with `activeOrder` as the order holding the table. */
  const releaseEm = (session: any, activeOrder: any) => ({
    findOne: jest.fn().mockImplementation((entity: any) => {
      if (entity === DiningTable) return Promise.resolve({ id: 'tbl-1', table_number: '1' });
      if (entity === TableSession) return Promise.resolve(session);
      return Promise.resolve(null);
    }),
    createQueryBuilder: jest.fn().mockReturnValue({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(activeOrder),
    }),
    save: jest.fn().mockImplementation((entity: any, obj: any) => Promise.resolve(obj || entity)),
    create: jest.fn().mockImplementation((entity: any, obj: any) => obj),
  });

  it('should release table and set closed_at timestamp', async () => {
    // releaseTable now does its work inside a transaction, because freeing a table has to
    // settle the order holding it as well as close the session. That means it reads and
    // writes through the EntityManager, not through the repositories this suite stubs.
    const session: any = { id: 'sess-1', table_id: 'tbl-1', status: 'OCCUPIED', closed_at: null };
    // No order is holding the table, so the release is just the session close.
    const mockEm = releaseEm(session, null);
    dataSource.transaction.mockImplementation((cb: any) => cb(mockEm));

    const result = await service.releaseTable('t-1', 'tbl-1', 'AVAILABLE', 'corr-release');

    expect(result.success).toBe(true);
    expect(mockEm.save).toHaveBeenCalledWith(
      TableSession,
      expect.objectContaining({ status: 'AVAILABLE' }),
    );
    expect(session.closed_at).toBeInstanceOf(Date);
    expect(transitionRecorder.record).not.toHaveBeenCalled();
  });

  it('completes the paid order holding a released table and records the transition', async () => {
    const session: any = { id: 'sess-1', table_id: 'tbl-1', status: 'OCCUPIED', closed_at: null };
    const order: any = { id: 'ord-5', tenant_id: 't-1', table_id: 'tbl-1', state: 'READY', outstanding_total: '0.0000' };
    const mockEm = releaseEm(session, order);
    dataSource.transaction.mockImplementation((cb: any) => cb(mockEm));

    await service.releaseTable('t-1', 'tbl-1', 'AVAILABLE', 'corr-release', 'user-1');

    expect(order.state).toBe('COMPLETED');
    expect(order.completed_at).toBeInstanceOf(Date);
    // The history row, sync event and loyalty cashback come from the recorder, in the same
    // transaction as the save.
    expect(transitionRecorder.record).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({ tenantId: 't-1', order, fromState: 'READY', action: 'COMPLETE', userId: 'user-1' }),
    );
  });

  it('refuses to release a table whose order still owes money', async () => {
    const session: any = { id: 'sess-1', table_id: 'tbl-1', status: 'OCCUPIED', closed_at: null };
    const order: any = { id: 'ord-6', tenant_id: 't-1', table_id: 'tbl-1', state: 'SUBMITTED', outstanding_total: '50000.0000' };
    dataSource.transaction.mockImplementation((cb: any) => cb(releaseEm(session, order)));

    await expect(service.releaseTable('t-1', 'tbl-1', 'AVAILABLE')).rejects.toThrow(BadRequestException);
    expect(order.state).toBe('SUBMITTED');
    expect(transitionRecorder.record).not.toHaveBeenCalled();
  });

  it('should sort lock IDs alphabetically to prevent deadlocks in moveTable', async () => {
    const lockOrder: string[] = [];
    const mockEm = {
      findOne: jest.fn().mockImplementation((entity, opts) => {
        if (opts.where && opts.where.id) {
          lockOrder.push(opts.where.id);
        }
        if (entity === OrderHeader) {
          return Promise.resolve({ id: 'ord-99', tenant_id: 't-1', table_id: 'tbl-B', state: 'SUBMITTED', guest_count: 2 });
        }
        return Promise.resolve({ id: opts.where.id, is_active: true, table_number: '10' });
      }),
      save: jest.fn().mockImplementation((entity, obj) => Promise.resolve(obj || entity)),
      create: jest.fn().mockImplementation((entity, obj) => obj),
    };
    dataSource.transaction.mockImplementation((cb) => cb(mockEm));

    // Order ID 'ord-99', Target table 'tbl-A', Source table 'tbl-B'
    await service.moveTable('t-1', 'ord-99', 'tbl-A', 3, 'user-1', 'corr-move');

    // Filter lock order for initial FOR UPDATE locks
    const initialLocks = lockOrder.slice(0, 3);
    const sorted = [...initialLocks].sort();
    expect(initialLocks).toEqual(sorted);
  });
});
