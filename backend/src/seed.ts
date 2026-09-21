import * as argon2 from 'argon2';
import { AppDataSource } from './data-source';
import { IsNull } from 'typeorm';
import { ORDER_ACTION_DEFAULTS } from './modules/order/order-edit-policy';
import { MoneyUtil } from './common/utils/money.util';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  IRANBURGER_BRANCHES,
  IRANBURGER_CATEGORIES,
  IRANBURGER_PRODUCTS,
  IRANBURGER_OPTION_GROUPS,
  IRANBURGER_TENANT_NAME,
  LEGACY_CATEGORY_CODE,
  LEGACY_PRODUCT_CODES,
} from './seeds/iranburger-data';

const LEGACY_TENANT_NAME = 'Gnext Core Tenant';
const DEFAULT_TENANT_ID = 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
const DEFAULT_TENANT_CODE = 'GNEXT';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin@gnext.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'GnextDemo!2026';
const APPROVER_PIN = process.env.APPROVER_PIN || '2468';
const BRANCH_MANAGER_USERNAME = process.env.BRANCH_MANAGER_USERNAME || 'manager.downtown@gnext.local';
const CASHIER_USERNAME = process.env.CASHIER_USERNAME || 'cashier.downtown@gnext.local';

export async function runSeed() {
  console.log('Connecting to database via AppDataSource (synchronize: false)...');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const tenantRepo = AppDataSource.getRepository('Tenant');
  const adminRepo = AppDataSource.getRepository('AdminUser');
  const branchRepo = AppDataSource.getRepository('Branch');
  const terminalRepo = AppDataSource.getRepository('Terminal');
  const currencyRepo = AppDataSource.getRepository('Currency');
  const payMethodRepo = AppDataSource.getRepository('PaymentMethod');
  const reasonRepo = AppDataSource.getRepository('ReasonCode');
  const settingRepo = AppDataSource.getRepository('TenantSetting');
  const catRepo = AppDataSource.getRepository('Category');
  const prodRepo = AppDataSource.getRepository('Product');
  const variantRepo = AppDataSource.getRepository('ProductVariant');
  const zoneRepo = AppDataSource.getRepository('DeliveryZone');
  const diningAreaRepo = AppDataSource.getRepository('DiningArea');
  const diningTableRepo = AppDataSource.getRepository('DiningTable');
  const courierRepo = AppDataSource.getRepository('Courier');
  const customerRepo = AppDataSource.getRepository('Customer');
  const customerPhoneRepo = AppDataSource.getRepository('CustomerPhone');
  const customerAddressRepo = AppDataSource.getRepository('CustomerAddress');
  const creditAccountRepo = AppDataSource.getRepository('CustomerCreditAccount');
  const creditEntryRepo = AppDataSource.getRepository('CreditEntry');
  const orderRepo = AppDataSource.getRepository('OrderHeader');
  const orderItemRepo = AppDataSource.getRepository('OrderItem');

  // 1. Idempotent Tenant Seed
  let tenant = await tenantRepo.findOne({ where: { id: DEFAULT_TENANT_ID } });
  // A database seeded before the demo became Iran Burger still carries the old generic
  // demo. It is converted once, in place, further down.
  const rebrandExisting = tenant?.name === LEGACY_TENANT_NAME;
  if (!tenant) {
    tenant = tenantRepo.create({
      id: DEFAULT_TENANT_ID,
      code: DEFAULT_TENANT_CODE,
      name: IRANBURGER_TENANT_NAME,
      base_currency: 'IRR',
      default_locale: 'fa',
      time_zone: 'Asia/Tehran',
    });
    await tenantRepo.save(tenant);
    console.log(`Seeded Tenant: ${IRANBURGER_TENANT_NAME}`);
  }

  // 2. Idempotent Admin Seed
  let admin = await adminRepo.findOne({ where: { tenant_id: tenant.id, username: ADMIN_USERNAME } });
  if (!admin) {
    const passwordHash = await argon2.hash(ADMIN_PASSWORD);
    const pinHash = await argon2.hash(APPROVER_PIN);
    admin = adminRepo.create({
      tenant_id: tenant.id,
      username: ADMIN_USERNAME,
      display_name: 'مدیر ستاد',
      password_hash: passwordHash,
      pin_hash: pinHash,
      role: 'SUPER_ADMIN',
      is_active: true,
      preferred_locale: 'fa',
    });
    await adminRepo.save(admin);
    console.log(`Seeded Admin User: ${ADMIN_USERNAME}`);
  }

  // 3. Idempotent Currencies
  const currencies = [
    { code: 'IRR', symbol: 'ریال', name: 'Iranian Rial', decimal_places: 0 },
    { code: 'USD', symbol: '$', name: 'US Dollar', decimal_places: 2 },
    { code: 'EUR', symbol: '€', name: 'Euro', decimal_places: 2 },
  ];
  for (const c of currencies) {
    const existing = await currencyRepo.findOne({ where: { code: c.code } });
    if (!existing) {
      await currencyRepo.save(currencyRepo.create({ ...c, tenant_id: tenant.id }));
    }
  }

  // 4. Idempotent Branches — the chain's real locations (see seeds/iranburger-data.ts).
  const branchByCode = new Map<string, any>();
  for (const b of IRANBURGER_BRANCHES) {
    let branch = await branchRepo.findOne({ where: { tenant_id: tenant.id, code: b.code } });
    if (!branch) {
      branch = await branchRepo.save(branchRepo.create({
        tenant_id: tenant.id,
        code: b.code,
        name: b.name,
        branch_type: b.branchType || 'RESTAURANT',
        phone: b.phone,
        address: b.address,
        time_zone: 'Asia/Tehran',
        is_active: true,
      }));
      console.log(`Seeded Branch: ${b.name}`);
    } else if (b.legacyName && branch.name === b.legacyName) {
      // The old demo's storefronts become real branches under the same code, so their
      // terminals, printers, floors, accounts and orders carry over untouched.
      branch.name = b.name;
      branch.phone = b.phone;
      branch.address = b.address;
      branch = await branchRepo.save(branch);
      console.log(`Renamed Branch: ${b.legacyName} -> ${b.name}`);
    }
    branchByCode.set(b.code, branch);
  }
  const sellingBranches = IRANBURGER_BRANCHES
    .filter((b) => (b.branchType || 'RESTAURANT') === 'RESTAURANT')
    .map((b) => branchByCode.get(b.code));
  // The three sites the demo accounts, floors and couriers hang off.
  const branchTeh = branchByCode.get('TEH-CENTRAL');
  const branchExpress = branchByCode.get('TEH-DOWNTOWN');
  const branchNorth = branchByCode.get('TEH-NORTH');

  if (rebrandExisting) {
    await rebrandLegacyDemo(tenant.id, IRANBURGER_TENANT_NAME, { branchTeh, branchExpress, branchNorth });
    tenant.name = IRANBURGER_TENANT_NAME;
    console.log(`Renamed Tenant: ${LEGACY_TENANT_NAME} -> ${IRANBURGER_TENANT_NAME}`);
  }

  let branchManager = await adminRepo.findOne({
    where: { tenant_id: tenant.id, username: BRANCH_MANAGER_USERNAME },
  });
  if (!branchManager) {
    branchManager = adminRepo.create({
      tenant_id: tenant.id,
      username: BRANCH_MANAGER_USERNAME,
      display_name: 'مدیر شعبه ولیعصر',
      password_hash: await argon2.hash(ADMIN_PASSWORD),
      pin_hash: await argon2.hash(APPROVER_PIN),
      role: 'MANAGER',
      // Pinned to one location: this is what stops the account reaching the rest of
      // the chain, not the role name.
      branch_id: branchExpress.id,
      is_active: true,
      preferred_locale: 'fa',
    });
    await adminRepo.save(branchManager);
    console.log(`Seeded Branch Manager User: ${BRANCH_MANAGER_USERNAME} (ایران برگر ولیعصر)`);
  }

  let cashier = await adminRepo.findOne({
    where: { tenant_id: tenant.id, username: CASHIER_USERNAME },
  });
  if (!cashier) {
    cashier = adminRepo.create({
      tenant_id: tenant.id,
      username: CASHIER_USERNAME,
      display_name: 'صندوقدار شعبه ولیعصر',
      password_hash: await argon2.hash(ADMIN_PASSWORD),
      // No approver pin on purpose: a register operator is who the pin is asked *of*,
      // so giving them one would let the demo approve its own escalations.
      role: 'CASHIER',
      branch_id: branchExpress.id,
      is_active: true,
      preferred_locale: 'fa',
    });
    await adminRepo.save(cashier);
    console.log(`Seeded Cashier User: ${CASHIER_USERNAME} (ایران برگر ولیعصر)`);
  }

  // 4b. Idempotent Delivery Zones
  const defaultZones = [
    { tenant_id: tenant.id, branch_id: branchTeh.id, code: 'ZONE-CENTRAL-01', name: 'محدوده ارسال نصرت', fee: '600000.0000', currency_code: 'IRR', estimated_minutes: 30, is_active: true },
    { tenant_id: tenant.id, branch_id: branchExpress.id, code: 'ZONE-DOWNTOWN-01', name: 'محدوده ارسال ولیعصر', fee: '500000.0000', currency_code: 'IRR', estimated_minutes: 20, is_active: true },
    { tenant_id: tenant.id, branch_id: branchNorth.id, code: 'ZONE-NORTH-01', name: 'محدوده ارسال هروی', fee: '700000.0000', currency_code: 'IRR', estimated_minutes: 35, is_active: true },
  ];
  for (const z of defaultZones) {
    const existing = await zoneRepo.findOne({ where: { tenant_id: tenant.id, code: z.code } });
    if (!existing) {
      await zoneRepo.save(zoneRepo.create(z));
      console.log(`Seeded Delivery Zone: ${z.name}`);
    }
  }
  // The first fees (20,000–30,000 rial) came from the generic demo and were a rounding error
  // next to Iran Burger's prices; a zone still on its first fee gets the chain-scale one.
  for (const [code, from] of [['ZONE-CENTRAL-01', '25000.0000'], ['ZONE-DOWNTOWN-01', '20000.0000'], ['ZONE-NORTH-01', '30000.0000']]) {
    const fee = defaultZones.find((z) => z.code === code)!.fee;
    await zoneRepo.update({ tenant_id: tenant.id, code, fee: from }, { fee });
  }

  // 4c. Idempotent dine-in floor, one per selling site.
  //
  // Both floors matter now that a branch account is answered only about its own branch.
  // The demo manager and cashier both work at Downtown, so seeding a floor for Central
  // alone left the two accounts anybody actually signs in as looking at an empty dining
  // room, an empty table picker and no courier to dispatch — the screens read as broken
  // features rather than as an empty branch.
  const floors = [
    { branch: branchTeh, code: 'AREA-MAIN', name: 'سالن اصلی', tables: 8, prefix: 'T' },
    { branch: branchExpress, code: 'AREA-EXPRESS', name: 'سالن ولیعصر', tables: 4, prefix: 'E' },
  ];

  let mainDiningArea: any = null;
  for (const floor of floors) {
    let area = await diningAreaRepo.findOne({
      where: { tenant_id: tenant.id, branch_id: floor.branch.id, code: floor.code },
    });
    if (!area) {
      area = await diningAreaRepo.save(diningAreaRepo.create({
        tenant_id: tenant.id,
        branch_id: floor.branch.id,
        code: floor.code,
        name: floor.name,
        sort_order: 1,
        is_active: true,
      }));
      console.log(`Seeded Dining Area: ${floor.name}`);
    }
    if (!mainDiningArea) mainDiningArea = area;

    for (let index = 0; index < floor.tables; index += 1) {
      const number = `${floor.prefix}-${String(index + 1).padStart(2, '0')}`;
      const existing = await diningTableRepo.findOne({
        where: { tenant_id: tenant.id, dining_area_id: area.id, code: number },
      });
      if (existing) continue;
      await diningTableRepo.save(diningTableRepo.create({
        tenant_id: tenant.id,
        dining_area_id: area.id,
        code: number,
        table_number: number,
        seating_capacity: index < 4 ? 4 : 2,
        shape: index % 2 === 0 ? 'SQUARE' : 'CIRCLE',
        pos_x: (index % 4) * 180,
        pos_y: Math.floor(index / 4) * 160,
        is_active: true,
      }));
    }
  }

  // One courier per selling site, for the same reason: a Downtown dispatcher with nobody
  // to dispatch cannot demonstrate a delivery.
  const couriers = [
    { branch: branchTeh, code: 'CR-001', name: 'علی رضایی', phone: '09120000001' },
    { branch: branchExpress, code: 'CR-002', name: 'سارا احمدی', phone: '09120000002' },
    // Valiasr runs two bikes at lunch, so a second order can go out while the first is away.
    { branch: branchExpress, code: 'CR-003', name: 'مهدی کاظمی', phone: '09120000003' },
  ];
  // Per-delivery pay at the menu's scale; the first figure (50,000 rial) was the generic demo's.
  await courierRepo.update({ tenant_id: tenant.id, compensation_per_delivery: '50000.0000' }, { compensation_per_delivery: '400000.0000' });
  for (const courier of couriers) {
    const existing = await courierRepo.findOne({ where: { tenant_id: tenant.id, code: courier.code } });
    if (existing) continue;
    await courierRepo.save(courierRepo.create({
      tenant_id: tenant.id,
      branch_id: courier.branch.id,
      code: courier.code,
      name: courier.name,
      phone: courier.phone,
      vehicle_type: 'MOTORCYCLE',
      status: 'AVAILABLE',
      compensation_per_delivery: '400000.0000',
      currency_code: 'IRR',
      is_active: true,
    }));
    console.log(`Seeded Courier: ${courier.name}`);
  }

  // 5. Idempotent Terminals
  const terminals = [
    { tenant_id: tenant.id, branch_id: branchTeh.id, code: 'TERM-01', name: 'صندوق ۱ نصرت', device_type: 'POS_STATION' },
    { tenant_id: tenant.id, branch_id: branchExpress.id, code: 'TERM-02', name: 'صندوق ۱ ولیعصر', device_type: 'POS_STATION' },
    { tenant_id: tenant.id, branch_id: branchNorth.id, code: 'TERM-03', name: 'صندوق ۱ هروی', device_type: 'POS_STATION' },
    // Every other branch gets one counter register, so any of them can be opened in the POS.
    ...sellingBranches
      .filter((b) => ![branchTeh.id, branchExpress.id, branchNorth.id].includes(b.id))
      .map((b) => ({ tenant_id: tenant.id, branch_id: b.id, code: `TERM-${b.code}`, name: `صندوق ۱ ${b.name}`, device_type: 'POS_STATION' })),
  ];
  for (const t of terminals) {
    const existing = await terminalRepo.findOne({ where: { tenant_id: tenant.id, code: t.code } });
    if (!existing) {
      await terminalRepo.save(terminalRepo.create(t));
    }
  }
  // TERM-02 is Valiasr's only counter register (a CASHIER terminal). It used to be named as a
  // kiosk, so the Valiasr cashier had to pick a "kiosk" to open a shift on.
  await terminalRepo.update({ tenant_id: tenant.id, code: 'TERM-02', name: 'کیوسک ولیعصر' }, { name: 'صندوق ۱ ولیعصر' });

  // 6. Idempotent Payment Methods
  const payMethods = [
    { tenant_id: tenant.id, code: 'CASH', name: 'Cash', kind: 'CASH', is_active: true },
    { tenant_id: tenant.id, code: 'CARD_POS', name: 'Bank Card POS', kind: 'CARD_POS', is_active: true },
    { tenant_id: tenant.id, code: 'CREDIT_ACCOUNT', name: 'Customer Credit Account', kind: 'CUSTOMER_CREDIT', is_active: true },
    // The couriers carry company card readers, and the scope reports those separately from
    // cash and from the counter terminal; online and bank transfer are the other two tenders
    // a refund may go back through.
    { tenant_id: tenant.id, code: 'MOBILE_POS', name: 'Courier Mobile POS', kind: 'MOBILE_POS', is_active: true },
    { tenant_id: tenant.id, code: 'ONLINE', name: 'Online Payment', kind: 'ONLINE', is_active: true },
    { tenant_id: tenant.id, code: 'BANK_TRANSFER', name: 'Bank Transfer', kind: 'BANK_TRANSFER', is_active: true },
  ];
  for (const pm of payMethods) {
    const existing = await payMethodRepo.findOne({ where: { tenant_id: tenant.id, code: pm.code } });
    if (!existing) {
      await payMethodRepo.save(payMethodRepo.create(pm));
    }
  }

  // 6a. Idempotent printers, one receipt and one kitchen printer per selling site, each
  // with a group and routes. With none, every receipt and kitchen ticket in the demo had
  // nowhere to go — and a kitchen ticket with no printer is an order nobody cooks.
  const printerRepo = AppDataSource.getRepository('Printer');
  const printerGroupRepo = AppDataSource.getRepository('PrinterGroup');
  const printerMemberRepo = AppDataSource.getRepository('PrinterGroupMember');
  const printRouteRepo = AppDataSource.getRepository('PrintRoute');
  for (const site of sellingBranches) {
    const findOrCreate = async (repo: any, where: Record<string, unknown>, data: Record<string, unknown>) =>
      (await repo.findOne({ where })) || (await repo.save(repo.create({ ...where, ...data })));

    const receiptPrinter = await findOrCreate(
      printerRepo,
      { tenant_id: tenant.id, branch_id: site.id, code: `PRN-${site.code}-RCPT` },
      { name: `چاپگر صندوق ${site.name}`, printer_type: 'THERMAL_RECEIPT', paper_width_mm: 80, is_active: true, simulated_address: 'sim://receipt' },
    );
    const kitchenPrinter = await findOrCreate(
      printerRepo,
      { tenant_id: tenant.id, branch_id: site.id, code: `PRN-${site.code}-KIT` },
      // If the kitchen printer jams, the ticket comes out at the counter rather than nowhere.
      { name: `چاپگر آشپزخانه ${site.name}`, printer_type: 'KITCHEN_IMPACT', paper_width_mm: 80, is_active: true, simulated_address: 'sim://kitchen', fallback_printer_id: receiptPrinter.id },
    );

    const routes: Array<{ group: string; name: string; printer: any; documents: string[] }> = [
      { group: 'RCPT', name: 'صندوق', printer: receiptPrinter, documents: ['CUSTOMER_RECEIPT', 'GUEST_BILL', 'COURIER_SLIP'] },
      { group: 'KIT', name: 'آشپزخانه', printer: kitchenPrinter, documents: ['KITCHEN_TICKET'] },
    ];
    for (const route of routes) {
      const group = await findOrCreate(
        printerGroupRepo,
        { tenant_id: tenant.id, branch_id: site.id, code: `GRP-${site.code}-${route.group}` },
        { name: `${route.name} ${site.name}` },
      );
      await findOrCreate(printerMemberRepo, { group_id: group.id, printer_id: route.printer.id }, { priority: 1, copies: 1 });
      for (const documentType of route.documents) {
        await findOrCreate(
          printRouteRepo,
          { tenant_id: tenant.id, branch_id: site.id, document_type: documentType, printer_group_id: group.id },
          { priority: 10, copies: 1 },
        );
      }
    }
  }

  // 7. Idempotent Reason Codes
  const reasons = [
    { tenant_id: tenant.id, code: 'WASTE_EXPIRED', name: 'Expired Stock Waste', type: 'INVENTORY_WASTE', requires_approval: false },
    { tenant_id: tenant.id, code: 'WASTE_DAMAGED', name: 'Damaged Goods Waste', type: 'INVENTORY_WASTE', requires_approval: false },
    { tenant_id: tenant.id, code: 'REFUND_CUSTOMER', name: 'Customer Dissatisfaction Refund', type: 'REFUND', requires_approval: true },
    { tenant_id: tenant.id, code: 'MANAGER_OVERRIDE', name: 'Manager Manual Adjustment', type: 'OVERRIDE', requires_approval: true },
  ];
  for (const r of reasons) {
    const existing = await reasonRepo.findOne({ where: { tenant_id: tenant.id, code: r.code } });
    if (!existing) {
      await reasonRepo.save(reasonRepo.create(r));
    }
  }
  // The till's own reasons, in the language the cashier reads, each offered only where it
  // applies: a void picker used to list stock-waste codes and nothing for a guest who simply
  // changed their mind.
  const tillReasons = [
    { code: 'CHANGED_MIND', name: 'مشتری منصرف شد', type: 'VOID', applies_to: ['ITEM_VOID', 'ORDER_CANCEL'] },
    { code: 'WRONG_ENTRY', name: 'ثبت اشتباه در صندوق', type: 'VOID', applies_to: ['ITEM_VOID', 'ORDER_CANCEL', 'PAYMENT_REVERSAL'] },
    { code: 'LONG_WAIT', name: 'تأخیر در آماده‌سازی', type: 'VOID', applies_to: ['ORDER_CANCEL', 'REFUND'] },
    { code: 'FOOD_QUALITY', name: 'کیفیت نامناسب غذا', type: 'REFUND', applies_to: ['REFUND', 'ITEM_VOID'] },
    { code: 'WRONG_ITEM', name: 'غذای اشتباه تحویل شد', type: 'REFUND', applies_to: ['REFUND'] },
    { code: 'PAYOUT_SUPPLIES', name: 'خرید اقلام مصرفی', type: 'CASH', applies_to: ['SHIFT_CLOSE'] },
    { code: 'PAYOUT_COURIER', name: 'پرداخت به پیک', type: 'CASH', applies_to: ['SHIFT_CLOSE', 'SETTLEMENT_CLOSE'] },
    { code: 'CUSTOMER_COPY', name: 'درخواست نسخه دوم مشتری', type: 'OTHER', applies_to: ['REPRINT'] },
    { code: 'MANAGER_DISCOUNT', name: 'تخفیف مدیریتی', type: 'OVERRIDE', applies_to: ['PRICE_OVERRIDE'] },
  ];
  for (const r of tillReasons) {
    if (await reasonRepo.findOne({ where: { tenant_id: tenant.id, code: r.code } })) continue;
    await reasonRepo.save(reasonRepo.create({ tenant_id: tenant.id, requires_approval: false, ...r }));
  }
  for (const [code, from, to] of [
    ['WASTE_EXPIRED', 'Expired Stock Waste', 'ضایعات تاریخ گذشته'],
    ['WASTE_DAMAGED', 'Damaged Goods Waste', 'ضایعات آسیب‌دیده'],
    ['REFUND_CUSTOMER', 'Customer Dissatisfaction Refund', 'نارضایتی مشتری'],
    ['MANAGER_OVERRIDE', 'Manager Manual Adjustment', 'اصلاح دستی مدیر'],
  ]) {
    await reasonRepo.update({ tenant_id: tenant.id, code, name: from }, { name: to });
  }
  // An empty scope offers a code everywhere; the stock-waste ones have no place at the till.
  for (const [code, scope] of [
    ['WASTE_EXPIRED', ['OTHER']],
    ['WASTE_DAMAGED', ['OTHER']],
    ['REFUND_CUSTOMER', ['REFUND']],
    ['MANAGER_OVERRIDE', ['PRICE_OVERRIDE', 'OTHER']],
  ] as Array<[string, string[]]>) {
    await AppDataSource.query(
      `UPDATE reason_code SET applies_to = $1 WHERE tenant_id = $2 AND code = $3 AND applies_to = '{}'`,
      [scope, tenant.id, code],
    );
  }

  // 7a. Idempotent order action windows. Seeded from the same constant the edit
  // policy falls back to, so a tenant that has never saved the settings group
  // behaves identically to one that saved the defaults explicitly.
  const existingOrderActions = await settingRepo.findOne({
    where: { tenant_id: tenant.id, key: 'ORDER_ACTIONS', branch_id: IsNull() },
  });
  if (!existingOrderActions) {
    await settingRepo.save(
      settingRepo.create({
        tenant_id: tenant.id,
        branch_id: null,
        key: 'ORDER_ACTIONS',
        value: { ...ORDER_ACTION_DEFAULTS },
        schema_version: 1,
      }),
    );
  }

  // 7a-ii. One live override, so the inheritance is visible without configuring it
  // first. Downtown is the express site: it turns orders over quickly, so a cashier
  // there keeps authority for a shorter window than the chain default.
  const existingDowntownOrderActions = await settingRepo.findOne({
    where: { tenant_id: tenant.id, key: 'ORDER_ACTIONS', branch_id: branchExpress.id },
  });
  if (!existingDowntownOrderActions) {
    await settingRepo.save(
      settingRepo.create({
        tenant_id: tenant.id,
        branch_id: branchExpress.id,
        key: 'ORDER_ACTIONS',
        value: { ...ORDER_ACTION_DEFAULTS, editWindowMinutes: 5, cancelWindowMinutes: 5 },
        schema_version: 1,
      }),
    );
    console.log('Seeded branch override: ORDER_ACTIONS for Downtown Express (5 min windows)');
  }

  // 7b. Demo customers make directory, address, and credit-account screens useful
  // immediately after a fresh deployment.
  // Regulars of the Valiasr branch, with addresses its couriers can reach, and one company
  // that eats on account. Credit limits are sized to the menu: a limit under one meal made
  // the on-account tender refuse every order.
  const demoCustomers = [
    { code: 'CUST-1001', first_name: 'رضا', last_name: 'محمدی', legacyName: ['Reza', 'Mohammadi'], mobile: '09121234567', email: 'reza@example.test', credit_limit: '100000000.0000', legacyLimit: '5000000.0000', current_balance: '-35000000.0000', address: 'تهران، خیابان ولیعصر، بالاتر از چهارراه ولیعصر، کوچه بوعلی، پلاک ۱۲، واحد ۳', postal_code: '1415943511' },
    { code: 'CUST-1002', first_name: 'الهام', last_name: 'صادقی', legacyName: ['Sara', 'Ahmadi'], mobile: '09121234568', email: 'sara@example.test', credit_limit: '60000000.0000', legacyLimit: '3000000.0000', current_balance: '25000000.0000', address: 'تهران، خیابان فاطمی غربی، کوچه جمالزاده شمالی، پلاک ۸، طبقه دوم', postal_code: '1416754321' },
    { code: 'CUST-1003', first_name: 'نیما', last_name: 'حسینی', legacyName: ['Nima', 'Hosseini'], mobile: '09121234569', email: 'nima@example.test', credit_limit: '40000000.0000', legacyLimit: '2000000.0000', current_balance: '0.0000', address: 'تهران، خیابان انقلاب، خیابان وصال شیرازی، پلاک ۴۵', postal_code: '1417613412' },
    { code: 'CUST-2001', first_name: 'شرکت فناوران آریا', last_name: '', legacyName: null, mobile: '02188001234', email: 'finance@arya.example.test', credit_limit: '300000000.0000', legacyLimit: null, current_balance: '0.0000', address: 'تهران، خیابان ولیعصر، نرسیده به پارک ساعی، برج نگار، طبقه ۷', postal_code: '1511733111' },
  ];
  for (const demo of demoCustomers) {
    let customer = await customerRepo.findOne({ where: { tenant_id: tenant.id, code: demo.code } });
    if (!customer) {
      customer = await customerRepo.save(customerRepo.create({
        tenant_id: tenant.id,
        code: demo.code,
        first_name: demo.first_name,
        last_name: demo.last_name,
        mobile: demo.mobile,
        email: demo.email,
        is_active: true,
      }));
    } else if (demo.legacyName && customer.first_name === demo.legacyName[0] && customer.last_name === demo.legacyName[1]) {
      customer.first_name = demo.first_name;
      customer.last_name = demo.last_name;
      customer = await customerRepo.save(customer);
    }

    const phone = await customerPhoneRepo.findOne({ where: { tenant_id: tenant.id, customer_id: customer.id } });
    if (!phone) {
      await customerPhoneRepo.save(customerPhoneRepo.create({
        tenant_id: tenant.id,
        customer_id: customer.id,
        phone_number: demo.mobile,
        normalized_phone: demo.mobile,
        label: 'PRIMARY_MOBILE',
        is_primary: true,
        is_verified: true,
      }));
    }

    const address = await customerAddressRepo.findOne({ where: { tenant_id: tenant.id, customer_id: customer.id } });
    if (!address) {
      await customerAddressRepo.save(customerAddressRepo.create({
        tenant_id: tenant.id,
        customer_id: customer.id,
        title: 'خانه',
        address_text: demo.address,
        postal_code: demo.postal_code,
        is_default: true,
      }));
    } else if (address.postal_code === `demo-${demo.code.toLowerCase()}`) {
      await customerAddressRepo.update({ id: address.id }, { title: 'خانه', address_text: demo.address, postal_code: demo.postal_code });
    }

    let account = await creditAccountRepo.findOne({
      where: { tenant_id: tenant.id, customer_id: customer.id, currency_code: 'IRR' },
    });
    if (!account) {
      account = await creditAccountRepo.save(creditAccountRepo.create({
        tenant_id: tenant.id,
        customer_id: customer.id,
        currency_code: 'IRR',
        mode: 'FINITE',
        credit_limit: demo.credit_limit,
        current_balance: demo.current_balance,
        status: 'ACTIVE',
        is_blocked: false,
      }));
    } else if (demo.legacyLimit && account.credit_limit === demo.legacyLimit) {
      // Only the limit is raised on an existing account; its balance is backed by ledger entries.
      await creditAccountRepo.update({ id: account.id }, { credit_limit: demo.credit_limit });
    }

    if (demo.current_balance.startsWith('-')) {
      const openingEntry = await creditEntryRepo.findOne({
        where: { tenant_id: tenant.id, account_id: account.id, reference: 'DEMO-OPENING-BALANCE' },
      });
      if (!openingEntry) {
        await creditEntryRepo.save(creditEntryRepo.create({
          tenant_id: tenant.id,
          account_id: account.id,
          entry_type: 'PURCHASE',
          amount: demo.current_balance,
          currency_code: 'IRR',
          reason_text: 'Demo opening balance',
          reference: 'DEMO-OPENING-BALANCE',
          business_date: new Date().toISOString().slice(0, 10),
          balance_after: demo.current_balance,
        }));
      }
    }
  }

  // 8. Idempotent catalogue: Iran Burger's menu with the chain's own photos. A photo is
  // attached only when the row is first created, so one removed in the app stays removed.
  const categoryByCode = new Map<string, any>();
  for (const [index, c] of IRANBURGER_CATEGORIES.entries()) {
    let category = await catRepo.findOne({ where: { tenant_id: tenant.id, code: c.code } });
    if (!category) {
      category = await catRepo.save(catRepo.create({
        tenant_id: tenant.id,
        code: c.code,
        name: c.name,
        sort_order: index + 1,
        is_active: true,
        image_asset_id: await seedPhoto(tenant.id, c.photo),
      }));
      console.log(`Seeded Category: ${c.name}`);
    }
    categoryByCode.set(c.code, category);
  }

  for (const p of IRANBURGER_PRODUCTS) {
    const existing = await prodRepo.findOne({ where: { tenant_id: tenant.id, code: p.code } });
    if (existing) continue;
    await prodRepo.save(prodRepo.create({
      tenant_id: tenant.id,
      category_id: categoryByCode.get(p.category).id,
      code: p.code,
      sku: p.code,
      name: p.name,
      base_price: MoneyUtil.format(p.price),
      tax_rate: '0.0900',
      image_asset_id: p.photo ? await seedPhoto(tenant.id, p.code) : null,
      is_active: true,
    }));
    console.log(`Seeded Product: ${p.name}`);
  }

  // Modifiers. A group is attached to its categories' products only when the group is first
  // created, so one detached in the catalogue stays detached.
  const optionGroupRepo = AppDataSource.getRepository('OptionGroup');
  const optionItemRepo = AppDataSource.getRepository('OptionItem');
  const productOptionRepo = AppDataSource.getRepository('ProductOptionGroup');
  for (const [groupIndex, g] of IRANBURGER_OPTION_GROUPS.entries()) {
    if (await optionGroupRepo.findOne({ where: { tenant_id: tenant.id, code: g.code } })) continue;
    const group: any = await optionGroupRepo.save(optionGroupRepo.create({
      tenant_id: tenant.id,
      code: g.code,
      name: g.name,
      min_selection: g.min,
      max_selection: g.max,
      is_required: g.min > 0,
    }));
    for (const [itemIndex, item] of g.items.entries()) {
      await optionItemRepo.save(optionItemRepo.create({
        tenant_id: tenant.id,
        option_group_id: group.id,
        code: item.code,
        name: item.name,
        price_delta: MoneyUtil.format(item.price),
        is_default: !!item.isDefault,
        sort_order: itemIndex,
      }));
    }
    const products = await prodRepo.find({ where: { tenant_id: tenant.id, is_active: true } });
    const categoryIds = g.categories.map((code) => categoryByCode.get(code)?.id).filter(Boolean);
    for (const product of products.filter((p: any) => categoryIds.includes(p.category_id))) {
      await productOptionRepo.save(productOptionRepo.create({
        tenant_id: tenant.id,
        product_id: product.id,
        option_group_id: group.id,
        sort_order: groupIndex,
      }));
    }
    console.log(`Seeded Option Group: ${g.name}`);
  }

  // Coupons a cashier can key in at the till. Unlike the app's one-time codes these serve the
  // demo's many sales, though a customer still redeems each only once. Amounts are in rial at
  // the menu's prices, so a cap is large enough to matter on a burger.
  const couponRepo = AppDataSource.getRepository('Coupon');
  const productIdByCode = async (code: string) =>
    ((await prodRepo.findOne({ where: { tenant_id: tenant.id, code } })) as any)?.id || null;
  const coupons = [
    { code: 'IB10', coupon_type: 'PERCENTAGE', percentage: '10.00', minimum_subtotal: MoneyUtil.format(5_000_000), maximum_discount_amount: MoneyUtil.format(2_000_000) },
    { code: 'WELCOME15', coupon_type: 'PERCENTAGE', percentage: '15.00', minimum_subtotal: null, maximum_discount_amount: MoneyUtil.format(1_500_000) },
    // Two Iran Burgers, and one portion of fries in the basket comes free.
    { code: 'FRIES-FREE', coupon_type: 'FREE_ITEM', percentage: '0.00', buy_product_id: await productIdByCode('101001'), buy_quantity: 2, reward_product_id: await productIdByCode('104003'), reward_quantity: 1, minimum_subtotal: null, maximum_discount_amount: null },
  ];
  for (const c of coupons) {
    if (await couponRepo.findOne({ where: { tenant_id: tenant.id, code: c.code } })) continue;
    await couponRepo.save(couponRepo.create({ tenant_id: tenant.id, is_active: true, max_uses: 1000, uses_count: 0, ...c }));
    console.log(`Seeded Coupon: ${c.code}`);
  }

  // 9. Idempotent chain sales history.
  //
  // Nothing else in the seed writes orders, so every branch report opened on a fresh
  // database was empty and the chain roll-up had nothing to roll up. This lays down a
  // fortnight of completed orders per selling branch with deliberately different shapes —
  // Valiasr sells often and small, Hervi rarely and large, the central branch sits between,
  // and the rest vary — so a comparison report shows a spread instead of identical rows.
  const HISTORY_DAYS = 14;
  // Order numbers the history is written under. The generic demo used SEED-; those orders
  // sold a catalogue that no longer exists and are cleared by the rebrand.
  const HISTORY_PREFIX = 'HIS-';
  // A string, so every figure below stays in decimal arithmetic. The seeded orders are
  // what the dashboards, reports and branch comparison are computed from, so drift here
  // shows up as demo figures that do not reconcile.
  const TAX_RATE = '0.09';

  const seedProducts = await prodRepo.find({ where: { tenant_id: tenant.id } });
  const productByCode = new Map(seedProducts.map((p: any) => [p.code, p]));

  await AppDataSource.query(
    `UPDATE branch SET branch_type = 'RESTAURANT' WHERE tenant_id = $1 AND (branch_type IS NULL OR branch_type = '')`,
    [tenant.id],
  );

  // Weights are draw counts, not prices: most tickets are a burger or sandwich with fries,
  // with the pizzas, combos and kids' packs turning up less often.
  const basket = [
    { code: '101001', weight: 6 }, // ایران برگر
    { code: '101054', weight: 4 }, // چیز برگر
    { code: '101012', weight: 4 }, // زینگر برگر
    { code: '101002', weight: 3 }, // چیز ماشروم برگر
    { code: '101005', weight: 2 }, // چوریتسو برگر
    { code: '102017', weight: 2 }, // گوشت تنوری
    { code: '102006', weight: 2 }, // کریسپی چیکن
    { code: '103015', weight: 3 }, // فیله استریپس سه تکه
    { code: '11106', weight: 2 }, // پیتزا مخلوط
    { code: '11109', weight: 2 }, // پیتزا پپرونی
    { code: '11303', weight: 2 }, // کمبو آبی
    { code: '11403', weight: 1 }, // هپی پک گوشت
    { code: '104003', weight: 6 }, // سیب زمینی سرخ شده
    { code: '104004', weight: 2 }, // قارچ سوخاری
    { code: '104001', weight: 2 }, // سالاد فصل
  ].filter((entry) => productByCode.has(entry.code));
  const drawPool: string[] = [];
  for (const entry of basket) {
    for (let i = 0; i < entry.weight; i += 1) drawPool.push(entry.code);
  }

  // A fixed-seed generator, so wiping and re-seeding reproduces the same demo numbers
  // and a screenshot taken last week still matches the app today.
  let rngState = 20260909;
  const rand = () => {
    rngState = (rngState * 1103515245 + 12345) % 2147483648;
    return rngState / 2147483648;
  };
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];

  // Only selling sites get a sales history; the commissary is deliberately absent.
  const namedProfiles: Record<string, { ordersPerDay: number; maxQty: number; types: string[] }> = {
    'TEH-CENTRAL': { ordersPerDay: 8, maxQty: 2, types: ['DINE_IN', 'DINE_IN', 'TAKEAWAY', 'DELIVERY'] },
    'TEH-DOWNTOWN': { ordersPerDay: 12, maxQty: 1, types: ['TAKEAWAY', 'TAKEAWAY', 'DELIVERY'] },
    'TEH-NORTH': { ordersPerDay: 4, maxQty: 3, types: ['DINE_IN', 'DINE_IN', 'DELIVERY'] },
  };

  for (const branch of sellingBranches) {
    const profile = namedProfiles[branch.code] || {
      ordersPerDay: 3 + Math.floor(rand() * 6),
      maxQty: 2,
      types: ['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'DELIVERY'],
    };
    const firstNumber = `${HISTORY_PREFIX}${branch.code}-0001`;
    const already = await orderRepo.findOne({ where: { tenant_id: tenant.id, order_number: firstNumber } });
    if (already || drawPool.length === 0) continue;

    const headers: any[] = [];
    const linesByOrder: any[][] = [];
    let sequence = 0;
    for (let dayOffset = HISTORY_DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
      const day = new Date();
      day.setDate(day.getDate() - dayOffset);
      const businessDate = day.toISOString().slice(0, 10);

      for (let n = 0; n < profile.ordersPerDay; n += 1) {
        sequence += 1;
        const orderType = pick(profile.types);
        // Spread across a trading day so hourly views and "recent orders" lists read
        // like a real service rather than a burst at midnight.
        const placedAt = new Date(day);
        placedAt.setHours(11 + Math.floor(rand() * 11), Math.floor(rand() * 60), 0, 0);

        const lineCount = 1 + Math.floor(rand() * 3);
        const chosen = new Map<string, number>();
        for (let i = 0; i < lineCount; i += 1) {
          const code = pick(drawPool);
          if (chosen.has(code)) continue;
          chosen.set(code, 1 + Math.floor(rand() * profile.maxQty));
        }

        let subtotal = '0.0000';
        const lines: any[] = [];
        let lineNumber = 0;
        for (const [code, qty] of chosen) {
          const product = productByCode.get(code) as any;
          lineNumber += 1;
          const unitPrice = MoneyUtil.format(product.base_price);
          const baseTotal = MoneyUtil.multiply(unitPrice, qty);
          const lineTax = MoneyUtil.multiply(baseTotal, TAX_RATE);
          const lineTotal = MoneyUtil.add(baseTotal, lineTax);
          subtotal = MoneyUtil.add(subtotal, baseTotal);
          lines.push({
            tenant_id: tenant.id,
            line_number: lineNumber,
            product_id: product.id,
            product_code: product.code,
            product_name: product.name,
            quantity: qty.toFixed(3),
            unit_price: unitPrice,
            base_total: baseTotal,
            subtotal: baseTotal,
            tax_total: lineTax,
            tax_amount: lineTax,
            line_total: lineTotal,
            total_amount: lineTotal,
            state: 'ACTIVE',
          });
        }

        const deliveryFee = MoneyUtil.format(orderType === 'DELIVERY' ? 600000 : 0);
        // Tax follows the line items only: a delivery fee is a service charge here, not
        // a taxable good, which is also how the POS quotes it.
        const tax = MoneyUtil.multiply(subtotal, TAX_RATE);
        const grandTotal = MoneyUtil.add(MoneyUtil.add(subtotal, tax), deliveryFee);

        headers.push(orderRepo.create({
          tenant_id: tenant.id,
          branch_id: branch.id,
          order_number: `${HISTORY_PREFIX}${branch.code}-${String(sequence).padStart(4, '0')}`,
          order_type: orderType,
          channel: orderType === 'DELIVERY' ? 'ONLINE' : 'POS',
          state: 'COMPLETED',
          status: 'COMPLETED',
          currency_code: 'IRR',
          business_date: businessDate,
          subtotal,
          subtotal_amount: subtotal,
          delivery_fee: deliveryFee,
          tax_total: tax,
          tax_amount: tax,
          grand_total: grandTotal,
          total_amount: grandTotal,
          paid_total: grandTotal,
          paid_amount: grandTotal,
          fulfillment_status: 'COMPLETED',
          submitted_at: placedAt,
          completed_at: placedAt,
        }));
        linesByOrder.push(lines);
      }
    }

    // Written in bulk: 23 branches of a fortnight each is a couple of thousand orders, and
    // this runs as the API container starts.
    const saved: any[] = await orderRepo.save(headers, { chunk: 200 });
    const items = saved.flatMap((order, i) => linesByOrder[i].map((l) => orderItemRepo.create({ ...l, order_id: order.id })));
    await orderItemRepo.save(items, { chunk: 500 });
    console.log(`Seeded ${sequence} historical orders for branch ${branch.name}`);
  }

  // placed_at is a CreateDateColumn, so TypeORM stamps it with now() on insert and
  // ignores the backdated value. Reports filter on business_date and are unaffected,
  // but order lists sort by placed_at — without this the whole fortnight would appear
  // to have been rung up in the same second.
  await AppDataSource.query(
    `UPDATE order_header SET placed_at = submitted_at, updated_at = submitted_at
     WHERE tenant_id = $1 AND order_number LIKE $2 AND submitted_at IS NOT NULL
       AND placed_at <> submitted_at`,
    [tenant.id, `${HISTORY_PREFIX}%`],
  );

  console.log('Database seed execution completed successfully.');
  console.log('');
  console.log('Demo sign-ins (all share the same password):');
  console.log(`  head office   ${ADMIN_USERNAME}`);
  console.log(`  branch manager ${BRANCH_MANAGER_USERNAME}  (ایران برگر ولیعصر)`);
  console.log(`  cashier        ${CASHIER_USERNAME}  (ایران برگر ولیعصر)`);
  console.log(`  password       ${ADMIN_PASSWORD}   approver pin ${APPROVER_PIN}`);
}

// Where the chain's product photos sit: next to package.json both in the repo (ts-node
// runs from backend/) and in the image (node runs from /app).
const SEED_ASSET_DIRS = [
  path.join(process.cwd(), 'seed-assets', 'iranburger'),
  path.join(__dirname, '..', 'seed-assets', 'iranburger'),
  path.join(__dirname, '..', '..', 'seed-assets', 'iranburger'),
];

/**
 * Copies one product photo into the upload directory and records it the way MediaService
 * records an upload, so the catalogue serves it like any photo a user added. Files are
 * named by content, so a photo shared by two products is stored once.
 */
async function seedPhoto(tenantId: string, productCode: string): Promise<string | null> {
  const source = SEED_ASSET_DIRS.map((dir) => path.join(dir, `${productCode}.jpg`)).find((file) => fs.existsSync(file));
  if (!source) {
    console.warn(`No seed photo for product ${productCode}`);
    return null;
  }
  const buffer = fs.readFileSync(source);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const fileName = `ib-${sha256.substring(0, 16)}.jpg`;
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const target = path.join(uploadDir, fileName);
  if (!fs.existsSync(target)) fs.writeFileSync(target, buffer);

  const assetRepo = AppDataSource.getRepository('FileAsset');
  const existing = await assetRepo.findOne({ where: { tenant_id: tenantId, checksum_sha256: sha256 } });
  if (existing) return existing.id;
  const saved = await assetRepo.save(assetRepo.create({
    tenant_id: tenantId,
    storage_kind: 'LOCAL',
    file_path: `/uploads/${fileName}`,
    mime_type: 'image/jpeg',
    size_bytes: buffer.length,
    checksum_sha256: sha256,
  }));
  return saved.id;
}

/**
 * Turns a database seeded with the old generic demo into Iran Burger, once. Runs in one
 * transaction with the tenant rename that marks it done, so a failure leaves it to retry.
 *
 * Rows are renamed only where they still carry the old seeded name, so anything a user
 * renamed is left alone. The old catalogue is retired rather than deleted, because orders
 * that sold it still point at it.
 */
async function rebrandLegacyDemo(
  tenantId: string,
  newTenantName: string,
  sites: { branchTeh: any; branchExpress: any; branchNorth: any },
) {
  // TypeORM hands back [rows, count] for an UPDATE or DELETE ... RETURNING.
  const affected = (result: any) => (Array.isArray(result[0]) ? result[0].length : result.length);
  await AppDataSource.transaction(async (em) => {
    const renames: Array<[string, string, string, string]> = [];
    for (const [legacy, site] of [
      ['Central Plaza', sites.branchTeh],
      ['Downtown Express', sites.branchExpress],
      ['Northside Grill', sites.branchNorth],
    ] as Array<[string, any]>) {
      renames.push(
        ['printer', `PRN-${site.code}-RCPT`, `${legacy} Receipt Printer`, `چاپگر صندوق ${site.name}`],
        ['printer', `PRN-${site.code}-KIT`, `${legacy} Kitchen Printer`, `چاپگر آشپزخانه ${site.name}`],
        ['printer_group', `GRP-${site.code}-RCPT`, `${legacy} Counter`, `صندوق ${site.name}`],
        ['printer_group', `GRP-${site.code}-KIT`, `${legacy} Kitchen`, `آشپزخانه ${site.name}`],
      );
    }
    renames.push(
      ['terminal', 'TERM-01', 'Main POS Register T-01', 'صندوق ۱ نصرت'],
      ['terminal', 'TERM-02', 'Express Kiosk T-02', 'صندوق ۱ ولیعصر'],
      ['terminal', 'TERM-03', 'Northside POS Register T-03', 'صندوق ۱ هروی'],
      ['delivery_zone', 'ZONE-CENTRAL-01', 'Central District Zone 1', 'محدوده ارسال نصرت'],
      ['delivery_zone', 'ZONE-DOWNTOWN-01', 'Downtown Express Zone 1', 'محدوده ارسال ولیعصر'],
      ['delivery_zone', 'ZONE-NORTH-01', 'Northside Zone 1', 'محدوده ارسال هروی'],
      ['dining_area', 'AREA-MAIN', 'Main Dining Hall', 'سالن اصلی'],
      ['dining_area', 'AREA-EXPRESS', 'Express Floor', 'سالن ولیعصر'],
      ['courier', 'CR-001', 'Ali Rezaei', 'علی رضایی'],
      ['courier', 'CR-002', 'Sara Ahmadi', 'سارا احمدی'],
    );
    for (const [table, code, from, to] of renames) {
      await em.query(`UPDATE ${table} SET name = $1 WHERE tenant_id = $2 AND code = $3 AND name = $4`, [to, tenantId, code, from]);
    }

    for (const [username, from, to] of [
      [ADMIN_USERNAME, 'System Administrator', 'مدیر ستاد'],
      [BRANCH_MANAGER_USERNAME, 'Downtown Branch Manager', 'مدیر شعبه ولیعصر'],
      [CASHIER_USERNAME, 'Downtown Cashier', 'صندوقدار شعبه ولیعصر'],
    ]) {
      await em.query(
        `UPDATE admin_user SET display_name = $1 WHERE tenant_id = $2 AND username = $3 AND display_name = $4`,
        [to, tenantId, username, from],
      );
    }

    // Everything on the menu that is not Iran Burger's comes off it: the old demo items and
    // whatever was added by hand while testing. Reversible from the catalogue screens.
    const keepProducts = IRANBURGER_PRODUCTS.map((p) => p.code);
    const keepCategories = IRANBURGER_CATEGORIES.map((c) => c.code);
    const retired = await em.query(
      `UPDATE product SET is_active = false WHERE tenant_id = $1 AND is_active AND NOT (code = ANY($2)) RETURNING id`,
      [tenantId, keepProducts],
    );
    await em.query(
      `UPDATE category SET is_active = false WHERE tenant_id = $1 AND is_active AND NOT (code = ANY($2))`,
      [tenantId, keepCategories],
    );
    console.log(`Retired ${affected(retired)} products from the old demo catalogue (${LEGACY_PRODUCT_CODES.join(', ')}, ${LEGACY_CATEGORY_CODE} and any added by hand)`);

    // The old two-week history sold cheeseburgers at made-up prices under English branch
    // names; it is regenerated from the real menu under HIS- numbers. Only orders nothing
    // else points at are removed, so a seeded order that was since refunded, invoiced or
    // paid against stays put.
    const referencing: Array<{ table_name: string }> = await em.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'order_id' AND table_name <> 'order_item'`,
    );
    const untouched = referencing
      .map(({ table_name }) => `NOT EXISTS (SELECT 1 FROM "${table_name}" r WHERE r.order_id = o.id)`)
      .join(' AND ');
    const doomed = `SELECT o.id FROM order_header o
      WHERE o.tenant_id = $1 AND o.order_number LIKE 'SEED-%'${untouched ? ` AND ${untouched}` : ''}`;
    await em.query(`DELETE FROM order_item WHERE order_id IN (${doomed})`, [tenantId]);
    const removed = await em.query(`DELETE FROM order_header WHERE id IN (${doomed}) RETURNING id`, [tenantId]);
    console.log(`Removed ${affected(removed)} generic seeded orders; the history is regenerated from the Iran Burger menu`);

    await em.query(`UPDATE tenant SET name = $1 WHERE id = $2`, [newTenantName, tenantId]);
  });
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

