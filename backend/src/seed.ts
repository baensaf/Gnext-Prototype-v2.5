import * as argon2 from 'argon2';
import { AppDataSource } from './data-source';
import { IsNull } from 'typeorm';
import { ORDER_ACTION_DEFAULTS } from './modules/order/order-edit-policy';
import { MoneyUtil } from './common/utils/money.util';

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
  const customerGroupRepo = AppDataSource.getRepository('CustomerGroup');
  const customerRepo = AppDataSource.getRepository('Customer');
  const customerPhoneRepo = AppDataSource.getRepository('CustomerPhone');
  const customerAddressRepo = AppDataSource.getRepository('CustomerAddress');
  const creditAccountRepo = AppDataSource.getRepository('CustomerCreditAccount');
  const creditEntryRepo = AppDataSource.getRepository('CreditEntry');
  const orderRepo = AppDataSource.getRepository('OrderHeader');
  const orderItemRepo = AppDataSource.getRepository('OrderItem');

  // 1. Idempotent Tenant Seed
  let tenant = await tenantRepo.findOne({ where: { id: DEFAULT_TENANT_ID } });
  if (!tenant) {
    tenant = tenantRepo.create({
      id: DEFAULT_TENANT_ID,
      code: DEFAULT_TENANT_CODE,
      name: 'Gnext Core Tenant',
      base_currency: 'IRR',
      default_locale: 'fa',
      time_zone: 'Asia/Tehran',
    });
    await tenantRepo.save(tenant);
    console.log('Seeded Tenant: Gnext Core Tenant');
  }

  // 2. Idempotent Admin Seed
  let admin = await adminRepo.findOne({ where: { tenant_id: tenant.id, username: ADMIN_USERNAME } });
  if (!admin) {
    const passwordHash = await argon2.hash(ADMIN_PASSWORD);
    const pinHash = await argon2.hash(APPROVER_PIN);
    admin = adminRepo.create({
      tenant_id: tenant.id,
      username: ADMIN_USERNAME,
      display_name: 'System Administrator',
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

  // 4. Idempotent Branches
  let branchTeh = await branchRepo.findOne({ where: { tenant_id: tenant.id, code: 'TEH-CENTRAL' } });
  if (!branchTeh) {
    branchTeh = branchRepo.create({
      tenant_id: tenant.id,
      code: 'TEH-CENTRAL',
      name: 'Central Plaza',
      branch_type: 'RESTAURANT',
      phone: '+98-21-88888888',
      address: 'Tehran, Central District',
      time_zone: 'Asia/Tehran',
      is_active: true,
    });
    await branchRepo.save(branchTeh);
    console.log('Seeded Branch: Central Plaza');
  } else if (branchTeh.name === 'Central Kitchen') {
    // This site is an ordinary storefront — it has a dining floor, tables and a POS.
    // The old name read as head office, which is a different thing entirely and made
    // the busiest shop in the chain look like the org that owns it.
    branchTeh.name = 'Central Plaza';
    await branchRepo.save(branchTeh);
    console.log('Renamed Branch: Central Kitchen -> Central Plaza');
  }

  let branchExpress = await branchRepo.findOne({ where: { tenant_id: tenant.id, code: 'TEH-DOWNTOWN' } });
  if (!branchExpress) {
    branchExpress = branchRepo.create({
      tenant_id: tenant.id,
      code: 'TEH-DOWNTOWN',
      name: 'Downtown Express',
      branch_type: 'RESTAURANT',
      phone: '+98-21-77777777',
      address: 'Tehran, Downtown Square',
      time_zone: 'Asia/Tehran',
      is_active: true,
    });
    await branchRepo.save(branchExpress);
    console.log('Seeded Branch: Downtown Express');
  }

  let branchNorth = await branchRepo.findOne({ where: { tenant_id: tenant.id, code: 'TEH-NORTH' } });
  if (!branchNorth) {
    branchNorth = branchRepo.create({
      tenant_id: tenant.id,
      code: 'TEH-NORTH',
      name: 'Northside Grill',
      branch_type: 'RESTAURANT',
      phone: '+98-21-66666666',
      address: 'Tehran, Northside Boulevard',
      time_zone: 'Asia/Tehran',
      is_active: true,
    });
    await branchRepo.save(branchNorth);
    console.log('Seeded Branch: Northside Grill');
  }

  // A real central kitchen: it prepares for the storefronts and never serves a
  // customer, so it carries no POS, no kiosk and no sales history. It exists to prove
  // a location can belong to the chain without being a shop.
  let branchCommissary = await branchRepo.findOne({ where: { tenant_id: tenant.id, code: 'TEH-COMMISSARY' } });
  if (!branchCommissary) {
    branchCommissary = branchRepo.create({
      tenant_id: tenant.id,
      code: 'TEH-COMMISSARY',
      name: 'Central Production Kitchen',
      branch_type: 'COMMISSARY',
      phone: '+98-21-55555555',
      address: 'Tehran, Industrial Zone',
      time_zone: 'Asia/Tehran',
      is_active: true,
    });
    await branchRepo.save(branchCommissary);
    console.log('Seeded Branch: Central Production Kitchen (commissary)');
  }

  let branchManager = await adminRepo.findOne({
    where: { tenant_id: tenant.id, username: BRANCH_MANAGER_USERNAME },
  });
  if (!branchManager) {
    branchManager = adminRepo.create({
      tenant_id: tenant.id,
      username: BRANCH_MANAGER_USERNAME,
      display_name: 'Downtown Branch Manager',
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
    console.log(`Seeded Branch Manager User: ${BRANCH_MANAGER_USERNAME} (Downtown Express)`);
  }

  let cashier = await adminRepo.findOne({
    where: { tenant_id: tenant.id, username: CASHIER_USERNAME },
  });
  if (!cashier) {
    cashier = adminRepo.create({
      tenant_id: tenant.id,
      username: CASHIER_USERNAME,
      display_name: 'Downtown Cashier',
      password_hash: await argon2.hash(ADMIN_PASSWORD),
      // No approver pin on purpose: a register operator is who the pin is asked *of*,
      // so giving them one would let the demo approve its own escalations.
      role: 'CASHIER',
      branch_id: branchExpress.id,
      is_active: true,
      preferred_locale: 'fa',
    });
    await adminRepo.save(cashier);
    console.log(`Seeded Cashier User: ${CASHIER_USERNAME} (Downtown Express)`);
  }

  // 4b. Idempotent Delivery Zones
  const defaultZones = [
    { tenant_id: tenant.id, branch_id: branchTeh.id, code: 'ZONE-CENTRAL-01', name: 'Central District Zone 1', fee: '25000.0000', currency_code: 'IRR', estimated_minutes: 30, is_active: true },
    { tenant_id: tenant.id, branch_id: branchExpress.id, code: 'ZONE-DOWNTOWN-01', name: 'Downtown Express Zone 1', fee: '20000.0000', currency_code: 'IRR', estimated_minutes: 20, is_active: true },
    { tenant_id: tenant.id, branch_id: branchNorth.id, code: 'ZONE-NORTH-01', name: 'Northside Zone 1', fee: '30000.0000', currency_code: 'IRR', estimated_minutes: 35, is_active: true },
  ];
  for (const z of defaultZones) {
    const existing = await zoneRepo.findOne({ where: { tenant_id: tenant.id, code: z.code } });
    if (!existing) {
      await zoneRepo.save(zoneRepo.create(z));
      console.log(`Seeded Delivery Zone: ${z.name}`);
    }
  }

  // 4c. Idempotent dine-in floor, one per selling site.
  //
  // Both floors matter now that a branch account is answered only about its own branch.
  // The demo manager and cashier both work at Downtown, so seeding a floor for Central
  // alone left the two accounts anybody actually signs in as looking at an empty dining
  // room, an empty table picker and no courier to dispatch — the screens read as broken
  // features rather than as an empty branch.
  const floors = [
    { branch: branchTeh, code: 'AREA-MAIN', name: 'Main Dining Hall', tables: 8, prefix: 'T' },
    { branch: branchExpress, code: 'AREA-EXPRESS', name: 'Express Floor', tables: 4, prefix: 'E' },
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
    { branch: branchTeh, code: 'CR-001', name: 'Ali Rezaei', phone: '09120000001' },
    { branch: branchExpress, code: 'CR-002', name: 'Sara Ahmadi', phone: '09120000002' },
  ];
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
      compensation_per_delivery: '50000.0000',
      currency_code: 'IRR',
      is_active: true,
    }));
    console.log(`Seeded Courier: ${courier.name}`);
  }

  // 5. Idempotent Terminals
  const terminals = [
    { tenant_id: tenant.id, branch_id: branchTeh.id, code: 'TERM-01', name: 'Main POS Register T-01', device_type: 'POS_STATION' },
    { tenant_id: tenant.id, branch_id: branchExpress.id, code: 'TERM-02', name: 'Express Kiosk T-02', device_type: 'KIOSK' },
    { tenant_id: tenant.id, branch_id: branchNorth.id, code: 'TERM-03', name: 'Northside POS Register T-03', device_type: 'POS_STATION' },
  ];
  for (const t of terminals) {
    const existing = await terminalRepo.findOne({ where: { tenant_id: tenant.id, code: t.code } });
    if (!existing) {
      await terminalRepo.save(terminalRepo.create(t));
    }
  }

  // 6. Idempotent Payment Methods
  const payMethods = [
    { tenant_id: tenant.id, code: 'CASH', name: 'Cash', kind: 'CASH', is_active: true },
    { tenant_id: tenant.id, code: 'CARD_POS', name: 'Bank Card POS', kind: 'CARD_POS', is_active: true },
    { tenant_id: tenant.id, code: 'CREDIT_ACCOUNT', name: 'Customer Credit Account', kind: 'CUSTOMER_CREDIT', is_active: true },
  ];
  for (const pm of payMethods) {
    const existing = await payMethodRepo.findOne({ where: { tenant_id: tenant.id, code: pm.code } });
    if (!existing) {
      await payMethodRepo.save(payMethodRepo.create(pm));
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
  let vipGroup = await customerGroupRepo.findOne({ where: { tenant_id: tenant.id, code: 'VIP' } });
  if (!vipGroup) {
    vipGroup = await customerGroupRepo.save(customerGroupRepo.create({
      tenant_id: tenant.id,
      code: 'VIP',
      name: 'VIP Customers',
      is_active: true,
    }));
  }

  const demoCustomers = [
    { code: 'CUST-1001', first_name: 'Reza', last_name: 'Mohammadi', mobile: '09121234567', email: 'reza@example.test', credit_limit: '5000000.0000', current_balance: '-350000.0000' },
    { code: 'CUST-1002', first_name: 'Sara', last_name: 'Ahmadi', mobile: '09121234568', email: 'sara@example.test', credit_limit: '3000000.0000', current_balance: '250000.0000' },
    { code: 'CUST-1003', first_name: 'Nima', last_name: 'Hosseini', mobile: '09121234569', email: 'nima@example.test', credit_limit: '2000000.0000', current_balance: '0.0000' },
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
        customer_group_id: vipGroup.id,
        is_active: true,
      }));
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
        title: 'Home',
        address_text: `Tehran demo address for ${demo.first_name} ${demo.last_name}`,
        postal_code: `demo-${demo.code.toLowerCase()}`,
        is_default: true,
      }));
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

  // 8. Idempotent Catalog Reference Data
  let category = await catRepo.findOne({ where: { tenant_id: tenant.id, code: 'CAT-FASTFOOD' } });
  if (!category) {
    category = catRepo.create({
      tenant_id: tenant.id,
      code: 'CAT-FASTFOOD',
      name: 'Fast Food & Burgers',
      sort_order: 1,
      is_active: true,
    });
    await catRepo.save(category);
  }

  const products = [
    { tenant_id: tenant.id, category_id: category.id, code: 'PROD-CHEESEBURGER', name: 'Cheeseburger Special', base_price: '150000.0000', tax_rate: '0.0900' },
    { tenant_id: tenant.id, category_id: category.id, code: 'PROD-FRIES', name: 'French Fries Large', base_price: '60000.0000', tax_rate: '0.0900' },
    { tenant_id: tenant.id, category_id: category.id, code: 'PROD-COLA', name: 'Cola Can 330ml', base_price: '30000.0000', tax_rate: '0.0900' },
  ];
  for (const p of products) {
    const existing = await prodRepo.findOne({ where: { tenant_id: tenant.id, code: p.code } });
    if (!existing) {
      await prodRepo.save(prodRepo.create(p));
    }
  }

  // 8.1 Seed Product Variants for Cheeseburger Special
  const prodBurger = await prodRepo.findOne({ where: { tenant_id: tenant.id, code: 'PROD-CHEESEBURGER' } });
  if (prodBurger) {
    const burgerVariants = [
      { tenant_id: tenant.id, product_id: prodBurger.id, code: 'VAR-CHB-SGL', name: 'Single Patty', sku: 'CHB-SGL', base_price: '150000.0000', is_default: true, sort_order: 0, is_active: true },
      { tenant_id: tenant.id, product_id: prodBurger.id, code: 'VAR-CHB-DBL', name: 'Double Patty', sku: 'CHB-DBL', base_price: '220000.0000', is_default: false, sort_order: 1, is_active: true },
      { tenant_id: tenant.id, product_id: prodBurger.id, code: 'VAR-CHB-TPL', name: 'Triple Patty', sku: 'CHB-TPL', base_price: '290000.0000', is_default: false, sort_order: 2, is_active: true },
    ];
    for (const v of burgerVariants) {
      const existingVar = await variantRepo.findOne({ where: { tenant_id: tenant.id, product_id: prodBurger.id, code: v.code } });
      if (!existingVar) {
        await variantRepo.save(variantRepo.create(v));
      }
    }
  }

  // 9. Idempotent chain sales history.
  //
  // Nothing else in the seed writes orders, so every branch report opened on a fresh
  // database was empty and the chain roll-up had nothing to roll up. This lays down a
  // fortnight of completed orders per branch with deliberately different shapes —
  // Downtown sells often and small, Northside rarely and large, Central sits between —
  // so a comparison report shows a spread instead of three near-identical rows.
  const HISTORY_DAYS = 14;
  // A string, so every figure below stays in decimal arithmetic. The seeded orders are
  // what the dashboards, reports and branch comparison are computed from, so drift here
  // shows up as demo figures that do not reconcile.
  const TAX_RATE = '0.09';

  const seedProducts = await prodRepo.find({
    where: [
      { tenant_id: tenant.id, code: 'PROD-CHEESEBURGER' },
      { tenant_id: tenant.id, code: 'PROD-FRIES' },
      { tenant_id: tenant.id, code: 'PROD-COLA' },
    ],
  });
  const productByCode = new Map(seedProducts.map((p: any) => [p.code, p]));

  await AppDataSource.query(
    `UPDATE branch SET branch_type = 'RESTAURANT' WHERE tenant_id = $1 AND (branch_type IS NULL OR branch_type = '')`,
    [tenant.id],
  );

  // Only selling sites get a sales history. The commissary is deliberately absent.
  const branchProfiles = [
    {
      branch: branchTeh,
      ordersPerDay: 8,
      // Weights are draw counts, not prices: a burger-led kitchen still lands a mid
      // ticket because most orders pair one burger with a side.
      basket: [
        { code: 'PROD-CHEESEBURGER', weight: 5, maxQty: 2 },
        { code: 'PROD-FRIES', weight: 3, maxQty: 2 },
        { code: 'PROD-COLA', weight: 2, maxQty: 2 },
      ],
      types: ['DINE_IN', 'DINE_IN', 'TAKEAWAY', 'DELIVERY'],
    },
    {
      branch: branchExpress,
      ordersPerDay: 12,
      basket: [
        { code: 'PROD-FRIES', weight: 4, maxQty: 2 },
        { code: 'PROD-COLA', weight: 4, maxQty: 2 },
        { code: 'PROD-CHEESEBURGER', weight: 2, maxQty: 1 },
      ],
      types: ['TAKEAWAY', 'TAKEAWAY', 'DELIVERY'],
    },
    {
      branch: branchNorth,
      ordersPerDay: 4,
      basket: [
        { code: 'PROD-CHEESEBURGER', weight: 6, maxQty: 3 },
        { code: 'PROD-FRIES', weight: 3, maxQty: 3 },
        { code: 'PROD-COLA', weight: 2, maxQty: 3 },
      ],
      types: ['DINE_IN', 'DINE_IN', 'DELIVERY'],
    },
  ];

  // A fixed-seed generator, so wiping and re-seeding reproduces the same demo numbers
  // and a screenshot taken last week still matches the app today.
  let rngState = 20260909;
  const rand = () => {
    rngState = (rngState * 1103515245 + 12345) % 2147483648;
    return rngState / 2147483648;
  };
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];

  for (const profile of branchProfiles) {
    const branch = profile.branch as any;
    const firstNumber = `SEED-${branch.code}-0001`;
    const already = await orderRepo.findOne({ where: { tenant_id: tenant.id, order_number: firstNumber } });
    if (already) continue;

    const drawPool: string[] = [];
    for (const entry of profile.basket) {
      for (let i = 0; i < entry.weight; i += 1) drawPool.push(entry.code);
    }
    const maxQtyByCode = new Map(profile.basket.map((b) => [b.code, b.maxQty]));

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
          chosen.set(code, 1 + Math.floor(rand() * (maxQtyByCode.get(code) || 1)));
        }
        if (chosen.size === 0) chosen.set('PROD-COLA', 1);

        let subtotal = '0.0000';
        const lines: any[] = [];
        let lineNumber = 0;
        for (const [code, qty] of chosen) {
          const product = productByCode.get(code) as any;
          if (!product) continue;
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
        if (lines.length === 0) continue;

        const deliveryFee = MoneyUtil.format(orderType === 'DELIVERY' ? 25000 : 0);
        // Tax follows the line items only: a delivery fee is a service charge here, not
        // a taxable good, which is also how the POS quotes it.
        const tax = MoneyUtil.multiply(subtotal, TAX_RATE);
        const grandTotal = MoneyUtil.add(MoneyUtil.add(subtotal, tax), deliveryFee);

        const savedOrder: any = await orderRepo.save(orderRepo.create({
          tenant_id: tenant.id,
          branch_id: branch.id,
          order_number: `SEED-${branch.code}-${String(sequence).padStart(4, '0')}`,
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

        await orderItemRepo.save(lines.map((l) => orderItemRepo.create({ ...l, order_id: savedOrder.id })));
      }
    }
    console.log(`Seeded ${sequence} historical orders for branch ${branch.name}`);
  }

  // placed_at is a CreateDateColumn, so TypeORM stamps it with now() on insert and
  // ignores the backdated value. Reports filter on business_date and are unaffected,
  // but order lists sort by placed_at — without this the whole fortnight would appear
  // to have been rung up in the same second.
  await AppDataSource.query(
    `UPDATE order_header SET placed_at = submitted_at, updated_at = submitted_at
     WHERE tenant_id = $1 AND order_number LIKE 'SEED-%' AND submitted_at IS NOT NULL
       AND placed_at <> submitted_at`,
    [tenant.id],
  );

  console.log('Database seed execution completed successfully.');
  console.log('');
  console.log('Demo sign-ins (all share the same password):');
  console.log(`  head office   ${ADMIN_USERNAME}`);
  console.log(`  branch manager ${BRANCH_MANAGER_USERNAME}  (Downtown Express)`);
  console.log(`  cashier        ${CASHIER_USERNAME}  (Downtown Express)`);
  console.log(`  password       ${ADMIN_PASSWORD}   approver pin ${APPROVER_PIN}`);
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

