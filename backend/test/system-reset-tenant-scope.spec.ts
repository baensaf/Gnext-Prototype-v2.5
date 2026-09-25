import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ImportExportService } from '../src/modules/import-export/import-export.service';
import { Tenant } from '../src/entities/Tenant.entity';
import { ImportRow } from '../src/entities/ImportRow.entity';
import { CourierSettlement } from '../src/entities/CourierSettlement.entity';
import { CourierSettlementLine } from '../src/entities/CourierSettlementLine.entity';
import { deleteTenantData } from './utils/tenant-teardown';

/**
 * A system reset clears one tenant's operational data. import_row and courier_settlement_line
 * have no tenant_id of their own, and the reset used to empty them outright — so a reset in
 * one tenant deleted another tenant's staged import rows. r27-e2e and section-16-3 both reset
 * their fixture tenant while the other, in a parallel Jest worker, sat between validateJob and
 * executeJob, and that import then found no rows and imported nothing.
 */
describe('System reset stays inside its tenant', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let importExportService: ImportExportService;

  let keptTenantId: string;
  let resetTenantId: string;
  const userId = randomUUID();
  const tag = `${Date.now()}`.slice(-7);

  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_NAME = process.env.DB_NAME || 'appdb';
    process.env.DB_USER = process.env.DB_USER || 'admin';
    process.env.DB_USERNAME = process.env.DB_USERNAME || 'admin';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'admin';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = moduleRef.get<DataSource>(DataSource);
    importExportService = moduleRef.get<ImportExportService>(ImportExportService);

    await dataSource.runMigrations();

    const tenantRepo = dataSource.getRepository(Tenant);
    const createTenant = async (suffix: string) =>
      (
        await tenantRepo.save(
          tenantRepo.create({
            code: `RESET-SCOPE-${suffix}-${Date.now()}`,
            name: `Reset Scope ${suffix}`,
            base_currency: 'IRR',
            default_locale: 'fa',
            time_zone: 'Asia/Tehran',
          }),
        )
      ).id;
    keptTenantId = await createTenant('KEPT');
    resetTenantId = await createTenant('RESET');
  }, 60000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await deleteTenantData(dataSource, keptTenantId);
      await deleteTenantData(dataSource, resetTenantId);
    }
    if (app) await app.close();
  }, 30000);

  const stageValidatedCustomerImport = async (tenantId: string, code: string, mobile: string) => {
    const job = await importExportService.createStagedJob(
      tenantId,
      'CUSTOMERS',
      'customers.csv',
      `code,first_name,last_name,mobile\n${code},Sara,Ahmadi,${mobile}`,
    );
    const validated = await importExportService.validateJob(job.id, {
      code: 'code',
      first_name: 'first_name',
      last_name: 'last_name',
      mobile: 'mobile',
    });
    expect(validated.valid_rows).toBe(1);
    return job.id;
  };

  const createSettlementWithLine = async (tenantId: string, suffix: string) => {
    const settlement = await dataSource.getRepository(CourierSettlement).save(
      dataSource.getRepository(CourierSettlement).create({
        tenant_id: tenantId,
        courier_id: randomUUID(),
        settlement_number: `STL-SCOPE-${suffix}-${tag}`,
        settlement_date: new Date(),
      }),
    );
    await dataSource.getRepository(CourierSettlementLine).save(
      dataSource.getRepository(CourierSettlementLine).create({
        settlement_id: settlement.id,
        delivery_assignment_id: randomUUID(),
        order_id: randomUUID(),
        order_number: `ORD-SCOPE-${suffix}-${tag}`,
        delivery_status: 'DELIVERED',
      }),
    );
    return settlement.id;
  };

  it("leaves another tenant's staged import rows and settlement lines alone", async () => {
    const keptJobId = await stageValidatedCustomerImport(keptTenantId, `CUST-KEPT-${tag}`, `0912${tag}`);
    const keptSettlementId = await createSettlementWithLine(keptTenantId, 'KEPT');
    const resetJobId = await stageValidatedCustomerImport(resetTenantId, `CUST-RESET-${tag}`, `0935${tag}`);
    const resetSettlementId = await createSettlementWithLine(resetTenantId, 'RESET');

    await importExportService.systemReset(resetTenantId, userId);

    const rowRepo = dataSource.getRepository(ImportRow);
    const lineRepo = dataSource.getRepository(CourierSettlementLine);

    // The resetting tenant's own children are gone...
    expect(await rowRepo.count({ where: { job_id: resetJobId } })).toBe(0);
    expect(await lineRepo.count({ where: { settlement_id: resetSettlementId } })).toBe(0);

    // ...and the other tenant's are untouched, so its import still has its row to execute.
    expect(await rowRepo.count({ where: { job_id: keptJobId, status: 'VALID' } })).toBe(1);
    expect(await lineRepo.count({ where: { settlement_id: keptSettlementId } })).toBe(1);

    const result = await importExportService.executeJob(keptJobId, userId);
    expect(result).toEqual({ importedCount: 1, failedCount: 0 });

    // Resetting the kept tenant clears its own rows too, so its children are reachable.
    await importExportService.systemReset(keptTenantId, userId);
    expect(await rowRepo.count({ where: { job_id: keptJobId } })).toBe(0);
    expect(await lineRepo.count({ where: { settlement_id: keptSettlementId } })).toBe(0);
  }, 60000);
});
