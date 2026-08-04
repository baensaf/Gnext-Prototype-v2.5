import { Test, TestingModule } from '@nestjs/testing';
import { KdsService } from '../src/modules/kds/kds.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KitchenStation } from '../src/entities/KitchenStation.entity';
import { KitchenTicket } from '../src/entities/KitchenTicket.entity';
import { KitchenTicketItem } from '../src/entities/KitchenTicketItem.entity';
import { PrinterDevice } from '../src/entities/PrinterDevice.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('KdsService (Unit)', () => {
  let service: KdsService;
  let stationRepo: any;
  let ticketRepo: any;
  let itemRepo: any;
  let printerRepo: any;
  let orderRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    stationRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    ticketRepo = { findOne: jest.fn(), find: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn(), save: jest.fn() };
    itemRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    printerRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KdsService,
        { provide: getRepositoryToken(KitchenStation), useValue: stationRepo },
        { provide: getRepositoryToken(KitchenTicket), useValue: ticketRepo },
        { provide: getRepositoryToken(KitchenTicketItem), useValue: itemRepo },
        { provide: getRepositoryToken(PrinterDevice), useValue: printerRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<KdsService>(KdsService);
  });

  it('should generate kitchen ticket from order and map order line items', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-kds-1',
      order_number: 'ORD-501',
      order_type: 'DINE_IN',
      table_number: '5',
      items: [
        { id: 'item-1', product_name: 'Cheeseburger', quantity: '2.0000', options: [{ option_item_name: 'Extra Cheese' }] },
      ],
    });
    stationRepo.findOne.mockResolvedValue({ id: 'st-hot', name: 'Hot Kitchen' });
    ticketRepo.create.mockImplementation((dto) => dto);
    ticketRepo.save.mockImplementation((dto) => Promise.resolve({ ...dto, id: 'tkt-1', ticket_number: 'K-101' }));
    itemRepo.create.mockImplementation((dto) => dto);

    const ticket = await service.generateTicketsForOrder('t-1', 'ord-kds-1', 'corr-kds-1');

    expect(ticket.ticket_number).toBe('K-101');
    expect(itemRepo.save).toHaveBeenCalledWith(expect.objectContaining({ product_name: 'Cheeseburger', options_summary: 'Extra Cheese' }));
  });

  it('should bump ticket and update status to BUMPED', async () => {
    ticketRepo.findOne.mockResolvedValue({ id: 'tkt-1', tenant_id: 't-1', status: 'IN_PREPARATION' });
    ticketRepo.save.mockImplementation((t) => Promise.resolve(t));
    itemRepo.find.mockResolvedValue([{ id: 'it-1', status: 'PENDING' }]);

    const bumped = await service.bumpTicket('t-1', 'tkt-1', 'corr-bump');

    expect(bumped.status).toBe('BUMPED');
    expect(itemRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'DONE' }));
  });

  it('should generate simulated ASCII thermal print chit payload', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-print',
      order_number: 'ORD-700',
      order_type: 'TAKEAWAY',
      placed_at: new Date(),
      items: [
        { product_name: 'Pepperoni Pizza', quantity: '1.0000', options: [] },
      ],
    });

    const result = await service.simulatePrint('t-1', { order_id: 'ord-print', paper_width_mm: 80 });

    expect(result.paper_width_mm).toBe(80);
    expect(result.raw_ascii_chit).toContain('KITCHEN PREPARATION CHIT');
    expect(result.raw_ascii_chit).toContain('Pepperoni Pizza');
  });
});
