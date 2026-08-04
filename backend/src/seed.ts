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
  console.log('Database connected for Slice 10 seed initialization.');

  const tenantRepo = dataSource.getRepository('Tenant');
  const branchRepo = dataSource.getRepository('Branch');
  const prodRepo = dataSource.getRepository('Product');
  const invItemRepo = dataSource.getRepository('InventoryItem');
  const invTxRepo = dataSource.getRepository('InventoryTransaction');

  let tenant = await tenantRepo.findOne({ where: { code: 'GNEXT' } });
  let branchTeh = await branchRepo.findOne({ where: { tenant_id: tenant!.id, code: 'TEH-CENTRAL' } });

  const prodBurger = await prodRepo.findOne({ where: { tenant_id: tenant!.id, code: 'PROD-CHEESEBURGER' } });
  const prodFries = await prodRepo.findOne({ where: { tenant_id: tenant!.id, code: 'PROD-FRIES' } });
  const prodCola = await prodRepo.findOne({ where: { tenant_id: tenant!.id, code: 'PROD-COLA' } });

  if (branchTeh) {
    // 1. Cheeseburger Inventory
    if (prodBurger) {
      let itemBurger = await invItemRepo.findOne({ where: { tenant_id: tenant!.id, branch_id: branchTeh.id, product_id: prodBurger.id } });
      if (!itemBurger) {
        itemBurger = invItemRepo.create({
          tenant_id: tenant!.id,
          branch_id: branchTeh.id,
          product_id: prodBurger.id,
          quantity_on_hand: '50.0000',
          reorder_level: '10.0000',
          unit_of_measure: 'UNIT',
          last_counted_at: new Date(),
        });
        itemBurger = await invItemRepo.save(itemBurger);

        const tx = invTxRepo.create({
          tenant_id: tenant!.id,
          inventory_item_id: itemBurger.id,
          transaction_type: 'PURCHASE_RECEIPT',
          quantity_delta: '50.0000',
          note: 'Initial inventory stock count for Cheeseburger',
        });
        await invTxRepo.save(tx);
        console.log('Seeded inventory item PROD-CHEESEBURGER (50 units).');
      }
    }

    // 2. Fries Inventory
    if (prodFries) {
      let itemFries = await invItemRepo.findOne({ where: { tenant_id: tenant!.id, branch_id: branchTeh.id, product_id: prodFries.id } });
      if (!itemFries) {
        itemFries = invItemRepo.create({
          tenant_id: tenant!.id,
          branch_id: branchTeh.id,
          product_id: prodFries.id,
          quantity_on_hand: '100.0000',
          reorder_level: '15.0000',
          unit_of_measure: 'PORTION',
          last_counted_at: new Date(),
        });
        itemFries = await invItemRepo.save(itemFries);

        const tx = invTxRepo.create({
          tenant_id: tenant!.id,
          inventory_item_id: itemFries.id,
          transaction_type: 'PURCHASE_RECEIPT',
          quantity_delta: '100.0000',
          note: 'Initial inventory stock count for French Fries',
        });
        await invTxRepo.save(tx);
        console.log('Seeded inventory item PROD-FRIES (100 portions).');
      }
    }

    // 3. Cola Inventory (LOW-STOCK ALERT TRIGGER)
    if (prodCola) {
      let itemCola = await invItemRepo.findOne({ where: { tenant_id: tenant!.id, branch_id: branchTeh.id, product_id: prodCola.id } });
      if (!itemCola) {
        itemCola = invItemRepo.create({
          tenant_id: tenant!.id,
          branch_id: branchTeh.id,
          product_id: prodCola.id,
          quantity_on_hand: '5.0000', // 5 <= 10 -> Low stock trigger!
          reorder_level: '10.0000',
          unit_of_measure: 'CAN',
          last_counted_at: new Date(),
        });
        itemCola = await invItemRepo.save(itemCola);

        const tx = invTxRepo.create({
          tenant_id: tenant!.id,
          inventory_item_id: itemCola.id,
          transaction_type: 'PURCHASE_RECEIPT',
          quantity_delta: '5.0000',
          note: 'Initial inventory stock count for Cola (Low stock trigger)',
        });
        await invTxRepo.save(tx);
        console.log('Seeded inventory item PROD-COLA (5 cans - Low Stock Alert Trigger).');
      }
    }
  }

  console.log('Slice 10 seed completed successfully.');
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
