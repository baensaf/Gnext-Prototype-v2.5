import { Test, TestingModule } from '@nestjs/testing';
import { KdsService } from '../src/modules/kds/kds.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KitchenStation } from '../src/entities/KitchenStation.entity';
import { KdsScreen } from '../src/entities/KdsScreen.entity';
import { KdsRoutingRule } from '../src/entities/KdsRoutingRule.entity';
import { KitchenTicket } from '../src/entities/KitchenTicket.entity';
import { KitchenTicketItem } from '../src/entities/KitchenTicketItem.entity';
import { KdsEvent } from '../src/entities/KdsEvent.entity';
import { Printer } from '../src/entities/Printer.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { Product } from '../src/entities/Product.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('KdsService (Unit & Integration)', () => {
  let service: KdsService;
  let stationRepo: any;
  let screenRepo: any;
  let ruleRepo: any;
  let ticketRepo: any;
  let itemRepo: any;
  let kdsEventRepo: any;
  let printerRepo: any;
  let orderRepo: any;
  let productRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    stationRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), softDelete: jest.fn() };
    screenRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), softDelete: jest.fn() };
    ruleRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), softDelete: jest.fn() };
    ticketRepo = { findOne: jest.fn(), find: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn(), save: jest.fn() };
    itemRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    kdsEventRepo = { create: jest.fn().mockImplementation((e) => e), save: jest.fn().mockImplementation((e) => Promise.resolve(e)) };
    printerRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    orderRepo = { findOne: jest.fn(), save: jest.fn() };
    productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'prod-1', category_id: 'cat-hot-dishes' }) };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KdsService,
        { provide: getRepositoryToken(KitchenStation), useValue: stationRepo },
        { provide: getRepositoryToken(KdsScreen), useValue: screenRepo },
        { provide: getRepositoryToken(KdsRoutingRule), useValue: ruleRepo },
        { provide: getRepositoryToken(KitchenTicket), useValue: ticketRepo },
        { provide: getRepositoryToken(KitchenTicketItem), useValue: itemRepo },
        { provide: getRepositoryToken(KdsEvent), useValue: kdsEventRepo },
        { provide: getRepositoryToken(Printer), useValue: printerRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<KdsService>(KdsService);
  });

  it('should evaluate product routing rules over category and default rules', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-kds-1',
      branch_id: 'br-1',
      order_number: 'ORD-501',
      order_type: 'DINE_IN',
      table_number: '5',
      items: [
        { id: 'item-1', product_id: 'prod-burger', product_name: 'Cheeseburger', quantity: '2.0000', options: [{ option_item_name: 'Extra Cheese' }] },
      ],
    });

    ruleRepo.find.mockResolvedValue([
      { id: 'rule-prod', station_id: 'st-grill', product_id: 'prod-burger', priority: 10 },
      { id: 'rule-cat', station_id: 'st-main', category_id: 'cat-fastfood', priority: 5 },
    ]);

    stationRepo.findOne.mockResolvedValue({ id: 'st-grill', name: 'Grill Station', target_minutes: 10 });
    ticketRepo.findOne.mockResolvedValue(null);
    ticketRepo.create.mockImplementation((dto) => dto);
    ticketRepo.save.mockImplementation((dto) => Promise.resolve({ ...dto, id: 'tkt-1', ticket_number: 'K-101' }));
    itemRepo.create.mockImplementation((dto) => dto);

    const tickets = await service.generateTicketsForOrder('t-1', 'ord-kds-1');

    expect(tickets.length).toBe(1);
    expect(tickets[0].station_id).toBe('st-grill');
    expect(itemRepo.save).toHaveBeenCalledWith(expect.objectContaining({ product_name: 'Cheeseburger' }));
  });

  it('does not send an aggregator order to the kitchen before the store accepts it', async () => {
    const orders = [
      { id: 'ord-pos', tenant_id: 't-1', status: 'SUBMITTED' },
      { id: 'ord-snp', tenant_id: 't-1', status: 'PENDING_ACCEPTANCE' },
    ];
    // Evaluate the sweep's status filter the way the database would.
    orderRepo.find = jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(orders.filter((o) => (where.status.value as string[]).includes(o.status))),
    );
    ticketRepo.findOne.mockResolvedValue(null);
    ticketRepo.find.mockResolvedValue([]);
    const generate = jest.spyOn(service, 'generateTicketsForOrder').mockResolvedValue([] as any);

    await service.getKdsTickets('t-1');

    expect(generate).toHaveBeenCalledWith('t-1', 'ord-pos', 'auto-kds-sync');
    expect(generate).not.toHaveBeenCalledWith('t-1', 'ord-snp', expect.anything());
  });

  it('should start, bump, recall tickets and perform order readiness roll-up', async () => {
    ticketRepo.findOne.mockResolvedValue({ id: 'tkt-1', tenant_id: 't-1', order_id: 'ord-1', state: 'NEW' });
    ticketRepo.save.mockImplementation((t) => Promise.resolve(t));
    itemRepo.find.mockResolvedValue([{ id: 'it-1', state: 'NEW' }]);

    // Start
    const started = await service.startTicket('t-1', 'tkt-1');
    expect(started.state).toBe('IN_PROGRESS');

    // Bump
    ticketRepo.find.mockResolvedValue([{ id: 'tkt-1', state: 'READY' }]);
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', tenant_id: 't-1', status: 'SUBMITTED' });
    const bumped = await service.bumpTicket('t-1', 'tkt-1', 'corr-bump');

    expect(bumped.state).toBe('READY');
    expect(orderRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'READY' }));

    // Recall
    const recalled = await service.recallTicket('t-1', 'tkt-1', 'corr-recall');
    expect(recalled.state).toBe('IN_PROGRESS');
  });

  it('leaves a voided item cancelled when the ticket is bumped', async () => {
    ticketRepo.findOne.mockResolvedValue({ id: 'tkt-1', tenant_id: 't-1', order_id: 'ord-1', state: 'IN_PROGRESS' });
    ticketRepo.save.mockImplementation((t) => Promise.resolve(t));
    ticketRepo.find.mockResolvedValue([{ id: 'tkt-1', state: 'READY' }]);
    orderRepo.findOne.mockResolvedValue({ id: 'ord-1', tenant_id: 't-1', status: 'CANCELLED' });
    const ticketItems = [
      { id: 'it-1', state: 'IN_PROGRESS' },
      { id: 'it-2', state: 'CANCELLED' },
    ];
    itemRepo.find.mockResolvedValue(ticketItems);

    await service.bumpTicket('t-1', 'tkt-1', 'corr-bump');

    expect(ticketItems[0].state).toBe('READY');
    expect(ticketItems[1].state).toBe('CANCELLED');
  });

  it('should set ticket priority and record event', async () => {
    ticketRepo.findOne.mockResolvedValue({ id: 'tkt-1', tenant_id: 't-1', priority: 0, state: 'IN_PROGRESS' });
    ticketRepo.save.mockImplementation((t) => Promise.resolve(t));

    const updated = await service.setTicketPriority('t-1', 'tkt-1', 9);

    expect(updated.priority).toBe(9);
    expect(kdsEventRepo.save).toHaveBeenCalledWith(expect.objectContaining({ action: 'PRIORITY_CHANGE' }));
  });
});
