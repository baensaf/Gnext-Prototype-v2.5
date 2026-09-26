import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { AdminUser } from '../../entities/AdminUser.entity';
import { AgentDataSnapshot } from '../../entities/AgentDataSnapshot.entity';
import { Branch } from '../../entities/Branch.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { Category } from '../../entities/Category.entity';
import { Courier } from '../../entities/Courier.entity';
import { CourierAttendance } from '../../entities/CourierAttendance.entity';
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
import { loadBusinessClock } from '../../common/utils/business-clock';
import { CALENDAR_SETTING_KEY, readCalendar } from '../../common/utils/calendar.util';
import { inTreeOrder } from '../../common/utils/category-tree.util';
import { MoneyUtil } from '../../common/utils/money.util';
import { parseDays } from '../../common/utils/availability-schedule.util';
import { inStorePrice } from '../../common/utils/price-list.util';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import { applyChannelRule } from '../../common/utils/channel-price.util';
import { CatalogService } from '../catalog/catalog.service';
import { PriceListService } from '../catalog/price-lists.service';
import { CALL_NUMBER_SETTING_KEY, callCount, readCallNumberRanges } from '../order/call-number';
import { resolveOrderActionConfig } from '../order/order-edit-policy';
import { PrintRoutingService } from '../printing/print-routing.service';

/** How long a served snapshot is kept for checking offline orders against (§12.2). */
export const SNAPSHOT_RETENTION_DAYS = 30;

/** The roles that may sign in at a branch's offline till (§13.3). */
export const OFFLINE_TILL_ROLES = ['CASHIER', 'SUPERVISOR', 'MANAGER', 'ADMIN', 'OWNER'];

export interface BranchSnapshot {
  data_version: string;
  generated_at: string;
  [section: string]: any;
}

/** Who may sign in at the branch's offline till, with their PIN hashes (§13.3). */
export interface StaffList {
  staff_version: string;
  generated_at: string;
  users: Array<{ id: string; display_name: string; role: string; pin_hash: string }>;
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
  /** The same for the staff list. */
  private readonly servedStaff = new Map<string, string>();

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
    @InjectRepository(AdminUser) private readonly users: Repository<AdminUser>,
    @InjectRepository(Courier) private readonly couriers: Repository<Courier>,
    @InjectRepository(CourierAttendance) private readonly attendance: Repository<CourierAttendance>,
    private readonly catalog: CatalogService,
    private readonly priceLists: PriceListService,
    private readonly routing: PrintRoutingService,
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

  /**
   * The branch's staff list as it stands now (§13.3). Its version is a hash of the users, so a
   * login that only stamps `last_login_at` does not change it. Unlike the snapshot it is never
   * stored: PIN hashes must not pile up in the cloud's copies.
   */
  async buildStaff(tenantId: string, branchId: string, now = new Date()): Promise<StaffList> {
    const rows = await this.users.find({
      where: { tenant_id: tenantId, branch_id: branchId, is_active: true, pin_hash: Not(IsNull()), role: In(OFFLINE_TILL_ROLES) },
      order: { display_name: 'ASC', id: 'ASC' },
    });
    const users = rows
      .filter((u) => !!u.pin_hash)
      .map((u) => ({ id: u.id, display_name: u.display_name, role: u.role, pin_hash: u.pin_hash }));
    const staff_version = createHash('sha256').update(JSON.stringify(users)).digest('hex').slice(0, 32);
    return { staff_version, generated_at: now.toISOString(), users };
  }

  /** Hands the agent its staff list. Returns null when it already holds this version. */
  async serveStaff(tenantId: string, branchId: string, held: string | null): Promise<StaffList | null> {
    const staff = await this.buildStaff(tenantId, branchId);
    this.servedStaff.set(`${tenantId}:${branchId}`, staff.staff_version);
    return held === staff.staff_version ? null : staff;
  }

  /** The staff version this branch's agent last fetched in this process, if any. */
  servedStaffVersion(tenantId: string, branchId: string): string | undefined {
    return this.servedStaff.get(`${tenantId}:${branchId}`);
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
    // The branch's business day, which turns over at its cutoff; the till dates its offline
    // orders by the same rule, from `settings.business_day`.
    const clock = await loadBusinessClock(this.settings.manager, tenantId, branchId);
    const businessDate = clock.today(now);

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

    const [methods, areas, zones, tills, openShifts, settingRows, issued, issuedOnline, routing, sheet, couriers, attendance] = await Promise.all([
      this.paymentMethods.find({ where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', code: 'ASC' } }),
      this.areas.find({ where: { tenant_id: tenantId, branch_id: branchId, is_active: true }, order: { sort_order: 'ASC', id: 'ASC' } }),
      this.zones.find({ where: { tenant_id: tenantId, branch_id: branchId, is_active: true, deleted_at: IsNull() }, order: { name: 'ASC', id: 'ASC' } }),
      this.terminals.find({ where: { tenant_id: tenantId, branch_id: branchId, is_active: true, deleted_at: IsNull() }, order: { code: 'ASC', id: 'ASC' } }),
      this.shifts.find({ where: { tenant_id: tenantId, branch_id: branchId, state: 'OPEN' }, order: { opened_at: 'ASC', id: 'ASC' } }),
      this.settings.find({ where: { tenant_id: tenantId, key: In([CALL_NUMBER_SETTING_KEY, 'ORDER_ACTIONS', 'SYSTEM', CALENDAR_SETTING_KEY]) } }),
      callCount(this.settings.manager, tenantId, branchId, businessDate, 'POS'),
      callCount(this.settings.manager, tenantId, branchId, businessDate, 'ONLINE'),
      this.routing.offlineRouting(tenantId, branchId, products.map((p) => p.id)),
      this.catalog.getChannelPriceSheet(tenantId, 'SNAPPFOOD', branchId),
      this.couriers.find({ where: { tenant_id: tenantId, branch_id: branchId, is_active: true }, order: { name: 'ASC', id: 'ASC' } }),
      this.attendance.find({ where: { tenant_id: tenantId, branch_id: branchId, date: businessDate } }),
    ]);
    // Who is on shift now: each courier's latest record today.
    const latestAttendance = new Map<string, CourierAttendance>();
    for (const a of attendance) {
      const seen = latestAttendance.get(a.courier_id);
      if (!seen || new Date(a.created_at) > new Date(seen.created_at)) latestAttendance.set(a.courier_id, a);
    }
    // Each key as it applies at this branch: its own override, else head office's value.
    const setting = (key: string) =>
      pickSettingValue(
        settingRows.filter((r) => r.key === key),
        branchId,
      );
    // Call numbers and the calendar are head office's alone.
    const orgSetting = (key: string) => settingRows.find((r) => r.key === key && !r.branch_id)?.value;
    const orderActions = resolveOrderActionConfig(setting('ORDER_ACTIONS'));
    const autoLogout = Number(setting('SYSTEM')?.auto_logout_minutes);
    const areaIds = areas.map((a) => a.id);
    const tables = areaIds.length
      ? await this.tables.find({ where: { tenant_id: tenantId, dining_area_id: In(areaIds), is_active: true }, order: { table_number: 'ASC', id: 'ASC' } })
      : [];
    const areaName = new Map(areas.map((a) => [a.id, a.name]));
    const ranges = readCallNumberRanges(orgSetting(CALL_NUMBER_SETTING_KEY));

    return {
      branch: {
        id: branch.id,
        code: branch.code,
        name: branch.name,
        currency_code: tenant.base_currency || 'IRR',
        time_zone: branch.time_zone || 'Asia/Tehran',
      },
      settings: {
        call_numbers: { POS: ranges.POS, ONLINE: ranges.ONLINE },
        call_number_issued_today: { business_date: businessDate, POS: issued, ONLINE: issuedOnline },
        order_actions: {
          edit_window_minutes: orderActions.editWindowMinutes,
          cancel_window_minutes: orderActions.cancelWindowMinutes,
        },
        auto_logout_minutes: Number.isInteger(autoLogout) && autoLogout > 0 ? autoLogout : 0,
        business_day: {
          business_date: businessDate,
          cutoff: clock.policy.cutoff,
          time_zone: clock.policy.timeZone,
          opens_at: clock.policy.opensAt,
          closes_at: clock.policy.closesAt,
          ends_at: new Date(clock.endOf(businessDate).getTime() + 1).toISOString(),
        },
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
        .map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          payment_device_id: t.payment_device_id ?? null,
          // Where the till's receipts and bills print (§13.11), as PrintRoutingService prints them online.
          receipt_printer_id: t.receipt_printer_id ?? null,
          receipt_copies: t.receipt_copies || 1,
          receipt_template: t.receipt_template ?? null,
        })),
      open_shifts: openShifts.map((s) => ({
        id: s.id,
        terminal_id: s.terminal_id ?? null,
        user_id: s.user_id ?? null,
        shift_number: s.shift_number ?? null,
        business_date: s.business_date ? String(s.business_date).slice(0, 10) : null,
        opened_at: s.opened_at ? new Date(s.opened_at).toISOString() : null,
      })),
      printing: {
        // What every ticket is headed with, as PrintQueueService heads it online.
        heading: {
          brand_name: tenant.name || null,
          branch_name: branch.name || null,
          branch_address: branch.address || null,
          branch_phone: branch.phone || null,
          calendar: readCalendar(orgSetting(CALENDAR_SETTING_KEY)),
        },
        ...routing,
      },
      // What a Snappfood order costs, for the till to take one while the cloud is away (§17.3):
      // the channel price sheet, and each add-on at the channel's markup.
      snappfood: {
        prices: sheet.items
          .map((r) => ({ product_id: r.product_id, variant_id: r.variant_id ?? null, price: rial(r.price) }))
          .sort((a, b) => `${a.product_id}:${a.variant_id}`.localeCompare(`${b.product_id}:${b.variant_id}`)),
        add_ons: [...items]
          .sort(byId)
          .map((i) => ({ option_item_id: i.id, price_delta: rial(applyChannelRule(i.price_delta || 0, sheet.rule)) })),
      },
      couriers: couriers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone ?? null,
        checked_in: latestAttendance.get(c.id)?.status === 'CHECKED_IN',
      })),
    };
  }
}
