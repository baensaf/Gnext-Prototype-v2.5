import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { AgentDataSnapshot } from '../../entities/AgentDataSnapshot.entity';
import { Branch } from '../../entities/Branch.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { Category } from '../../entities/Category.entity';
import { DeliveryZone } from '../../entities/DeliveryZone.entity';
import { DiningArea } from '../../entities/DiningArea.entity';
import { DiningTable } from '../../entities/DiningTable.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { Product } from '../../entities/Product.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { inTreeOrder } from '../../common/utils/category-tree.util';
import { MoneyUtil } from '../../common/utils/money.util';
import { parseDays } from '../../common/utils/availability-schedule.util';
import { inStorePrice } from '../../common/utils/price-list.util';
import { CatalogService } from '../catalog/catalog.service';
import { PriceListService } from '../catalog/price-lists.service';
import { CALL_NUMBER_SETTING_KEY, readCallNumberRanges } from '../order/call-number';

/** How long a served snapshot is kept for checking offline orders against (§12.2). */
export const SNAPSHOT_RETENTION_DAYS = 30;

export interface BranchSnapshot {
  data_version: string;
  generated_at: string;
  [section: string]: any;
}

/** Whole rials, as the protocol carries money (§2.1). */
const rial = (value: unknown) => MoneyUtil.format(value as any, 0);
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The branch snapshot the agent keeps so the branch can sell while offline (protocol §12.2):
 * what the register would offer at this branch right now, at this branch's prices.
 */
@Injectable()
export class AgentDataService {
  /** The version each branch's agent last fetched, so a change it already has is not announced. */
  private readonly served = new Map<string, string>();

  constructor(
    @InjectRepository(AgentDataSnapshot) private readonly snapshots: Repository<AgentDataSnapshot>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(ProductVariant) private readonly variants: Repository<ProductVariant>,
    @InjectRepository(OptionGroup) private readonly optionGroups: Repository<OptionGroup>,
    @InjectRepository(OptionItem) private readonly optionItems: Repository<OptionItem>,
    @InjectRepository(ProductOptionGroup) private readonly productGroups: Repository<ProductOptionGroup>,
    @InjectRepository(PaymentMethod) private readonly paymentMethods: Repository<PaymentMethod>,
    @InjectRepository(DiningArea) private readonly areas: Repository<DiningArea>,
    @InjectRepository(DiningTable) private readonly tables: Repository<DiningTable>,
    @InjectRepository(DeliveryZone) private readonly zones: Repository<DeliveryZone>,
    @InjectRepository(Terminal) private readonly terminals: Repository<Terminal>,
    @InjectRepository(CashierShift) private readonly shifts: Repository<CashierShift>,
    @InjectRepository(TenantSetting) private readonly settings: Repository<TenantSetting>,
    private readonly catalog: CatalogService,
    private readonly priceLists: PriceListService,
  ) {}

  /** The snapshot as it stands now. Its version is a hash of everything but the version and the time. */
  async build(tenantId: string, branchId: string, now = new Date()): Promise<BranchSnapshot> {
    const content = await this.content(tenantId, branchId, now);
    const data_version = createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 32);
    return { data_version, generated_at: now.toISOString(), ...content };
  }

  /**
   * Hands the agent its snapshot, keeping the version it was given for 30 days. Returns null
   * when the agent already holds this version (`If-None-Match`).
   */
  async serve(tenantId: string, branchId: string, held: string | null): Promise<BranchSnapshot | null> {
    const snapshot = await this.build(tenantId, branchId);
    const now = new Date();
    await this.snapshots
      .createQueryBuilder()
      .insert()
      .into(AgentDataSnapshot)
      .values({
        tenant_id: tenantId,
        branch_id: branchId,
        data_version: snapshot.data_version,
        body: snapshot,
        first_served_at: now,
        last_served_at: now,
      })
      .orUpdate(['last_served_at'], ['tenant_id', 'branch_id', 'data_version'])
      .execute();
    await this.snapshots.delete({
      tenant_id: tenantId,
      branch_id: branchId,
      last_served_at: LessThan(new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * 86_400_000)),
    });
    this.served.set(`${tenantId}:${branchId}`, snapshot.data_version);
    return held === snapshot.data_version ? null : snapshot;
  }

  /** The version this branch's agent last fetched in this process, if any. */
  servedVersion(tenantId: string, branchId: string): string | undefined {
    return this.served.get(`${tenantId}:${branchId}`);
  }

  /** A snapshot the cloud served, for checking an offline order against (§12.6). */
  async findServed(tenantId: string, branchId: string, dataVersion: string): Promise<BranchSnapshot | null> {
    const row = await this.snapshots.findOne({ where: { tenant_id: tenantId, branch_id: branchId, data_version: dataVersion } });
    return (row?.body as BranchSnapshot) ?? null;
  }

  private async content(tenantId: string, branchId: string, now: Date) {
    const [tenant, branch] = await Promise.all([
      this.tenants.findOneOrFail({ where: { id: tenantId } }),
      this.branches.findOneOrFail({ where: { id: branchId, tenant_id: tenantId } }),
    ]);
    const businessDate = BusinessDateUtil.today(now);

    const [categories, products, variants, groups, items, links, off, windows, stock, listed, stops] = await Promise.all([
      this.categories.find({ where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', name: 'ASC', id: 'ASC' } }),
      this.products.find({ where: { tenant_id: tenantId, is_active: true }, order: { name: 'ASC', id: 'ASC' } }),
      this.variants.find({ where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', code: 'ASC', id: 'ASC' } }),
      this.optionGroups.find({ where: { tenant_id: tenantId } }),
      this.optionItems.find({ where: { tenant_id: tenantId }, order: { sort_order: 'ASC', name: 'ASC', id: 'ASC' } }),
      this.productGroups.find({ where: { tenant_id: tenantId }, order: { sort_order: 'ASC', id: 'ASC' } }),
      this.catalog.getUnavailableNow(tenantId, branchId, now),
      this.catalog.sellingWindows(tenantId, branchId),
      this.catalog.getDailyStock(tenantId, branchId, businessDate),
      this.priceLists.pricesForBranch(tenantId, branchId, now),
      this.catalog.getAvailabilities(tenantId, branchId),
    ]);

    const groupById = new Map(groups.map((g) => [g.id, g]));
    const catalogProducts = products.map((p) => {
      const own = variants.filter((v) => v.product_id === p.id);
      const onSale = own.filter((v) => !off.products.has(p.id) && !off.variants.has(v.id));
      return {
        id: p.id,
        code: p.code ?? null,
        name: p.name,
        category_id: p.category_id ?? null,
        price: rial(inStorePrice(listed, p, null)),
        tax_rate: MoneyUtil.format(p.tax_rate || 0, 4),
        max_per_order: p.max_per_order ?? null,
        variants: own.map((v) => ({ id: v.id, name: v.name, price: rial(inStorePrice(listed, p, v)) })),
        option_groups: links
          .filter((l) => l.product_id === p.id && groupById.has(l.option_group_id))
          .map((l) => {
            const g = groupById.get(l.option_group_id)!;
            const excluded = new Set(l.excluded_item_ids || []);
            return {
              id: g.id,
              name: g.name,
              min: g.min_selection ?? 0,
              max: g.max_selection ?? null,
              required: !!g.is_required,
              items: items
                .filter((i) => i.option_group_id === g.id && !excluded.has(i.id))
                .map((i) => ({ id: i.id, name: i.name, price_delta: rial(i.price_delta || 0), product_id: i.product_id ?? null })),
            };
          }),
        is_available: !off.products.has(p.id) && (own.length === 0 || onSale.length > 0),
      };
    });

    // Stops for a sale in store: a stop on one channel (Snappfood) does not reach the register.
    const liveStops = stops
      .filter((s) => !s.channel && s.is_suspended && (!s.suspended_until || new Date(s.suspended_until) > now))
      .sort(byId)
      .map((s) => ({
        product_id: s.variant_id || s.option_item_id ? null : s.product_id ?? null,
        variant_id: s.variant_id ?? null,
        option_item_id: s.option_item_id ?? null,
        until: s.suspended_until ? new Date(s.suspended_until).toISOString() : null,
      }));

    const schedules = [...windows.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([productId, ws]) => ({
        product_id: productId,
        windows: [...ws].sort(byId).map((w) => ({ days: parseDays(w.days_of_week), from: w.start_time, to: w.end_time })),
      }));

    const [methods, areas, zones, tills, openShifts, callSetting, counter] = await Promise.all([
      this.paymentMethods.find({ where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', code: 'ASC' } }),
      this.areas.find({ where: { tenant_id: tenantId, branch_id: branchId, is_active: true }, order: { sort_order: 'ASC', id: 'ASC' } }),
      this.zones.find({ where: { tenant_id: tenantId, branch_id: branchId, is_active: true, deleted_at: IsNull() }, order: { name: 'ASC', id: 'ASC' } }),
      this.terminals.find({ where: { tenant_id: tenantId, branch_id: branchId, is_active: true, deleted_at: IsNull() }, order: { code: 'ASC', id: 'ASC' } }),
      this.shifts.find({ where: { tenant_id: tenantId, branch_id: branchId, state: 'OPEN' }, order: { opened_at: 'ASC', id: 'ASC' } }),
      this.settings.findOne({ where: { tenant_id: tenantId, key: CALL_NUMBER_SETTING_KEY, branch_id: IsNull() } }),
      this.settings.manager.query(
        `SELECT "last_value" FROM "order_call_counter" WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "business_date" = $3 AND "channel_group" = 'POS'`,
        [tenantId, branchId, businessDate],
      ),
    ]);
    const areaIds = areas.map((a) => a.id);
    const tables = areaIds.length
      ? await this.tables.find({ where: { tenant_id: tenantId, dining_area_id: In(areaIds), is_active: true }, order: { table_number: 'ASC', id: 'ASC' } })
      : [];
    const areaName = new Map(areas.map((a) => [a.id, a.name]));

    return {
      branch: {
        id: branch.id,
        code: branch.code,
        name: branch.name,
        currency_code: tenant.base_currency || 'IRR',
        time_zone: branch.time_zone || 'Asia/Tehran',
      },
      settings: {
        call_numbers: { POS: readCallNumberRanges(callSetting?.value).POS },
        call_number_issued_today: { business_date: businessDate, POS: Number(counter?.[0]?.last_value || 0) },
      },
      categories: inTreeOrder(categories).map((c) => ({ id: c.id, parent_id: c.parent_id ?? null, name: c.name, sort_order: c.sort_order ?? 0 })),
      products: catalogProducts,
      availability: {
        stopped: liveStops,
        schedules,
        daily_stock: stock
          .map((s) => ({ product_id: s.product_id, variant_id: s.variant_id ?? null, remaining: s.remaining }))
          .sort((a, b) => `${a.product_id}:${a.variant_id}`.localeCompare(`${b.product_id}:${b.variant_id}`)),
      },
      payment_methods: methods.map((m) => ({ id: m.id, code: m.code, name: m.name, kind: m.kind })),
      order_types: ['TAKEAWAY', 'DINE_IN', 'DELIVERY'],
      dining_tables: tables.map((t) => ({
        id: t.id,
        area: areaName.get(t.dining_area_id) ?? null,
        number: t.table_number,
        seats: t.seating_capacity ?? null,
      })),
      delivery_zones: zones.map((z) => ({ id: z.id, name: z.name, fee: rial(z.fee || 0) })),
      tills: tills
        .filter((t) => (t.terminal_type || 'CASHIER') === 'CASHIER')
        .map((t) => ({ id: t.id, code: t.code, name: t.name, payment_device_id: t.payment_device_id ?? null })),
      open_shifts: openShifts.map((s) => ({
        id: s.id,
        terminal_id: s.terminal_id ?? null,
        user_id: s.user_id ?? null,
        shift_number: s.shift_number ?? null,
        business_date: s.business_date ? String(s.business_date).slice(0, 10) : null,
        opened_at: s.opened_at ? new Date(s.opened_at).toISOString() : null,
      })),
    };
  }
}
