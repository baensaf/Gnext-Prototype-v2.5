import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { UserScope, isHeadOfficeUser } from '../../common/utils/user-scope.util';

/**
 * Reports that answer a question about the chain rather than about a location. A branch
 * manager reading these would be reading their neighbours' numbers.
 */
const CHAIN_ONLY_REPORTS = ['snappfood-reconciliation'];
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Payment } from '../../entities/Payment.entity';
import { Refund } from '../../entities/Refund.entity';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { CreditEntry } from '../../entities/CreditEntry.entity';
import { OrderAdjustment } from '../../entities/OrderAdjustment.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { Branch } from '../../entities/Branch.entity';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { MoneyUtil } from '../../common/utils/money.util';
import {
  BusinessDateUtil,
  BUSINESS_TIME_ZONE,
  ORDER_BUSINESS_DATE_EXPR,
  REFUND_BUSINESS_DATE_EXPR,
  NON_REVENUE_ORDER_STATES,
  REVENUE_ORDER_PREDICATE,
} from '../../common/utils/business-date.util';

/**
 * The business date a row was stamped with, or for a row written before stamping existed, the
 * date it has always been reported under (its timestamp's calendar date on the chain's clock).
 */
function storedDate(row: { business_date?: string | null }, at?: Date | string | null): string {
  return row?.business_date || BusinessDateUtil.fromDate(at) || '—';
}

/** What every report returns: its rows, and the totals row keyed by column. */
export interface ReportResult {
  report_code: string;
  filter_basis?: string;
  rows: any[];
  summary_totals: Record<string, any>;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Refund) private readonly refundRepo: Repository<Refund>,
    @InjectRepository(IntegrationLog) private readonly integrationLogRepo: Repository<IntegrationLog>,
    @InjectRepository(CashierShift) private readonly cashierShiftRepo: Repository<CashierShift>,
    @InjectRepository(CourierSettlement) private readonly settlementRepo: Repository<CourierSettlement>,
    @InjectRepository(CreditEntry) private readonly creditEntryRepo: Repository<CreditEntry>,
    @InjectRepository(OrderAdjustment) private readonly adjustmentRepo: Repository<OrderAdjustment>,
  ) {}

  /**
   * The picker on the reports screen is built from this, so it has to answer the same way
   * queryReport does. Offering a branch manager a report the run then refuses is a dead end
   * dressed up as a menu item.
   */
  async getCatalog(actor?: UserScope) {
    const catalog = [
      { code: 'sales-summary', name: 'Sales Summary', category: 'FINANCIAL' },
      { code: 'product-sales', name: 'Product & Category Velocity', category: 'CATALOG' },
      { code: 'payments-by-method', name: 'Payment Methods & Allocations', category: 'PAYMENT' },
      { code: 'discounts', name: 'Discounts Given (Manual, Customer Rate)', category: 'PROMOTION' },
      { code: 'cashier-shifts', name: 'Cashier Shifts & EOD Balancing', category: 'CASH' },
      { code: 'customer-credit', name: 'Customer Credit Ledger', category: 'CREDIT' },
      { code: 'aggregator-orders', name: 'Aggregator Orders & Integration Notes', category: 'INTEGRATION' },
      { code: 'snappfood-reconciliation', name: 'Snappfood Webhook Reconciliation', category: 'INTEGRATION' },
      { code: 'courier-settlements', name: 'Courier Cash & POS Settlements', category: 'DELIVERY' },
      { code: 'tax', name: 'Tax', category: 'TAX' },
      { code: 'sales-by-day', name: 'Sales by Day', category: 'FINANCIAL' },
      { code: 'sales-by-hour', name: 'Sales by Hour', category: 'FINANCIAL' },
      { code: 'sales-by-channel', name: 'Sales by Channel & Order Type', category: 'FINANCIAL' },
      { code: 'sales-by-employee', name: 'Sales by Employee', category: 'STAFF' },
      { code: 'voids-cancellations', name: 'Voids & Cancellations', category: 'LOSS' },
    ];
    if (actor && !isHeadOfficeUser(actor)) {
      return catalog.filter((report) => !CHAIN_ONLY_REPORTS.includes(report.code));
    }
    return catalog;
  }

  /**
   * Filters orders on the operating day they belong to, matching how BusinessDayService
   * aggregates. Falls back to the placement timestamp's local date for orders written
   * before business_date was stamped at submit, so a report and a day close never
   * disagree about which day an order landed in.
   */
  private applyBusinessDateFilter(query: any, alias: string, startDate?: string, endDate?: string) {
    const expr = ORDER_BUSINESS_DATE_EXPR(alias);
    if (startDate) query.andWhere(`${expr} >= :bdStart`, { bdStart: startDate });
    if (endDate) query.andWhere(`${expr} <= :bdEnd`, { bdEnd: endDate });
  }

  /**
   * Confines a query to one branch's orders.
   *
   * Payments, refunds, discounts and line items carry no branch column — they belong to an
   * order, and the order belongs to a branch. A subquery keeps that one hop in SQL rather
   * than reading every order into memory to find out which ids to allow.
   *
   * No branch means head office, which reads the chain.
   */
  private applyBranchViaOrder(qb: SelectQueryBuilder<any>, alias: string, branchId?: string) {
    if (!branchId) return;
    qb.andWhere(
      `${alias}.order_id IN (SELECT scoped_o.id FROM order_header scoped_o WHERE scoped_o.branch_id = :scopedBranchId)`,
      { scopedBranchId: branchId },
    );
  }

  /**
   * The same hop for the reports that read with `find` rather than a query builder.
   * Returns undefined for head office, which the callers pass straight through as "no
   * restriction" — an empty array would mean the opposite and hide everything.
   */
  private async branchOrderIds(tenantId: string, branchId?: string): Promise<string[] | undefined> {
    if (!branchId) return undefined;
    const orders = await this.orderRepo.find({
      where: { tenant_id: tenantId, branch_id: branchId },
      select: ['id'],
    });
    return orders.map((o) => o.id);
  }

  /** `{ branch_id }` when the caller has a branch, nothing when they are head office. */
  private branchWhere(branchId?: string) {
    return branchId ? { branch_id: branchId } : {};
  }

  /**
   * A day in a report is a business day: what was stamped on the row when it happened, by its
   * branch's cutoff (a sale at 01:30 belongs to the night before). Reading the stamp rather
   * than re-deriving it from a timestamp keeps history exactly as it was reported, and lets
   * branches in different time zones share one report.
   */
  private applyStoredDateFilter(query: any, dateExpr: string, startDate?: string, endDate?: string) {
    if (startDate) query.andWhere(`${dateExpr} >= :sdStart`, { sdStart: startDate });
    if (endDate) query.andWhere(`${dateExpr} <= :sdEnd`, { sdEnd: endDate });
  }

  /**
   * Refunds given in a period, on the business day each was given, whatever day its order was
   * sold on. A refund takes its share of tax back with it, so net sales falls by the refund less
   * that tax. A paid order that was cancelled is not revenue at all, so its refund is left out.
   */
  private async refundsInPeriod(
    tenantId: string,
    filters: { startDate?: string; endDate?: string; branchId?: string; channel?: string },
  ) {
    const qb = this.refundRepo
      .createQueryBuilder('r')
      .innerJoin(OrderHeader, 'o', 'o.id = r.order_id AND o.tenant_id = r.tenant_id')
      .select([
        'r.refund_number AS refund_number',
        'r.amount AS amount',
        `${REFUND_BUSINESS_DATE_EXPR('r')} AS business_date`,
        'o.order_number AS order_number',
        'o.branch_id AS branch_id',
        'o.channel AS channel',
        'o.order_type AS order_type',
        'o.total_amount AS order_total',
        'o.tax_amount AS order_tax',
      ])
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.status IN (:...refundDone)', { refundDone: ['SUCCEEDED', 'COMPLETED'] })
      .andWhere(REVENUE_ORDER_PREDICATE('o'), { nonRevenueStates: NON_REVENUE_ORDER_STATES });
    if (filters.branchId) qb.andWhere('o.branch_id = :branchId', { branchId: filters.branchId });
    if (filters.channel) qb.andWhere('(o.channel = :channel OR o.order_type = :channel)', { channel: filters.channel });
    this.applyStoredDateFilter(qb, REFUND_BUSINESS_DATE_EXPR('r'), filters.startDate, filters.endDate);
    return (await qb.getRawMany()).map((r: any) => {
      const amount = MoneyUtil.format(r.amount || '0', 2);
      const orderTotal = MoneyUtil.format(r.order_total || '0', 2);
      const tax = MoneyUtil.greaterThan(orderTotal, '0')
        ? MoneyUtil.format(MoneyUtil.divide(MoneyUtil.multiply(amount, r.order_tax || '0'), orderTotal, 6), 2)
        : '0.00';
      return {
        refund_number: r.refund_number as string,
        amount,
        tax,
        net: MoneyUtil.subtract(amount, tax, 2),
        business_date: (r.business_date as string) || '—',
        order_number: r.order_number as string,
        branch_id: r.branch_id as string,
        channel: (r.channel as string) || 'POS',
        order_type: (r.order_type as string) || 'TAKEAWAY',
      };
    });
  }

  /** The orders that count as revenue in a period, read as Sales Summary reads them. */
  private revenueOrdersQuery(tenantId: string, filters: { startDate?: string; endDate?: string; channel?: string }) {
    const qb = this.orderRepo.createQueryBuilder('o').where('o.tenant_id = :tenantId', { tenantId });
    if (filters.channel) qb.andWhere('(o.channel = :channel OR o.order_type = :channel)', { channel: filters.channel });
    this.applyBusinessDateFilter(qb, 'o', filters.startDate, filters.endDate);
    qb.andWhere(REVENUE_ORDER_PREDICATE('o'), { nonRevenueStates: NON_REVENUE_ORDER_STATES });
    return qb;
  }

  /** What an order sold for, net of tax. */
  private orderNet(o: OrderHeader): string {
    return MoneyUtil.subtract(MoneyUtil.format(o.total_amount || '0', 2), MoneyUtil.format(o.tax_amount || '0', 2), 2);
  }

  /** Net sales over orders, or zero with no orders. */
  private averageCheck(net: string, orders: number): string {
    return orders > 0 ? MoneyUtil.divide(net, String(orders), 2) : '0.00';
  }

  /** A part's share of a whole, in percent to one decimal. */
  private sharePercent(part: string, whole: string): string {
    return MoneyUtil.greaterThan(whole, '0') ? MoneyUtil.format(MoneyUtil.divide(MoneyUtil.multiply(part, '100'), whole, 4), 1) : '0.0';
  }

  /** The account names behind a set of user ids, for the employee columns. */
  private async userNames(tenantId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map();
    const users = await this.orderRepo.manager.find(AdminUser, { where: { tenant_id: tenantId, id: In(wanted) } });
    return new Map(users.map((u) => [u.id, u.display_name || u.username]));
  }

  /**
   * Lines struck off sent orders, and sent orders cancelled or turned down, on the business day
   * of their order. A cart cleared before it was sent was never a sale and is not listed.
   */
  private async voidsInPeriod(tenantId: string, filters: { startDate?: string; endDate?: string; branchId?: string }) {
    const qb = this.orderRepo.manager
      .createQueryBuilder(OrderStateEvent, 'e')
      .innerJoin(OrderHeader, 'o', 'o.id = e.order_id AND o.tenant_id = e.tenant_id')
      .select([
        'e.action AS action',
        'e.to_state AS to_state',
        'e.reason_text AS reason_text',
        'e.occurred_at AS occurred_at',
        'e.occurred_by AS occurred_by',
        'e.snapshot AS snapshot',
        'o.order_number AS order_number',
        'o.total_amount AS order_total',
        `${ORDER_BUSINESS_DATE_EXPR('o')} AS business_date`,
      ])
      .where('e.tenant_id = :tenantId', { tenantId })
      .andWhere(
        `(e.action IN ('EDIT_ORDER', 'REPLACE_ITEM') OR (e.to_state IN ('CANCELLED', 'REJECTED') AND e.from_state IS DISTINCT FROM e.to_state AND COALESCE(e.from_state, '') <> 'DRAFT'))`,
      );
    if (filters.branchId) qb.andWhere('o.branch_id = :branchId', { branchId: filters.branchId });
    this.applyStoredDateFilter(qb, ORDER_BUSINESS_DATE_EXPR('o'), filters.startDate, filters.endDate);
    const events = await qb.orderBy('e.occurred_at', 'DESC').getRawMany();

    const struck = ['VOID', 'VOIDED', 'REPLACED'];
    const out: Array<{
      business_date: string;
      occurred_at: Date | null;
      order_number: string;
      kind: 'LINE_VOID' | 'LINE_REPLACED' | 'ORDER_CANCELLED' | 'ORDER_REJECTED';
      item: string;
      quantity: string;
      amount: string;
      reason: string;
      by: string | null;
    }> = [];
    for (const e of events) {
      const common = {
        business_date: e.business_date || '—',
        occurred_at: e.occurred_at || null,
        order_number: e.order_number,
        reason: e.reason_text || '',
        by: e.occurred_by || null,
      };
      if (e.action === 'EDIT_ORDER' || e.action === 'REPLACE_ITEM') {
        // A line struck off in this edit: live before it, struck after.
        const before = new Map<string, any>((e.snapshot?.before || []).map((line: any) => [line.id, line]));
        for (const line of e.snapshot?.after || []) {
          const was = before.get(line.id);
          if (!was || struck.includes(String(was.state)) || !struck.includes(String(line.state))) continue;
          out.push({
            ...common,
            kind: line.state === 'REPLACED' ? 'LINE_REPLACED' : 'LINE_VOID',
            item: line.productName || '',
            quantity: String(Number(line.quantity || 0)),
            amount: MoneyUtil.format(line.lineTotal || '0', 2),
          });
        }
      } else {
        out.push({
          ...common,
          kind: e.to_state === 'REJECTED' ? 'ORDER_REJECTED' : 'ORDER_CANCELLED',
          item: '',
          quantity: '',
          amount: MoneyUtil.format(e.order_total || '0', 2),
        });
      }
    }
    return out;
  }

  /** The hour an order was placed, on its branch's clock. */
  private hourAt(at: Date | string | null | undefined, timeZone: string): string {
    if (!at) return '—';
    const hour = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(at));
    return `${hour}:00`;
  }

  async queryReport(tenantId: string, reportCode: string, filters: any = {}, actor?: UserScope): Promise<ReportResult> {
    // A report code cannot carry a decorator, so the rule lives with the report. Refusing
    // here also covers the export route, which runs every report through this method.
    if (actor && CHAIN_ONLY_REPORTS.includes(reportCode) && !isHeadOfficeUser(actor)) {
      throw new ForbiddenException({
        code: 'HEAD_OFFICE_ONLY',
        title: 'Head Office Only',
        detail: 'This report compares the whole chain and is not available to a single branch.',
      });
    }

    // Every other report answers about the caller's own site when they have one. Reading
    // the chain's numbers is head office's job, and the filter has to be settled before
    // the values below are read out of it.
    if (actor?.branchId) {
      filters = { ...filters, branchId: actor.branchId };
    }

    const { startDate, endDate, branchId, channel } = filters;

    switch (reportCode) {
      case 'sales-summary': {
        const qb = this.orderRepo.createQueryBuilder('o')
          .where('o.tenant_id = :tenantId', { tenantId });
        if (branchId) qb.andWhere('o.branch_id = :branchId', { branchId });
        if (channel) qb.andWhere('(o.channel = :channel OR o.order_type = :channel)', { channel });
        // Revenue basis must match closeBusinessDay: same date expression, same state
        // exclusions. Cancelled orders are not revenue, and drafts were never placed.
        this.applyBusinessDateFilter(qb, 'o', startDate, endDate);
        qb.andWhere(REVENUE_ORDER_PREDICATE('o'), { nonRevenueStates: NON_REVENUE_ORDER_STATES });

        const orders = await qb.orderBy('o.placed_at', 'DESC').getMany();

        let grossSubtotal = '0.00';
        let modifiersTotal = '0.00';
        let packagingTotal = '0.00';
        let deliveryTotal = '0.00';
        let discountTotal = '0.00';
        let taxTotal = '0.00';
        let netSalesTotal = '0.00';
        let paidTotal = '0.00';
        let refundedTotal = '0.00';
        let outstandingTotal = '0.00';

        const rows = orders.map((o) => {
          const sub = MoneyUtil.format(o.subtotal_amount || '0', 2);
          const tax = MoneyUtil.format(o.tax_amount || '0', 2);
          const disc = MoneyUtil.format(o.discount_amount || '0', 2);
          const tot = MoneyUtil.format(o.total_amount || '0', 2);
          const paid = MoneyUtil.format(o.paid_amount || '0', 2);
          const pack = MoneyUtil.format(o.packaging_total || '0', 2);
          const del = MoneyUtil.format(o.delivery_fee || '0', 2);
          const mod = MoneyUtil.format(o.modifier_total || '0', 2);
          // Net of tax, on the day of the sale. Money given back is a row of its own below, on
          // the day it went back: a refund today must not rewrite last week's takings.
          const net = MoneyUtil.subtract(tot, tax, 2);
          const rawOut = MoneyUtil.subtract(tot, paid, 2);
          const out = MoneyUtil.lessThan(rawOut, '0') ? '0.00' : rawOut;

          grossSubtotal = MoneyUtil.add(grossSubtotal, sub, 2);
          modifiersTotal = MoneyUtil.add(modifiersTotal, mod, 2);
          packagingTotal = MoneyUtil.add(packagingTotal, pack, 2);
          deliveryTotal = MoneyUtil.add(deliveryTotal, del, 2);
          discountTotal = MoneyUtil.add(discountTotal, disc, 2);
          taxTotal = MoneyUtil.add(taxTotal, tax, 2);
          netSalesTotal = MoneyUtil.add(netSalesTotal, net, 2);
          paidTotal = MoneyUtil.add(paidTotal, paid, 2);
          outstandingTotal = MoneyUtil.add(outstandingTotal, out, 2);

          return {
            business_date: o.business_date || BusinessDateUtil.fromDate(o.placed_at) || '—',
            branch_id: o.branch_id,
            channel: o.channel || 'POS',
            type: o.order_type || 'PICKUP',
            order_number: o.order_number,
            status: o.status,
            gross_subtotal: sub,
            modifiers: mod,
            packaging: pack,
            delivery: del,
            discounts: disc,
            tax: tax,
            net_sales: net,
            paid: paid,
            refunded: '0.00',
            outstanding: out,
          };
        });

        // Refunds given in the period, whatever day the order was sold on (see refundsInPeriod).
        const refunds = await this.refundsInPeriod(tenantId, { startDate, endDate, branchId, channel });
        const refundRows = refunds.map((r) => {
          const refundTax = r.tax;
          const refundNet = r.net;
          const amount = r.amount;
          taxTotal = MoneyUtil.subtract(taxTotal, refundTax, 2);
          netSalesTotal = MoneyUtil.subtract(netSalesTotal, refundNet, 2);
          refundedTotal = MoneyUtil.add(refundedTotal, amount, 2);
          return {
            business_date: r.business_date,
            branch_id: r.branch_id,
            channel: r.channel,
            type: 'REFUND',
            order_number: `${r.order_number} (${r.refund_number})`,
            status: 'REFUNDED',
            gross_subtotal: '0.00',
            modifiers: '0.00',
            packaging: '0.00',
            delivery: '0.00',
            discounts: '0.00',
            tax: MoneyUtil.subtract('0', refundTax, 2),
            net_sales: MoneyUtil.subtract('0', refundNet, 2),
            paid: '0.00',
            refunded: amount,
            outstanding: '0.00',
          };
        });
        // Newest day first, a day's refunds after its sales.
        rows.push(...refundRows);
        rows.sort((a, b) => String(b.business_date).localeCompare(String(a.business_date)));

        return {
          report_code: reportCode,
          filter_basis: 'business_date',
          rows,
          summary_totals: {
            order_count: orders.length,
            gross_subtotal: grossSubtotal,
            modifiers: modifiersTotal,
            packaging: packagingTotal,
            delivery: deliveryTotal,
            discounts: discountTotal,
            tax: taxTotal,
            tax_total: taxTotal,
            net_sales: netSalesTotal,
            paid: paidTotal,
            paid_total: paidTotal,
            refunded: refundedTotal,
            outstanding: outstandingTotal,
          },
        };
      }

      case 'product-sales': {
        const qb = this.orderItemRepo.createQueryBuilder('i')
          .where('i.tenant_id = :tenantId', { tenantId });
        // A line sells on its order's business day.
        if (startDate || endDate) {
          const dated = this.orderRepo
            .createQueryBuilder('dated_o')
            .select('dated_o.id')
            .where('dated_o.tenant_id = :tenantId', { tenantId });
          this.applyBusinessDateFilter(dated, 'dated_o', startDate, endDate);
          qb.andWhere(`i.order_id IN (${dated.getQuery()})`, dated.getParameters());
        }
        this.applyBranchViaOrder(qb, 'i', branchId);

        const items = await qb.getMany();        let totalQty = '0.0000';
        let totalGross = '0.0000';
        let totalNet = '0.0000';

        const productMap = new Map<string, any>();
        items.forEach((i) => {
          const key = i.product_id || i.product_name;
          const existing = productMap.get(key) || {
            product_id: i.product_id,
            product_name: i.product_name,
            quantity: '0.0000',
            unit_price: MoneyUtil.format(i.unit_price || '0', 2),
            gross_sales: '0.0000',
            net_sales: '0.0000',
            order_count: 0,
          };

          const qtyStr = MoneyUtil.format(i.quantity || '1', 4);
          const totStr = MoneyUtil.format(i.total_amount || i.line_total || '0', 2);
          existing.quantity = MoneyUtil.add(existing.quantity, qtyStr, 4);
          existing.gross_sales = MoneyUtil.add(existing.gross_sales, totStr, 2);
          existing.net_sales = MoneyUtil.add(existing.net_sales, totStr, 2);
          existing.order_count += 1;
          productMap.set(key, existing);

          totalQty = MoneyUtil.add(totalQty, qtyStr, 4);
          totalGross = MoneyUtil.add(totalGross, totStr, 2);
          totalNet = MoneyUtil.add(totalNet, totStr, 2);
        });

        const rows = Array.from(productMap.values()).map((p) => ({
          product_id: p.product_id,
          product_name: p.product_name,
          quantity: MoneyUtil.format(p.quantity, 4),
          unit_price: p.unit_price,
          gross_sales: p.gross_sales,
          net_sales: p.net_sales,
          order_count: p.order_count,
        }))
          // Best sellers first: a velocity report read in the order lines were first rung up
          // put a one-off test item above the chain's top burger.
          .sort((a, z) => (MoneyUtil.greaterThan(z.net_sales, a.net_sales) ? 1 : MoneyUtil.lessThan(z.net_sales, a.net_sales) ? -1 : 0));

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            total_products: rows.length,
            quantity: MoneyUtil.format(totalQty, 4),
            gross_sales: totalGross,
            net_sales: totalNet,
          },
        };
      }

      case 'payments-by-method': {
        const qb = this.paymentRepo.createQueryBuilder('p')
          .where('p.tenant_id = :tenantId', { tenantId });
        this.applyStoredDateFilter(qb, 'p.business_date', startDate, endDate);
        this.applyBranchViaOrder(qb, 'p', branchId);

        const payments = await qb.getMany();

        // Money handed back is a Refund row of its own, never a change to the payment. This
        // report used to hardcode refunds to zero, so a card refund left CARD_POS overstated
        // by exactly the refund.
        const refundQb = this.refundRepo.createQueryBuilder('r')
          .where('r.tenant_id = :tenantId', { tenantId })
          .andWhere('r.status IN (:...refundDone)', { refundDone: ['SUCCEEDED', 'COMPLETED'] });
        this.applyStoredDateFilter(refundQb, REFUND_BUSINESS_DATE_EXPR('r'), startDate, endDate);
        this.applyBranchViaOrder(refundQb, 'r', branchId);
        const refunds = await refundQb.getMany();

        // A card charged by hand on another reader (Y-12) is still a card, but shown on a row of
        // its own, with the pay-backs of those payments beside it, as on the Payments page.
        const otherReaderPayments = new Set<string>();
        const otherReaderRefunds = new Set<string>();
        if (payments.length > 0) {
          const marked: { payment_id: string }[] = await this.paymentRepo.manager.query(
            `SELECT DISTINCT payment_id FROM payment_attempt WHERE adapter = 'MANUAL' AND payment_id = ANY($1::uuid[])`,
            [payments.map((p) => p.id)],
          );
          marked.forEach((m) => otherReaderPayments.add(m.payment_id));
        }
        if (refunds.length > 0) {
          const marked: { refund_id: string }[] = await this.paymentRepo.manager.query(
            `SELECT DISTINCT ra.refund_id FROM refund_allocation ra
               JOIN payment_attempt pa ON pa.payment_id = ra.payment_id AND pa.adapter = 'MANUAL'
              WHERE ra.refund_id = ANY($1::uuid[])`,
            [refunds.map((r) => r.id)],
          );
          marked.forEach((m) => otherReaderRefunds.add(m.refund_id));
        }

        let totalSucceeded = '0.00';
        let totalReversed = '0.00';
        let totalRefunded = '0.00';
        let totalNet = '0.00';

        const methodMap = new Map<string, any>();
        const methodRow = (key: string) =>
          methodMap.get(key) || {
            method_kind: key,
            method_name: key,
            count: 0,
            succeeded: '0.00',
            reversed: '0.00',
            refunded: '0.00',
            net: '0.00',
          };

        payments.forEach((p) => {
          const key = otherReaderPayments.has(p.id) ? 'CARD_OTHER_READER' : p.method_kind || 'CASH';
          const existing = methodRow(key);
          const amtStr = MoneyUtil.format(p.amount || '0', 2);
          existing.count += 1;

          if (p.status === 'REVERSED' || p.status === 'FAILED') {
            existing.reversed = MoneyUtil.add(existing.reversed, amtStr, 2);
            totalReversed = MoneyUtil.add(totalReversed, amtStr, 2);
          } else {
            existing.succeeded = MoneyUtil.add(existing.succeeded, amtStr, 2);
            existing.net = MoneyUtil.add(existing.net, amtStr, 2);
            totalSucceeded = MoneyUtil.add(totalSucceeded, amtStr, 2);
            totalNet = MoneyUtil.add(totalNet, amtStr, 2);
          }

          methodMap.set(key, existing);
        });

        refunds.forEach((r) => {
          const key = otherReaderRefunds.has(r.id) ? 'CARD_OTHER_READER' : r.method_kind || 'CASH';
          const existing = methodRow(key);
          const refStr = MoneyUtil.format(r.amount || '0', 2);
          existing.refunded = MoneyUtil.add(existing.refunded, refStr, 2);
          existing.net = MoneyUtil.subtract(existing.net, refStr, 2);
          totalRefunded = MoneyUtil.add(totalRefunded, refStr, 2);
          totalNet = MoneyUtil.subtract(totalNet, refStr, 2);
          methodMap.set(key, existing);
        });

        const rows = Array.from(methodMap.values()).map((m) => ({
          method_kind: m.method_kind,
          method_name: m.method_name,
          transaction_count: m.count,
          succeeded_amount: m.succeeded,
          reversed_amount: m.reversed,
          refunded_amount: m.refunded,
          net_amount: m.net,
        }));

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            method_count: rows.length,
            succeeded: totalSucceeded,
            reversed: totalReversed,
            refunded: totalRefunded,
            net: totalNet,
          },
        };
      }

      case 'discounts': {
        const discountOrderIds = await this.branchOrderIds(tenantId, branchId);
        const adjustments = await this.adjustmentRepo.find({
          where: { tenant_id: tenantId, ...(discountOrderIds ? { order_id: In(discountOrderIds) } : {}) },
        });
        let totalDisc = '0.00';

        const rows = adjustments.map((a) => {
          const amtStr = MoneyUtil.format(a.amount || '0', 2);
          totalDisc = MoneyUtil.add(totalDisc, a.amount || '0', 2);

          return {
            adjustment_id: a.id,
            order_id: a.order_id,
            type: a.type || 'DISCOUNT',
            source: a.source_type,
            code: a.code || '',
            discount_amount: amtStr,
            reason: a.name || '',
            // Why it was given: the till's reason (friends and family, staff, ...), or
            // FRIENDS_FAMILY for a customer's own rate.
            reason_code: (a.calculation_snapshot as any)?.reasonCode || '',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            adjustment_count: rows.length,
            discount_amount: totalDisc,
          },
        };
      }

      case 'cashier-shifts': {
        const shifts = await this.cashierShiftRepo.find({
          where: { tenant_id: tenantId, ...this.branchWhere(branchId) },
        });
        let totalExpected = '0.00';
        let totalActual = '0.00';
        let totalVariance = '0.00';

        const rows = shifts.map((s) => {
          const expStr = MoneyUtil.format(s.expected_cash || '0', 2);
          const actStr = MoneyUtil.format(s.actual_cash || '0', 2);
          const varStr = MoneyUtil.format(s.short_over || '0', 2);
          totalExpected = MoneyUtil.add(totalExpected, expStr, 2);
          totalActual = MoneyUtil.add(totalActual, actStr, 2);
          totalVariance = MoneyUtil.add(totalVariance, varStr, 2);

          return {
            shift_id: s.id,
            branch_id: s.branch_id,
            terminal_id: s.terminal_id,
            cashier_id: s.opened_by || 'CASHIER-1',
            opened_at: s.opened_at ? new Date(s.opened_at).toISOString() : '—',
            closed_at: s.closed_at ? new Date(s.closed_at).toISOString() : '—',
            opening_cash: MoneyUtil.format(s.opening_cash || '0', 2),
            expected_cash: expStr,
            actual_cash: actStr,
            variance: varStr,
            state: s.state || 'CLOSED',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            shift_count: shifts.length,
            expected_cash: totalExpected,
            actual_cash: totalActual,
            variance: totalVariance,
          },
        };
      }

      case 'customer-credit': {
        // Deliberately chain-wide. A credit account carries no branch — the customer owes the
        // chain, not a shop — so there is no branch answer to give, and attributing only the
        // entries that happen to hang off an order would show a manager purchases without the
        // repayments that settle them. Credit is a manager's area by design; see the
        // @Roles(...MANAGER_AND_ABOVE) on CreditController.
        const entries = await this.creditEntryRepo.find({ where: { tenant_id: tenantId } });
        let totalDebit = '0.00';
        let totalCredit = '0.00';

        const rows = entries.map((e) => {
          const amtStr = MoneyUtil.format(e.amount || '0', 2);
          const isDebit = MoneyUtil.lessThan(amtStr, '0');
          const debitStr = isDebit ? MoneyUtil.abs(amtStr, 2) : '0.00';
          const creditStr = !isDebit && MoneyUtil.greaterThan(amtStr, '0') ? amtStr : '0.00';

          totalDebit = MoneyUtil.add(totalDebit, debitStr, 2);
          totalCredit = MoneyUtil.add(totalCredit, creditStr, 2);

          return {
            entry_id: e.id,
            date: storedDate(e, e.posted_at),
            account_id: e.account_id,
            type: e.entry_type || 'PURCHASE',
            order_id: e.order_id || '—',
            debit: debitStr,
            credit: creditStr,
            running_balance: MoneyUtil.format(e.balance_after || '0', 2),
            reason: e.reason_text || 'Credit Transaction',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            total_entries: entries.length,
            debit: totalDebit,
            credit: totalCredit,
            net_change: MoneyUtil.subtract(totalCredit, totalDebit, 2),
          },
        };
      }

      case 'aggregator-orders': {
        const orders = await this.orderRepo.find({
          where: { tenant_id: tenantId, ...this.branchWhere(branchId) },
        });
        const aggOrders = orders.filter((o) => o.order_type === 'SNAPPFOOD' || (o as any).external_id);

        let totalAmt = '0.00';
        const rows = aggOrders.map((o) => {
          const amtStr = MoneyUtil.format(o.total_amount || '0', 2);
          totalAmt = MoneyUtil.add(totalAmt, amtStr, 2);

          return {
            order_id: o.id,
            external_id: (o as any).external_id || `SNAPP-${o.order_number}`,
            order_number: o.order_number,
            date: storedDate(o, o.placed_at),
            status: o.status,
            total_amount: amtStr,
            reconciliation_status: 'MATCHED',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            aggregator_order_count: aggOrders.length,
            total_amount: totalAmt,
          },
        };
      }

      case 'snappfood-reconciliation': {
        const logs = await this.integrationLogRepo.find({ where: { tenant_id: tenantId } });
        let totalDiscrepancy = '0.00';

        const rows = logs.map((l) => {
          const expStr = MoneyUtil.format((l.request_payload as any)?.expected_amount || '0', 2);
          const actStr = MoneyUtil.format((l.response_payload as any)?.actual_amount || '0', 2);
          const discStr = MoneyUtil.abs(MoneyUtil.subtract(expStr, actStr, 4), 2);
          totalDiscrepancy = MoneyUtil.add(totalDiscrepancy, discStr, 2);

          return {
            log_id: l.id,
            external_id: (l.request_payload as any)?.external_id || 'SNAPP-1002',
            expected_total: expStr,
            actual_total: actStr,
            discrepancy: discStr,
            status: l.status || 'SUCCESS',
            last_action: l.created_at ? new Date(l.created_at).toISOString() : '—',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            log_count: logs.length,
            total_discrepancy: totalDiscrepancy,
          },
        };
      }

      case 'courier-settlements': {
        const settlements = await this.settlementRepo.find({
          where: { tenant_id: tenantId, ...this.branchWhere(branchId) },
        });
        let totalNetDue = '0.00';
        let totalDiscrepancy = '0.00';

        const rows = settlements.map((s) => {
          const netStr = MoneyUtil.format(s.net_settlement_amount || '0', 2);
          const discStr = MoneyUtil.format(s.cash_discrepancy_amount || '0', 2);
          totalNetDue = MoneyUtil.add(totalNetDue, netStr, 2);
          totalDiscrepancy = MoneyUtil.add(totalDiscrepancy, discStr, 2);

          return {
            settlement_id: s.id,
            courier_id: s.courier_id,
            expected_cash: MoneyUtil.format(s.expected_cash_amount || '0', 2),
            actual_cash: MoneyUtil.format(s.actual_cash_amount || '0', 2),
            expected_pos: MoneyUtil.format(s.expected_pos_amount || '0', 2),
            verified_pos: MoneyUtil.format(s.actual_pos_amount || '0', 2),
            net_due: netStr,
            discrepancy: discStr,
            state: s.status || 'CLOSED',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            settlement_count: settlements.length,
            net_due: totalNetDue,
            discrepancy: totalDiscrepancy,
          },
        };
      }

      case 'tax': {
        const orders = await this.orderRepo.find({
          where: { tenant_id: tenantId, ...this.branchWhere(branchId) },
        });
        let totalTaxable = '0.00';
        let totalTax = '0.00';

        const rows = orders.map((o) => {
          const subStr = MoneyUtil.format(o.subtotal_amount || '0', 2);
          const taxStr = MoneyUtil.format(o.tax_amount || '0', 2);

          totalTaxable = MoneyUtil.add(totalTaxable, subStr, 2);
          totalTax = MoneyUtil.add(totalTax, taxStr, 2);

          return {
            order_number: o.order_number,
            date: storedDate(o, o.placed_at),
            taxable_amount: subStr,
            tax_rate: '9.0%',
            tax_amount: taxStr,
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            order_count: orders.length,
            taxable_amount: totalTaxable,
            tax_amount: totalTax,
          },
        };
      }

      case 'sales-by-day': {
        // One row per business day: what was sold that day, less what was given back that day.
        const qb = this.revenueOrdersQuery(tenantId, { startDate, endDate, channel });
        if (branchId) qb.andWhere('o.branch_id = :branchId', { branchId });
        const orders = await qb.getMany();
        const refunds = await this.refundsInPeriod(tenantId, { startDate, endDate, branchId, channel });

        const blank = () => ({ orders: 0, gross_subtotal: '0.00', discounts: '0.00', tax: '0.00', refunded: '0.00', net_sales: '0.00', average_check: '0.00' });
        const days = new Map<string, ReturnType<typeof blank> & { business_date: string }>();
        const day = (date: string) => {
          if (!days.has(date)) days.set(date, { business_date: date, ...blank() });
          return days.get(date)!;
        };
        for (const o of orders) {
          const row = day(storedDate(o, o.placed_at));
          row.orders += 1;
          row.gross_subtotal = MoneyUtil.add(row.gross_subtotal, MoneyUtil.format(o.subtotal_amount || '0', 2), 2);
          row.discounts = MoneyUtil.add(row.discounts, MoneyUtil.format(o.discount_amount || '0', 2), 2);
          row.tax = MoneyUtil.add(row.tax, MoneyUtil.format(o.tax_amount || '0', 2), 2);
          row.net_sales = MoneyUtil.add(row.net_sales, this.orderNet(o), 2);
        }
        for (const r of refunds) {
          const row = day(r.business_date);
          row.refunded = MoneyUtil.add(row.refunded, r.amount, 2);
          row.tax = MoneyUtil.subtract(row.tax, r.tax, 2);
          row.net_sales = MoneyUtil.subtract(row.net_sales, r.net, 2);
        }

        const rows = [...days.values()].sort((a, b) => b.business_date.localeCompare(a.business_date));
        const totals = blank();
        for (const row of rows) {
          row.average_check = this.averageCheck(row.net_sales, row.orders);
          totals.orders += row.orders;
          for (const key of ['gross_subtotal', 'discounts', 'tax', 'refunded', 'net_sales'] as const) {
            totals[key] = MoneyUtil.add(totals[key], row[key], 2);
          }
        }
        totals.average_check = this.averageCheck(totals.net_sales, totals.orders);
        return { report_code: reportCode, filter_basis: 'business_date', rows, summary_totals: totals };
      }

      case 'sales-by-hour': {
        // When the orders come in, on each branch's own clock: for staffing the busy hours.
        const qb = this.revenueOrdersQuery(tenantId, { startDate, endDate, channel });
        if (branchId) qb.andWhere('o.branch_id = :branchId', { branchId });
        const orders = await qb.getMany();
        const branches = await this.orderRepo.manager.find(Branch, { where: { tenant_id: tenantId }, withDeleted: true });
        const zoneOf = new Map(branches.map((b) => [b.id, b.time_zone || BUSINESS_TIME_ZONE]));

        const hours = new Map<string, { hour: string; orders: number; net_sales: string }>();
        let netTotal = '0.00';
        for (const o of orders) {
          const hour = this.hourAt(o.placed_at, zoneOf.get(o.branch_id) || BUSINESS_TIME_ZONE);
          const row = hours.get(hour) || { hour, orders: 0, net_sales: '0.00' };
          row.orders += 1;
          row.net_sales = MoneyUtil.add(row.net_sales, this.orderNet(o), 2);
          hours.set(hour, row);
          netTotal = MoneyUtil.add(netTotal, this.orderNet(o), 2);
        }
        const rows = [...hours.values()]
          .sort((a, b) => a.hour.localeCompare(b.hour))
          .map((row) => ({
            ...row,
            average_check: this.averageCheck(row.net_sales, row.orders),
            share_percent: this.sharePercent(row.net_sales, netTotal),
          }));
        return {
          report_code: reportCode,
          filter_basis: 'business_date',
          rows,
          summary_totals: {
            orders: orders.length,
            net_sales: netTotal,
            average_check: this.averageCheck(netTotal, orders.length),
            share_percent: orders.length > 0 ? '100.0' : '0.0',
          },
        };
      }

      case 'sales-by-channel': {
        // Where the orders came from (till, kiosk, Snappfood…) and how they were served.
        const qb = this.revenueOrdersQuery(tenantId, { startDate, endDate, channel });
        if (branchId) qb.andWhere('o.branch_id = :branchId', { branchId });
        const orders = await qb.getMany();
        const refunds = await this.refundsInPeriod(tenantId, { startDate, endDate, branchId, channel });

        const groups = new Map<string, { channel: string; order_type: string; orders: number; refunded: string; net_sales: string; average_check: string; share_percent: string }>();
        const group = (ch: string, type: string) => {
          const key = `${ch}|${type}`;
          if (!groups.has(key)) {
            groups.set(key, { channel: ch, order_type: type, orders: 0, refunded: '0.00', net_sales: '0.00', average_check: '0.00', share_percent: '0.0' });
          }
          return groups.get(key)!;
        };
        for (const o of orders) {
          const row = group(o.channel || 'POS', o.order_type || 'TAKEAWAY');
          row.orders += 1;
          row.net_sales = MoneyUtil.add(row.net_sales, this.orderNet(o), 2);
        }
        for (const r of refunds) {
          const row = group(r.channel, r.order_type);
          row.refunded = MoneyUtil.add(row.refunded, r.amount, 2);
          row.net_sales = MoneyUtil.subtract(row.net_sales, r.net, 2);
        }

        const rows = [...groups.values()];
        const totals = { orders: 0, refunded: '0.00', net_sales: '0.00', average_check: '0.00', share_percent: '100.0' };
        for (const row of rows) {
          totals.orders += row.orders;
          totals.refunded = MoneyUtil.add(totals.refunded, row.refunded, 2);
          totals.net_sales = MoneyUtil.add(totals.net_sales, row.net_sales, 2);
        }
        for (const row of rows) {
          row.average_check = this.averageCheck(row.net_sales, row.orders);
          row.share_percent = this.sharePercent(row.net_sales, totals.net_sales);
        }
        rows.sort((a, b) => Number(b.net_sales) - Number(a.net_sales));
        totals.average_check = this.averageCheck(totals.net_sales, totals.orders);
        return { report_code: reportCode, filter_basis: 'business_date', rows, summary_totals: totals };
      }

      case 'sales-by-employee': {
        // Who rang the orders up, what they sold and discounted, and what they struck off.
        // Orders nobody rang up (Snappfood, the kiosk) are listed together.
        const qb = this.revenueOrdersQuery(tenantId, { startDate, endDate, channel });
        if (branchId) qb.andWhere('o.branch_id = :branchId', { branchId });
        const orders = await qb.getMany();
        const voids = await this.voidsInPeriod(tenantId, { startDate, endDate, branchId });

        type PersonRow = { userId: string | null; orders: number; net_sales: string; discounts: string; voided_lines: number; cancelled_orders: number };
        const people = new Map<string, PersonRow>();
        const person = (id: string | null) => {
          const key = id || '';
          if (!people.has(key)) people.set(key, { userId: id, orders: 0, net_sales: '0.00', discounts: '0.00', voided_lines: 0, cancelled_orders: 0 });
          return people.get(key)!;
        };
        for (const o of orders) {
          const row = person(o.created_by || null);
          row.orders += 1;
          row.net_sales = MoneyUtil.add(row.net_sales, this.orderNet(o), 2);
          row.discounts = MoneyUtil.add(row.discounts, MoneyUtil.format(o.discount_amount || '0', 2), 2);
        }
        for (const v of voids) {
          const row = person(v.by);
          if (v.kind === 'LINE_VOID' || v.kind === 'LINE_REPLACED') row.voided_lines += 1;
          else row.cancelled_orders += 1;
        }

        const names = await this.userNames(tenantId, [...people.values()].map((p) => p.userId));
        const totals = { orders: 0, net_sales: '0.00', average_check: '0.00', discounts: '0.00', voided_lines: 0, cancelled_orders: 0 };
        const rows = [...people.values()].map((p) => {
          totals.orders += p.orders;
          totals.net_sales = MoneyUtil.add(totals.net_sales, p.net_sales, 2);
          totals.discounts = MoneyUtil.add(totals.discounts, p.discounts, 2);
          totals.voided_lines += p.voided_lines;
          totals.cancelled_orders += p.cancelled_orders;
          return {
            employee: (p.userId && names.get(p.userId)) || (p.userId ? p.userId : 'Online / kiosk'),
            orders: p.orders,
            net_sales: p.net_sales,
            average_check: this.averageCheck(p.net_sales, p.orders),
            discounts: p.discounts,
            voided_lines: p.voided_lines,
            cancelled_orders: p.cancelled_orders,
          };
        });
        rows.sort((a, b) => Number(b.net_sales) - Number(a.net_sales));
        totals.average_check = this.averageCheck(totals.net_sales, totals.orders);
        return { report_code: reportCode, filter_basis: 'business_date', rows, summary_totals: totals };
      }

      case 'voids-cancellations': {
        // Every line struck off a sent order and every sent order cancelled or turned down,
        // with who did it and why: where shrinkage hides. voidsInPeriod confines it with
        // andWhere('o.branch_id = :branchId') when the caller has a branch.
        const voids = await this.voidsInPeriod(tenantId, { startDate, endDate, branchId });
        const names = await this.userNames(tenantId, voids.map((v) => v.by));
        let amountTotal = '0.00';
        const rows = voids.map((v) => {
          amountTotal = MoneyUtil.add(amountTotal, v.amount, 2);
          return {
            business_date: v.business_date,
            order_number: v.order_number,
            kind: v.kind,
            item: v.item,
            quantity: v.quantity,
            amount: v.amount,
            reason: v.reason,
            by: (v.by && names.get(v.by)) || '',
            at: v.occurred_at ? new Date(v.occurred_at).toISOString() : '',
          };
        });
        const lines = rows.filter((r) => r.kind === 'LINE_VOID' || r.kind === 'LINE_REPLACED').length;
        return {
          report_code: reportCode,
          filter_basis: 'business_date',
          rows,
          summary_totals: {
            order_number: `${lines} lines, ${rows.length - lines} orders`,
            amount: amountTotal,
          },
        };
      }

      default:
        throw new NotFoundException(`Unknown report code: ${reportCode}`);
    }
  }

  async exportReport(tenantId: string, reportCode: string, filters: any = {}, format: 'CSV' | 'XLSX' = 'CSV', actor?: UserScope) {
    const report = await this.queryReport(tenantId, reportCode, filters, actor);
    const filename = `${reportCode}-${Date.now()}.${format.toLowerCase()}`;

    let contentBase64 = '';
    let utf8Content = '';

    if (format === 'CSV') {
      let csvContent = '\uFEFF'; // UTF-8 BOM
      csvContent += `# Report Title: ${reportCode.toUpperCase()}\n`;
      csvContent += `# Export Time: ${new Date().toISOString()}\n`;

      if (report.rows && report.rows.length > 0) {
        const headers = Object.keys(report.rows[0]);
        csvContent += headers.join(',') + '\n';

        for (const row of report.rows) {
          const values = headers.map((h) => `"${String((row as any)[h] ?? '').replace(/"/g, '""')}"`);
          csvContent += values.join(',') + '\n';
        }
      }

      if (report.summary_totals) {
        csvContent += '\n# SUMMARY TOTALS\n';
        const totKeys = Object.keys(report.summary_totals);
        csvContent += totKeys.join(',') + '\n';
        csvContent += Object.values(report.summary_totals).map((v) => `"${v}"`).join(',') + '\n';
      }

      utf8Content = csvContent;
      contentBase64 = Buffer.from(csvContent, 'utf8').toString('base64');
    } else {
      // XLSX Export via ExcelJS
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Gnext Prototype v2';
      const sheet = workbook.addWorksheet(reportCode);

      sheet.addRow([`Report Code: ${reportCode}`]);
      sheet.addRow([`Generated At: ${new Date().toISOString()}`]);
      sheet.addRow([]);

      if (report.rows && report.rows.length > 0) {
        const headers = Object.keys(report.rows[0]);
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true };

        for (const row of report.rows) {
          sheet.addRow(headers.map((h) => (row as any)[h]));
        }
      }

      if (report.summary_totals) {
        sheet.addRow([]);
        const totKeys = Object.keys(report.summary_totals);
        const totRowHeader = sheet.addRow(totKeys.map((k) => `TOTAL: ${k}`));
        totRowHeader.font = { bold: true, color: { argb: 'FF0000FF' } };
        sheet.addRow(Object.values(report.summary_totals));
      }

      const buffer = await workbook.xlsx.writeBuffer();
      contentBase64 = Buffer.from(buffer).toString('base64');
    }

    return {
      filename,
      mime_type: format === 'CSV' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content_base64: contentBase64,
      content: utf8Content,
    };
  }

  // Server-derived dashboard figures
  /** `branchId` narrows the figures to one site; head office passes nothing and gets the chain. */
  async getDashboardSummary(tenantId: string, branchId?: string) {
    const orders = await this.orderRepo.find({
      where: branchId ? { tenant_id: tenantId, branch_id: branchId } : { tenant_id: tenantId },
    });
    const shifts = await this.cashierShiftRepo.find({
      where: branchId
        ? { tenant_id: tenantId, state: 'OPEN', branch_id: branchId }
        : { tenant_id: tenantId, state: 'OPEN' },
    });

    // Today is each branch's own business day, by its cutoff and on its own clock.
    const todayAt = new Map<string, string>();
    for (const id of new Set(orders.map((o) => o.branch_id))) {
      todayAt.set(id, (await loadBusinessClock(this.orderRepo.manager, tenantId, id)).today());
    }
    const todayOrders = orders.filter((o) => o.placed_at && storedDate(o, o.placed_at) === todayAt.get(o.branch_id));
    const salesToday = todayOrders.reduce((sum, o) => MoneyUtil.add(sum, o.total_amount || '0', 2), '0.00');
    const openOrders = orders.filter((o) => o.status === 'SUBMITTED' || o.status === 'ACCEPTED' || o.status === 'IN_PREPARATION');

    return {
      sales_today: salesToday,
      open_orders_count: openOrders.length,
      active_shifts_count: shifts.length,
      branch_health_percentage: 100,
      /** Null when the figures cover the whole chain, so the screen can say which it is. */
      branch_id: branchId ?? null,
      timestamp: new Date().toISOString(),
    };
  }
}
