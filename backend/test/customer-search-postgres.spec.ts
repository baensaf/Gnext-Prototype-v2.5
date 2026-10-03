import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CustomerService } from '../src/modules/customer/customer.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { Customer } from '../src/entities/Customer.entity';
import { deleteTenantData } from './utils/tenant-teardown';

// The POS no longer loads every customer (a chain can have 500,000); it asks the server for the
// best matches to what the cashier typed. Benchmarked 2026-10-03 on 500k rows: 2–26 ms.
describe('Customer search (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let customers: CustomerService;
  let tenantId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    customers = moduleRef.get(CustomerService);

    const repo = dataSource.getRepository(Tenant);
    tenantId = (await repo.save(repo.create({ code: `CSEARCH-${Date.now()}`, name: 'Customer search fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' } as any)) as any).id;
    const rows: Array<[string, string]> = [
      ['سارا کریمی', '+989121234567'],
      ['علی کریمی', '+989121234500'],
      ['کاظم نوری', '+989351234567'],
      ['Reza 50%_off', '+989190000000'],
    ];
    const customerRepo = dataSource.getRepository(Customer);
    for (const [name, mobile] of rows) {
      await customerRepo.save(customerRepo.create({ tenant_id: tenantId, code: mobile, first_name: name, last_name: '', mobile, is_active: true }));
    }
  });

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  const mobiles = async (q: string) => (await customers.searchCustomers(tenantId, q)).map((c) => c.mobile);
  const names = async (q: string) => (await customers.searchCustomers(tenantId, q)).map((c) => c.first_name);

  it('needs 3 characters', async () => {
    expect(await mobiles('09')).toEqual([]);
    expect(await mobiles('سا')).toEqual([]);
  });

  it('finds a mobile however it is typed, the exact number first', async () => {
    expect(await mobiles('09121234567')).toEqual(['+989121234567']);
    expect(await mobiles('+98 912 123 4567')).toEqual(['+989121234567']);
    expect(await mobiles('۰۹۱۲۱۲۳۴۵۶۷')).toEqual(['+989121234567']);
    // Starts-with ranks before contains.
    expect(await mobiles('0912123')).toEqual(['+989121234500', '+989121234567']);
    expect(await mobiles('1234567')).toEqual(['+989121234567', '+989351234567']);
  });

  it('finds a name by any part, with Arabic ي/ك matching Persian ی/ک', async () => {
    expect(await names('کریمی')).toEqual(['سارا کریمی', 'علی کریمی']);
    expect(await names('كريمي')).toEqual(['سارا کریمی', 'علی کریمی']);
    expect(await names('کاظ')).toEqual(['کاظم نوری']);
  });

  it('treats % and _ as plain text', async () => {
    expect(await names('za 50%_')).toEqual(['Reza 50%_off']);
    expect(await names('a%b')).toEqual([]);
  });

  it('pages the customers list with the same search', async () => {
    const page: any = await customers.getCustomers(tenantId, { search: 'کریمی', page: 1, limit: 1 } as any);
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
  });
});
