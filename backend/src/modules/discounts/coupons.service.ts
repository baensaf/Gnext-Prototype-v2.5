import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Coupon } from '../../entities/Coupon.entity';
import { CouponBatch, CouponReward } from '../../entities/CouponBatch.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { toWesternDigits } from '../customer/customer.service';
import { AuditWriter } from '../audit/audit-writer.service';

/** No 0/O, 1/I/L: a code read out over the phone or typed from an SMS comes out right. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const MAX_CODES = 5000;

export interface CouponBatchInput {
  name: string;
  reward_type: CouponReward;
  percent?: string | null;
  max_discount?: string | null;
  reward_product_id?: string | null;
  min_subtotal?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  count: number;
}

/** Why a code does not work on this order; the till shows it in the cashier's words. */
export type CouponRefusal = 'UNKNOWN' | 'USED' | 'OFF' | 'NOT_YET' | 'EXPIRED' | 'BELOW_MINIMUM' | 'ITEM_MISSING';

export type CouponCheck =
  | { ok: true; coupon: Coupon; batch: CouponBatch }
  | { ok: false; reason: CouponRefusal; batch?: CouponBatch };

/** A typed code as stored: upper case, Latin digits, no spaces or dashes. */
export const normaliseCouponCode = (raw: string) => toWesternDigits(String(raw || '')).toUpperCase().replace(/[\s-]/g, '');

@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(Coupon) private readonly couponRepo: Repository<Coupon>,
    @InjectRepository(CouponBatch) private readonly batchRepo: Repository<CouponBatch>,
    private readonly dataSource: DataSource,
    private readonly auditWriter: AuditWriter,
  ) {}

  /** The batches, newest first, each with how many of its codes were used. */
  async listBatches(tenantId: string) {
    return await this.batchRepo.query(
      `SELECT b.*, (SELECT COUNT(*) FROM coupon c WHERE c.batch_id = b.id AND c.used_at IS NOT NULL)::int AS used_count
         FROM coupon_batch b
        WHERE b.tenant_id = $1
        ORDER BY b.created_at DESC`,
      [tenantId],
    );
  }

  /** One batch's codes, with the order each used code went on. */
  async listCodes(tenantId: string, batchId: string) {
    const batch = await this.batchRepo.findOne({ where: { id: batchId, tenant_id: tenantId } });
    if (!batch) throw new NotFoundException('Coupon batch not found');
    const codes = await this.couponRepo.query(
      `SELECT c.code, c.used_at, o.order_number AS used_order_number, b.name AS used_branch_name
         FROM coupon c
         LEFT JOIN order_header o ON o.id = c.used_order_id
         LEFT JOIN branch b ON b.id = c.used_branch_id
        WHERE c.tenant_id = $1 AND c.batch_id = $2
        ORDER BY c.used_at DESC NULLS LAST, c.code ASC`,
      [tenantId, batchId],
    );
    return { batch, codes };
  }

  async createBatch(tenantId: string, input: CouponBatchInput, userId?: string, correlationId?: string) {
    const name = String(input.name || '').trim();
    if (!name) throw new BadRequestException('A batch needs a name');
    const count = Math.floor(Number(input.count));
    if (!(count >= 1 && count <= MAX_CODES)) throw new BadRequestException(`A batch makes 1 to ${MAX_CODES} codes`);
    if (input.reward_type === 'PERCENT') {
      const pct = MoneyUtil.format(input.percent || '0', 2);
      if (!MoneyUtil.greaterThan(pct, '0') || MoneyUtil.greaterThan(pct, '100')) {
        throw new BadRequestException('The percent must be more than 0 and at most 100');
      }
    } else if (input.reward_type === 'FREE_ITEM') {
      if (!input.reward_product_id) throw new BadRequestException('A free-item coupon names the product it gives');
    } else {
      throw new BadRequestException('A coupon gives a percent off or a free item');
    }
    if (input.valid_from && input.valid_to && input.valid_from > input.valid_to) {
      throw new BadRequestException('The first day comes after the last day');
    }

    return await this.dataSource.transaction(async (em) => {
      const batch = await em.save(
        CouponBatch,
        em.create(CouponBatch, {
          tenant_id: tenantId,
          name,
          reward_type: input.reward_type,
          percent: input.reward_type === 'PERCENT' ? MoneyUtil.format(input.percent!, 2) : null,
          max_discount: input.reward_type === 'PERCENT' && input.max_discount ? MoneyUtil.format(input.max_discount) : null,
          reward_product_id: input.reward_type === 'FREE_ITEM' ? input.reward_product_id! : null,
          min_subtotal: input.min_subtotal ? MoneyUtil.format(input.min_subtotal) : null,
          valid_from: input.valid_from || null,
          valid_to: input.valid_to || null,
          code_count: count,
          created_by: userId || null,
        }),
      );

      // Random codes; one that clashes with an existing code is skipped and made again.
      let made = 0;
      while (made < count) {
        const want = count - made;
        const codes = Array.from({ length: want }, () => randomCode());
        const rows: { id: string }[] = await em.query(
          `INSERT INTO coupon (tenant_id, batch_id, code)
           SELECT $1, $2, unnest($3::varchar[])
           ON CONFLICT (tenant_id, code) DO NOTHING
           RETURNING id`,
          [tenantId, batch.id, codes],
        );
        made += rows.length;
      }

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'COUPON_BATCH_CREATED',
        entityType: 'CouponBatch',
        entityId: batch.id,
        correlationId: correlationId || 'system',
        afterData: batch,
      });
      return batch;
    });
  }

  async setActive(tenantId: string, batchId: string, isActive: boolean, userId?: string, correlationId?: string) {
    const batch = await this.batchRepo.findOne({ where: { id: batchId, tenant_id: tenantId } });
    if (!batch) throw new NotFoundException('Coupon batch not found');
    batch.is_active = !!isActive;
    const saved = await this.batchRepo.save(batch);
    await this.auditWriter.write({
      tenantId,
      actorType: userId ? 'ADMIN' : 'SYSTEM',
      actorId: userId,
      action: isActive ? 'COUPON_BATCH_ON' : 'COUPON_BATCH_OFF',
      entityType: 'CouponBatch',
      entityId: batchId,
      correlationId: correlationId || 'system',
    });
    return saved;
  }

  /**
   * Whether a code works on an order now: known, not used, its batch on and in its days,
   * the order big enough, and a free item's product on it. Reads only; the code is taken
   * when the order is sent.
   */
  async check(
    tenantId: string,
    rawCode: string,
    order: { branchId?: string; subtotal: string; productIds: string[] },
    em?: EntityManager,
  ): Promise<CouponCheck> {
    const code = normaliseCouponCode(rawCode);
    const manager = em ?? this.dataSource.manager;
    const coupon = code ? await manager.findOne(Coupon, { where: { tenant_id: tenantId, code } }) : null;
    if (!coupon) return { ok: false, reason: 'UNKNOWN' };
    const batch = await manager.findOne(CouponBatch, { where: { id: coupon.batch_id, tenant_id: tenantId } });
    if (!batch) return { ok: false, reason: 'UNKNOWN' };
    if (coupon.used_at) return { ok: false, reason: 'USED', batch };
    if (!batch.is_active) return { ok: false, reason: 'OFF', batch };
    const today = (await loadBusinessClock(manager, tenantId, order.branchId)).today();
    if (batch.valid_from && today < batch.valid_from) return { ok: false, reason: 'NOT_YET', batch };
    if (batch.valid_to && today > batch.valid_to) return { ok: false, reason: 'EXPIRED', batch };
    if (batch.min_subtotal && MoneyUtil.lessThan(order.subtotal, batch.min_subtotal)) {
      return { ok: false, reason: 'BELOW_MINIMUM', batch };
    }
    if (batch.reward_type === 'FREE_ITEM' && !order.productIds.includes(batch.reward_product_id!)) {
      return { ok: false, reason: 'ITEM_MISSING', batch };
    }
    return { ok: true, coupon, batch };
  }

  /** Takes the code for the order, under a row lock so two tills cannot both use it. */
  async redeem(em: EntityManager, tenantId: string, rawCode: string, orderId: string, branchId: string | null) {
    const code = normaliseCouponCode(rawCode);
    const coupon = await em.findOne(Coupon, { where: { tenant_id: tenantId, code }, lock: { mode: 'pessimistic_write' } });
    if (!coupon) throw new NotFoundException({ code: 'COUPON_REFUSED', reason: 'UNKNOWN', message: 'No such coupon code' });
    if (coupon.used_at && coupon.used_order_id !== orderId) {
      throw new ConflictException({ code: 'COUPON_REFUSED', reason: 'USED', message: 'This coupon code was already used' });
    }
    coupon.used_at = coupon.used_at ?? new Date();
    coupon.used_order_id = orderId;
    coupon.used_branch_id = branchId;
    return await em.save(Coupon, coupon);
  }

  /** A cancelled order gives its code back, so the customer can use it again. */
  async releaseForOrder(tenantId: string, orderId: string, em?: EntityManager) {
    await (em ?? this.dataSource.manager).query(
      `UPDATE coupon SET used_at = NULL, used_order_id = NULL, used_branch_id = NULL
        WHERE tenant_id = $1 AND used_order_id = $2`,
      [tenantId, orderId],
    );
  }
}

function randomCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}
