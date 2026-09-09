import * as argon2 from 'argon2';
import { AppDataSource } from './data-source';
import { ORDER_ACTION_DEFAULTS } from './modules/order/order-edit-policy';

const DEFAULT_TENANT_ID = 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
const DEFAULT_TENANT_CODE = 'GNEXT';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin@gnext.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'GnextDemo!2026';
const APPROVER_PIN = process.env.APPROVER_PIN || '2468';

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
      name: 'Central Kitchen',
      phone: '+98-21-88888888',
      address: 'Tehran, Central District',
      time_zone: 'Asia/Tehran',
      is_active: true,
    });
    await branchRepo.save(branchTeh);
    console.log('Seeded Branch: Central Kitchen');
  }

  let branchExpress = await branchRepo.findOne({ where: { tenant_id: tenant.id, code: 'TEH-DOWNTOWN' } });
  if (!branchExpress) {
    branchExpress = branchRepo.create({
      tenant_id: tenant.id,
      code: 'TEH-DOWNTOWN',
      name: 'Downtown Express',
      phone: '+98-21-77777777',
      address: 'Tehran, Downtown Square',
      time_zone: 'Asia/Tehran',
      is_active: true,
    });
    await branchRepo.save(branchExpress);
    console.log('Seeded Branch: Downtown Express');
  }

  // 4b. Idempotent Delivery Zones
  const defaultZones = [
    { tenant_id: tenant.id, branch_id: branchTeh.id, code: 'ZONE-CENTRAL-01', name: 'Central District Zone 1', fee: '25000.0000', currency_code: 'IRR', estimated_minutes: 30, is_active: true },
    { tenant_id: tenant.id, branch_id: branchExpress.id, code: 'ZONE-DOWNTOWN-01', name: 'Downtown Express Zone 1', fee: '20000.0000', currency_code: 'IRR', estimated_minutes: 20, is_active: true },
  ];
  for (const z of defaultZones) {
    const existing = await zoneRepo.findOne({ where: { tenant_id: tenant.id, code: z.code } });
    if (!existing) {
      await zoneRepo.save(zoneRepo.create(z));
      console.log(`Seeded Delivery Zone: ${z.name}`);
    }
  }

  // 4c. Idempotent dine-in floor used by the default POS table selector.
  let mainDiningArea = await diningAreaRepo.findOne({
    where: { tenant_id: tenant.id, branch_id: branchTeh.id, code: 'AREA-MAIN' },
  });
  if (!mainDiningArea) {
    mainDiningArea = await diningAreaRepo.save(diningAreaRepo.create({
      tenant_id: tenant.id,
      branch_id: branchTeh.id,
      code: 'AREA-MAIN',
      name: 'Main Dining Hall',
      sort_order: 1,
      is_active: true,
    }));
    console.log('Seeded Dining Area: Main Dining Hall');
  }

  const diningTables = Array.from({ length: 8 }, (_, index) => {
    const number = `T-${String(index + 1).padStart(2, '0')}`;
    return {
      tenant_id: tenant.id,
      dining_area_id: mainDiningArea.id,
      code: number,
      table_number: number,
      seating_capacity: index < 4 ? 4 : 2,
      shape: index % 2 === 0 ? 'SQUARE' : 'CIRCLE',
      pos_x: (index % 4) * 180,
      pos_y: Math.floor(index / 4) * 160,
      is_active: true,
    };
  });
  for (const table of diningTables) {
    const existing = await diningTableRepo.findOne({
      where: { tenant_id: tenant.id, dining_area_id: mainDiningArea.id, code: table.code },
    });
    if (!existing) {
      await diningTableRepo.save(diningTableRepo.create(table));
    }
  }

  const demoCourier = await courierRepo.findOne({ where: { tenant_id: tenant.id, code: 'CR-001' } });
  if (!demoCourier) {
    await courierRepo.save(courierRepo.create({
      tenant_id: tenant.id,
      branch_id: branchTeh.id,
      code: 'CR-001',
      name: 'Ali Rezaei',
      phone: '09120000001',
      vehicle_type: 'MOTORCYCLE',
      status: 'AVAILABLE',
      compensation_per_delivery: '50000.0000',
      currency_code: 'IRR',
      is_active: true,
    }));
    console.log('Seeded Courier: Ali Rezaei');
  }

  // 5. Idempotent Terminals
  const terminals = [
    { tenant_id: tenant.id, branch_id: branchTeh.id, code: 'TERM-01', name: 'Main POS Register T-01', device_type: 'POS_STATION' },
    { tenant_id: tenant.id, branch_id: branchExpress.id, code: 'TERM-02', name: 'Express Kiosk T-02', device_type: 'KIOSK' },
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
    where: { tenant_id: tenant.id, key: 'ORDER_ACTIONS' },
  });
  if (!existingOrderActions) {
    await settingRepo.save(
      settingRepo.create({
        tenant_id: tenant.id,
        key: 'ORDER_ACTIONS',
        value: { ...ORDER_ACTION_DEFAULTS },
        schema_version: 1,
      }),
    );
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

  console.log('Database seed execution completed successfully.');
}

if (require.main === module) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

