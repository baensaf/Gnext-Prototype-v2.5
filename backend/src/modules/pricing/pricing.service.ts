import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PriceEntry } from '../../entities/PriceEntry.entity';
import { PriceGroupBranch } from '../../entities/PriceGroupBranch.entity';
import { PriceBulkJob } from '../../entities/PriceBulkJob.entity';
import { Product } from '../../entities/Product.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { TransactionUtil } from '../../common/utils/transaction.util';
import { AppDataSource } from '../../data-source';

export interface PriceContext {
  productId: string;
  variantId?: string;
  modifierOptionId?: string;
  priceGroupId?: string;
  branchId?: string;
  channel?: string;
  orderType?: string;
  currencyCode?: string;
  evalTime?: Date;
}

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PriceEntry) private readonly entryRepo: Repository<PriceEntry>,
    @InjectRepository(PriceGroupBranch) private readonly pgbRepo: Repository<PriceGroupBranch>,
    @InjectRepository(PriceBulkJob) private readonly bulkJobRepo: Repository<PriceBulkJob>,
    @InjectRepository(Product) private readonly prodRepo: Repository<Product>,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
  ) {}

  async assignBranchToPriceGroup(tenantId: string, branchId: string, priceGroupId: string, correlationId: string) {
    let pgb = await this.pgbRepo.findOne({ where: { tenant_id: tenantId, branch_id: branchId } });
    if (!pgb) {
      pgb = this.pgbRepo.create({ tenant_id: tenantId, branch_id: branchId, price_group_id: priceGroupId });
    } else {
      pgb.price_group_id = priceGroupId;
    }
    const saved = await this.pgbRepo.save(pgb);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRICE_GROUP_BRANCH_ASSIGNED',
      correlationId,
      details: { branchId, priceGroupId },
    });
    return saved;
  }

  async resolvePrice(tenantId: string, context: PriceContext) {
    const evalTime = context.evalTime ? new Date(context.evalTime) : new Date();
    const currency = context.currencyCode || 'IRR';

    let resolvedGroupId = context.priceGroupId;
    if (!resolvedGroupId && context.branchId) {
      const pgb = await this.pgbRepo.findOne({ where: { tenant_id: tenantId, branch_id: context.branchId } });
      if (pgb) resolvedGroupId = pgb.price_group_id;
    }

    const qb = this.entryRepo.createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.product_id = :productId', { productId: context.productId })
      .andWhere('p.currency_code = :currency', { currency })
      .andWhere('p.effective_from <= :evalTime', { evalTime })
      .andWhere('(p.effective_to IS NULL OR p.effective_to > :evalTime)', { evalTime });

    if (context.modifierOptionId) {
      qb.andWhere('p.modifier_option_id = :modId', { modId: context.modifierOptionId });
    }

    const entries = await qb.getMany();

    if (entries.length === 0) {
      const product = await this.prodRepo.findOne({ where: { id: context.productId, tenant_id: tenantId } });
      if (!product) throw new NotFoundException('Product not found');
      return {
        amount: MoneyUtil.format(product.base_price),
        resolutionSource: 'BASE_PRICE',
        priceEntryId: null,
        isOverridden: false,
        effectiveFrom: null,
        effectiveTo: null,
      };
    }

    const scoreEntry = (e: PriceEntry): { score: number; isVariant: boolean } => {
      const isVariant = Boolean(context.variantId && e.variant_id === context.variantId);
      let score = 99; // default lowest rank

      if (e.branch_id === context.branchId && context.branchId) {
        if (e.channel === context.channel && context.channel && e.order_type === context.orderType && context.orderType) score = 1;
        else if (e.channel === context.channel && context.channel && !e.order_type) score = 2;
        else if (!e.channel && e.order_type === context.orderType && context.orderType) score = 3;
        else if (!e.channel && !e.order_type) score = 4;
      } else if (e.price_group_id === resolvedGroupId && resolvedGroupId) {
        if (e.channel === context.channel && context.channel && e.order_type === context.orderType && context.orderType) score = 5;
        else if (e.channel === context.channel && context.channel && !e.order_type) score = 6;
        else if (!e.channel && e.order_type === context.orderType && context.orderType) score = 7;
        else if (!e.channel && !e.order_type) score = 8;
      } else if (!e.branch_id && !e.price_group_id) {
        if (e.channel === context.channel && context.channel && e.order_type === context.orderType && context.orderType) score = 9;
        else if (e.channel === context.channel && context.channel && !e.order_type) score = 10;
        else if (e.price_type === 'DELIVERY' && (context.channel === 'DELIVERY' || context.orderType === 'DELIVERY')) score = 11;
        else if (e.price_type === 'BASE' || (!e.channel && !e.order_type)) score = 12;
      }

      return { score, isVariant };
    };

    entries.sort((a, b) => {
      const scoreA = scoreEntry(a);
      const scoreB = scoreEntry(b);

      if (scoreA.score !== scoreB.score) return scoreA.score - scoreB.score; // lower score wins (higher precedence)
      if (scoreA.isVariant !== scoreB.isVariant) return scoreA.isVariant ? -1 : 1; // variant beats product

      const timeA = new Date(a.effective_from).getTime();
      const timeB = new Date(b.effective_from).getTime();
      return timeB - timeA; // latest effective_from wins
    });

    const winning = entries[0];

    let resolutionSource = 'BASE_PRICE';
    if (winning.branch_id) resolutionSource = 'BRANCH';
    else if (winning.price_group_id) resolutionSource = 'PRICE_GROUP';
    else if (winning.channel) resolutionSource = 'CHANNEL';

    return {
      amount: MoneyUtil.format(winning.amount),
      resolutionSource,
      priceEntryId: winning.id,
      isOverridden: resolutionSource !== 'BASE_PRICE',
      effectiveFrom: winning.effective_from,
      effectiveTo: winning.effective_to,
    };
  }

  async createPriceEntry(tenantId: string, data: Partial<PriceEntry>, correlationId: string) {
    if (data.amount !== undefined) {
      const amt = Number(data.amount);
      if (isNaN(amt) || amt < 0) {
        throw new BadRequestException('Price amount must be a non-negative number');
      }
    }

    const effectiveFrom = data.effective_from ? new Date(data.effective_from) : new Date();
    const effectiveTo = data.effective_to ? new Date(data.effective_to) : null;

    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException('Price effective_to must be strictly later than effective_from');
    }

    // Check temporal overlap on identical target dimensions
    const qb = this.entryRepo.createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.product_id = :productId', { productId: data.product_id });

    if (data.variant_id) qb.andWhere('p.variant_id = :variantId', { variantId: data.variant_id });
    else qb.andWhere('p.variant_id IS NULL');

    if (data.modifier_option_id) qb.andWhere('p.modifier_option_id = :modId', { modId: data.modifier_option_id });
    else qb.andWhere('p.modifier_option_id IS NULL');

    if (data.price_group_id) qb.andWhere('p.price_group_id = :pgId', { pgId: data.price_group_id });
    else qb.andWhere('p.price_group_id IS NULL');

    if (data.branch_id) qb.andWhere('p.branch_id = :branchId', { branchId: data.branch_id });
    else qb.andWhere('p.branch_id IS NULL');

    if (data.channel) qb.andWhere('p.channel = :channel', { channel: data.channel });
    else qb.andWhere('p.channel IS NULL');

    if (data.order_type) qb.andWhere('p.order_type = :orderType', { orderType: data.order_type });
    else qb.andWhere('p.order_type IS NULL');

    qb.andWhere('p.currency_code = :currency', { currency: data.currency_code || 'IRR' });

    // Overlap condition
    if (effectiveTo) {
      qb.andWhere('p.effective_from < :effectiveTo AND (p.effective_to IS NULL OR p.effective_to > :effectiveFrom)', { effectiveFrom, effectiveTo });
    } else {
      qb.andWhere('(p.effective_to IS NULL OR p.effective_to > :effectiveFrom)', { effectiveFrom });
    }

    const overlapping = await qb.getMany();
    if (overlapping.length > 0) {
      throw new ConflictException(`Price entry overlaps with existing active range. (PRICE_RANGE_OVERLAP)`);
    }

    const entry = this.entryRepo.create({
      ...data,
      tenant_id: tenantId,
      currency_code: data.currency_code || 'IRR',
      amount: MoneyUtil.format(data.amount || '0'),
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
    });

    const saved = await this.entryRepo.save(entry);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRICE_ENTRY_CREATED',
      entityType: 'PriceEntry',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async bulkPreview(
    tenantId: string,
    params: { price_group_id?: string; branch_id?: string; category_id?: string; product_ids?: string[]; adjustment_type: 'PERCENTAGE' | 'FIXED' | 'SET'; amount: string; effective_from?: Date },
  ) {
    const numAmount = parseFloat(params.amount);
    if (isNaN(numAmount)) throw new BadRequestException('Invalid bulk adjustment amount');

    let products: Product[] = [];
    if (params.product_ids && params.product_ids.length > 0) {
      products = await this.prodRepo.find({ where: params.product_ids.map((id) => ({ id, tenant_id: tenantId })) });
    } else if (params.category_id) {
      products = await this.prodRepo.find({ where: { tenant_id: tenantId, category_id: params.category_id } });
    } else {
      products = await this.prodRepo.find({ where: { tenant_id: tenantId } });
    }

    const previewItems = [];
    for (const prod of products) {
      const resolved = await this.resolvePrice(tenantId, { productId: prod.id, branchId: params.branch_id, priceGroupId: params.price_group_id });
      const current = parseFloat(resolved.amount);
      let newPrice = current;

      if (params.adjustment_type === 'PERCENTAGE') {
        newPrice = current * (1 + numAmount / 100);
      } else if (params.adjustment_type === 'FIXED') {
        newPrice = current + numAmount;
      } else {
        newPrice = numAmount;
      }

      newPrice = Math.max(0, newPrice);
      previewItems.push({
        product_id: prod.id,
        product_name: prod.name,
        current_price: MoneyUtil.format(current.toString()),
        new_price: MoneyUtil.format(newPrice.toString()),
        effective_from: params.effective_from || new Date(),
      });
    }

    return { total: previewItems.length, items: previewItems };
  }

  async bulkCommit(
    tenantId: string,
    params: { price_group_id?: string; branch_id?: string; category_id?: string; product_ids?: string[]; adjustment_type: 'PERCENTAGE' | 'FIXED' | 'SET'; amount: string; effective_from?: Date },
    correlationId: string,
  ) {
    const preview = await this.bulkPreview(tenantId, params);
    const effectiveFrom = params.effective_from ? new Date(params.effective_from) : new Date();

    const ds = AppDataSource.isInitialized ? AppDataSource : this.dataSource;

    const result = await TransactionUtil.runInTransaction(ds, async (manager) => {
      const entryRepoTx = manager.getRepository(PriceEntry);

      for (const item of preview.items) {
        await entryRepoTx.createQueryBuilder()
          .update(PriceEntry)
          .set({ effective_to: effectiveFrom })
          .where('tenant_id = :tenantId', { tenantId })
          .andWhere('product_id = :productId', { productId: item.product_id })
          .andWhere('(effective_to IS NULL OR effective_to > :effectiveFrom)', { effectiveFrom })
          .andWhere('effective_from < :effectiveFrom', { effectiveFrom })
          .execute();

        const newEntry = entryRepoTx.create({
          tenant_id: tenantId,
          product_id: item.product_id,
          branch_id: params.branch_id || null,
          price_group_id: params.price_group_id || null,
          price_type: params.branch_id ? 'OVERRIDE' : params.price_group_id ? 'OVERRIDE' : 'BASE',
          currency_code: 'IRR',
          amount: item.new_price,
          effective_from: effectiveFrom,
        });

        await entryRepoTx.save(newEntry);
      }

      const jobRepoTx = manager.getRepository(PriceBulkJob);
      const job = jobRepoTx.create({
        tenant_id: tenantId,
        status: 'COMPLETED',
        params,
        affected_rows: preview.items.length,
      });
      return await jobRepoTx.save(job);
    });

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRICE_BULK_COMMITTED',
      correlationId,
      details: { affectedRows: preview.items.length, jobId: result.id },
    });

    return { success: true, updated_count: preview.items.length, affected_rows: preview.items.length, job_id: result.id };
  }
}
