import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, EntityManager } from 'typeorm';
import { ORDER_ACTION_DEFAULTS } from '../modules/order/order-edit-policy';
import { MoneyUtil } from '../common/utils/money.util';
import { COURIER_ROLE, courierUsername } from '../common/utils/user-scope.util';
import { BUSINESS_DAY_SETTING_KEY } from '../common/utils/business-day';
import { DATA_RESET_LOCK_KEY } from '../modules/import-export/import-export.service';

/**
 * A demo tenant whose menu and order history come from a file rather than this repository.
 * The file is copied into DATA_DIR by hand; with none there, nothing happens. The import runs
 * once, in one transaction, and the tenant row says it is done.
 */
const DATA_FILE = 'imported-tenant.json';
const CHUNK = 500;

type Tender = [kind: string, amount: string];

interface ImportOrder {
  kind: 'SNAPP' | 'PHONE' | 'COUNTER';
  num: string;
  placedAt: string;
  shift: number;
  businessDate: string;
  call: number | null;
  op: string;
  customer: number | null;
  subtotal: string;
  discount: string;
  discountPercent: number | null;
  fee: string;
  service: string;
  price: string;
  house: 'STAFF' | 'HOSPITALITY' | null;
  note: string | null;
  tenders: Tender[];
  lines: { code: string; qty: number; unit: string; note?: string }[];
}

export function importedTenantDataPath(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), DATA_FILE);
}

export async function seedImportedTenant(ds: DataSource): Promise<void> {
  const file = importedTenantDataPath();
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (await ds.getRepository('Tenant').findOne({ where: { code: data.tenant.code } })) return;

  const started = Date.now();
  await ds.transaction((em) => importAll(em, data));
  console.log(`Imported demo tenant ${data.tenant.code}: ${data.orders.length} orders in ${Math.round((Date.now() - started) / 1000)} s`);
}

const money = (value: string | number) => MoneyUtil.format(value);
const ZERO = '0.0000';
const uuid = () => crypto.randomUUID();

async function insertAll(em: EntityManager, entity: string, rows: any[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await em.insert(entity, rows.slice(i, i + CHUNK));
  }
}

async function importAll(em: EntityManager, data: any): Promise<void> {
  const tenantId = uuid();
  const branchId = uuid();
  const now = new Date();
  const orders: ImportOrder[] = data.orders;

  await em.insert('Tenant', {
    id: tenantId,
    code: data.tenant.code,
    name: data.tenant.name,
    base_currency: 'IRR',
    default_locale: 'fa',
    time_zone: 'Asia/Tehran',
  });
  // created_at stays today on purpose: the auto-close sweep walks back to this date, and every
  // imported day already has its close row.
  await em.insert('Branch', {
    id: branchId,
    tenant_id: tenantId,
    code: data.branch.code,
    name: data.branch.name,
    address: data.branch.address,
    latitude: data.branch.latitude,
    longitude: data.branch.longitude,
    time_zone: 'Asia/Tehran',
    branch_type: 'RESTAURANT',
    is_active: true,
  });
  await insertAll(
    em,
    'BranchOperatingHour',
    Array.from({ length: 7 }, (_, day) => ({
      tenant_id: tenantId,
      branch_id: branchId,
      day_of_week: day,
      open_time: `${data.branch.opens}:00`,
      close_time: `${data.branch.closes}:00`,
      is_closed: false,
      spans_midnight: true,
    })),
  );

  const userId = new Map<string, string>();
  await insertAll(
    em,
    'AdminUser',
    data.users.map((u: any) => {
      const id = uuid();
      userId.set(u.key, id);
      return {
        id,
        tenant_id: tenantId,
        username: u.username,
        display_name: u.display_name,
        password_hash: u.password_hash,
        pin_hash: u.pin_hash,
        role: u.role,
        branch_id: u.atBranch ? branchId : null,
        is_active: true,
        preferred_locale: 'fa',
      };
    }),
  );

  for (const courier of data.couriers) {
    const accountId = uuid();
    await em.insert('AdminUser', {
      id: accountId,
      tenant_id: tenantId,
      username: courierUsername(courier.phone, courier.code),
      display_name: courier.name,
      password_hash: '!courier-no-sign-in',
      role: COURIER_ROLE,
      branch_id: branchId,
      is_active: true,
      preferred_locale: 'fa',
    });
    await em.insert('Courier', {
      tenant_id: tenantId,
      user_id: accountId,
      branch_id: branchId,
      code: courier.code,
      name: courier.name,
      phone: courier.phone,
      vehicle_type: 'MOTORCYCLE',
      status: 'AVAILABLE',
      currency_code: 'IRR',
      is_active: true,
    });
  }

  // The till: a receipt and a kitchen printer, and one register.
  const receiptPrinterId = uuid();
  await insertAll(em, 'Printer', [
    { id: receiptPrinterId, tenant_id: tenantId, branch_id: branchId, code: `PRN-${data.branch.code}-RCPT`, name: 'چاپگر صندوق', printer_type: 'THERMAL_RECEIPT', paper_width_mm: 80, is_active: true, simulated_address: 'sim://receipt' },
    { id: uuid(), tenant_id: tenantId, branch_id: branchId, code: `PRN-${data.branch.code}-KIT`, name: 'چاپگر آشپزخانه', printer_type: 'KITCHEN_IMPACT', paper_width_mm: 80, is_active: true, simulated_address: 'sim://kitchen', kitchen_default: true },
  ]);
  const terminalId = uuid();
  await em.insert('Terminal', {
    id: terminalId,
    tenant_id: tenantId,
    branch_id: branchId,
    code: 'TERM-01',
    name: 'صندوق ۱',
    terminal_type: 'CASHIER',
    receipt_printer_id: receiptPrinterId,
    is_active: true,
  });

  const zoneId = uuid();
  await em.insert('DeliveryZone', {
    id: zoneId,
    tenant_id: tenantId,
    branch_id: branchId,
    code: 'ZONE-01',
    name: 'محدوده ارسال',
    fee: money(data.zoneFee),
    currency_code: 'IRR',
    estimated_minutes: 40,
    is_active: true,
  });

  const methodId = new Map<string, string>();
  const methods = [
    ['CASH', 'نقد', 'CASH'],
    ['CARD_POS', 'کارتخوان بانکی', 'CARD_POS'],
    ['CREDIT_ACCOUNT', 'حساب اعتباری مشتری', 'CUSTOMER_CREDIT'],
    ['WALLET', 'کیف پول', 'WALLET'],
    ['MOBILE_POS', 'کارتخوان سیار پیک', 'MOBILE_POS'],
    ['ONLINE', 'پرداخت آنلاین', 'ONLINE'],
    ['BANK_TRANSFER', 'کارت به کارت / واریز', 'BANK_TRANSFER'],
  ];
  await insertAll(
    em,
    'PaymentMethod',
    methods.map(([code, name, kind]) => {
      const id = uuid();
      methodId.set(kind, id);
      return { id, tenant_id: tenantId, code, name, kind, is_active: true };
    }),
  );

  // The same reasons a new chain's till offers (see seed.ts).
  await insertAll(
    em,
    'ReasonCode',
    [
      { code: 'WASTE_EXPIRED', name: 'ضایعات تاریخ گذشته', type: 'INVENTORY_WASTE', applies_to: ['OTHER'] },
      { code: 'WASTE_DAMAGED', name: 'ضایعات آسیب‌دیده', type: 'INVENTORY_WASTE', applies_to: ['OTHER'] },
      { code: 'REFUND_CUSTOMER', name: 'نارضایتی مشتری', type: 'REFUND', applies_to: ['REFUND'], requires_approval: true },
      { code: 'MANAGER_OVERRIDE', name: 'اصلاح دستی مدیر', type: 'OVERRIDE', applies_to: ['PRICE_OVERRIDE', 'OTHER'], requires_approval: true },
      { code: 'CHANGED_MIND', name: 'مشتری منصرف شد', type: 'VOID', applies_to: ['ITEM_VOID', 'ORDER_CANCEL'] },
      { code: 'WRONG_ENTRY', name: 'ثبت اشتباه در صندوق', type: 'VOID', applies_to: ['ITEM_VOID', 'ORDER_CANCEL', 'PAYMENT_REVERSAL'] },
      { code: 'LONG_WAIT', name: 'تأخیر در آماده‌سازی', type: 'VOID', applies_to: ['ORDER_CANCEL', 'REFUND'] },
      { code: 'FOOD_QUALITY', name: 'کیفیت نامناسب غذا', type: 'REFUND', applies_to: ['REFUND', 'ITEM_VOID'] },
      { code: 'WRONG_ITEM', name: 'غذای اشتباه تحویل شد', type: 'REFUND', applies_to: ['REFUND'] },
      { code: 'PAYOUT_SUPPLIES', name: 'خرید اقلام مصرفی', type: 'CASH', applies_to: ['SHIFT_CLOSE'] },
      { code: 'PAYOUT_COURIER', name: 'پرداخت به پیک', type: 'CASH', applies_to: ['SHIFT_CLOSE', 'SETTLEMENT_CLOSE'] },
      { code: 'CUSTOMER_COPY', name: 'درخواست نسخه دوم مشتری', type: 'OTHER', applies_to: ['REPRINT'] },
      { code: 'MANAGER_DISCOUNT', name: 'تخفیف مدیریتی', type: 'OVERRIDE', applies_to: ['PRICE_OVERRIDE'] },
      { code: 'CUSTOMER_SATISFACTION', name: 'رضایت مشتری / مهمان‌نوازی', type: 'DISCOUNT', applies_to: ['DISCOUNT'] },
      { code: 'FRIENDS_FAMILY', name: 'تخفیف اختصاصی', type: 'DISCOUNT', applies_to: ['DISCOUNT'] },
      { code: 'STAFF_DISCOUNT', name: 'تخفیف کارکنان', type: 'DISCOUNT', applies_to: ['DISCOUNT'] },
      { code: 'DAMAGED_ITEM', name: 'ایراد جزئی / مشکل بسته‌بندی', type: 'DISCOUNT', applies_to: ['DISCOUNT'] },
      { code: 'VIP_COURTESY', name: 'عضو ویژه باشگاه', type: 'DISCOUNT', applies_to: ['DISCOUNT'] },
    ].map((r) => ({ requires_approval: false, ...r, tenant_id: tenantId })),
  );

  await insertAll(
    em,
    'TenantSetting',
    [
      ['ORDER_ACTIONS', { ...ORDER_ACTION_DEFAULTS }],
      ['CATALOG', { default_tax_rate: '0' }],
      ['CUSTOMER_CLUB', { cashback_percentage: '0.00' }],
      [BUSINESS_DAY_SETTING_KEY, { cutoff: '05:00' }],
      // A reset could not bring this history back: the import has already run.
      [DATA_RESET_LOCK_KEY, { locked: true }],
    ].map(([key, value]) => ({ tenant_id: tenantId, branch_id: null, key, value, schema_version: 1 })),
  );

  const categoryId = new Map<string, string>();
  await insertAll(
    em,
    'Category',
    data.categories.map((c: any, index: number) => {
      const id = uuid();
      categoryId.set(c.code, id);
      return { id, tenant_id: tenantId, code: `KP-${c.code}`, name: c.name, sort_order: index + 1, is_active: c.active };
    }),
  );
  const productById = new Map<string, { id: string; name: string }>();
  await insertAll(
    em,
    'Product',
    data.products.map((p: any, index: number) => {
      const id = uuid();
      productById.set(p.code, { id, name: p.name });
      return {
        id,
        tenant_id: tenantId,
        category_id: categoryId.get(p.category),
        code: p.code,
        name: p.name,
        base_price: money(p.price),
        tax_rate: ZERO,
        sort_order: index + 1,
        is_active: p.active,
      };
    }),
  );

  // Customers, with what the app writes for one made at the till.
  const customerId: string[] = [];
  const addressId: string[] = [];
  const customerRows: any[] = [];
  const phoneRows: any[] = [];
  const addressRows: any[] = [];
  const accountRows: any[] = [];
  for (const c of data.customers) {
    const id = uuid();
    const address = uuid();
    const normalized = `+98${c.mobile.slice(1)}`;
    const joined = new Date(`${c.joined}T12:00:00+03:30`);
    customerId.push(id);
    addressId.push(address);
    customerRows.push({ id, tenant_id: tenantId, code: normalized, first_name: c.first, last_name: c.last, mobile: normalized, is_active: true, created_at: joined, updated_at: joined });
    phoneRows.push({ tenant_id: tenantId, customer_id: id, phone_number: c.mobile, normalized_phone: normalized, label: 'PRIMARY_MOBILE', is_primary: true, is_verified: true });
    addressRows.push({ id: address, tenant_id: tenantId, customer_id: id, title: 'خانه', address_text: c.address, is_default: true });
    accountRows.push({ tenant_id: tenantId, customer_id: id, currency_code: 'IRR', kind: 'CREDIT', mode: 'FINITE', credit_limit: ZERO, current_balance: ZERO });
  }
  await insertAll(em, 'Customer', customerRows);
  await insertAll(em, 'CustomerPhone', phoneRows);
  await insertAll(em, 'CustomerAddress', addressRows);
  await insertAll(em, 'CustomerCreditAccount', accountRows);

  await importOrders(em, { tenantId, branchId, terminalId, zoneId, zoneFee: data.zoneFee, orders, userId, methodId, productById, customerId, addressId, addressText: data.customers.map((c: any) => c.address), now });
}

async function importOrders(em: EntityManager, ctx: any): Promise<void> {
  const { tenantId, branchId, terminalId, zoneId, zoneFee, orders, userId, methodId, productById, customerId, addressId, addressText } = ctx;

  // Snappfood orders stay off shifts, as live ones do.
  const shifts = new Map<string, { id: string; date: string; n: number; orders: ImportOrder[] }>();
  for (const o of orders as ImportOrder[]) {
    if (o.kind === 'SNAPP') continue;
    const key = `${o.businessDate}#${o.shift}`;
    if (!shifts.has(key)) shifts.set(key, { id: uuid(), date: o.businessDate, n: o.shift, orders: [] });
    shifts.get(key)!.orders.push(o);
  }

  const headers: any[] = [];
  const items: any[] = [];
  const adjustments: any[] = [];
  const events: any[] = [];
  const payments: any[] = [];
  const allocations: any[] = [];
  const deliveries: any[] = [];
  const cash: any[] = [];

  const orderSeq = new Map<string, number>();
  const paySeq = new Map<string, number>();
  const nextNumber = (seq: Map<string, number>, prefix: string, date: string) => {
    const n = (seq.get(date) ?? 0) + 1;
    seq.set(date, n);
    return `${prefix}-${date.replace(/-/g, '')}-${String(n).padStart(4, '0')}`;
  };
  const totalsByShift = new Map<string, { sales: string; discount: string; fee: string; byType: Map<string, { count: number; total: string }> }>();
  const totalsByDay = new Map<string, { sales: string; count: number }>();

  for (const o of orders as ImportOrder[]) {
    const id = uuid();
    const at = new Date(o.placedAt);
    const snapp = o.kind === 'SNAPP';
    const delivered = snapp || o.kind === 'PHONE';
    const shiftId = snapp ? null : shifts.get(`${o.businessDate}#${o.shift}`)!.id;
    const orderNumber = snapp ? `SNP-${o.num}` : nextNumber(orderSeq, 'ORD', o.businessDate);
    const createdBy = snapp ? null : userId.get(o.op) ?? null;
    const subtotal = money(o.subtotal);
    // A meal the house gave away was never money: all of it is discount, and no tender.
    const grandTotal = o.house ? ZERO : money(o.price);
    const discount = o.house ? subtotal : money(o.discount);
    const fee = o.house ? ZERO : money(o.fee);
    const service = o.house ? ZERO : money(o.service);
    const orderType = snapp ? 'AGGREGATOR' : o.kind === 'PHONE' ? 'DELIVERY' : 'TAKEAWAY';
    const hasCustomer = o.customer !== null;
    const useAddress = o.kind === 'PHONE' && hasCustomer;

    headers.push({
      id,
      tenant_id: tenantId,
      branch_id: branchId,
      terminal_id: snapp ? null : terminalId,
      shift_id: shiftId,
      order_number: orderNumber,
      call_number: o.call,
      order_type: orderType,
      channel: snapp ? 'AGGREGATOR' : 'POS',
      state: 'COMPLETED',
      status: 'COMPLETED',
      currency_code: 'IRR',
      quote_version: '1',
      customer_id: hasCustomer ? customerId[o.customer as number] : null,
      customer_address_id: useAddress ? addressId[o.customer as number] : null,
      delivery_zone_id: o.kind === 'PHONE' ? zoneId : null,
      business_date: o.businessDate,
      subtotal,
      subtotal_amount: subtotal,
      modifier_total: ZERO,
      packaging_total: service,
      delivery_fee: fee,
      delivery_fee_manual: o.kind === 'PHONE' && o.fee !== zoneFee ? fee : null,
      discount_total: discount,
      discount_amount: discount,
      tax_total: ZERO,
      tax_amount: ZERO,
      grand_total: grandTotal,
      total_amount: grandTotal,
      paid_total: grandTotal,
      paid_amount: grandTotal,
      refunded_total: ZERO,
      outstanding_total: ZERO,
      due_amount: ZERO,
      fulfillment_status: delivered ? 'DELIVERED' : 'PENDING',
      notes: o.note,
      submitted_at: at,
      completed_at: at,
      placed_at: at,
      updated_at: at,
      after_hours: false,
      aggregator_expedition: snapp ? 'DELIVERY' : null,
      accepted_at: snapp ? at : null,
      promised_minutes: snapp ? 20 : null,
      created_by: createdBy,
    });

    o.lines.forEach((line, index) => {
      const product = productById.get(line.code);
      const unit = money(line.unit);
      const total = MoneyUtil.multiply(unit, line.qty);
      items.push({
        tenant_id: tenantId,
        order_id: id,
        line_number: index + 1,
        product_id: product.id,
        product_code: line.code,
        product_name: product.name,
        quantity: line.qty.toFixed(3),
        unit_price: unit,
        base_total: total,
        subtotal: total,
        modifier_total: ZERO,
        discount_total: ZERO,
        discount_amount: ZERO,
        tax_rate: ZERO,
        tax_total: ZERO,
        tax_amount: ZERO,
        packaging_total: ZERO,
        line_total: total,
        total_amount: total,
        notes: line.note ?? null,
        special_instructions: line.note ?? null,
        state: 'ACTIVE',
      });
    });

    // Snappfood's discount sits on the header alone, as a live Snappfood order's does.
    if (!snapp && MoneyUtil.greaterThan(discount, ZERO)) {
      const percent = o.house ? 100 : o.discountPercent;
      adjustments.push({
        tenant_id: tenantId,
        order_id: id,
        type: 'DISCOUNT',
        source_type: 'MANUAL',
        code: 'MANUAL_DISCOUNT',
        name: 'Manual Cashier Discount',
        amount: discount,
        funding_source: 'MERCHANT',
        calculation_snapshot: {
          discountType: percent ? 'PERCENTAGE' : 'FIXED_AMOUNT',
          amount: discount,
          value: String(percent ?? discount),
          reasonCode: o.house === 'STAFF' ? 'STAFF_DISCOUNT' : 'CUSTOMER_SATISFACTION',
        },
        created_at: at,
      });
    }

    const event = (from: string | null, to: string, action: string) =>
      events.push({ tenant_id: tenantId, order_id: id, from_state: from, to_state: to, action, occurred_by: createdBy, occurred_at: at });
    if (snapp) {
      event('PENDING_ACCEPTANCE', 'CONFIRMED', 'ACCEPT');
    } else {
      event('DRAFT', 'CONFIRMED', 'SUBMIT');
    }
    if (delivered) {
      event('CONFIRMED', 'OUT_FOR_DELIVERY', 'DISPATCH');
      event('OUT_FOR_DELIVERY', 'COMPLETED', 'COMPLETE');
    } else {
      event('CONFIRMED', 'COMPLETED', 'COMPLETE');
    }

    o.tenders.forEach(([kind, amount], index) => {
      const paymentId = uuid();
      const paid = money(amount);
      payments.push({
        id: paymentId,
        tenant_id: tenantId,
        order_id: id,
        payment_number: snapp ? `PAY-SNP-${o.num}-${index + 1}` : nextNumber(paySeq, 'PAY', o.businessDate),
        method_id: methodId.get(kind),
        method_kind: kind,
        status: 'SUCCEEDED',
        amount: paid,
        currency_code: 'IRR',
        shift_id: shiftId,
        business_date: o.businessDate,
        reference: snapp ? orderNumber : null,
        initiated_at: at,
        posted_at: at,
      });
      allocations.push({ tenant_id: tenantId, payment_id: paymentId, order_id: id, amount: paid, currency_code: 'IRR', created_at: at });
      if (kind === 'CASH' && shiftId) {
        cash.push({ tenant_id: tenantId, shift_id: shiftId, type: 'CASH_PAYMENT', amount: paid, payment_id: paymentId, posted_by: createdBy, posted_at: at, reference: `Cash Payment ${orderNumber}` });
      }
    });

    if (delivered) {
      const onMobilePos = o.tenders.filter(([kind]) => kind === 'MOBILE_POS').reduce((sum, [, a]) => MoneyUtil.add(sum, money(a)), ZERO);
      const onCash = o.tenders.filter(([kind]) => kind === 'CASH').reduce((sum, [, a]) => MoneyUtil.add(sum, money(a)), ZERO);
      deliveries.push({
        tenant_id: tenantId,
        order_id: id,
        zone_id: o.kind === 'PHONE' ? zoneId : null,
        courier_id: null,
        state: 'DELIVERED',
        fee,
        currency_code: 'IRR',
        address_snapshot: useAddress
          ? { address_id: addressId[o.customer as number], title: 'خانه', address_text: addressText[o.customer as number], customer_id: customerId[o.customer as number] }
          : { address_text: 'اسنپ‌فود' },
        assigned_at: at,
        picked_up_at: at,
        delivered_at: at,
        cash_expected: onCash,
        mobile_pos_expected: onMobilePos,
        created_at: at,
        // Backdated, or the dispatch board shows every old delivery as just finished.
        updated_at: at,
      });
    }

    if (shiftId) {
      if (!totalsByShift.has(shiftId)) totalsByShift.set(shiftId, { sales: ZERO, discount: ZERO, fee: ZERO, byType: new Map() });
      const totals = totalsByShift.get(shiftId)!;
      totals.sales = MoneyUtil.add(totals.sales, grandTotal);
      totals.discount = MoneyUtil.add(totals.discount, discount);
      totals.fee = MoneyUtil.add(totals.fee, fee);
      const type = totals.byType.get(orderType) ?? { count: 0, total: ZERO };
      type.count += 1;
      type.total = MoneyUtil.add(type.total, grandTotal);
      totals.byType.set(orderType, type);
    }
    const day = totalsByDay.get(o.businessDate) ?? { sales: ZERO, count: 0 };
    day.sales = MoneyUtil.add(day.sales, grandTotal);
    day.count += 1;
    totalsByDay.set(o.businessDate, day);
  }

  // The file holds no float records, so each drawer opens at nothing and counts true.
  const shiftRows: any[] = [];
  for (const shift of shifts.values()) {
    const list = shift.orders;
    const opened = new Date(Date.parse(list[0].placedAt) - 10 * 60000);
    const closed = new Date(Date.parse(list[list.length - 1].placedAt) + 10 * 60000);
    const counts = new Map<string, number>();
    for (const o of list) counts.set(o.op, (counts.get(o.op) ?? 0) + 1);
    const cashier = userId.get([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    const totals = totalsByShift.get(shift.id)!;
    const takings = list
      .flatMap((o) => o.tenders)
      .filter(([kind]) => kind === 'CASH')
      .reduce((sum, [, a]) => MoneyUtil.add(sum, money(a)), ZERO);
    shiftRows.push({
      id: shift.id,
      tenant_id: tenantId,
      branch_id: branchId,
      terminal_id: terminalId,
      opened_by: cashier,
      closed_by: cashier,
      shift_number: `SHF-${shift.date.replace(/-/g, '')}-${String(shift.n).padStart(4, '0')}`,
      state: 'CLOSED',
      business_date: shift.date,
      opened_at: opened,
      closed_at: closed,
      opening_cash: ZERO,
      expected_cash: takings,
      actual_cash: takings,
      short_over: ZERO,
      left_in_drawer: ZERO,
      closing_orders: {
        orderCount: list.length,
        cancelledCount: 0,
        salesTotal: totals.sales,
        discountTotal: totals.discount,
        deliveryFeeTotal: totals.fee,
        unpaidTotal: ZERO,
        byType: [...totals.byType.entries()].map(([type, t]) => ({ type, count: t.count, total: t.total })),
      },
      created_at: opened,
      updated_at: closed,
    });
    cash.push({ tenant_id: tenantId, shift_id: shift.id, type: 'OPENING_FLOAT', amount: ZERO, posted_by: cashier, posted_at: opened, reference: 'Opening Float' });
  }

  const dayRows = [...totalsByDay.entries()].map(([date, day]) => ({
    tenant_id: tenantId,
    branch_id: branchId,
    business_date: date,
    closed_at: new Date(`${date}T23:59:00Z`),
    totals: { totalSales: day.sales, orderCount: day.count, autoCompletedOrders: 0, carriedOverOrders: 0 },
  }));

  await insertAll(em, 'CashierShift', shiftRows);
  await insertAll(em, 'OrderHeader', headers);
  await insertAll(em, 'OrderItem', items);
  await insertAll(em, 'OrderAdjustment', adjustments);
  await insertAll(em, 'OrderStateEvent', events);
  await insertAll(em, 'Payment', payments);
  await insertAll(em, 'PaymentAllocation', allocations);
  await insertAll(em, 'CashMovement', cash);
  await insertAll(em, 'Delivery', deliveries);
  await insertAll(em, 'BusinessDayClose', dayRows);
}
