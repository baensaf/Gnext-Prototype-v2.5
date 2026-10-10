import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/entities/Tenant.entity';
import { Branch } from '../src/entities/Branch.entity';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { Printer } from '../src/entities/Printer.entity';
import { PrintRoutingService } from '../src/modules/printing/print-routing.service';
import { deleteTenantData } from './utils/tenant-teardown';

// The "not printed" list and the printers' routes, saved for real: an item is on one or the other.
describe('print routing with a "not printed" list (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let routing: PrintRoutingService;
  let tenantId: string;
  let branchId: string;
  let barId: string;
  let grillId: string;
  let drinksId: string;
  let burgersId: string;
  let cokeId: string;
  let lemonadeId: string;

  const save = <T>(entity: any, data: Partial<T>) =>
    dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
  const routesOf = async (printerId: string | null) =>
    (await routing.routes(tenantId, branchId)).find((r) => r.printer_id === printerId) ?? { category_ids: [], product_ids: [] };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    dataSource = moduleRef.get(DataSource);
    routing = moduleRef.get(PrintRoutingService);

    tenantId = (
      await save(Tenant, { code: `PRTROUTE-${Date.now()}`, name: 'Print routing fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'PRT', name: 'Routing branch', is_active: true, time_zone: 'Asia/Tehran' })).id;
    barId = (await save(Printer, { tenant_id: tenantId, branch_id: branchId, code: 'BAR', name: 'Bar', printer_type: 'KITCHEN_IMPACT', is_active: true })).id;
    grillId = (await save(Printer, { tenant_id: tenantId, branch_id: branchId, code: 'GRL', name: 'Grill', printer_type: 'KITCHEN_IMPACT', is_active: true })).id;
    drinksId = (await save(Category, { tenant_id: tenantId, code: 'DRK', name: 'Drinks' })).id;
    burgersId = (await save(Category, { tenant_id: tenantId, code: 'BRG', name: 'Burgers' })).id;
    cokeId = (await save(Product, { tenant_id: tenantId, name: 'Coke', category_id: drinksId })).id;
    lemonadeId = (await save(Product, { tenant_id: tenantId, name: 'Lemonade', category_id: drinksId })).id;
  }, 60000);

  afterAll(async () => {
    await deleteTenantData(dataSource, tenantId);
    await moduleRef.close();
  });

  it('takes a category off its printers when it goes on the list, and off the list when a printer takes it back', async () => {
    await routing.setRoutes(tenantId, barId, [drinksId], []);
    await routing.setRoutes(tenantId, grillId, [burgersId, drinksId], []);

    await routing.setNotPrinted(tenantId, branchId, [drinksId], []);

    expect((await routesOf(barId)).category_ids).toEqual([]);
    expect((await routesOf(grillId)).category_ids).toEqual([burgersId]);
    expect((await routesOf(null)).category_ids).toEqual([drinksId]);
    expect((await routing.routeProducts(tenantId, branchId, [cokeId])).get(cokeId)!.source).toBe('NOT_PRINTED');

    await routing.setRoutes(tenantId, barId, [drinksId], []);

    expect((await routesOf(null)).category_ids).toEqual([]);
    expect((await routing.routeProducts(tenantId, branchId, [cokeId])).get(cokeId)!.printers.map((p) => p.id)).toEqual([barId]);
  });

  it('lets one product print while its category is on the list', async () => {
    await routing.setNotPrinted(tenantId, branchId, [drinksId], []);
    await routing.setRoutes(tenantId, barId, [], [lemonadeId]);

    const routed = await routing.routeProducts(tenantId, branchId, [cokeId, lemonadeId]);

    expect(routed.get(cokeId)!.source).toBe('NOT_PRINTED');
    expect(routed.get(lemonadeId)).toMatchObject({ source: 'PRODUCT' });
    expect(routed.get(lemonadeId)!.printers.map((p) => p.id)).toEqual([barId]);
    const menu = await routing.menuRouting(tenantId, branchId);
    expect(menu.find((m) => m.product_id === cokeId)).toEqual({ product_id: cokeId, source: 'NOT_PRINTED', printer_ids: [] });
  });
});
