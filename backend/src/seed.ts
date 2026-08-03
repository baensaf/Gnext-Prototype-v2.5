import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin@gnext.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'GnextDemo!2026';

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'admin',
    database: process.env.DB_NAME || 'appdb',
    entities: [__dirname + '/entities/*.entity{.ts,.js}'],
    synchronize: true, // Guarantees schema creation for prototype seed
  });

  await dataSource.initialize();
  console.log('Database connected for Slice 6 seed initialization.');

  const tenantRepo = dataSource.getRepository('Tenant');
  const userRepo = dataSource.getRepository('AdminUser');
  const branchRepo = dataSource.getRepository('Branch');
  const hoursRepo = dataSource.getRepository('BranchOperatingHour');
  const terminalRepo = dataSource.getRepository('Terminal');
  const statusRepo = dataSource.getRepository('BranchStatusSnapshot');
  const currencyRepo = dataSource.getRepository('Currency');

  const catRepo = dataSource.getRepository('Category');
  const prodRepo = dataSource.getRepository('Product');
  const priceGroupRepo = dataSource.getRepository('PriceGroup');

  const discountRepo = dataSource.getRepository('Discount');
  const couponRepo = dataSource.getRepository('Coupon');

  const custGroupRepo = dataSource.getRepository('CustomerGroup');
  const custRepo = dataSource.getRepository('Customer');
  const addrRepo = dataSource.getRepository('CustomerAddress');
  const creditAccountRepo = dataSource.getRepository('CustomerCreditAccount');
  const creditTxRepo = dataSource.getRepository('CustomerCreditTransaction');

  // Seed tenant
  let tenant = await tenantRepo.findOne({ where: { code: 'GNEXT' } });
  if (!tenant) {
    tenant = tenantRepo.create({
      code: 'GNEXT',
      name: 'Gnext Prototype',
      base_currency: 'IRR',
      default_locale: 'fa',
      time_zone: 'Asia/Tehran',
    });
    tenant = await tenantRepo.save(tenant);
    console.log('Seeded tenant GNEXT.');
  }

  // Seed admin user
  let user = await userRepo.findOne({ where: { username: ADMIN_USERNAME.toLowerCase() } });
  const passwordHash = await argon2.hash(ADMIN_PASSWORD);
  if (!user) {
    user = userRepo.create({
      tenant_id: tenant.id,
      username: ADMIN_USERNAME.toLowerCase(),
      display_name: 'Shared Prototype Administrator',
      password_hash: passwordHash,
      is_active: true,
      preferred_locale: 'fa',
    });
    await userRepo.save(user);
    console.log(`Seeded admin user ${ADMIN_USERNAME}.`);
  }

  // Seed Currencies
  const currenciesData = [
    { code: 'IRR', symbol: 'ریال', decimal_precision: 0, rounding_increment: '1.0000', is_enabled: true, is_base: true },
    { code: 'USD', symbol: '$', decimal_precision: 2, rounding_increment: '0.0100', is_enabled: false, is_base: false },
  ];

  for (const c of currenciesData) {
    let curr = await currencyRepo.findOne({ where: { tenant_id: tenant.id, code: c.code } });
    if (!curr) {
      curr = currencyRepo.create({ tenant_id: tenant.id, ...c });
      await currencyRepo.save(curr);
    }
  }

  // Seed Branches
  const branchesData = [
    { code: 'TEH-CENTRAL', name: 'Tehran Central', phone: '+982188000001', address: 'Valiasr St, Tehran' },
    { code: 'TEH-NORTH', name: 'Tehran North', phone: '+982122000002', address: 'Niavaran St, Tehran' },
  ];

  for (const b of branchesData) {
    let branch = await branchRepo.findOne({ where: { tenant_id: tenant.id, code: b.code } });
    if (!branch) {
      branch = branchRepo.create({
        tenant_id: tenant.id,
        code: b.code,
        name: b.name,
        phone: b.phone,
        address: b.address,
        time_zone: 'Asia/Tehran',
        is_active: true,
      });
      branch = await branchRepo.save(branch);

      for (let day = 0; day < 7; day++) {
        const hour = hoursRepo.create({
          tenant_id: tenant.id,
          branch_id: branch.id,
          day_of_week: day,
          open_time: '08:00:00',
          close_time: '23:00:00',
          is_closed: false,
          spans_midnight: false,
        });
        await hoursRepo.save(hour);
      }

      const termTypes = [
        { code: `${b.code}-POS-1`, name: `${b.name} Cashier POS`, type: 'CASHIER' },
        { code: `${b.code}-KIOSK-1`, name: `${b.name} Kiosk Terminal`, type: 'KIOSK' },
        { code: `${b.code}-KDS-1`, name: `${b.name} Kitchen KDS`, type: 'KDS' },
      ];

      for (const t of termTypes) {
        const term = terminalRepo.create({
          tenant_id: tenant.id,
          branch_id: branch.id,
          code: t.code,
          name: t.name,
          terminal_type: t.type,
          is_active: true,
          last_seen_at: new Date(),
        });
        await terminalRepo.save(term);
      }

      const status = statusRepo.create({
        tenant_id: tenant.id,
        branch_id: branch.id,
        is_online: true,
        agent_version: 'v1.5.0-simulated',
        agent_health: 'HEALTHY',
        last_heartbeat_at: new Date(),
        last_sync_at: new Date(),
      });
      await statusRepo.save(status);
    }
  }

  // Seed Categories & Products
  const categoriesData = [
    { code: 'CAT-BURGERS', name: 'Burgers & Sandwiches', sort_order: 1 },
    { code: 'CAT-SIDES', name: 'Fries & Sides', sort_order: 2 },
    { code: 'CAT-BEVERAGES', name: 'Beverages & Soft Drinks', sort_order: 3 },
  ];

  const catMap: Record<string, string> = {};
  for (const c of categoriesData) {
    let cat = await catRepo.findOne({ where: { tenant_id: tenant.id, code: c.code } });
    if (!cat) {
      cat = catRepo.create({ tenant_id: tenant.id, ...c, is_active: true });
      cat = await catRepo.save(cat);
    }
    catMap[c.code] = cat.id;
  }

  const productsData = [
    { code: 'PROD-CHEESEBURGER', name: 'Cheeseburger', category_code: 'CAT-BURGERS', base_price: '1500000.0000', tax_rate: '0.1000' },
    { code: 'PROD-CHICKENBURGER', name: 'Double Chicken Burger', category_code: 'CAT-BURGERS', base_price: '1800000.0000', tax_rate: '0.1000' },
    { code: 'PROD-FRIES', name: 'Regular French Fries', category_code: 'CAT-SIDES', base_price: '600000.0000', tax_rate: '0.1000' },
    { code: 'PROD-COLA', name: 'Zero Cola 330ml', category_code: 'CAT-BEVERAGES', base_price: '250000.0000', tax_rate: '0.1000' },
  ];

  for (const p of productsData) {
    let prod = await prodRepo.findOne({ where: { tenant_id: tenant.id, code: p.code } });
    if (!prod) {
      prod = prodRepo.create({
        tenant_id: tenant.id,
        code: p.code,
        name: p.name,
        category_id: catMap[p.category_code],
        base_price: p.base_price,
        tax_rate: p.tax_rate,
        is_active: true,
        unit_of_measure: 'UNIT',
      });
      await prodRepo.save(prod);
    }
  }

  // Price Group
  let priceGroup = await priceGroupRepo.findOne({ where: { tenant_id: tenant.id, code: 'PG-VIP' } });

  // Seed Discounts & Coupons
  let disc10 = await discountRepo.findOne({ where: { tenant_id: tenant.id, code: 'DISC-10PCT' } });
  if (!disc10) {
    disc10 = discountRepo.create({
      tenant_id: tenant.id,
      code: 'DISC-10PCT',
      name: '10% Manager Discount',
      kind: 'MANUAL',
      calculation_type: 'PERCENTAGE',
      value: '0.1000',
      min_order_total: '0.0000',
      requires_reason: true,
      requires_manager_approval: true,
      is_active: true,
    });
    await discountRepo.save(disc10);
  }

  // Seed Customer Group
  let custGroup = await custGroupRepo.findOne({ where: { tenant_id: tenant.id, code: 'GRP-VIP' } });
  if (!custGroup) {
    custGroup = custGroupRepo.create({
      tenant_id: tenant.id,
      code: 'GRP-VIP',
      name: 'VIP Corporate Customers',
      price_group_id: priceGroup ? priceGroup.id : null,
      discount_id: disc10 ? disc10.id : null,
      is_active: true,
    });
    custGroup = await custGroupRepo.save(custGroup);
    console.log('Seeded Customer Group GRP-VIP.');
  }

  // Seed Customer
  let customer = await custRepo.findOne({ where: { tenant_id: tenant.id, code: 'CUST-1001' } });
  if (!customer) {
    customer = custRepo.create({
      tenant_id: tenant.id,
      code: 'CUST-1001',
      first_name: 'Ali',
      last_name: 'Ahmadi',
      mobile: '+989121111111',
      email: 'ali.ahmadi@example.ir',
      customer_group_id: custGroup.id,
      national_id: '0012345678',
      is_active: true,
    });
    customer = await custRepo.save(customer);
    console.log('Seeded Customer CUST-1001 (Ali Ahmadi).');

    // Customer Address
    const addr = addrRepo.create({
      tenant_id: tenant.id,
      customer_id: customer.id,
      title: 'Home Address',
      address_text: 'Tehran, Valiasr St, No 100',
      postal_code: '1987654321',
      is_default: true,
    });
    await addrRepo.save(addr);

    // Customer Credit Account
    const creditAcc = creditAccountRepo.create({
      tenant_id: tenant.id,
      customer_id: customer.id,
      credit_limit: '10000000.0000',
      current_balance: '2500000.0000',
      is_blocked: false,
    });
    const savedAcc = await creditAccountRepo.save(creditAcc);

    // Seed Charge Transaction
    const tx = creditTxRepo.create({
      tenant_id: tenant.id,
      account_id: savedAcc.id,
      transaction_type: 'CHARGE',
      amount: '2500000.0000',
      note: 'Initial prototype credit account balance deposit',
    });
    await creditTxRepo.save(tx);
    console.log('Seeded credit account and transaction for Ali Ahmadi.');
  }

  console.log('Slice 6 seed completed successfully.');
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
