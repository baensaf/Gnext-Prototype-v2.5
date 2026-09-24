import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { gunzipSync } from 'zlib';
import { get } from 'http';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { AgentDataSnapshot } from '../src/entities/AgentDataSnapshot.entity';
import { Branch } from '../src/entities/Branch.entity';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { Category } from '../src/entities/Category.entity';
import { DeliveryZone } from '../src/entities/DeliveryZone.entity';
import { DiningArea } from '../src/entities/DiningArea.entity';
import { DiningTable } from '../src/entities/DiningTable.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { PaymentMethod } from '../src/entities/PaymentMethod.entity';
import { PrintRoute } from '../src/entities/PrintRoute.entity';
import { Printer } from '../src/entities/Printer.entity';
import { PrinterGroup } from '../src/entities/PrinterGroup.entity';
import { PrinterGroupMember } from '../src/entities/PrinterGroupMember.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductOptionGroup } from '../src/entities/ProductOptionGroup.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { Tenant } from '../src/entities/Tenant.entity';
import { Terminal } from '../src/entities/Terminal.entity';
import { AgentEnrolmentService } from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentRegistryService } from '../src/modules/agent-gateway/agent-registry.service';
import { AgentDataChangesService } from '../src/modules/agent-data/agent-data-changes.service';
import { heldVersion } from '../src/modules/agent-data/agent-data.controller';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PriceListService } from '../src/modules/catalog/price-lists.service';
import { LiveChangesService } from '../src/modules/live/live-changes.service';
import { BusinessDateUtil } from '../src/common/utils/business-date.util';
import { deleteTenantData } from './utils/tenant-teardown';
import { TestAgent } from './utils/agent-client';

const until = async (check: () => Promise<boolean> | boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** A GET whose body is kept as sent: supertest would unzip a gzip body before the test saw it. */
const rawGet = (url: string, headers: Record<string, string>) =>
  new Promise<{ status: number; headers: Record<string, any>; body: Buffer }>((resolve, reject) => {
    get(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });

// The branch snapshot the agent keeps for selling offline (protocol §12.2, §12.3).
describe('agent branch snapshot (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let changes: AgentDataChangesService;
  let wsUrl: string;
  let tenantId: string;
  let branchId: string;
  let deviceKey: string;
  const ids: Record<string, string> = {};
  const open: TestAgent[] = [];

  const save = <T>(entity: any, data: Partial<T>) =>
    dataSource.getRepository<T>(entity).save(dataSource.getRepository<T>(entity).create(data as any) as any) as Promise<any>;
  const snapshot = () => request(app.getHttpServer()).get('/api/v1/agent/data/snapshot').set('Authorization', `Bearer ${deviceKey}`);

  const connect = async (capabilities: string[]) => {
    const agent = new TestAgent(wsUrl, deviceKey);
    open.push(agent);
    await agent.opened;
    const id = agent.send('hello', { agent_version: '1.1.0', protocol_versions: [1], capabilities, devices: [] });
    await agent.next((m) => m.type === 'welcome' && m.ref === id);
    return agent;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    wsUrl = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/agent/ws`;
    dataSource = moduleRef.get(DataSource);
    changes = moduleRef.get(AgentDataChangesService);
    await moduleRef.get(LiveChangesService).listening;

    tenantId = (
      await save(Tenant, { code: `AGENTDATA-${Date.now()}`, name: 'Agent data fixture', base_currency: 'IRR', default_locale: 'fa', time_zone: 'Asia/Tehran' })
    ).id;
    branchId = (await save(Branch, { tenant_id: tenantId, code: 'ADT', name: 'مرکز خرید', is_active: true, time_zone: 'Asia/Tehran' })).id;

    ids.category = (await save(Category, { tenant_id: tenantId, code: 'BRG', name: 'برگر', sort_order: 1, is_active: true })).id;
    ids.burger = (
      await save(Product, { tenant_id: tenantId, code: 'B01', name: 'چیزبرگر', category_id: ids.category, base_price: '2000000.0000', tax_rate: '0.1000', is_active: true })
    ).id;
    ids.fries = (
      await save(Product, { tenant_id: tenantId, code: 'F01', name: 'سیب‌زمینی', category_id: ids.category, base_price: '0.0000', tax_rate: '0.0000', is_active: true })
    ).id;
    ids.small = (await save(ProductVariant, { tenant_id: tenantId, product_id: ids.fries, code: 'S', name: 'کوچک', base_price: '1000000.0000', sort_order: 1, is_active: true })).id;
    ids.large = (await save(ProductVariant, { tenant_id: tenantId, product_id: ids.fries, code: 'L', name: 'بزرگ', base_price: '1500000.0000', sort_order: 2, is_active: true })).id;
    await save(Product, { tenant_id: tenantId, code: 'OLD', name: 'Retired', category_id: ids.category, base_price: '1.0000', tax_rate: '0.0000', is_active: false });

    ids.drinks = (await save(OptionGroup, { tenant_id: tenantId, code: 'DRK', name: 'نوشیدنی', min_selection: 0, max_selection: 1, is_required: false })).id;
    ids.cola = (await save(OptionItem, { tenant_id: tenantId, option_group_id: ids.drinks, code: 'COLA', name: 'کوکا', price_delta: '350000.0000', sort_order: 1 })).id;
    ids.dough = (await save(OptionItem, { tenant_id: tenantId, option_group_id: ids.drinks, code: 'DOOGH', name: 'دوغ', price_delta: '250000.0000', sort_order: 2 })).id;
    await save(ProductOptionGroup, { tenant_id: tenantId, product_id: ids.burger, option_group_id: ids.drinks, sort_order: 1, excluded_item_ids: [ids.dough] });

    // This branch's price list: the burger and the large fries cost more here.
    const prices = moduleRef.get(PriceListService);
    const list = await prices.createPriceList(tenantId, { name: 'Mall prices' }, 'test');
    await prices.assignBranch(tenantId, branchId, list.id, 'test');
    await prices.setListPrice(tenantId, list.id, ids.burger, null, '2450000', 'test');
    await prices.setListPrice(tenantId, list.id, ids.fries, ids.large, '1600000', 'test');

    // A Snappfood-only stop on the fries does not reach the register; the doogh is off in store.
    const catalog = moduleRef.get(CatalogService);
    await catalog.suspendProduct(tenantId, ids.fries, branchId, 0, 'app only', 'test', { channel: 'SNAPPFOOD' });
    await catalog.suspendProduct(tenantId, undefined, branchId, 2, 'out', 'test', { optionItemId: ids.dough });

    ids.cash = (await save(PaymentMethod, { tenant_id: tenantId, code: 'CASH', name: 'نقد', kind: 'CASH', is_active: true, sort_order: 1 })).id;
    const area = await save(DiningArea, { tenant_id: tenantId, branch_id: branchId, code: 'HALL', name: 'سالن', sort_order: 1, is_active: true });
    ids.table = (await save(DiningTable, { tenant_id: tenantId, dining_area_id: area.id, code: 'T12', table_number: '12', seating_capacity: 4, is_active: true })).id;
    ids.zone = (await save(DeliveryZone, { tenant_id: tenantId, branch_id: branchId, code: 'VNK', name: 'ونک', fee: '400000.0000', is_active: true })).id;
    ids.till = (await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'T1', name: 'صندوق ۱', terminal_type: 'CASHIER', is_active: true })).id;
    await save(Terminal, { tenant_id: tenantId, branch_id: branchId, code: 'K1', name: 'کیوسک', terminal_type: 'KIOSK', is_active: true });
    ids.shift = (
      await save(CashierShift, {
        tenant_id: tenantId,
        branch_id: branchId,
        terminal_id: ids.till,
        user_id: ids.till,
        shift_number: 'S-0001',
        state: 'OPEN',
        business_date: BusinessDateUtil.today(),
      })
    ).id;

    const registry = moduleRef.get(AgentRegistryService);
    const { code } = await registry.createEnrolmentCode(tenantId, branchId, {});
    const enrolled = await moduleRef.get(AgentEnrolmentService).enrol({ code, machine: { hostname: 'ADT-PC' } }, { clientKey: 'test', wsUrl: '' });
    deviceKey = enrolled.device_key;
  }, 60000);

  afterEach(async () => {
    for (const a of open.splice(0)) {
      a.ws.terminate();
      await a.closed;
    }
  });

  afterAll(async () => {
    await changes.settled();
    await deleteTenantData(dataSource, tenantId);
    await app.close();
  });

  it('reads the version out of If-None-Match', () => {
    expect(heldVersion('"abc"')).toBe('abc');
    expect(heldVersion('W/"abc", "def"')).toBe('abc');
    expect(heldVersion(undefined)).toBeNull();
  });

  it('refuses a caller without a device key', async () => {
    await request(app.getHttpServer()).get('/api/v1/agent/data/snapshot').expect(401);
  });

  it('gives the branch what the register sells here, at this branch prices', async () => {
    const res = await snapshot().expect(200);
    const body = res.body;

    expect(res.headers.etag).toBe(`"${body.data_version}"`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(body.data_version).toMatch(/^[0-9a-f]{32}$/);
    expect(body.branch).toMatchObject({ id: branchId, code: 'ADT', currency_code: 'IRR', time_zone: 'Asia/Tehran' });
    expect(body.categories).toEqual([{ id: ids.category, parent_id: null, name: 'برگر', sort_order: 1 }]);

    expect(body.products.map((p: any) => p.code).sort()).toEqual(['B01', 'F01']);
    const burger = body.products.find((p: any) => p.id === ids.burger);
    expect(burger).toMatchObject({ price: '2450000', tax_rate: '0.1000', category_id: ids.category, variants: [], is_available: true });
    // The doogh is left out of this product's group; the cola is offered.
    expect(burger.option_groups).toEqual([
      { id: ids.drinks, name: 'نوشیدنی', min: 0, max: 1, required: false, items: [{ id: ids.cola, name: 'کوکا', price_delta: '350000', product_id: null }] },
    ]);
    const fries = body.products.find((p: any) => p.id === ids.fries);
    expect(fries.variants).toEqual([
      { id: ids.small, name: 'کوچک', price: '1000000' },
      { id: ids.large, name: 'بزرگ', price: '1600000' },
    ]);
    // Stopped on Snappfood only: still on sale in store.
    expect(fries.is_available).toBe(true);

    expect(body.availability.stopped).toEqual([
      { product_id: null, variant_id: null, option_item_id: ids.dough, until: expect.any(String) },
    ]);
    expect(body.availability.schedules).toEqual([]);
    expect(body.payment_methods).toEqual([{ id: ids.cash, code: 'CASH', name: 'نقد', kind: 'CASH' }]);
    expect(body.dining_tables).toEqual([{ id: ids.table, area: 'سالن', number: '12', seats: 4 }]);
    expect(body.delivery_zones).toEqual([{ id: ids.zone, name: 'ونک', fee: '400000' }]);
    expect(body.tills).toEqual([{ id: ids.till, code: 'T1', name: 'صندوق ۱', payment_device_id: null }]);
    expect(body.open_shifts).toEqual([
      expect.objectContaining({ id: ids.shift, terminal_id: ids.till, shift_number: 'S-0001', business_date: BusinessDateUtil.today() }),
    ]);
    expect(body.settings).toEqual({
      call_numbers: { POS: { start: 100, end: 399 } },
      call_number_issued_today: { business_date: BusinessDateUtil.today(), POS: 0 },
      order_actions: { edit_window_minutes: 10, cancel_window_minutes: 10 },
      auto_logout_minutes: 0,
    });
    // No printers yet: nothing to route to (§13.11).
    expect(body.printing).toEqual({
      heading: { brand_name: 'Agent data fixture', branch_name: 'مرکز خرید', branch_address: null, branch_phone: null, calendar: 'JALALI' },
      groups: [],
      kitchen_routes: {},
      documents: { CUSTOMER_RECEIPT: null, GUEST_BILL: null },
      fallback: { KITCHEN_TICKET: null, OTHER: null },
    });

    // Kept for 30 days, so offline orders can be checked against it (§12.6).
    const kept = await dataSource.getRepository(AgentDataSnapshot).findOneByOrFail({ tenant_id: tenantId, data_version: body.data_version });
    expect(kept.body.products).toHaveLength(2);
  });

  it('answers 304 when the agent already holds the version, and gzips when asked', async () => {
    const first = await snapshot().expect(200);
    const version = first.body.data_version;

    await snapshot().set('If-None-Match', `"${version}"`).expect(304);
    await snapshot().set('If-None-Match', '"something-older"').expect(200);

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const zipped = await rawGet(`http://127.0.0.1:${port}/api/v1/agent/data/snapshot`, {
      Authorization: `Bearer ${deviceKey}`,
      'Accept-Encoding': 'gzip',
    });
    expect(zipped.status).toBe(200);
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(zipped.body).toString('utf8')).data_version).toBe(version);
  });

  it('gets a new version when head office changes a price, and the same one when nothing changed', async () => {
    const before = (await snapshot().expect(200)).body.data_version;
    expect((await snapshot().expect(200)).body.data_version).toBe(before);

    await dataSource.getRepository(Product).update({ id: ids.burger }, { tax_rate: '0.0900' });
    const after = (await snapshot().expect(200)).body;
    expect(after.data_version).not.toBe(before);
    expect(after.products.find((p: any) => p.id === ids.burger).tax_rate).toBe('0.0900');
    await dataSource.getRepository(Product).update({ id: ids.burger }, { tax_rate: '0.1000' });
  });

  it('tells a connected agent that pulls to fetch the new snapshot, once', async () => {
    const puller = await connect(['print.html', 'data.pull']);
    await snapshot().expect(200);
    await changes.settled();

    await dataSource.getRepository(Product).update({ id: ids.burger }, { name: 'چیزبرگر ویژه' });
    await until(() => changes.isWaiting(tenantId));
    await changes.flushNow(tenantId);

    const notice = await puller.next((m) => m.type === 'data.changed');
    expect(notice.payload.data_version).toMatch(/^[0-9a-f]{32}$/);
    expect(notice.payload.expires_at).toEqual(expect.any(String));
    puller.send('ack', { ok: true }, undefined, notice.id);

    // Once the agent has fetched that version, a notice that changes nothing is not passed on.
    const fetched = await snapshot().expect(200);
    expect(fetched.body.data_version).toBe(notice.payload.data_version);
    await dataSource.getRepository(Product).update({ id: ids.burger }, { name: 'چیزبرگر ویژه' });
    changes.onChange({ topic: 'agent-data', tenant_id: tenantId, branch_id: branchId });
    await changes.flushNow(tenantId);
    expect(puller.frames.filter((m) => m.type === 'data.changed')).toHaveLength(1);
  });

  it('does not send data.changed to an agent that does not keep a snapshot', async () => {
    const v1 = await connect(['print.html']);
    changes.onChange({ topic: 'agent-data', tenant_id: tenantId, branch_id: null });
    await dataSource.getRepository(Product).update({ id: ids.burger }, { name: 'چیزبرگر' });
    await changes.flushNow(tenantId);
    await new Promise((r) => setTimeout(r, 200));
    expect(v1.frames.filter((m) => m.type === 'data.changed')).toHaveLength(0);
  });

  describe('offline till (§13)', () => {
    const OFFLINE_TILL = ['print.html', 'data.pull', 'sync.orders', 'pos.offline'];
    const staff = () => request(app.getHttpServer()).get('/api/v1/agent/data/staff').set('Authorization', `Bearer ${deviceKey}`);
    const user = (username: string, data: Partial<AdminUser>) =>
      save<AdminUser>(AdminUser, { tenant_id: tenantId, username, display_name: username, password_hash: 'x', is_active: true, role: 'CASHIER', branch_id: branchId, ...data });

    beforeAll(async () => {
      ids.sara = (await user('sara', { display_name: 'سارا', pin_hash: '$argon2id$v=19$m=65536,t=3,p=4$c2FyYQ$aGFzaA' })).id;
      ids.boss = (await user('boss', { display_name: 'امیر', role: 'MANAGER', pin_hash: '$argon2id$v=19$m=65536,t=3,p=4$Ym9zcw$aGFzaA' })).id;
      await user('nopin', { pin_hash: null as any });
      await user('gone', { is_active: false, pin_hash: '$argon2id$x' });
      await user('hq', { role: 'ADMIN', branch_id: null, pin_hash: '$argon2id$x' });
      await user('root', { role: 'SUPER_ADMIN', pin_hash: '$argon2id$x' });
    });

    afterAll(async () => {
      await dataSource.query(`DELETE FROM "printer_group_member" WHERE "group_id" IN (SELECT "id" FROM "printer_group" WHERE "tenant_id" = $1)`, [tenantId]);
    });

    it('works out the print routing the offline till applies itself', async () => {
      const grillPrinter = await save<Printer>(Printer, { tenant_id: tenantId, branch_id: branchId, code: 'KIT1', name: 'گریل', printer_type: 'KITCHEN_IMPACT', is_active: true });
      const counter = await save<Printer>(Printer, { tenant_id: tenantId, branch_id: branchId, code: 'REC1', name: 'صندوق', printer_type: 'THERMAL_RECEIPT', is_active: true });
      const grill = await save<PrinterGroup>(PrinterGroup, { tenant_id: tenantId, branch_id: branchId, code: 'GRL', name: 'گریل', ticket_template: 'COMPACT' });
      const front = await save<PrinterGroup>(PrinterGroup, { tenant_id: tenantId, branch_id: branchId, code: 'FRT', name: 'جلو' });
      await save<PrinterGroupMember>(PrinterGroupMember, { group_id: grill.id, printer_id: grillPrinter.id, priority: 0, copies: 2 });
      await save<PrinterGroupMember>(PrinterGroupMember, { group_id: front.id, printer_id: counter.id, priority: 0, copies: 1 });
      // The burger has a route of its own; the fries only the category's.
      await save<PrintRoute>(PrintRoute, { tenant_id: tenantId, branch_id: branchId, document_type: 'KITCHEN_TICKET', category_id: ids.category, printer_group_id: front.id, copies: 1 });
      await save<PrintRoute>(PrintRoute, { tenant_id: tenantId, branch_id: branchId, document_type: 'KITCHEN_TICKET', product_id: ids.burger, printer_group_id: grill.id, copies: 3 });
      await save<PrintRoute>(PrintRoute, { tenant_id: tenantId, branch_id: branchId, document_type: 'CUSTOMER_RECEIPT', printer_group_id: front.id, copies: 1 });

      const { printing } = (await snapshot().expect(200)).body;
      expect(printing.groups).toEqual([
        { id: front.id, name: 'جلو', ticket_template: null, printers: [{ printer_id: counter.id, copies: 1 }] },
        { id: grill.id, name: 'گریل', ticket_template: 'COMPACT', printers: [{ printer_id: grillPrinter.id, copies: 2 }] },
      ]);
      expect(printing.kitchen_routes).toEqual({
        [ids.burger]: { group_id: grill.id, copies: 3 },
        [ids.fries]: { group_id: front.id, copies: 1 },
      });
      expect(printing.documents).toEqual({ CUSTOMER_RECEIPT: { group_id: front.id, copies: 1 }, GUEST_BILL: null });
      expect(printing.fallback).toEqual({ KITCHEN_TICKET: grillPrinter.id, OTHER: counter.id });

      // A printer switched off leaves its group, as it would online.
      await dataSource.getRepository(Printer).update({ id: grillPrinter.id }, { is_active: false });
      const after = (await snapshot().expect(200)).body.printing;
      expect(after.groups.find((g: any) => g.id === grill.id).printers).toEqual([]);
      expect(after.fallback.KITCHEN_TICKET).toBeNull();
      await dataSource.getRepository(Printer).update({ id: grillPrinter.id }, { is_active: true });
    });

    it('hears of a change to a group member or the brand name, rows that carry no branch of their own', async () => {
      const [member] = await dataSource.query(
        `SELECT "group_id", "printer_id" FROM "printer_group_member" WHERE "group_id" IN (SELECT "id" FROM "printer_group" WHERE "tenant_id" = $1) LIMIT 1`,
        [tenantId],
      );
      await changes.flushNow(tenantId);
      await dataSource.query(`UPDATE "printer_group_member" SET "copies" = "copies" WHERE "group_id" = $1 AND "printer_id" = $2`, [member.group_id, member.printer_id]);
      await until(() => changes.isWaiting(tenantId));

      await changes.flushNow(tenantId);
      await dataSource.getRepository(Tenant).update({ id: tenantId }, { name: 'Agent data fixture' });
      await until(() => changes.isWaiting(tenantId));
      await changes.flushNow(tenantId);
    });

    it('serves the staff list only to an agent connected with the offline till', async () => {
      await staff().expect(403);
      await connect(['print.html', 'data.pull']);
      expect((await staff().expect(403)).body.code).toBe('CAPABILITY_REQUIRED');
    });

    it('lists the branch staff who may sign in, with their PIN hashes, and keeps no copy', async () => {
      await connect(OFFLINE_TILL);
      const res = await staff().expect(200);
      expect(res.headers.etag).toBe(`"${res.body.staff_version}"`);
      // Only this branch's active users with a PIN, in the till's roles, by name.
      expect(res.body.users).toEqual([
        { id: ids.boss, display_name: 'امیر', role: 'MANAGER', pin_hash: '$argon2id$v=19$m=65536,t=3,p=4$Ym9zcw$aGFzaA' },
        { id: ids.sara, display_name: 'سارا', role: 'CASHIER', pin_hash: '$argon2id$v=19$m=65536,t=3,p=4$c2FyYQ$aGFzaA' },
      ]);
      await staff().set('If-None-Match', `"${res.body.staff_version}"`).expect(304);

      // Signing in stamps the user row; that is not a new list.
      await dataSource.getRepository(AdminUser).update({ id: ids.sara }, { last_login_at: new Date() });
      await staff().set('If-None-Match', `"${res.body.staff_version}"`).expect(304);

      const kept = await dataSource.query(`SELECT count(*)::int AS n FROM "agent_data_snapshot" WHERE "tenant_id" = $1 AND "body"::text LIKE '%argon2%'`, [tenantId]);
      expect(kept[0].n).toBe(0);
    });

    it('tells an offline-till agent when its staff list changes', async () => {
      const till = await connect(OFFLINE_TILL);
      const dataVersion = (await snapshot().expect(200)).body.data_version;
      const staffVersion = (await staff().expect(200)).body.staff_version;
      await changes.settled();

      await dataSource.getRepository(AdminUser).update({ id: ids.sara }, { pin_hash: '$argon2id$v=19$m=65536,t=3,p=4$bmV3$bmV3' });
      await until(() => changes.isWaiting(tenantId));
      await changes.flushNow(tenantId);

      const notice = await till.next((m) => m.type === 'data.changed');
      expect(notice.payload.data_version).toBe(dataVersion);
      expect(notice.payload.staff_version).not.toBe(staffVersion);
      const fetched = await staff().set('If-None-Match', `"${staffVersion}"`).expect(200);
      expect(fetched.body.staff_version).toBe(notice.payload.staff_version);
    });

    it('puts the day’s POS call count in heartbeat.ack for an offline till only', async () => {
      await dataSource.query(
        `INSERT INTO "order_call_counter" ("tenant_id", "branch_id", "business_date", "channel_group", "last_value") VALUES ($1, $2, $3, 'POS', 41)`,
        [tenantId, branchId, BusinessDateUtil.today()],
      );
      const till = await connect(OFFLINE_TILL);
      const beat = till.send('heartbeat', { in_flight: 0, unacked_results: 0, till: { terminal_id: ids.till, mode: 'ONLINE', open_orders: 0 } });
      const ack = await till.next((m) => m.type === 'heartbeat.ack' && m.ref === beat);
      expect(ack.payload.call_numbers).toEqual({ business_date: BusinessDateUtil.today(), POS: 41 });
      till.ws.terminate();
      await till.closed;

      const plain = await connect(['print.html', 'data.pull']);
      const plainBeat = plain.send('heartbeat', { in_flight: 0, unacked_results: 0 });
      const plainAck = await plain.next((m) => m.type === 'heartbeat.ack' && m.ref === plainBeat);
      expect(plainAck.payload.call_numbers).toBeUndefined();
    });
  });
});
