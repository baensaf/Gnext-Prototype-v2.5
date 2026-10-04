import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { ItemDiscount } from '../../entities/ItemDiscount.entity';
import { Product } from '../../entities/Product.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { MoneyUtil } from '../../common/utils/money.util';

export interface ItemDiscountInput {
  product_id: string;
  percent: string | number;
  starts_on: string;
  ends_on?: string | null;
  note?: string | null;
}

/** The discount a product gets on one business day. */
export interface ActiveItemDiscount {
  id: string;
  percent: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Automatic item discounts (V1, 2026-10-03): a dated percent off one product, applied to every
 * POS line of it at every branch. Head office sets them up; the quote engine asks
 * `activeFor` which apply on the branch's business day. One product has at most one discount
 * on any day, so overlapping periods are refused rather than resolved.
 */
@Injectable()
export class ItemDiscountsService {
  constructor(
    @InjectRepository(ItemDiscount) private readonly repo: Repository<ItemDiscount>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    private readonly auditWriter: AuditWriter,
  ) {}

  /** Every item discount with its product's name, newest start first. */
  async list(tenantId: string) {
    const rows = await this.repo.find({ where: { tenant_id: tenantId }, order: { starts_on: 'DESC', created_at: 'DESC' } });
    const products = rows.length
      ? await this.productRepo.find({ where: { tenant_id: tenantId, id: In([...new Set(rows.map((r) => r.product_id))]) }, withDeleted: true })
      : [];
    const nameOf = new Map(products.map((p) => [p.id, p.name]));
    return rows.map((r) => ({ ...r, product_name: nameOf.get(r.product_id) || null }));
  }

  async create(tenantId: string, input: ItemDiscountInput, actorId?: string, correlationId?: string) {
    const data = await this.validate(tenantId, input);
    await this.refuseOverlap(tenantId, data.product_id, data.starts_on, data.ends_on, null);
    const saved = await this.repo.save(this.repo.create({ tenant_id: tenantId, ...data, created_by: actorId || null }));
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', actorId, action: 'ITEM_DISCOUNT_CREATED', entityType: 'ItemDiscount', entityId: saved.id, correlationId, afterData: saved });
    return saved;
  }

  async update(tenantId: string, id: string, input: Partial<ItemDiscountInput>, actorId?: string, correlationId?: string) {
    const row = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!row) throw new NotFoundException('Item discount not found');
    const before = { ...row };
    const data = await this.validate(tenantId, {
      product_id: input.product_id ?? row.product_id,
      percent: input.percent ?? row.percent,
      starts_on: input.starts_on ?? row.starts_on,
      ends_on: input.ends_on !== undefined ? input.ends_on : row.ends_on,
      note: input.note !== undefined ? input.note : row.note,
    });
    await this.refuseOverlap(tenantId, data.product_id, data.starts_on, data.ends_on, id);
    Object.assign(row, data);
    const saved = await this.repo.save(row);
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', actorId, action: 'ITEM_DISCOUNT_UPDATED', entityType: 'ItemDiscount', entityId: id, correlationId, beforeData: before, afterData: saved });
    return saved;
  }

  /** Removes a discount. Orders already priced keep the percent their lines were given. */
  async remove(tenantId: string, id: string, actorId?: string, correlationId?: string) {
    const row = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!row) throw new NotFoundException('Item discount not found');
    await this.repo.delete({ id, tenant_id: tenantId });
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', actorId, action: 'ITEM_DISCOUNT_DELETED', entityType: 'ItemDiscount', entityId: id, correlationId, beforeData: row });
    return { success: true };
  }

  /**
   * The discount each product gets on the branch's business day (the day turns at the chain's
   * cutoff, so a sale at 01:00 belongs to the day before). Products with none are absent.
   */
  async activeFor(tenantId: string, branchId: string | null | undefined, productIds: string[], em?: EntityManager) {
    const out = new Map<string, ActiveItemDiscount>();
    const ids = [...new Set(productIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id || '')))];
    if (!ids.length) return out;
    const manager = em || this.repo.manager;
    const today = (await loadBusinessClock(manager, tenantId, branchId || null)).today();
    const rows = await manager.find(ItemDiscount, {
      where: [
        { tenant_id: tenantId, product_id: In(ids), starts_on: LessThanOrEqual(today), ends_on: IsNull() },
        { tenant_id: tenantId, product_id: In(ids), starts_on: LessThanOrEqual(today), ends_on: MoreThanOrEqual(today) },
      ],
    });
    for (const r of rows) out.set(r.product_id, { id: r.id, percent: MoneyUtil.format(r.percent, 2) });
    return out;
  }

  private async validate(tenantId: string, input: ItemDiscountInput) {
    const refuse = (code: string, message: string) => new BadRequestException({ statusCode: 400, code, message });
    const product = input.product_id ? await this.productRepo.findOne({ where: { id: input.product_id, tenant_id: tenantId } }) : null;
    if (!product) throw refuse('ITEM_DISCOUNT_PRODUCT', 'Pick the item the discount is for');
    const percent = Number(input.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw refuse('ITEM_DISCOUNT_PERCENT', 'A discount is more than 0% and at most 100%');
    const startsOn = String(input.starts_on || '').slice(0, 10);
    if (!DATE.test(startsOn)) throw refuse('ITEM_DISCOUNT_DATES', 'Pick the first day of the discount');
    const endsOn = input.ends_on ? String(input.ends_on).slice(0, 10) : null;
    if (endsOn && (!DATE.test(endsOn) || endsOn < startsOn)) throw refuse('ITEM_DISCOUNT_DATES', 'The last day is on or after the first day');
    return {
      product_id: product.id,
      percent: percent.toFixed(2),
      starts_on: startsOn,
      ends_on: endsOn,
      note: String(input.note || '').trim().slice(0, 160) || null,
    };
  }

  /** One product has at most one discount on any day. */
  private async refuseOverlap(tenantId: string, productId: string, startsOn: string, endsOn: string | null, exceptId: string | null) {
    const others = (await this.repo.find({ where: { tenant_id: tenantId, product_id: productId } })).filter((r) => r.id !== exceptId);
    const clash = others.find((r) => (r.ends_on === null || r.ends_on >= startsOn) && (endsOn === null || r.starts_on <= endsOn));
    if (clash) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ITEM_DISCOUNT_OVERLAP',
        message: `This item already has a ${Number(clash.percent)}% discount from ${clash.starts_on}${clash.ends_on ? ` to ${clash.ends_on}` : ''}`,
        discountId: clash.id,
      });
    }
  }
}
