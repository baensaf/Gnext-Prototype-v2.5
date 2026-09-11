import { Test, TestingModule } from '@nestjs/testing';
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
import { ForbiddenException, BadRequestException } from '@nestjs/common';

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

  beforeEach(async () => {
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
    auditWriter = { write: jest.fn() };

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
    productRepo.findOne.mockResolvedValue({ id: 'prod-1', name: 'Burger', base_price: '10.00' });
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
    productRepo.findOne.mockResolvedValue({ id: 'prod-1', name: 'Burger', base_price: '10.00' });

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
      productRepo.findOne.mockResolvedValue({ id: 'prod-1', name: 'Burger', base_price: '10.00' });
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

  it('should process kiosk terminal payment and return simulated receipt', async () => {
    orderRepo.findOne.mockResolvedValue({
      id: 'ord-kiosk-1',
      tenant_id: 't-1',
      order_number: 'KOS-1001',
      order_type: 'TAKEAWAY',
      total_amount: '21.80',
      paid_amount: '0.00',
      due_amount: '21.80',
    });

    paymentMethodRepo.find.mockResolvedValue([{ id: 'pm-card', name: 'Card Terminal', kind: 'NETWORK_POS' }]);
    paymentRepo.create.mockImplementation((dto: any) => dto);
    paymentRepo.save.mockImplementation((dto: any) => Promise.resolve({ ...dto, id: 'pay-1' }));
    orderRepo.save.mockImplementation((o: any) => Promise.resolve(o));

    const res = await service.processKioskPayment('t-1', { order_id: 'ord-kiosk-1' });

    expect(res.success).toBe(true);
    expect(res.receipt.status).toBe('PAID & SENT TO KITCHEN');
    expect(res.order.status).toBe('READY');
    expect(auditWriter.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'KIOSK_PAYMENT_PROCESSED' }));
  });

  it('should ignore client-supplied unit price and use authoritative database price', async () => {
    settingRepo.find.mockResolvedValue([
      { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'OPTIONAL', branch_id: null },
    ]);
    productRepo.findOne.mockResolvedValue({ id: 'prod-1', name: 'Burger', base_price: '15.00' });

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
