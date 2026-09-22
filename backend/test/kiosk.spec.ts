import { Test, TestingModule } from '@nestjs/testing';
import { basePriceLists } from './utils/price-list-fakes';
import { KioskService } from '../src/modules/kiosk/kiosk.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { ProductOptionGroup } from '../src/entities/ProductOptionGroup.entity';
import { Branch } from '../src/entities/Branch.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderItemOption } from '../src/entities/OrderItemOption.entity';
import { Payment } from '../src/entities/Payment.entity';
import { Customer } from '../src/entities/Customer.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { KdsService } from '../src/modules/kds/kds.service';
import { PrintQueueService } from '../src/modules/printing/print-queue.service';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { Terminal } from '../src/entities/Terminal.entity';
import { PaymentDevice } from '../src/entities/PaymentDevice.entity';
import { OrderService } from '../src/modules/order/order.service';
import { PaymentService } from '../src/modules/payment/payment.service';

describe('KioskService (Unit)', () => {
  let service: KioskService;
  let categoryRepo: any;
  let productRepo: any;
  let optionGroupRepo: any;
  let optionItemRepo: any;
  let productOptionGroupRepo: any;
  let branchRepo: any;
  let settingRepo: any;
  let paymentMethodRepo: any;
  let orderRepo: any;
  let orderItemRepo: any;
  let orderItemOptionRepo: any;
  let paymentRepo: any;
  let customerRepo: any;
  let auditWriter: any;
  let kdsService: any;
  let printQueueService: any;
  let variantRepo: any;
  let catalogService: any;
  let terminalRepo: any;
  let deviceRepo: any;
  let orderService: any;
  let paymentService: any;

  beforeEach(async () => {
    terminalRepo = { findOne: jest.fn().mockResolvedValue(null) };
    deviceRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null) };
    orderService = { afterPaymentSucceeded: jest.fn().mockResolvedValue(null) };
    paymentService = { createPaymentIntent: jest.fn(), processPayment: jest.fn() };
    categoryRepo = { find: jest.fn() };
    productRepo = { find: jest.fn(), findOne: jest.fn() };
    optionGroupRepo = { find: jest.fn() };
    optionItemRepo = { find: jest.fn(), findOne: jest.fn() };
    productOptionGroupRepo = { find: jest.fn() };
    branchRepo = { find: jest.fn(), findOne: jest.fn() };
    settingRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    paymentMethodRepo = { find: jest.fn(), findOne: jest.fn() };
    orderRepo = { create: jest.fn(), save: jest.fn(), findOne: jest.fn() };
    orderItemRepo = { create: jest.fn(), save: jest.fn() };
    orderItemOptionRepo = { create: jest.fn(), save: jest.fn() };
    paymentRepo = { create: jest.fn(), save: jest.fn() };
    customerRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    // The order is saved in one transaction; its repositories are these same fakes.
    const txRepos = new Map<any, any>([[OrderHeader, orderRepo], [OrderItem, orderItemRepo], [OrderItemOption, orderItemOptionRepo], [Customer, customerRepo]]);
    orderRepo.manager = { transaction: async (fn: any) => fn({ getRepository: (entity: any) => txRepos.get(entity) }) };
    auditWriter = { write: jest.fn() };
    kdsService = { generateTicketsForOrder: jest.fn().mockResolvedValue([]) };
    printQueueService = { enqueueOrderPrintJobs: jest.fn().mockResolvedValue([]) };
    variantRepo = { find: jest.fn().mockResolvedValue([]) };
    catalogService = {
      getUnavailableNow: jest.fn().mockResolvedValue({ products: new Set(), variants: new Set(), optionItems: new Set() }),
      assertBasketSellable: jest.fn().mockResolvedValue(undefined),
      recordRefusedSale: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KioskService,
        { provide: getRepositoryToken(Category), useValue: categoryRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(OptionGroup), useValue: optionGroupRepo },
        { provide: getRepositoryToken(OptionItem), useValue: optionItemRepo },
        { provide: getRepositoryToken(ProductOptionGroup), useValue: productOptionGroupRepo },
        { provide: getRepositoryToken(Branch), useValue: branchRepo },
        { provide: getRepositoryToken(TenantSetting), useValue: settingRepo },
        { provide: getRepositoryToken(PaymentMethod), useValue: paymentMethodRepo },
        { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: getRepositoryToken(OrderItemOption), useValue: orderItemOptionRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: KdsService, useValue: kdsService },
        { provide: PrintQueueService, useValue: printQueueService },
        { provide: getRepositoryToken(ProductVariant), useValue: variantRepo },
        { provide: CatalogService, useValue: catalogService },
        { provide: getRepositoryToken(Terminal), useValue: terminalRepo },
        { provide: getRepositoryToken(PaymentDevice), useValue: deviceRepo },
        { provide: OrderService, useValue: orderService },
        { provide: PaymentService, useValue: paymentService },
        basePriceLists(),
      ],
    }).compile();

    service = module.get<KioskService>(KioskService);
  });

  it('should return aggregated kiosk bootstrap context with channel KIOSK', async () => {
    branchRepo.find.mockResolvedValue([{ id: 'br-1', code: 'BR01', name: 'Main Branch', currency_code: 'USD' }]);
    categoryRepo.find.mockResolvedValue([{ id: 'cat-1', name: 'Burgers' }]);
    productRepo.find.mockResolvedValue([{ id: 'prod-1', name: 'Cheeseburger', base_price: '10.00' }]);
    optionGroupRepo.find.mockResolvedValue([]);
    optionItemRepo.find.mockResolvedValue([]);
    productOptionGroupRepo.find.mockResolvedValue([]);
    paymentMethodRepo.find.mockResolvedValue([{ id: 'pm-1', code: 'CARD', name: 'Card Terminal', kind: 'NETWORK_POS' }]);
    // branch_id null is the organization-wide row, which is what this kiosk inherits.
    settingRepo.find.mockResolvedValue([
      { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'OPTIONAL', branch_id: null },
    ]);

    const result = await service.getBootstrapContext('t-1');

    expect(result.channel).toBe('KIOSK');
    expect(result.customer_identity_policy).toBe('OPTIONAL');
    expect(result.categories.length).toBe(1);
    expect(result.products.length).toBe(1);
    expect(result.payment_methods.length).toBe(1);
  });

  it('should enforce required customer phone when identity policy is REQUIRED', async () => {
    settingRepo.find.mockResolvedValue([
      { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'REQUIRED', branch_id: null },
    ]);

    await expect(
      service.createKioskOrder('t-1', {
        branch_id: 'br-1',
        order_type: 'TAKEAWAY',
        items: [{ product_id: 'prod-1', quantity: 1 }],
      }),
    ).rejects.toThrow(ForbiddenException);
  });


  // The submit path used to ask for one row and take whichever came back, so a branch
  // that had overridden the policy could be judged by another site's rule — or by the
  // organization's — while the screen in front of the customer showed its own.
  it('should enforce the branch own identity policy, not the organization one', async () => {
    settingRepo.find.mockResolvedValue([
      { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'OPTIONAL', branch_id: null },
      { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'REQUIRED', branch_id: 'br-strict' },
    ]);
    productRepo.findOne.mockResolvedValue({ id: 'prod-1', name: 'Burger', base_price: '10.00', tax_rate: '0.0900' });
    orderRepo.create.mockImplementation((dto: any) => dto);
    orderRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'ord-kiosk-3' }));
    orderItemRepo.create.mockImplementation((dto: any) => dto);
    orderItemRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'item-3' }));

    await expect(
      service.createKioskOrder('t-1', {
        branch_id: 'br-strict',
        order_type: 'TAKEAWAY',
        items: [{ product_id: 'prod-1', quantity: 1 }],
      }),
    ).rejects.toThrow(ForbiddenException);

    // The same order at a branch that inherits the organization's OPTIONAL goes through.
    const order = await service.createKioskOrder('t-1', {
      branch_id: 'br-relaxed',
      order_type: 'TAKEAWAY',
      items: [{ product_id: 'prod-1', quantity: 1 }],
    });
    expect(order.id).toBe('ord-kiosk-3');
  });
  it('should create a valid kiosk order with tax calculation', async () => {
    settingRepo.find.mockResolvedValue([
      { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'OPTIONAL', branch_id: null },
    ]);
    productRepo.findOne.mockResolvedValue({ id: 'prod-1', name: 'Burger', base_price: '10.00', tax_rate: '0.0900' });

    orderRepo.create.mockImplementation((dto: any) => dto);
    orderRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'ord-kiosk-1' }));
    orderItemRepo.create.mockImplementation((dto: any) => dto);
    orderItemRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'item-1' }));

    const order = await service.createKioskOrder('t-1', {
      branch_id: 'br-1',
      order_type: 'DINE_IN',
      items: [{ product_id: 'prod-1', quantity: 2 }],
    });

    expect(order.subtotal_amount).toBe('20.0000');
    expect(order.tax_amount).toBe('1.8000');
    expect(order.total_amount).toBe('21.8000');
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'KIOSK_ORDER_CREATED' }));
  });

  // Slice 4 of incoming orders: a kiosk order goes straight to the kitchen by default, but a
  // branch can make it wait for staff like a Snappfood order.
  describe('the branch acceptance policy for kiosk orders', () => {
    const settings = (rows: any[]) =>
      settingRepo.find.mockImplementation(({ where }: any) => Promise.resolve(rows.filter((r) => r.key === where.key)));
    const kioskOrder = { branch_id: 'br-1', order_type: 'TAKEAWAY' as const, items: [{ product_id: 'prod-1', quantity: 1 }] };

    beforeEach(() => {
      productRepo.findOne.mockResolvedValue({ id: 'prod-1', name: 'Burger', base_price: '10.00', tax_rate: '0.0900' });
      orderRepo.create.mockImplementation((dto: any) => dto);
      orderRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'ord-kiosk-9' }));
      orderItemRepo.create.mockImplementation((dto: any) => dto);
      orderItemRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'item-9' }));
    });

    it('goes straight to the kitchen queue by default', async () => {
      settings([]);

      const order = await service.createKioskOrder('t-1', kioskOrder);

      expect(order.state).toBe('SUBMITTED');
    });

    it('waits for staff when the branch says kiosk orders need accepting', async () => {
      settings([{ key: 'ORDER_WORKFLOW', branch_id: 'br-1', value: { incomingOrders: { acceptance: { KIOSK: 'MANUAL' } } } }]);

      const order = await service.createKioskOrder('t-1', kioskOrder);

      expect(order.state).toBe('PENDING_ACCEPTANCE');
      expect(order.status).toBe('PENDING_ACCEPTANCE');
    });
  });

  // The 2026-09-16 audit paid for a kiosk order and found it booked as CASH, still showing
  // nothing paid, and parked in READY with no kitchen ticket — while the receipt said it had
  // gone to the kitchen.
  describe('paying at the kiosk terminal', () => {
    const unpaidOrder = (overrides: Record<string, any> = {}) => ({
      id: 'ord-kiosk-1',
      tenant_id: 't-1',
      order_number: 'KOS-1001',
      order_type: 'TAKEAWAY',
      state: 'SUBMITTED',
      status: 'SUBMITTED',
      grand_total: '163500.0000',
      total_amount: '163500.0000',
      paid_total: '0.0000',
      paid_amount: '0.0000',
      outstanding_total: '163500.0000',
      due_amount: '163500.0000',
      ...overrides,
    });
    // Cash is listed first, as in the seed, so a first-row fallback would pick it.
    const seededMethods = [
      { id: 'pm-cash', name: 'Cash', kind: 'CASH' },
      { id: 'pm-card', name: 'Bank Card POS', kind: 'CARD_POS' },
    ];

    let saved: any;
    beforeEach(() => {
      saved = null;
      paymentRepo.create.mockImplementation((dto: any) => dto);
      paymentRepo.save.mockImplementation((dto: any) => Promise.resolve((saved = { ...dto, id: 'pay-1' })));
      paymentRepo.findOne = jest.fn(async () => saved);
      orderRepo.save.mockImplementation((o: any) => Promise.resolve(o));
    });

    it('takes the card on the simulator, marks the order paid, and hands it on to the kitchen', async () => {
      const order = unpaidOrder();
      orderRepo.findOne.mockResolvedValue(order);
      paymentMethodRepo.find.mockResolvedValue(seededMethods);

      const res = await service.processKioskPayment('t-1', { order_id: 'ord-kiosk-1' });

      expect(res.payment).toEqual(expect.objectContaining({ method_id: 'pm-card', method_kind: 'CARD_POS', amount: '163500.0000' }));
      expect(res.order).toEqual(expect.objectContaining({ paid_total: '163500.0000', outstanding_total: '0.0000' }));
      // Confirming, numbering and firing it is the same step a real terminal's approval takes.
      expect(orderService.afterPaymentSucceeded).toHaveBeenCalledWith('t-1', 'ord-kiosk-1', undefined, undefined);
      expect(res.success).toBe(true);
      expect(res.receipt?.simulated).toBe(true);
      expect(paymentService.createPaymentIntent).not.toHaveBeenCalled();
      expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'KIOSK_PAYMENT_PROCESSED' }));
    });

    it("charges the branch's Saman terminal through the agent and waits for its answer", async () => {
      orderRepo.findOne.mockResolvedValue(unpaidOrder({ branch_id: 'br-1' }));
      paymentMethodRepo.find.mockResolvedValue(seededMethods);
      deviceRepo.find.mockResolvedValue([
        { id: 'dev-sep', code: 'POS-01', is_active: true, agent_connection: { kind: 'tcp' }, agent_driver: 'sep' },
      ]);
      paymentService.createPaymentIntent.mockResolvedValue({ id: 'pay-agent' });
      paymentService.processPayment.mockResolvedValue({ id: 'pay-agent', status: 'PROCESSING' });
      paymentRepo.findOne = jest.fn(async () => ({ id: 'pay-agent', order_id: 'ord-kiosk-1', status: 'PROCESSING', device_id: 'dev-sep' }));

      const res = await service.processKioskPayment('t-1', { order_id: 'ord-kiosk-1' });

      expect(paymentService.createPaymentIntent).toHaveBeenCalledWith(
        't-1',
        expect.objectContaining({ orderId: 'ord-kiosk-1', methodId: 'pm-card', amount: '163500.0000', deviceId: 'dev-sep' }),
        undefined,
        undefined,
      );
      expect(res.pending).toBe(true);
      expect(res.success).toBe(false);
      expect(paymentRepo.save).not.toHaveBeenCalled();
      expect(orderService.afterPaymentSucceeded).not.toHaveBeenCalled();
    });

    it('refuses to guess between several terminals when none is linked to the kiosk', async () => {
      orderRepo.findOne.mockResolvedValue(unpaidOrder({ branch_id: 'br-1' }));
      paymentMethodRepo.find.mockResolvedValue(seededMethods);
      const terminal = (id: string) => ({ id, code: id, is_active: true, agent_connection: { kind: 'tcp' }, agent_driver: 'sep' });
      deviceRepo.find.mockResolvedValue([terminal('dev-a'), terminal('dev-b')]);

      await expect(service.processKioskPayment('t-1', { order_id: 'ord-kiosk-1' })).rejects.toThrow(/link one to this kiosk/);
      expect(paymentService.createPaymentIntent).not.toHaveBeenCalled();
    });

    it('uses the terminal linked to the kiosk when the branch has several', async () => {
      orderRepo.findOne.mockResolvedValue(unpaidOrder({ branch_id: 'br-1' }));
      paymentMethodRepo.find.mockResolvedValue(seededMethods);
      terminalRepo.findOne.mockResolvedValue({ id: 'kiosk-1', payment_device_id: 'dev-b' });
      deviceRepo.findOne.mockResolvedValue({ id: 'dev-b', is_active: true, agent_connection: { kind: 'tcp' }, agent_driver: 'sep' });
      paymentService.createPaymentIntent.mockResolvedValue({ id: 'pay-agent' });
      paymentService.processPayment.mockResolvedValue({ id: 'pay-agent', status: 'PROCESSING' });
      paymentRepo.findOne = jest.fn(async () => ({ id: 'pay-agent', order_id: 'ord-kiosk-1', status: 'PROCESSING' }));

      await service.processKioskPayment('t-1', { order_id: 'ord-kiosk-1', terminal_id: 'kiosk-1' });

      expect(paymentService.createPaymentIntent).toHaveBeenCalledWith('t-1', expect.objectContaining({ deviceId: 'dev-b' }), undefined, undefined);
    });

    it('refuses to take payment when no card method exists rather than booking cash', async () => {
      orderRepo.findOne.mockResolvedValue(unpaidOrder());
      paymentMethodRepo.find.mockResolvedValue([{ id: 'pm-cash', name: 'Cash', kind: 'CASH' }]);

      await expect(service.processKioskPayment('t-1', { order_id: 'ord-kiosk-1' })).rejects.toThrow(BadRequestException);
      expect(paymentRepo.save).not.toHaveBeenCalled();
    });

    it('says an order that needs staff acceptance is waiting for them', async () => {
      orderRepo.findOne.mockResolvedValue(unpaidOrder({ state: 'PENDING_ACCEPTANCE', status: 'PENDING_ACCEPTANCE' }));
      paymentMethodRepo.find.mockResolvedValue(seededMethods);

      const res = await service.processKioskPayment('t-1', { order_id: 'ord-kiosk-1' });

      expect(res.order?.state).toBe('PENDING_ACCEPTANCE');
      expect(res.order?.paid_total).toBe('163500.0000');
      expect(res.receipt?.status).toBe('WAITING_FOR_STAFF');
    });

    it('returns the existing payment when a paid order is paid again', async () => {
      orderRepo.findOne.mockResolvedValue(unpaidOrder({ state: 'CONFIRMED', paid_total: '163500.0000', outstanding_total: '0.0000', due_amount: '0.0000' }));
      paymentRepo.findOne = jest.fn().mockResolvedValue({ id: 'pay-1', reference: 'POS-KOS-1' });

      const res = await service.processKioskPayment('t-1', { order_id: 'ord-kiosk-1' });

      expect(res.payment).toEqual(expect.objectContaining({ id: 'pay-1' }));
      expect(paymentRepo.save).not.toHaveBeenCalled();
    });
  });

  it('should ignore client-supplied unit price and use authoritative database price', async () => {
    settingRepo.find.mockResolvedValue([
      { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'OPTIONAL', branch_id: null },
    ]);
    productRepo.findOne.mockResolvedValue({ id: 'prod-1', name: 'Burger', base_price: '15.00', tax_rate: '0.0900' });

    orderRepo.create.mockImplementation((dto: any) => dto);
    orderRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'ord-kiosk-2' }));
    orderItemRepo.create.mockImplementation((dto: any) => dto);
    orderItemRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'item-2' }));

    const order = await service.createKioskOrder('t-1', {
      branch_id: 'br-1',
      order_type: 'TAKEAWAY',
      items: [{ product_id: 'prod-1', quantity: 1, unit_price: 1.00 /* Malicious client override attempt */ }],
    });

    // Should use authoritative base_price 15.00, NOT client override 1.00
    expect(order.subtotal_amount).toBe('15.0000');
    expect(order.tax_amount).toBe('1.3500');
    expect(order.total_amount).toBe('16.3500');
  });

  it('should return existing order on duplicate submit with idempotency key', async () => {
    const existingOrder = { id: 'ord-existing', order_number: 'KOS-IDEM-01', total_amount: '16.3500' };
    orderRepo.findOne.mockResolvedValue(existingOrder);

    const result = await service.createKioskOrder('t-1', {
      branch_id: 'br-1',
      order_type: 'TAKEAWAY',
      idempotency_key: 'KOS-IDEM-01',
      items: [{ product_id: 'prod-1', quantity: 1 }],
    });

    expect(result.id).toBe('ord-existing');
  });
});

describe('KioskService selling rules', () => {
  const build = async (overrides: { product?: any; variants?: any[]; basket?: jest.Mock; unavailable?: any }) => {
    const productRepo = { find: jest.fn().mockResolvedValue([overrides.product]), findOne: jest.fn().mockResolvedValue(overrides.product) };
    const variantRepo = { find: jest.fn().mockResolvedValue(overrides.variants || []) };
    const catalogService = {
      getUnavailableNow: jest.fn().mockResolvedValue(overrides.unavailable || { products: new Set(), variants: new Set(), optionItems: new Set() }),
      assertBasketSellable: overrides.basket || jest.fn().mockResolvedValue(undefined),
      recordRefusedSale: jest.fn(),
    };
    const passthrough: any = { create: jest.fn((dto: any) => dto), save: jest.fn((dto: any) => Promise.resolve({ ...dto, id: 'x' })), findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    passthrough.manager = { transaction: async (fn: any) => fn({ getRepository: () => passthrough }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KioskService,
        { provide: getRepositoryToken(Category), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(OptionGroup), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(OptionItem), useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() } },
        { provide: getRepositoryToken(ProductOptionGroup), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Branch), useValue: { find: jest.fn().mockResolvedValue([{ id: 'br-1' }]), findOne: jest.fn().mockResolvedValue({ id: 'br-1' }) } },
        { provide: getRepositoryToken(TenantSetting), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(PaymentMethod), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(OrderHeader), useValue: passthrough },
        { provide: getRepositoryToken(OrderItem), useValue: passthrough },
        { provide: getRepositoryToken(OrderItemOption), useValue: passthrough },
        { provide: getRepositoryToken(Payment), useValue: passthrough },
        { provide: getRepositoryToken(Customer), useValue: passthrough },
        { provide: getRepositoryToken(ProductVariant), useValue: variantRepo },
        { provide: AuditWriter, useValue: { write: jest.fn() } },
        { provide: CatalogService, useValue: catalogService },
        { provide: getRepositoryToken(Terminal), useValue: { findOne: jest.fn().mockResolvedValue(null) } },
        { provide: getRepositoryToken(PaymentDevice), useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() } },
        { provide: OrderService, useValue: { afterPaymentSucceeded: jest.fn() } },
        { provide: PaymentService, useValue: {} },
        basePriceLists(),
      ],
    }).compile();
    return { service: module.get<KioskService>(KioskService), catalogService };
  };
  const burger = { id: 'p-1', code: 'BRG', name: 'Burger', base_price: '100.0000', tax_rate: '0.1000', is_active: true };
  const order = (item: any) => ({ branch_id: 'br-1', order_type: 'TAKEAWAY' as const, items: [item] });

  it("charges VAT at the product's own rate, not a flat 9%", async () => {
    const { service } = await build({ product: burger });
    const placed = await service.createKioskOrder('t-1', order({ product_id: 'p-1', quantity: 2 }));
    expect(placed.subtotal_amount).toBe('200.0000');
    expect(placed.tax_amount).toBe('20.0000');
  });

  it('sells a product with sizes at the chosen size, and refuses it with none', async () => {
    const sizes = [{ id: 'v-l', product_id: 'p-1', name: 'Large', base_price: '150.0000' }];
    const { service } = await build({ product: burger, variants: sizes });
    await expect(service.createKioskOrder('t-1', order({ product_id: 'p-1', quantity: 1 }))).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VARIANT_REQUIRED' }) });
    const placed = await service.createKioskOrder('t-1', order({ product_id: 'p-1', variant_id: 'v-l', quantity: 1 }));
    expect(placed.subtotal_amount).toBe('150.0000');
    expect(placed.items[0]).toEqual(expect.objectContaining({ variant_id: 'v-l', variant_name: 'Large' }));
  });

  it('refuses the basket when the catalog says an item is off, before saving anything', async () => {
    const basket = jest.fn().mockRejectedValue(new BadRequestException({ code: 'PRODUCT_SUSPENDED' }));
    const { service } = await build({ product: burger, basket });
    await expect(service.createKioskOrder('t-1', order({ product_id: 'p-1', quantity: 1 }))).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PRODUCT_SUSPENDED' }) });
    expect(basket).toHaveBeenCalledWith('t-1', 'br-1', [expect.objectContaining({ variantId: null, quantity: 1 })], expect.any(Date), expect.anything());
  });

  it('shows an 86d item on the menu as unavailable', async () => {
    const { service } = await build({ product: burger, unavailable: { products: new Set(['p-1']), variants: new Set(), optionItems: new Set() } });
    const menu = await service.getBootstrapContext('t-1', 'br-1');
    expect(menu.products[0]).toEqual(expect.objectContaining({ id: 'p-1', is_available: false }));
  });
});
