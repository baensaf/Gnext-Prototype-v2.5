import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Customer } from '../src/entities/Customer.entity';
import { CreditEntry } from '../src/entities/CreditEntry.entity';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
import { CreditService } from '../src/modules/customer/credit.service';
import { HamiClubCreditImportService } from '../src/modules/customer/hamiclub-credit-import.service';
import { loadBusinessClock } from '../src/common/utils/business-clock';
import { addDays } from '../src/common/utils/business-day';
import { deleteTenantData } from './utils/tenant-teardown';

// The club for branches leaving HAMI (2026-11-10): cashback is a credit of its own, usable from
// the next day for 14 days, spent soonest-ending first; HamiClub's live credit carries over.
describe('Wallet credits that start and expire (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let credit: CreditService;
  let hamiClub: HamiClubCreditImportService;
  let tenantId: string;
  let customerId: string;
  let today: string;

  const rules = { creditStartsAfterDays: 1, creditValidDays: 14 };
  const wallet = () =>
    dataSource.getRepository(CustomerCreditAccount).findOneByOrFail({ tenant_id: tenantId, customer_id: customerId, kind: 'WALLET' });
  const entries = async (type: string) =>
    dataSource.getRepository(CreditEntry).find({ where: { tenant_id: tenantId, entry_type: type as any }, order: { posted_at: 'ASC' } });
  const spend = (amount: string, on: string) =>
    dataSource.transaction(async (em) => credit.postPurchase(tenantId, (await wallet()).id, { orderId: randomUUID(), amount, businessDate: on }, undefined, em));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    credit = moduleRef.get(CreditService);
    hamiClub = moduleRef.get(HamiClubCreditImportService);

    const save = (entity: any, data: any) => dataSource.getRepository(entity).save(dataSource.getRepository(entity).create(data)) as Promise<any>;
    tenantId = (await save(Tenant, { code: `CLUB-${Date.now()}`, name: 'Club', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })).id;
    customerId = (await save(Customer, { tenant_id: tenantId, code: '+989120000001', first_name: 'Sara', last_name: '', mobile: '+989120000001', is_active: true })).id;
    today = (await loadBusinessClock(dataSource.manager, tenantId)).today();
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('gives cashback that can be spent from the next day for 14 days', async () => {
    await credit.awardLoyaltyCashback(tenantId, customerId, randomUUID(), '1000000.0000', '10.00', 'IRR', undefined, rules);

    const [cashback] = await entries('LOYALTY_CASHBACK');
    expect(cashback.remaining).toBe('100000.0000');
    expect(cashback.available_from).toBe(addDays(today, 1));
    expect(cashback.expires_on).toBe(addDays(today, 15));

    // In the wallet, but not usable on the day it was earned.
    expect((await wallet()).current_balance).toBe('100000.0000');
    await expect(spend('1000', today)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'WALLET_BALANCE_SHORT' }) });
    const position = (await credit.walletPositions(tenantId, [await wallet()])).get((await wallet()).id)!;
    expect(position.spendable).toBe('0.0000');
    expect(position.notYetUsable).toBe('100000.0000');
    expect(position.nextExpiresOn).toBe(addDays(today, 15));
  });

  it('spends the credit that ends soonest first', async () => {
    await dataSource.transaction((em) =>
      credit.postOpeningCredit(em, tenantId, customerId, { amount: '50000', expiresOn: addDays(today, 3), reference: 'HAMICLUB_TEST', note: 'carried' }),
    );

    await spend('70000', addDays(today, 1));

    const [opening] = await entries('OPENING_BALANCE');
    const [cashback] = await entries('LOYALTY_CASHBACK');
    expect(opening.remaining).toBe('0.0000');
    expect(cashback.remaining).toBe('80000.0000');
    expect((await wallet()).current_balance).toBe('80000.0000');
  });

  it('carries the same HamiClub credit over only once', async () => {
    const again = await dataSource.transaction((em) =>
      credit.postOpeningCredit(em, tenantId, customerId, { amount: '50000', expiresOn: addDays(today, 3), reference: 'HAMICLUB_TEST', note: 'carried' }),
    );
    expect(again).toBe('ALREADY_CARRIED');
    expect((await wallet()).current_balance).toBe('80000.0000');
  });

  it('takes out what is left after the last day', async () => {
    // Refused on the day after the last day, before the sweep has run.
    await expect(spend('1000', addDays(today, 16))).rejects.toMatchObject({ response: expect.objectContaining({ code: 'WALLET_BALANCE_SHORT' }) });

    await credit.expireDueCredits(new Date(Date.now() + 17 * 86_400_000));

    const [expiry] = await entries('EXPIRY');
    expect(expiry.amount).toBe('-80000.0000');
    expect((await wallet()).current_balance).toBe('0.0000');
    const [cashback] = await entries('LOYALTY_CASHBACK');
    expect(cashback.remaining).toBe('0.0000');
  });

  it('carries a branch\'s live HamiClub credit over from the panel\'s export', async () => {
    // As HamiClub's هدایا report exports it: a title row, blank headers over name and phone.
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('هدایا');
    sheet.addRow(['باشگاه مشتریان حامی']);
    sheet.addRow(['', '', '', '', 'شعبه', 'جمع فروش', 'هدیه', 'مانده', 'شروع', 'اعتبار']);
    sheet.addRow(['اعتبار', 'رویداد', 'Ali', '09121111111', 'نیایش', '6,000,000', '600,000', '600,000', '1405/08/13', '1500/01/01']);
    sheet.addRow(['اعتبار', 'رویداد', 'Ali', '09121111111', 'نیایش', '5,000,000', '500,000', '250,000', '1405/08/14', '1500/01/01']);
    sheet.addRow(['اعتبار', 'رویداد', 'Sara', '09120000001', 'نیایش', '7,000,000', '700,000', '700,000', '1405/08/15', '1500/01/02']);
    sheet.addRow(['اعتبار', 'رویداد', 'Reza', '09123333333', 'نیایش', '5,000,000', '500,000', '0', '1405/08/10', '1500/01/01']);
    sheet.addRow(['اعتبار', 'رویداد', 'Mina', '09124444444', 'نیایش', '5,000,000', '500,000', '500,000', '1400/01/01', '1400/01/15']);
    const file = { buffer: Buffer.from(await book.xlsx.writeBuffer()), originalname: 'hamiclub.xlsx' };

    const preview = await hamiClub.importFile(tenantId, file, false);
    expect(preview).toMatchObject({ applied: false, credits: 2, customers: 2, total: '1550000.0000', newCustomers: 1 });
    expect(preview.skipped.map((s) => s.reason).sort()).toEqual(['ENDED', 'NO_AMOUNT']);
    expect((await entries('OPENING_BALANCE')).length).toBe(1);

    await hamiClub.importFile(tenantId, file, true);
    const carried = (await entries('OPENING_BALANCE')).filter((e) => e.reference !== 'HAMICLUB_TEST');
    expect(carried.map((e) => e.amount).sort()).toEqual(['700000.0000', '850000.0000']);
    expect(carried.every((e) => e.available_from === today && e.expires_on! > '2100-01-01')).toBe(true);
    const ali = await dataSource.getRepository(Customer).findOneByOrFail({ tenant_id: tenantId, mobile: '+989121111111' });
    expect(ali.id).toBeTruthy();

    const twice = await hamiClub.importFile(tenantId, file, true);
    expect(twice.alreadyCarried).toBe(2);
    expect((await entries('OPENING_BALANCE')).length).toBe(3);
  });
});
