import { DataSource, In, IsNull, Like } from 'typeorm';
import { MoneyUtil } from '../common/utils/money.util';
import { BusinessDateUtil } from '../common/utils/business-date.util';

/**
 * What head office and a branch manager work with that the rest of the seed never laid down.
 *
 * Walking through a day of admin work on 2026-09-22 found screens with nothing on them: no
 * branch price list, no bank account or card terminal, no kitchen stations at
 * Valiasr, no closed business days, every Moadian invoice accepted and no duplicate customer
 * to merge. Each block below is idempotent and only adds what is missing, so re-running the
 * seed on the VPS leaves anybody's own changes alone.
 */
export async function seedAdminDemo(
  ds: DataSource,
  tenantId: string,
  branchByCode: Map<string, any>,
  managerId: string | null,
): Promise<void> {
  const valiasr = branchByCode.get('TEH-DOWNTOWN');

  // Rial is the chain's only currency. The seed created Dollar and Euro beside it, all three
  // enabled and none marked as the base.
  const currencyRepo = ds.getRepository('Currency');
  const rial: any = await currencyRepo.findOne({ where: { code: 'IRR' } });
  if (rial && !rial.is_base) {
    await currencyRepo.update({ code: 'IRR' }, { is_base: true, is_enabled: true });
    await currencyRepo.update({ code: In(['USD', 'EUR']) }, { is_enabled: false });
    console.log('Set Rial as the base currency and switched off Dollar and Euro');
  }

  // Tender names as the till and the receipts show them. Only the English defaults are
  // replaced, so a name somebody typed stays.
  const payMethodRepo = ds.getRepository('PaymentMethod');
  const tenderNames: Record<string, [string, string]> = {
    CASH: ['Cash', 'نقد'],
    CARD_POS: ['Bank Card POS', 'کارتخوان بانکی'],
    CREDIT_ACCOUNT: ['Customer Credit Account', 'حساب اعتباری مشتری'],
    MOBILE_POS: ['Courier Mobile POS', 'کارتخوان سیار پیک'],
    ONLINE: ['Online Payment', 'پرداخت آنلاین'],
    BANK_TRANSFER: ['Bank Transfer', 'کارت به کارت / واریز'],
  };
  for (const [code, [english, persian]] of Object.entries(tenderNames)) {
    await payMethodRepo.update({ tenant_id: tenantId, code, name: english }, { name: persian });
  }

  const categoryRepo = ds.getRepository('Category');
  const productRepo = ds.getRepository('Product');
  const categories: any[] = await categoryRepo.find({
    where: { tenant_id: tenantId, is_active: true, code: Like('IB-%') },
    order: { sort_order: 'ASC' },
  });
  const categoryIds = categories.map((c) => c.id);
  const products: any[] = categoryIds.length
    ? await productRepo.find({ where: { tenant_id: tenantId, is_active: true, category_id: In(categoryIds) }, order: { code: 'ASC' } })
    : [];

  // A branch price list. The Shiraz shops sell burgers and sandwiches a little under Tehran's
  // prices; everything else is at the base price. The figures are the demo's, not the chain's.
  const priceGroupRepo = ds.getRepository('PriceGroup');
  if (!(await priceGroupRepo.findOne({ where: { tenant_id: tenantId, code: 'PL-SHIRAZ' } }))) {
    const list: any = await priceGroupRepo.save(
      priceGroupRepo.create({ tenant_id: tenantId, code: 'PL-SHIRAZ', name: 'قیمت شعب شیراز', currency_code: 'IRR', is_active: true }),
    );
    const listedCategories = new Set(categories.filter((c) => ['IB-BURGER', 'IB-SANDWICH'].includes(c.code)).map((c) => c.id));
    const entryRepo = ds.getRepository('PriceEntry');
    const since = BusinessDateUtil.startOfDay(BusinessDateUtil.today());
    for (const p of products.filter((p) => listedCategories.has(p.category_id) && MoneyUtil.greaterThan(p.base_price, '0'))) {
      // Five percent off, to the nearest thousand toman.
      const amount = MoneyUtil.multiply(MoneyUtil.divide(MoneyUtil.multiply(p.base_price, '0.95'), '10000', 0), '10000');
      await entryRepo.save(
        entryRepo.create({
          tenant_id: tenantId,
          product_id: p.id,
          price_group_id: list.id,
          currency_code: 'IRR',
          price_type: 'LIST',
          amount: MoneyUtil.format(amount),
          effective_from: since,
        }),
      );
    }
    const groupBranchRepo = ds.getRepository('PriceGroupBranch');
    for (const [code, branch] of branchByCode) {
      if (!code.startsWith('SHZ-')) continue;
      if (await groupBranchRepo.findOne({ where: { tenant_id: tenantId, branch_id: branch.id } })) continue;
      await groupBranchRepo.save(groupBranchRepo.create({ tenant_id: tenantId, price_group_id: list.id, branch_id: branch.id }));
    }
    console.log('Seeded Price List: قیمت شعب شیراز, assigned to the Shiraz branches');
  }

  // The chain's card-settlement account, and Valiasr's counter card terminal settling into it.
  const accountRepo = ds.getRepository('SettlementAccount');
  let account: any = await accountRepo.findOne({ where: { tenant_id: tenantId, code: 'SA-SAMAN-01' } });
  if (!account) {
    account = await accountRepo.save(
      accountRepo.create({
        tenant_id: tenantId,
        code: 'SA-SAMAN-01',
        name: 'بانک سامان - حساب تسویه کارتخوان',
        account_type: 'POS_MERCHANT',
        masked_identifier: 'IR**********************4521',
        currency_code: 'IRR',
        is_company_owned: true,
        is_active: true,
      }),
    );
    console.log('Seeded Settlement Account: بانک سامان');
  }
  const deviceRepo = ds.getRepository('PaymentDevice');
  if (valiasr && !(await deviceRepo.findOne({ where: { tenant_id: tenantId, code: 'POS-VAL-01' } }))) {
    await deviceRepo.save(
      deviceRepo.create({
        tenant_id: tenantId,
        branch_id: valiasr.id,
        code: 'POS-VAL-01',
        name: 'کارتخوان سامان صندوق ۱',
        kind: 'POS',
        ownership: 'COMPANY',
        settlement_account_id: account.id,
        device_identifier: 'SMN-77120045',
        is_active: true,
      }),
    );
    console.log('Seeded Payment Device: کارتخوان سامان صندوق ۱ (ولیعصر)');
  }

  // Valiasr's kitchen: a grill for burgers and sandwiches, a fryer for the fried food and
  // sides, and one screen showing both. Its old stations were deleted in testing on 09-10.
  const stationRepo = ds.getRepository('KitchenStation');
  if (valiasr && !(await stationRepo.findOne({ where: { tenant_id: tenantId, branch_id: valiasr.id, deleted_at: IsNull() } }))) {
    const grill: any = await stationRepo.save(
      stationRepo.create({ tenant_id: tenantId, branch_id: valiasr.id, code: 'VAL-GRILL', name: 'گریل', station_type: 'HOT_KITCHEN', target_minutes: 8, is_active: true }),
    );
    const fryer: any = await stationRepo.save(
      stationRepo.create({ tenant_id: tenantId, branch_id: valiasr.id, code: 'VAL-FRY', name: 'سرخ‌کن', station_type: 'FRYER', target_minutes: 5, is_active: true }),
    );
    const ruleRepo = ds.getRepository('KdsRoutingRule');
    const routes: Array<[string, any]> = [
      ['IB-BURGER', grill],
      ['IB-SANDWICH', grill],
      ['IB-FRIED', fryer],
      ['IB-SIDES', fryer],
    ];
    for (const [code, station] of routes) {
      const category = categories.find((c) => c.code === code);
      if (!category) continue;
      await ruleRepo.save(
        ruleRepo.create({ tenant_id: tenantId, branch_id: valiasr.id, station_id: station.id, category_id: category.id, priority: 10 }),
      );
    }
    await ds.getRepository('KdsScreen').save(
      ds.getRepository('KdsScreen').create({
        tenant_id: tenantId,
        branch_id: valiasr.id,
        code: 'VAL-KDS-1',
        name: 'نمایشگر آشپزخانه ولیعصر',
        station_ids: [grill.id, fryer.id],
        is_active: true,
      }),
    );
    console.log('Seeded Valiasr kitchen: grill and fryer stations, routing and a screen');
  }

  // A second, farther Valiasr delivery zone, so the fee and the courier's pay visibly differ.
  const zoneRepo = ds.getRepository('DeliveryZone');
  if (valiasr && !(await zoneRepo.findOne({ where: { tenant_id: tenantId, code: 'ZONE-DOWNTOWN-02' }, withDeleted: true }))) {
    await zoneRepo.save(
      zoneRepo.create({
        tenant_id: tenantId,
        branch_id: valiasr.id,
        code: 'ZONE-DOWNTOWN-02',
        name: 'ولیعصر - محدوده دور (تا پارک وی)',
        fee: MoneyUtil.format(900_000),
        courier_pay: MoneyUtil.format(600_000),
        currency_code: 'IRR',
        estimated_minutes: 35,
        is_active: true,
      }),
    );
    console.log('Seeded Delivery Zone: ولیعصر - محدوده دور');
  }

  // The same customer twice, as a Snappfood order leaves them: under the international form
  // of the number CUST-1001 already has. The duplicates screen had nothing to merge.
  const customerRepo = ds.getRepository('Customer');
  const duplicateCode = 'SNP-989121234567';
  if (
    (await customerRepo.findOne({ where: { tenant_id: tenantId, code: 'CUST-1001' } })) &&
    !(await customerRepo.findOne({ where: { tenant_id: tenantId, code: duplicateCode }, withDeleted: true }))
  ) {
    const duplicate: any = await customerRepo.save(
      customerRepo.create({ tenant_id: tenantId, code: duplicateCode, first_name: 'رضا', last_name: 'محمدی', mobile: '+989121234567', is_active: true }),
    );
    await ds.getRepository('CustomerPhone').save(
      ds.getRepository('CustomerPhone').create({
        tenant_id: tenantId,
        customer_id: duplicate.id,
        phone_number: '+98 912 123 4567',
        normalized_phone: '+989121234567',
        label: 'PRIMARY_MOBILE',
        is_primary: true,
        is_verified: true,
      }),
    );
    console.log('Seeded a duplicate of CUST-1001 for the merge screen');
  }

  // One invoice the tax office turned down, so the Moadian screen has a rejection to fix and
  // send again. Every simulated invoice had been accepted.
  const invoiceRepo = ds.getRepository('TaxInvoice');
  if (valiasr && !(await invoiceRepo.findOne({ where: { tenant_id: tenantId, status: 'FAILED' } }))) {
    const latest: any = await invoiceRepo.findOne({
      where: { tenant_id: tenantId, branch_id: valiasr.id, status: 'SUCCESS', subject: 1, order_number: Like('HIS-%') },
      order: { issued_at: 'DESC' },
    });
    if (latest) {
      await invoiceRepo.update(
        { id: latest.id },
        {
          status: 'FAILED',
          reference_number: null,
          resolved_at: new Date(),
          errors: [{ code: '0301', message: 'شناسه کالا/خدمت (sstid) برای یکی از ردیف‌ها معتبر نیست' }],
        },
      );
      console.log(`Marked Moadian invoice for ${latest.order_number} as rejected, for the retry demo`);
    }
  }

  // Valiasr's closed business days, one for each day of the seeded history except the last
  // two: yesterday is left for the manager to close in the demo, and today is still trading.
  const closeRepo = ds.getRepository('BusinessDayClose');
  if (valiasr && !(await closeRepo.findOne({ where: { tenant_id: tenantId, branch_id: valiasr.id } }))) {
    const days: Array<{ business_date: string; total: string; orders: string }> = await ds.query(
      `SELECT business_date::text AS business_date, SUM(total_amount)::text AS total, COUNT(*)::text AS orders
         FROM order_header
        WHERE tenant_id = $1 AND branch_id = $2 AND order_number LIKE 'HIS-%' AND business_date < $3
        GROUP BY business_date ORDER BY business_date`,
      [tenantId, valiasr.id, BusinessDateUtil.fromDate(new Date(Date.now() - 86_400_000))],
    );
    for (const d of days) {
      const date = d.business_date.slice(0, 10);
      await closeRepo.save(
        closeRepo.create({
          tenant_id: tenantId,
          branch_id: valiasr.id,
          business_date: date,
          currency_code: 'IRR',
          status: 'CLOSED',
          totals: { totalSales: MoneyUtil.format(d.total), orderCount: Number(d.orders), autoCompletedOrders: 0, carriedOverOrders: 0 },
          // A quarter to midnight on the business clock.
          closed_at: new Date(BusinessDateUtil.endOfDay(date).getTime() - 15 * 60_000),
          closed_by: managerId,
        }),
      );
    }
    if (days.length) console.log(`Seeded ${days.length} closed business days for Valiasr`);
  }
}
