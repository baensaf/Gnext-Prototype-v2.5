import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SimulationService } from '../src/modules/simulation/simulation.service';
import { IntegrationLog } from '../src/entities/IntegrationLog.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { Product } from '../src/entities/Product.entity';
import { Branch } from '../src/entities/Branch.entity';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { IncomingOrderPolicyService } from '../src/modules/order/incoming-order-policy.service';

// Slice 3 of incoming orders: what the cashier needs in front of them to answer an order,
// and the Notification Center entry that records its arrival.
describe('an incoming Snappfood order carries what the store needs to answer it', () => {
  let service: SimulationService;
  let orderItemRepo: any;
  let alertRepo: any;
  let incomingPolicy: any;

  // The simulator's order form, as simulation-snappfood.tsx posts it.
  const simulatorOrder = {
    customer_name: 'Hamid Bayanak',
    customer_phone: '+989991111111',
    address: 'Tehran, Zafaraniyeh, No. 2',
    expeditionType: 'DELIVERY',
    orderPaymentTypeCode: 'ONLINE',
    notes: 'Put the food in a box',
    items: [
      { title: 'Pizza One', quantity: 2, price: 500 },
      { title: 'Pizza Two', quantity: 1, price: 600 },
    ],
  };

  beforeEach(async () => {
    incomingPolicy = { applyOnArrival: jest.fn().mockResolvedValue(null) };
    const logRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((dto: any) => Promise.resolve({ ...dto, id: 'log-1' })),
    };
    const orderRepo = {
      create: jest.fn((dto: any) => dto),
      save: jest.fn((dto: any) => Promise.resolve({ id: 'ord-1', ...dto })),
    };
    orderItemRepo = { create: jest.fn((dto: any) => dto), save: jest.fn((dto: any) => Promise.resolve(dto)) };
    alertRepo = { create: jest.fn((dto: any) => dto), save: jest.fn((dto: any) => Promise.resolve({ id: 'alert-1', ...dto })) };
    const branchRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'br-vanak', code: 'VANAK', branch_type: 'RESTAURANT' },
        { id: 'br-tajrish', code: 'TAJRISH', branch_type: 'RESTAURANT' },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulationService,
        { provide: getRepositoryToken(IntegrationLog), useValue: logRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: getRepositoryToken(Product), useValue: {} },
        { provide: getRepositoryToken(Branch), useValue: branchRepo },
        { provide: getRepositoryToken(OperationalAlert), useValue: alertRepo },
        { provide: IncomingOrderPolicyService, useValue: incomingPolicy },
        { provide: AuditWriter, useValue: { write: jest.fn() } },
      ],
    }).compile();

    service = module.get<SimulationService>(SimulationService);
  });

  it('keeps the customer, address, delivery type, payment and note on the order', async () => {
    const result: any = await service.generateSnappfoodOrder('t-1', simulatorOrder);

    for (const expected of ['Hamid Bayanak', '+989991111111', 'Tehran, Zafaraniyeh, No. 2', 'DELIVERY', 'ONLINE', 'Put the food in a box']) {
      expect(result.order.notes).toContain(expected);
    }
  });

  it("lists Snappfood's products as the order's lines, numbered in order", async () => {
    await service.generateSnappfoodOrder('t-1', simulatorOrder);

    const lines = orderItemRepo.save.mock.calls.map(([line]: any[]) => line);
    expect(lines).toEqual([
      expect.objectContaining({ product_name: 'Pizza One', quantity: '2.0000', line_number: 1 }),
      expect.objectContaining({ product_name: 'Pizza Two', quantity: '1.0000', line_number: 2 }),
    ]);
  });

  it('goes to the branch picked in the simulator', async () => {
    const result: any = await service.generateSnappfoodOrder('t-1', { ...simulatorOrder, branch_id: 'br-tajrish' });

    expect(result.order.branch_id).toBe('br-tajrish');
  });

  it('records its arrival in the Notification Center, for the branch that received it', async () => {
    const result: any = await service.generateSnappfoodOrder('t-1', { ...simulatorOrder, branch_id: 'br-tajrish' });

    expect(alertRepo.save).toHaveBeenCalledTimes(1);
    const [alert] = alertRepo.save.mock.calls[0];
    expect(alert).toEqual(
      expect.objectContaining({ tenant_id: 't-1', branch_id: 'br-tajrish', type: 'INCOMING_ORDER', severity: 'INFO', acknowledged: false }),
    );
    expect(alert.title).toContain(result.order.order_number);
  });

  // Slice 4: the branch's acceptance policy decides, as the order lands, whether it waits.
  it('puts the order through the branch acceptance policy as it lands', async () => {
    const result: any = await service.generateSnappfoodOrder('t-1', simulatorOrder);

    expect(incomingPolicy.applyOnArrival).toHaveBeenCalledWith('t-1', 'ord-1', expect.any(String));
    expect(result.order.state).toBe('PENDING_ACCEPTANCE');
  });

  it('answers with the accepted order when the policy let it straight through', async () => {
    incomingPolicy.applyOnArrival.mockResolvedValue({ id: 'ord-1', state: 'CONFIRMED' });

    const result: any = await service.generateSnappfoodOrder('t-1', simulatorOrder);

    expect(result.order).toEqual(expect.objectContaining({ id: 'ord-1', state: 'CONFIRMED' }));
  });
});
