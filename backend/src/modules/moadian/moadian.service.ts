import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { TaxInvoice } from '../../entities/TaxInvoice.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Refund } from '../../entities/Refund.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import {
  InvoiceSource,
  MoadianLine,
  MoadianSettings,
  MoadianSubject,
  buildInvoice,
  buildInvoiceLines,
  generateTaxId,
  moadianSetupProblem,
  resolveMoadianSettings,
  simulatedRejection,
} from '../../common/utils/moadian.util';

/** How often invoices are sent and answered in the background. */
const SWEEP_MS = 10000;
/** How long the simulated tax office keeps an invoice PENDING before answering. */
const VERDICT_DELAY_MS = 8000;

function sourceFromOrder(order: OrderHeader): InvoiceSource {
  return {
    items: (order.items || [])
      .filter((item) => !['VOID', 'REPLACED'].includes(item.state))
      .map((item) => {
        const parts = Number(item.base_total || 0) + Number(item.modifier_total || 0) + Number(item.packaging_total || 0);
        return {
          name: [item.product_name, item.variant_name].filter(Boolean).join(' - ') || 'کالا',
          quantity: item.quantity,
          gross: parts > 0 ? parts : Number(item.unit_price || 0) * Number(item.quantity || 1),
        };
      }),
    discountTotal: Number(order.discount_total || 0),
    taxTotal: Number(order.tax_total || 0),
    deliveryFee: Number(order.delivery_fee || 0),
  };
}

/**
 * Issues Moadian e-invoices for completed sales and simulates the tax office's side:
 * invoices are queued, "sent", held PENDING for a few seconds, then accepted or rejected
 * at the configured rate. A cancelled or fully refunded order gets a cancellation invoice,
 * a partial refund a return invoice, both only once the original was accepted.
 */
@Injectable()
export class MoadianService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MoadianService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    @InjectRepository(TaxInvoice) private readonly invoiceRepo: Repository<TaxInvoice>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(Refund) private readonly refundRepo: Repository<Refund>,
    @InjectRepository(TenantSetting) private readonly settingRepo: Repository<TenantSetting>,
  ) {}

  async settingsFor(tenantId: string): Promise<MoadianSettings> {
    const rows = await this.settingRepo.find({ where: { tenant_id: tenantId, key: 'MOADIAN' } });
    return resolveMoadianSettings(pickSettingValue(rows, null));
  }

  async listInvoices(tenantId: string, filters: { status?: string; branchId?: string; orderId?: string }) {
    const scoped = () => {
      const qb = this.invoiceRepo.createQueryBuilder('t').where('t.tenant_id = :tenantId', { tenantId });
      if (filters.branchId) qb.andWhere('t.branch_id = :branchId', { branchId: filters.branchId });
      if (filters.orderId) qb.andWhere('t.order_id = :orderId', { orderId: filters.orderId });
      return qb;
    };
    const list = scoped();
    if (filters.status) list.andWhere('t.status = :status', { status: filters.status });
    const items = await list.orderBy('t.created_at', 'DESC').take(300).getMany();
    const rows = await scoped().select('t.status', 'status').addSelect('COUNT(*)', 'count').groupBy('t.status').getRawMany();
    const counts: Record<string, number> = { QUEUED: 0, PENDING: 0, SUCCESS: 0, FAILED: 0 };
    rows.forEach((row) => (counts[row.status] = Number(row.count)));
    return { items, counts };
  }

  /** Issue the original invoice for one order by hand, e.g. a sale from before e-invoicing was on. */
  async issueForOrder(tenantId: string, orderId: string): Promise<TaxInvoice> {
    const settings = await this.readySettings(tenantId);
    const order = await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId }, relations: ['items'] });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.state !== 'COMPLETED') throw new BadRequestException('Only a completed order gets a tax invoice');
    if (Number(order.outstanding_total || 0) > 0) throw new BadRequestException('The order is not fully paid yet');

    const existing = await this.invoiceRepo.findOne({ where: { tenant_id: tenantId, order_id: orderId, subject: 1 } });
    if (existing) return existing;
    return await this.queueOriginal(order, settings);
  }

  /** A rejected invoice goes back in the queue with the same tax ID, as the tax office allows. */
  async retry(tenantId: string, invoiceId: string): Promise<TaxInvoice> {
    await this.readySettings(tenantId);
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId, tenant_id: tenantId } });
    if (!invoice) throw new NotFoundException(`Tax invoice ${invoiceId} not found`);
    if (invoice.status !== 'FAILED') throw new BadRequestException('Only a rejected invoice can be sent again');
    invoice.status = 'QUEUED';
    return await this.invoiceRepo.save(invoice);
  }

  /**
   * One pass for a tenant: find what needs invoicing, send the queue, collect verdicts.
   * `force` answers pending invoices straight away instead of after the simulated delay.
   */
  async processTenant(tenantId: string, options: { force?: boolean; now?: Date } = {}) {
    const now = options.now ?? new Date();
    const settings = await this.settingsFor(tenantId);
    if (moadianSetupProblem(settings)) return { queued: 0, sent: 0, answered: 0 };

    const queued = await this.discover(tenantId, settings);
    const sent = await this.send(tenantId, now);
    const answered = await this.answer(tenantId, settings, now, options.force === true);
    return { queued, sent, answered };
  }

  private async readySettings(tenantId: string): Promise<MoadianSettings> {
    const settings = await this.settingsFor(tenantId);
    const problem = moadianSetupProblem(settings);
    if (problem) throw new BadRequestException(problem);
    return settings;
  }

  private async discover(tenantId: string, settings: MoadianSettings): Promise<number> {
    let queued = 0;

    if (settings.enabledAt) {
      const due: { id: string }[] = await this.orderRepo.query(
        `SELECT o.id FROM order_header o
          WHERE o.tenant_id = $1 AND o.state = 'COMPLETED' AND o.deleted_at IS NULL
            AND COALESCE(o.outstanding_total, 0) <= 0
            AND COALESCE(o.completed_at, o.updated_at) >= $2
            AND NOT EXISTS (SELECT 1 FROM tax_invoice t WHERE t.order_id = o.id AND t.subject = 1)
          ORDER BY COALESCE(o.completed_at, o.updated_at) LIMIT 50`,
        [tenantId, settings.enabledAt],
      );
      const orders = due.length
        ? await this.orderRepo.find({ where: { id: In(due.map((row) => row.id)) }, relations: ['items'] })
        : [];
      for (const order of orders) {
        await this.queueOriginal(order, settings);
        queued += 1;
      }
    }

    // Cancellations run before returns, so a fully refunded order is cancelled once rather
    // than returned refund by refund.
    const toCancel: { id: string }[] = await this.invoiceRepo.query(
      `SELECT t.id FROM tax_invoice t JOIN order_header o ON o.id = t.order_id
        WHERE t.tenant_id = $1 AND t.subject = 1 AND t.status = 'SUCCESS'
          AND (o.state = 'CANCELLED' OR (COALESCE(o.refunded_total, 0) > 0 AND o.refunded_total >= o.grand_total))
          AND NOT EXISTS (SELECT 1 FROM tax_invoice c WHERE c.order_id = t.order_id AND c.subject = 3)
        LIMIT 50`,
      [tenantId],
    );
    for (const row of toCancel) {
      const original = await this.invoiceRepo.findOneByOrFail({ id: row.id });
      await this.queue({
        tenantId,
        branchId: original.branch_id,
        orderId: original.order_id,
        orderNumber: original.order_number,
        subject: 3,
        issuedAt: new Date(),
        lines: original.payload.body,
        settings,
        reference: original,
      });
      queued += 1;
    }

    const toReturn: { refund_id: string; original_id: string }[] = await this.refundRepo.query(
      `SELECT r.id AS refund_id, t.id AS original_id FROM refund r
         JOIN order_header o ON o.id = r.order_id
         JOIN tax_invoice t ON t.order_id = r.order_id AND t.subject = 1 AND t.status = 'SUCCESS'
        WHERE r.tenant_id = $1 AND r.status = 'SUCCEEDED'
          AND o.state <> 'CANCELLED' AND COALESCE(o.refunded_total, 0) < o.grand_total
          AND NOT EXISTS (SELECT 1 FROM tax_invoice x WHERE x.refund_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM tax_invoice c WHERE c.order_id = r.order_id AND c.subject = 3)
        LIMIT 50`,
      [tenantId],
    );
    for (const row of toReturn) {
      const original = await this.invoiceRepo.findOneByOrFail({ id: row.original_id });
      const refund = await this.refundRepo.findOneByOrFail({ id: row.refund_id });
      const order = await this.orderRepo.findOne({ where: { id: original.order_id }, relations: ['items'] });
      const grandTotal = Number(order?.grand_total || 0);
      const refunded = Number(refund.amount || 0);
      if (!order || grandTotal <= 0) continue;
      await this.queue({
        tenantId,
        branchId: original.branch_id,
        orderId: original.order_id,
        orderNumber: original.order_number,
        refundId: refund.id,
        subject: 4,
        issuedAt: new Date(refund.posted_at || Date.now()),
        lines: buildInvoiceLines(sourceFromOrder(order), settings, refunded / grandTotal),
        settings,
        reference: original,
      });
      queued += 1;
    }

    return queued;
  }

  private async queueOriginal(order: OrderHeader, settings: MoadianSettings): Promise<TaxInvoice> {
    return await this.queue({
      tenantId: order.tenant_id,
      branchId: order.branch_id,
      orderId: order.id,
      orderNumber: order.order_number,
      subject: 1,
      issuedAt: new Date(order.completed_at || order.updated_at || Date.now()),
      lines: buildInvoiceLines(sourceFromOrder(order), settings),
      settings,
    });
  }

  private async queue(args: {
    tenantId: string;
    branchId: string | null;
    orderId: string;
    orderNumber: string | null;
    refundId?: string;
    subject: MoadianSubject;
    issuedAt: Date;
    lines: MoadianLine[];
    settings: MoadianSettings;
    reference?: TaxInvoice;
  }): Promise<TaxInvoice> {
    const max = await this.invoiceRepo
      .createQueryBuilder('t')
      .select('COALESCE(MAX(t.serial), 0)', 'max')
      .where('t.tenant_id = :tenantId', { tenantId: args.tenantId })
      .getRawOne();
    const serial = Number(max?.max || 0) + 1;
    const taxId = generateTaxId(args.settings.memoryId, args.issuedAt, serial);
    const payload = buildInvoice({
      taxId,
      serial,
      issuedAt: args.issuedAt,
      subject: args.subject,
      referenceTaxId: args.reference?.tax_id ?? null,
      sellerTaxId: args.settings.economicCode,
      lines: args.lines,
    });

    return await this.invoiceRepo.save(
      this.invoiceRepo.create({
        tenant_id: args.tenantId,
        branch_id: args.branchId,
        order_id: args.orderId,
        order_number: args.orderNumber,
        refund_id: args.refundId ?? null,
        subject: args.subject,
        tax_id: taxId,
        serial,
        reference_tax_id: args.reference?.tax_id ?? null,
        status: 'QUEUED',
        total_amount: String(payload.header.tbill),
        vat_amount: String(payload.header.tvam),
        payload,
        issued_at: args.issuedAt,
      }),
    );
  }

  private async send(tenantId: string, now: Date): Promise<number> {
    const queued = await this.invoiceRepo.find({
      where: { tenant_id: tenantId, status: 'QUEUED' },
      order: { created_at: 'ASC' },
      take: 100,
    });
    for (const invoice of queued) {
      invoice.status = 'PENDING';
      invoice.reference_number = randomUUID();
      invoice.sent_at = now;
      invoice.attempts += 1;
      invoice.errors = null;
    }
    await this.invoiceRepo.save(queued);
    return queued.length;
  }

  private async answer(tenantId: string, settings: MoadianSettings, now: Date, force: boolean): Promise<number> {
    const pending = await this.invoiceRepo.find({ where: { tenant_id: tenantId, status: 'PENDING' }, take: 100 });
    const due = pending.filter(
      (invoice) => force || !invoice.sent_at || now.getTime() - new Date(invoice.sent_at).getTime() >= VERDICT_DELAY_MS,
    );
    for (const invoice of due) {
      const rejected = Math.random() * 100 < settings.rejectionRate;
      invoice.status = rejected ? 'FAILED' : 'SUCCESS';
      invoice.errors = rejected ? [simulatedRejection(invoice.subject as MoadianSubject)] : null;
      invoice.resolved_at = now;
    }
    await this.invoiceRepo.save(due);
    return due.length;
  }

  onApplicationBootstrap() {
    // Tests drive processTenant themselves, and a live timer would keep Jest from exiting.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const rows = await this.settingRepo.find({ where: { key: 'MOADIAN' } });
      const tenants = new Set(rows.filter((row) => !row.branch_id && row.value?.enabled === true).map((row) => row.tenant_id));
      for (const tenantId of tenants) await this.processTenant(tenantId);
    } catch (err) {
      this.logger.error(`Moadian sweep failed: ${(err as Error)?.message}`);
    } finally {
      this.sweeping = false;
    }
  }
}
