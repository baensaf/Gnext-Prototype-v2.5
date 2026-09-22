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
import { snappfoodIntakeMocks } from './utils/snappfood-intake-mocks';

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
      findOne: jest.fn().mockResolvedValue(null),
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
        { provide: getRepositoryToken(Product), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Branch), useValue: branchRepo },
        { provide: getRepositoryToken(OperationalAlert), useValue: alertRepo },
        { provide: IncomingOrderPolicyService, useValue: incomingPolicy },
        { provide: AuditWriter, useValue: { write: jest.fn() } },
        ...snappfoodIntakeMocks().providers,
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

// F13 of the HAMI audit: Snappfood bills in Toman and the store books in Rial, and the order must
// reconcile against Snappfood's statement, so Snappfood's own amounts are the order's.
describe("a Snappfood order keeps Snappfood's money, in Rial", () => {
  let service: SimulationService;
  let orderItemRepo: any;
  let alertRepo: any;
  let intake: ReturnType<typeof snappfoodIntakeMocks>;

  // The simulator's default order: two dishes (500 + 600 Toman), 110 VAT, 500 delivery,
  // 200 packing, 1,910 Toman billed and paid online.
  const snappfoodOrder = {
    firstName: 'Hamid',
    lastName: 'Bayanak',
    customer_phone: '09991111111',
    address: 'Tehran, Zafaraniyeh, No. 2',
  };

  beforeEach(async () => {
    intake = snappfoodIntakeMocks();
    orderItemRepo = { create: jest.fn((dto: any) => dto), save: jest.fn((dto: any) => Promise.resolve(dto)) };
    alertRepo = { create: jest.fn((dto: any) => dto), save: jest.fn((dto: any) => Promise.resolve(dto)) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulationService,
        {
          provide: getRepositoryToken(IntegrationLog),
          useValue: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn((d: any) => d), save: jest.fn((d: any) => Promise.resolve({ ...d, id: 'log-1' })) },
        },
        {
          provide: getRepositoryToken(OrderHeader),
          useValue: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn((d: any) => d), save: jest.fn((d: any) => Promise.resolve(Object.assign(d, { id: 'ord-1' }))) },
        },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: getRepositoryToken(Product), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Branch), useValue: { find: jest.fn().mockResolvedValue([{ id: 'br-1', code: 'VANAK', branch_type: 'RESTAURANT' }]) } },
        { provide: getRepositoryToken(OperationalAlert), useValue: alertRepo },
        { provide: IncomingOrderPolicyService, useValue: { applyOnArrival: jest.fn().mockResolvedValue(null) } },
        { provide: AuditWriter, useValue: { write: jest.fn() } },
        ...intake.providers,
      ],
    }).compile();
    service = module.get(SimulationService);
  });

  it("records Snappfood's total, VAT, delivery and packing, ten Rial to the Toman", async () => {
    const { order }: any = await service.generateSnappfoodOrder('t-1', snappfoodOrder);

    expect(order).toEqual(
      expect.objectContaining({
        currency_code: 'IRR',
        subtotal: '11000.0000',
        tax_total: '1100.0000',
        delivery_fee: '5000.0000',
        packaging_total: '2000.0000',
        discount_total: '0.0000',
        grand_total: '19100.0000',
      }),
    );
    const lines = orderItemRepo.save.mock.calls.map(([line]: any[]) => line);
    expect(lines.map((l: any) => [l.unit_price, l.tax_total])).toEqual([
      ['5000.0000', '500.0000'],
      ['6000.0000', '600.0000'],
    ]);
  });

  it("takes whatever Snappfood's parts don't explain as the discount", async () => {
    const { order }: any = await service.generateSnappfoodOrder('t-1', { ...snappfoodOrder, price: 1710, otherDiscounts: 200 });

    expect(order.discount_total).toBe('2000.0000');
    expect(order.grand_total).toBe('17100.0000');
  });

  it('books an online-paid order as an ONLINE payment, so the order owes nothing', async () => {
    const { order }: any = await service.generateSnappfoodOrder('t-1', snappfoodOrder);

    expect(intake.payments).toEqual([
      expect.objectContaining({ order_id: 'ord-1', method_kind: 'ONLINE', status: 'SUCCEEDED', amount: '19100.0000', reference: order.order_number }),
    ]);
    expect(order).toEqual(expect.objectContaining({ paid_total: '19100.0000', outstanding_total: '0.0000' }));
  });

  it('leaves a cash order owing its total, with no payment', async () => {
    const { order }: any = await service.generateSnappfoodOrder('t-1', { ...snappfoodOrder, orderPaymentTypeCode: 'CASH' });

    expect(intake.payments).toEqual([]);
    expect(order).toEqual(expect.objectContaining({ paid_total: '0.0000', outstanding_total: '19100.0000' }));
  });

  it('leaves the order owing and warns the branch when no ONLINE method is active', async () => {
    intake.paymentMethodRepo.findOne.mockResolvedValue(null);

    const { order }: any = await service.generateSnappfoodOrder('t-1', snappfoodOrder);

    expect(intake.payments).toEqual([]);
    expect(order.outstanding_total).toBe('19100.0000');
    expect(alertRepo.save).toHaveBeenCalledWith(expect.objectContaining({ severity: 'WARNING', branch_id: 'br-1' }));
  });

  it('registers a new customer by phone and links the order to them and their address', async () => {
    const { order }: any = await service.generateSnappfoodOrder('t-1', snappfoodOrder);

    expect(intake.customerService.createCustomer).toHaveBeenCalledWith(
      't-1',
      { first_name: 'Hamid', last_name: 'Bayanak', mobile: '+989991111111' },
      expect.any(String),
    );
    expect(order.customer_id).toBe('cust-new');
    expect(intake.addresses).toEqual([expect.objectContaining({ customer_id: 'cust-new', address_text: 'Tehran, Zafaraniyeh, No. 2' })]);
    expect(order.customer_address_id).toBe(intake.addresses[0].id);
  });

  it('links a returning customer found by phone, without registering them again', async () => {
    intake.customerPhoneRepo.findOne.mockResolvedValue({ customer_id: 'cust-known' });

    const { order }: any = await service.generateSnappfoodOrder('t-1', snappfoodOrder);

    expect(intake.customerService.createCustomer).not.toHaveBeenCalled();
    expect(order.customer_id).toBe('cust-known');
  });

  it("reverses the online payment when Snappfood cancels the order", async () => {
    const { order }: any = await service.generateSnappfoodOrder('t-1', snappfoodOrder);
    (service as any).orderRepo.findOne.mockResolvedValue(order);

    await service.handleSnappfoodWebhook('t-1', '{}', { code: order.order_number.replace('SNP-', ''), statusCode: 54 });

    expect(intake.payments.map((p) => p.status)).toEqual(['REVERSED']);
    expect(order).toEqual(expect.objectContaining({ state: 'CANCELLED', paid_total: '0.0000' }));
  });
});
