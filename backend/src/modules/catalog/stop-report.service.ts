import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { AuditEvent } from '../../entities/AuditEvent.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { Branch } from '../../entities/Branch.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { MoneyUtil } from '../../common/utils/money.util';

/** How far back a stop may have started and still be off inside the report's days. */
const LOOKBACK_DAYS = 31;
const HOUR_MS = 3600 * 1000;

interface StopEvent {
  product_id?: string | null;
  variant_id?: string | null;
  option_item_id?: string | null;
  channel?: string | null;
  branchId?: string | null;
  reason?: string | null;
  suspendedUntil?: string | null;
  approverId?: string | null;
  source?: string;
}

interface Interval {
  key: string;
  product_id: string | null;
  variant_id: string | null;
  option_item_id: string | null;
  branch_id: string | null;
  channel: string | null;
  reason: string | null;
  source: string;
  by: string | null;
  approver: string | null;
  from: Date;
  planned_until: Date | null;
  to: Date | null;
  ended: 'RESUMED' | 'EXPIRED' | 'CHANGED' | 'ONGOING';
  resumed_by: string | null;
}

/**
 * The 86 report: who took what off sale, when, why and for how long, and the sales refused
 * while it was off (a register or kiosk tried to sell it). Built from the audit log, which
 * records every stop, resume and refusal.
 */
@Injectable()
export class StopReportService {
  constructor(
    @InjectRepository(AuditEvent) private readonly auditRepo: Repository<AuditEvent>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductVariant) private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(OptionItem) private readonly optionRepo: Repository<OptionItem>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
  ) {}

  /** `from` and `to` are business days (YYYY-MM-DD), both included; the last 7 days by default. */
  async report(tenantId: string, query: { from?: string; to?: string; branchId?: string | null }, now: Date = new Date()) {
    const today = BusinessDateUtil.today(now);
    const to = query.to || today;
    const from = query.from || BusinessDateUtil.today(new Date(BusinessDateUtil.startOfDay(to).getTime() - 6 * 24 * HOUR_MS));
    if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) || from > to) throw new BadRequestException('Pick a date range: from and to as YYYY-MM-DD, from first');
    const start = BusinessDateUtil.startOfDay(from);
    const end = new Date(Math.min(BusinessDateUtil.endOfDay(to).getTime(), now.getTime()));
    const branchId = query.branchId || null;

    const events = await this.auditRepo.find({
      where: {
        tenant_id: tenantId,
        action: In(['PRODUCT_SUSPENDED', 'PRODUCT_RESUMED', 'SALE_REFUSED']),
        occurred_at: Between(new Date(start.getTime() - LOOKBACK_DAYS * 24 * HOUR_MS), end),
      },
      order: { occurred_at: 'ASC' },
    });
    // At a branch, its own stops and head office's chain-wide ones count.
    const atBranch = (id: string | null | undefined) => !branchId || !id || id === branchId;

    // Stops as intervals, one per item and branch (and channel): a stop opens one, a resume
    // or another stop on the same thing closes it, and one left alone ends at its own time.
    const open = new Map<string, Interval>();
    const intervals: Interval[] = [];
    const close = (iv: Interval, at: Date, how: Interval['ended'], by: string | null = null) => {
      const planned = iv.planned_until;
      if (planned && planned <= at) {
        iv.to = planned;
        iv.ended = 'EXPIRED';
      } else {
        iv.to = at;
        iv.ended = how;
        iv.resumed_by = by;
      }
      open.delete(iv.key);
    };
    for (const ev of events.filter((e) => e.action !== 'SALE_REFUSED')) {
      const d = (ev.details || {}) as StopEvent;
      const stopBranch = d.branchId || ev.branch_id || null;
      if (!atBranch(stopBranch)) continue;
      const key = [d.product_id, d.variant_id, d.option_item_id, stopBranch, d.channel].map((v) => v || '').join('|');
      const held = open.get(key);
      if (ev.action === 'PRODUCT_RESUMED') {
        if (held) close(held, ev.occurred_at, 'RESUMED', ev.actor_id || null);
        continue;
      }
      if (held) close(held, ev.occurred_at, 'CHANGED');
      const iv: Interval = {
        key,
        product_id: d.product_id || null,
        variant_id: d.variant_id || null,
        option_item_id: d.option_item_id || null,
        branch_id: stopBranch,
        channel: d.channel || null,
        reason: d.reason || null,
        source: d.source || 'ADMIN',
        by: ev.actor_id || null,
        approver: d.approverId || null,
        from: ev.occurred_at,
        planned_until: d.suspendedUntil ? new Date(d.suspendedUntil) : null,
        to: null,
        ended: 'ONGOING',
        resumed_by: null,
      };
      open.set(key, iv);
      intervals.push(iv);
    }
    for (const iv of [...open.values()]) {
      if (iv.planned_until && iv.planned_until <= now) {
        iv.to = iv.planned_until;
        iv.ended = 'EXPIRED';
      }
    }
    const inRange = intervals.filter((iv) => iv.from <= end && (iv.to === null || iv.to >= start));
    const hoursIn = (iv: Interval) => {
      const a = Math.max(iv.from.getTime(), start.getTime());
      const b = Math.min((iv.to || end).getTime(), end.getTime());
      return Math.max(0, b - a) / HOUR_MS;
    };

    const refusals = events.filter((e) => e.action === 'SALE_REFUSED' && e.occurred_at >= start && e.occurred_at <= end && (!branchId || e.branch_id === branchId));

    // Names for everything mentioned.
    const productIds = new Set<string>();
    const variantIds = new Set<string>();
    const optionIds = new Set<string>();
    const userIds = new Set<string>();
    const branchIds = new Set<string>();
    for (const iv of inRange) {
      if (iv.product_id) productIds.add(iv.product_id);
      if (iv.variant_id) variantIds.add(iv.variant_id);
      if (iv.option_item_id) optionIds.add(iv.option_item_id);
      for (const u of [iv.by, iv.approver, iv.resumed_by]) if (u) userIds.add(u);
      if (iv.branch_id) branchIds.add(iv.branch_id);
    }
    for (const r of refusals) {
      if (r.details?.productId) productIds.add(r.details.productId);
      if (r.details?.variantId) variantIds.add(r.details.variantId);
      if (r.branch_id) branchIds.add(r.branch_id);
    }
    const byId = async <T extends { id: string }>(repo: Repository<T>, ids: Set<string>) =>
      new Map((ids.size ? await repo.find({ where: { tenant_id: tenantId, id: In([...ids]) } as any, withDeleted: true } as any) : []).map((r) => [r.id, r]));
    const [products, variants, options, branches] = await Promise.all([
      byId(this.productRepo, productIds),
      byId(this.variantRepo, variantIds),
      byId(this.optionRepo, optionIds),
      byId(this.branchRepo, branchIds),
    ]);
    const users = new Map(
      (userIds.size ? await this.auditRepo.manager.find(AdminUser, { where: { tenant_id: tenantId, id: In([...userIds]) } }) : []).map((u) => [u.id, u.display_name || u.username]),
    );
    const itemName = (productId: string | null, variantId: string | null, optionId: string | null) => {
      if (optionId) return options.get(optionId)?.name || '—';
      const product = productId ? products.get(productId)?.name || '—' : '—';
      return variantId ? `${product} — ${variants.get(variantId)?.name || '—'}` : product;
    };
    const itemKey = (productId: string | null, variantId: string | null, optionId: string | null) => `${productId || ''}|${variantId || ''}|${optionId || ''}`;
    const unitPrice = (productId: string | null, variantId: string | null) =>
      (variantId && variants.get(variantId)?.base_price) || (productId && products.get(productId)?.base_price) || '0';

    // Per item: how often and how long it was off, and what went unsold.
    const summary = new Map<string, { name: string; kind: 'PRODUCT' | 'SIZE' | 'ADDON'; stops: number; hours: number; refused: number; refused_quantity: number; estimated_lost: string }>();
    const row = (productId: string | null, variantId: string | null, optionId: string | null) => {
      const key = itemKey(productId, variantId, optionId);
      if (!summary.has(key)) {
        summary.set(key, {
          name: itemName(productId, variantId, optionId),
          kind: optionId ? 'ADDON' : variantId ? 'SIZE' : 'PRODUCT',
          stops: 0,
          hours: 0,
          refused: 0,
          refused_quantity: 0,
          estimated_lost: '0.0000',
        });
      }
      return summary.get(key)!;
    };
    for (const iv of inRange) {
      const r = row(iv.product_id, iv.variant_id, iv.option_item_id);
      r.stops++;
      r.hours += hoursIn(iv);
    }
    for (const ev of refusals) {
      const d = ev.details || {};
      const r = row(d.productId || null, d.variantId || null, null);
      const quantity = Number(d.quantity) || 1;
      r.refused++;
      r.refused_quantity += quantity;
      r.estimated_lost = MoneyUtil.add(r.estimated_lost, MoneyUtil.multiply(unitPrice(d.productId, d.variantId), String(quantity)));
    }

    const branchName = (id: string | null) => (id ? branches.get(id)?.name || '—' : null);
    const items = [...summary.values()]
      .map((r) => ({ ...r, hours: Math.round(r.hours * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours || b.refused - a.refused || a.name.localeCompare(b.name));
    return {
      from,
      to,
      branch_id: branchId,
      items,
      totals: {
        stops: inRange.length,
        hours: Math.round(inRange.reduce((sum, iv) => sum + hoursIn(iv), 0) * 10) / 10,
        refused: refusals.length,
        estimated_lost: items.reduce((sum, r) => MoneyUtil.add(sum, r.estimated_lost), '0.0000'),
      },
      stops: inRange
        .sort((a, b) => b.from.getTime() - a.from.getTime())
        .slice(0, 500)
        .map((iv) => ({
          item: itemName(iv.product_id, iv.variant_id, iv.option_item_id),
          branch: branchName(iv.branch_id),
          chain_wide: !iv.branch_id,
          channel: iv.channel,
          reason: iv.reason,
          source: iv.source,
          by: iv.by ? users.get(iv.by) || null : null,
          approver: iv.approver ? users.get(iv.approver) || null : null,
          from: iv.from,
          to: iv.to,
          planned_until: iv.planned_until,
          ended: iv.ended,
          resumed_by: iv.resumed_by ? users.get(iv.resumed_by) || null : null,
          hours: Math.round(hoursIn(iv) * 10) / 10,
        })),
    };
  }
}
