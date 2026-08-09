import * as argon2 from 'argon2';
import { AppDataSource } from './data-source';

const DEFAULT_TENANT_ID = 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
const DEFAULT_TENANT_CODE = 'GNEXT';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin@gnext.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'GnextDemo!2026';
const APPROVER_PIN = process.env.APPROVER_PIN || '2468';

async function seed() {
  console.log('Connecting to database via AppDataSource (synchronize: false)...');
  await AppDataSource.initialize();

  const tenantRepo = AppDataSource.getRepository('Tenant');
  const adminRepo = AppDataSource.getRepository('AdminUser');
  const branchRepo = AppDataSource.getRepository('Branch');
  const terminalRepo = AppDataSource.getRepository('Terminal');
  const currencyRepo = AppDataSource.getRepository('Currency');
  const payMethodRepo = AppDataSource.getRepository('PaymentMethod');
  const reasonRepo = AppDataSource.getRepository('ReasonCode');
  const catRepo = AppDataSource.getRepository('Category');
  const prodRepo = AppDataSource.getRepository('Product');
  const invItemRepo = AppDataSource.getRepository('InventoryItem');
  const invTxRepo = AppDataSource.getRepository('InventoryTransaction');

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
      await currencyRepo.save(currencyRepo.create(c));
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
    { tenant_id: tenant.id, code: 'CASH', name: 'Cash', is_active: true },
    { tenant_id: tenant.id, code: 'CARD_POS', name: 'Bank Card POS', is_active: true },
    { tenant_id: tenant.id, code: 'CREDIT_ACCOUNT', name: 'Customer Credit Account', is_active: true },
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

  // 9. Idempotent V5 Inventory Seed Items
  const prodBurger = await prodRepo.findOne({ where: { tenant_id: tenant.id, code: 'PROD-CHEESEBURGER' } });
  const prodFries = await prodRepo.findOne({ where: { tenant_id: tenant.id, code: 'PROD-FRIES' } });
  const prodCola = await prodRepo.findOne({ where: { tenant_id: tenant.id, code: 'PROD-COLA' } });

  if (branchTeh && prodBurger && prodFries && prodCola) {
    let itemBurger = await invItemRepo.findOne({ where: { tenant_id: tenant.id, branch_id: branchTeh.id, product_id: prodBurger.id } });
    if (!itemBurger) {
      itemBurger = await invItemRepo.save(invItemRepo.create({
        tenant_id: tenant.id,
        branch_id: branchTeh.id,
        product_id: prodBurger.id,
        product_code: prodBurger.code,
        product_name: prodBurger.name,
        quantity_on_hand: '50.0000',
        reorder_level: '10.0000',
        unit_of_measure: 'UNIT',
        last_counted_at: new Date(),
      }));
      await invTxRepo.save(invTxRepo.create({
        tenant_id: tenant.id,
        inventory_item_id: itemBurger.id,
        transaction_type: 'PURCHASE_RECEIPT',
        quantity_delta: '50.0000',
        note: 'Initial inventory stock count for Cheeseburger',
      }));
    }

    let itemFries = await invItemRepo.findOne({ where: { tenant_id: tenant.id, branch_id: branchTeh.id, product_id: prodFries.id } });
    if (!itemFries) {
      itemFries = await invItemRepo.save(invItemRepo.create({
        tenant_id: tenant.id,
        branch_id: branchTeh.id,
        product_id: prodFries.id,
        product_code: prodFries.code,
        product_name: prodFries.name,
        quantity_on_hand: '100.0000',
        reorder_level: '15.0000',
        unit_of_measure: 'PORTION',
        last_counted_at: new Date(),
      }));
      await invTxRepo.save(invTxRepo.create({
        tenant_id: tenant.id,
        inventory_item_id: itemFries.id,
        transaction_type: 'PURCHASE_RECEIPT',
        quantity_delta: '100.0000',
        note: 'Initial inventory stock count for French Fries',
      }));
    }

    let itemCola = await invItemRepo.findOne({ where: { tenant_id: tenant.id, branch_id: branchTeh.id, product_id: prodCola.id } });
    if (!itemCola) {
      itemCola = await invItemRepo.save(invItemRepo.create({
        tenant_id: tenant.id,
        branch_id: branchTeh.id,
        product_id: prodCola.id,
        product_code: prodCola.code,
        product_name: prodCola.name,
        quantity_on_hand: '5.0000', // Low stock alert trigger
        reorder_level: '10.0000',
        unit_of_measure: 'CAN',
        last_counted_at: new Date(),
      }));
      await invTxRepo.save(invTxRepo.create({
        tenant_id: tenant.id,
        inventory_item_id: itemCola.id,
        transaction_type: 'PURCHASE_RECEIPT',
        quantity_delta: '5.0000',
        note: 'Initial inventory stock count for Cola (Low stock trigger)',
      }));
    }
  }

  console.log('Database seed execution completed successfully.');
  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
