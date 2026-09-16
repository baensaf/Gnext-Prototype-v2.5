import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { UserScope, isHeadOfficeUser } from '../../common/utils/user-scope.util';

/**
 * Reports that answer a question about the chain rather than about a location. A branch
 * manager reading these would be reading their neighbours' numbers.
 */
const CHAIN_ONLY_REPORTS = ['branch-comparison', 'snappfood-reconciliation', 'integration-operations'];
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Payment } from '../../entities/Payment.entity';
import { Refund } from '../../entities/Refund.entity';
import { AuditEvent } from '../../entities/AuditEvent.entity';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { CourierSettlementLine } from '../../entities/CourierSettlementLine.entity';
import { CourierAttendance } from '../../entities/CourierAttendance.entity';
import { Customer } from '../../entities/Customer.entity';
import { CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { CreditEntry } from '../../entities/CreditEntry.entity';
import { OrderAdjustment } from '../../entities/OrderAdjustment.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { PrintJob } from '../../entities/PrintJob.entity';
import { PrintAttempt } from '../../entities/PrintAttempt.entity';
import { Printer } from '../../entities/Printer.entity';
import { Delivery } from '../../entities/Delivery.entity';
import { OfflineQueueItem } from '../../entities/OfflineQueueItem.entity';
import { Product } from '../../entities/Product.entity';
import { Category } from '../../entities/Category.entity';
import { Branch, SELLING_BRANCH_TYPES } from '../../entities/Branch.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { SavedReportView } from '../../entities/SavedReportView.entity';
import { ReportExportJob } from '../../entities/ReportExportJob.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { ApprovalDecision } from '../../entities/ApprovalDecision.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import {
  BusinessDateUtil,
  ORDER_BUSINESS_DATE_EXPR,
  NON_REVENUE_ORDER_STATES,
  REVENUE_ORDER_PREDICATE,
} from '../../common/utils/business-date.util';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Refund) private readonly refundRepo: Repository<Refund>,
    @InjectRepository(AuditEvent) private readonly auditRepo: Repository<AuditEvent>,
    @InjectRepository(IntegrationLog) private readonly integrationLogRepo: Repository<IntegrationLog>,
    @InjectRepository(CashierShift) private readonly cashierShiftRepo: Repository<CashierShift>,
    @InjectRepository(CourierSettlement) private readonly settlementRepo: Repository<CourierSettlement>,
    @InjectRepository(CourierSettlementLine) private readonly settlementLineRepo: Repository<CourierSettlementLine>,
    @InjectRepository(CourierAttendance) private readonly attendanceRepo: Repository<CourierAttendance>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerCreditAccount) private readonly creditAccountRepo: Repository<CustomerCreditAccount>,
    @InjectRepository(CreditEntry) private readonly creditEntryRepo: Repository<CreditEntry>,
    @InjectRepository(OrderAdjustment) private readonly adjustmentRepo: Repository<OrderAdjustment>,
    @InjectRepository(PaymentDevice) private readonly paymentDeviceRepo: Repository<PaymentDevice>,
    @InjectRepository(PaymentMethod) private readonly paymentMethodRepo: Repository<PaymentMethod>,
    @InjectRepository(PrintJob) private readonly printJobRepo: Repository<PrintJob>,
    @InjectRepository(PrintAttempt) private readonly printAttemptRepo: Repository<PrintAttempt>,
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(Delivery) private readonly deliveryRepo: Repository<Delivery>,
    @InjectRepository(OfflineQueueItem) private readonly offlineQueueRepo: Repository<OfflineQueueItem>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Category) private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(OperationalAlert) private readonly alertRepo: Repository<OperationalAlert>,
    @InjectRepository(SavedReportView) private readonly savedViewRepo: Repository<SavedReportView>,
    @InjectRepository(ReportExportJob) private readonly exportJobRepo: Repository<ReportExportJob>,
  ) {}

  /**
   * The picker on the reports screen is built from this, so it has to answer the same way
   * queryReport does. Offering a branch manager a report the run then refuses is a dead end
   * dressed up as a menu item.
   */
  async getCatalog(actor?: UserScope) {
    const catalog = [
      { code: 'sales-summary', name: 'Sales Summary', category: 'FINANCIAL' },
      { code: 'branch-comparison', name: 'Branch Performance Comparison', category: 'FINANCIAL' },
      { code: 'product-sales', name: 'Product & Category Velocity', category: 'CATALOG' },
      { code: 'payments-by-method', name: 'Payment Methods & Allocations', category: 'PAYMENT' },
      { code: 'mixed-payments', name: 'Mixed Payments Audit', category: 'PAYMENT' },
      { code: 'mobile-pos', name: 'Mobile POS Terminal Operations', category: 'PAYMENT' },
      { code: 'alternative-refunds', name: 'Alternative Method Refunds', category: 'PAYMENT' },
      { code: 'discounts', name: 'Discounts Given (Manual, Coupon, Customer Rate)', category: 'PROMOTION' },
      { code: 'manual-discounts', name: 'Cashier Manual Discounts & Deductions', category: 'PROMOTION' },
      { code: 'cashier-shifts', name: 'Cashier Shifts & EOD Balancing', category: 'CASH' },
      { code: 'cash-discrepancies', name: 'Cash & Settlement Discrepancies', category: 'CASH' },
      { code: 'customer-credit', name: 'Customer Credit Ledger', category: 'CREDIT' },
      { code: 'credit-eod-usage', name: 'End-of-Day Credit Usage', category: 'CREDIT' },
      { code: 'credit-aging', name: 'Credit Accounts Aging Analysis', category: 'CREDIT' },
      { code: 'customer-activity', name: 'Customer Sales & Activity', category: 'CUSTOMER' },
      { code: 'aggregator-orders', name: 'Aggregator Orders & Integration Notes', category: 'INTEGRATION' },
      { code: 'snappfood-reconciliation', name: 'Snappfood Webhook Reconciliation', category: 'INTEGRATION' },
      { code: 'courier-attendance', name: 'Courier Attendance & Roster', category: 'DELIVERY' },
      { code: 'courier-settlements', name: 'Courier Cash & POS Settlements', category: 'DELIVERY' },
      { code: 'courier-reconciliation', name: 'Courier Cash vs POS Reconciliation', category: 'DELIVERY' },
      { code: 'tax-packaging', name: 'Tax & Packaging Compliance', category: 'TAX' },
      { code: 'print-operations', name: 'Print Operations & Job Queue Log', category: 'SIMULATION' },
      { code: 'integration-operations', name: 'Integration & Webhook Operations', category: 'SIMULATION' },
      { code: 'v5-preview-inventory', name: 'V5 Preview: Inventory Stock & Movement', category: 'V5_PREVIEW' },
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

  private applyDateFilter(query: any, dateColumn: string, startDate?: string, endDate?: string) {
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.andWhere(`${dateColumn} BETWEEN :startDate AND :endDate`, { startDate: start, endDate: end });
    } else if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      query.andWhere(`${dateColumn} >= :startDate`, { startDate: start });
    } else if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.andWhere(`${dateColumn} <= :endDate`, { endDate: end });
    }
  }

  async queryReport(tenantId: string, reportCode: string, filters: any = {}, actor?: UserScope) {
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
      /**
       * The chain roll-up: one row per branch instead of one row per order, on the
       * same revenue basis as sales-summary so the two reports agree when you drill
       * down. Branches with no orders in the window are kept — a location that sold
       * nothing is the row a chain operator most needs to see, and dropping it would
       * silently turn a problem into an absence.
       */
      case 'branch-comparison': {
        const branches = await this.branchRepo.find({ where: { tenant_id: tenantId } });

        const qb = this.orderRepo.createQueryBuilder('o')
          .where('o.tenant_id = :tenantId', { tenantId });
        if (branchId) qb.andWhere('o.branch_id = :branchId', { branchId });
        if (channel) qb.andWhere('(o.channel = :channel OR o.order_type = :channel)', { channel });
        this.applyBusinessDateFilter(qb, 'o', startDate, endDate);
        qb.andWhere(REVENUE_ORDER_PREDICATE('o'), { nonRevenueStates: NON_REVENUE_ORDER_STATES });

        const orders = await qb.getMany();

        type BranchBucket = {
          orders: number;
          gross: string;
          discounts: string;
          tax: string;
          net: string;
          paid: string;
          refunded: string;
        };
        const emptyBucket = (): BranchBucket => ({
          orders: 0,
          gross: '0.00',
          discounts: '0.00',
          tax: '0.00',
          net: '0.00',
          paid: '0.00',
          refunded: '0.00',
        });

        const buckets = new Map<string, BranchBucket>();
        // Seeding from the branch list first is what keeps a zero-sales branch in the
        // output; the order loop only ever adds to a bucket that already exists.
        // Zero-filling exists so a shop that sold nothing still shows up. A commissary
        // or an office selling nothing is normal, not a problem, so they are left out
        // unless they somehow carry orders — the loop below still adds those back.
        const sellingBranches = branches.filter((b) => SELLING_BRANCH_TYPES.includes(b.branch_type));
        const scoped = branchId ? sellingBranches.filter((b) => b.id === branchId) : sellingBranches;
        for (const b of scoped) buckets.set(b.id, emptyBucket());

        for (const o of orders) {
          if (!buckets.has(o.branch_id)) buckets.set(o.branch_id, emptyBucket());
          const bucket = buckets.get(o.branch_id)!;
          const tax = MoneyUtil.format(o.tax_amount || '0', 2);
          const tot = MoneyUtil.format(o.total_amount || '0', 2);
          const ref = MoneyUtil.format(o.refunded_total || '0', 2);

          bucket.orders += 1;
          bucket.gross = MoneyUtil.add(bucket.gross, MoneyUtil.format(o.subtotal_amount || '0', 2), 2);
          bucket.discounts = MoneyUtil.add(bucket.discounts, MoneyUtil.format(o.discount_amount || '0', 2), 2);
          bucket.tax = MoneyUtil.add(bucket.tax, tax, 2);
          bucket.paid = MoneyUtil.add(bucket.paid, MoneyUtil.format(o.paid_amount || '0', 2), 2);
          bucket.refunded = MoneyUtil.add(bucket.refunded, ref, 2);
          // Same definition as sales-summary: total less tax less anything given back.
          bucket.net = MoneyUtil.add(bucket.net, MoneyUtil.subtract(MoneyUtil.subtract(tot, tax, 2), ref, 2), 2);
        }

        const byId = new Map(branches.map((b) => [b.id, b]));
        const chainNet = MoneyUtil.sum(Array.from(buckets.values()).map((b) => b.net), 2);

        const rows = Array.from(buckets.entries())
          .map(([id, b]) => {
            const branch = byId.get(id);
            return {
              branch: branch ? branch.name : id,
              branch_code: branch ? branch.code : '—',
              status: branch && !branch.is_active ? 'ARCHIVED' : 'ACTIVE',
              orders: b.orders,
              gross_subtotal: b.gross,
              discounts: b.discounts,
              tax: b.tax,
              net_sales: b.net,
              // A chain is compared on ticket size as much as on volume, and the two
              // move independently — a branch can lead on revenue and trail on ticket.
              average_ticket: b.orders > 0 ? MoneyUtil.divide(b.net, String(b.orders), 2) : '0.00',
              share_of_chain: MoneyUtil.isZero(chainNet)
                ? '0.00'
                : MoneyUtil.multiply(MoneyUtil.divide(b.net, chainNet, 6), '100', 2),
              paid: b.paid,
              refunded: b.refunded,
            };
          })
          .sort((a, z) => (MoneyUtil.greaterThan(z.net_sales, a.net_sales) ? 1 : -1));

        const totalOrders = rows.reduce((sum, r) => sum + r.orders, 0);

        return {
          report_code: reportCode,
          filter_basis: 'business_date',
          rows,
          summary_totals: {
            branch_count: rows.length,
            order_count: totalOrders,
            // The viewer matches a total to its column by name, so the totals row also
            // needs the keys spelled the way this report's columns are spelled.
            orders: totalOrders,
            share_of_chain: rows.length > 0 ? '100.00' : '0.00',
            gross_subtotal: MoneyUtil.sum(rows.map((r) => r.gross_subtotal), 2),
            discounts: MoneyUtil.sum(rows.map((r) => r.discounts), 2),
            tax: MoneyUtil.sum(rows.map((r) => r.tax), 2),
            net_sales: chainNet,
            average_ticket: totalOrders > 0 ? MoneyUtil.divide(chainNet, String(totalOrders), 2) : '0.00',
            paid: MoneyUtil.sum(rows.map((r) => r.paid), 2),
            refunded: MoneyUtil.sum(rows.map((r) => r.refunded), 2),
          },
        };
      }

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
          const ref = MoneyUtil.format(o.refunded_total || '0', 2);
          const pack = MoneyUtil.format(o.packaging_total || '0', 2);
          const del = MoneyUtil.format(o.delivery_fee || '0', 2);
          const mod = MoneyUtil.format(o.modifier_total || '0', 2);
          // Net of tax AND of anything given back. paid/refunded stay gross alongside,
          // so a refunded order still shows what was tendered — but net sales moves,
          // which is what a refund is supposed to do to the day's revenue.
          const net = MoneyUtil.subtract(MoneyUtil.subtract(tot, tax, 2), ref, 2);
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
          refundedTotal = MoneyUtil.add(refundedTotal, ref, 2);
          outstandingTotal = MoneyUtil.add(outstandingTotal, out, 2);

          return {
            business_date: o.business_date || BusinessDateUtil.fromDate(o.placed_at) || '—',
            branch_id: o.branch_id,
            channel: o.order_type || 'POS',
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
            refunded: ref,
            outstanding: out,
          };
        });

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
        this.applyDateFilter(qb, 'i.created_at', startDate, endDate);
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
        }));

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
        this.applyDateFilter(qb, 'p.initiated_at', startDate, endDate);
        this.applyBranchViaOrder(qb, 'p', branchId);

        const payments = await qb.getMany();

        // Money handed back is a Refund row of its own, never a change to the payment. This
        // report used to hardcode refunds to zero, so a card refund left CARD_POS overstated
        // by exactly the refund.
        const refundQb = this.refundRepo.createQueryBuilder('r')
          .where('r.tenant_id = :tenantId', { tenantId })
          .andWhere('r.status IN (:...refundDone)', { refundDone: ['SUCCEEDED', 'COMPLETED'] });
        this.applyDateFilter(refundQb, 'r.initiated_at', startDate, endDate);
        this.applyBranchViaOrder(refundQb, 'r', branchId);
        const refunds = await refundQb.getMany();

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
          const key = p.method_kind || 'CASH';
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
          const key = r.method_kind || 'CASH';
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

      case 'mixed-payments': {
        const scopedOrderIds = await this.branchOrderIds(tenantId, branchId);
        const payments = await this.paymentRepo.find({
          where: { tenant_id: tenantId, ...(scopedOrderIds ? { order_id: In(scopedOrderIds) } : {}) },
        });
        const orderPaymentMap = new Map<string, Payment[]>();
        payments.forEach((p) => {
          if (p.order_id) {
            const list = orderPaymentMap.get(p.order_id) || [];
            list.push(p);
            orderPaymentMap.set(p.order_id, list);
          }
        });

        const mixedOrderIds = Array.from(orderPaymentMap.entries())
          .filter(([_, pmts]) => {
            const kinds = new Set(pmts.map((p) => p.method_kind));
            return kinds.size >= 2;
          })
          .map(([ordId]) => ordId);

        let rows: any[] = [];
        let totalPaid = '0.00';

        if (mixedOrderIds.length > 0) {
          const orders = await this.orderRepo.find({ where: { tenant_id: tenantId } });
          const matchedOrders = orders.filter((o) => mixedOrderIds.includes(o.id));

          rows = matchedOrders.map((o) => {
            const pmts = orderPaymentMap.get(o.id) || [];
            const paidStr = MoneyUtil.format(o.paid_amount || '0', 2);
            const totStr = MoneyUtil.format(o.total_amount || '0', 2);
            totalPaid = MoneyUtil.add(totalPaid, o.paid_amount || '0', 2);

            return {
              order_id: o.id,
              order_number: o.order_number,
              date: o.placed_at ? new Date(o.placed_at).toISOString().split('T')[0] : '—',
              branch_id: o.branch_id,
              total_amount: totStr,
              paid_amount: paidStr,
              method_count: pmts.length,
              methods: pmts.map((p) => `${p.method_kind}: ${MoneyUtil.format(p.amount || '0', 2)}`).join(', '),
            };
          });
        }

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            mixed_orders_count: rows.length,
            total_paid: totalPaid,
          },
        };
      }

      case 'mobile-pos': {
        const qb = this.paymentRepo.createQueryBuilder('p')
          .where('p.tenant_id = :tenantId', { tenantId })
          .andWhere('(p.method_kind = :mk OR p.device_id IS NOT NULL)', { mk: 'MOBILE_POS' });
        this.applyDateFilter(qb, 'p.initiated_at', startDate, endDate);
        this.applyBranchViaOrder(qb, 'p', branchId);

        const payments = await qb.getMany();
        let totalAmt = '0.00';
        let totalRef = '0.00';

        const rows = payments.map((p) => {
          const amtStr = MoneyUtil.format(p.amount || '0', 2);
          const refStr = '0.00';
          totalAmt = MoneyUtil.add(totalAmt, p.amount || '0', 2);
          totalRef = MoneyUtil.add(totalRef, refStr, 2);

          return {
            payment_id: p.id,
            order_id: p.order_id,
            date: p.initiated_at ? new Date(p.initiated_at).toISOString().split('T')[0] : '—',
            device_id: p.device_id || 'MOBILE_POS_DEV_1',
            reference_number: p.reference || 'REF-POS-100',
            amount: amtStr,
            refunded_amount: refStr,
            status: p.status,
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            mobile_pos_count: rows.length,
            total_amount: totalAmt,
            total_refunded: totalRef,
          },
        };
      }

      case 'alternative-refunds': {
        const qb = this.refundRepo.createQueryBuilder('r')
          .where('r.tenant_id = :tenantId', { tenantId });
        this.applyDateFilter(qb, 'r.initiated_at', startDate, endDate);
        this.applyBranchViaOrder(qb, 'r', branchId);

        const refunds = await qb.getMany();
        let totalAmt = '0.00';

        const rows = refunds
          .filter((r) => r.is_alternative_method)
          .map((r) => {
            const amtStr = MoneyUtil.format(r.amount || '0', 2);
            totalAmt = MoneyUtil.add(totalAmt, r.amount || '0', 2);

            return {
              refund_id: r.id,
              order_id: r.order_id,
              date: r.initiated_at ? new Date(r.initiated_at).toISOString().split('T')[0] : '—',
              original_method: 'CASH',
              target_method: r.method_kind || 'BANK_TRANSFER',
              amount: amtStr,
              reason: r.reason_text || r.reason_code_id || 'Customer Request',
              approval_id: r.approval_request_id || 'APPR-AUTO',
              status: r.status,
            };
          });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            alternative_refund_count: rows.length,
            amount: totalAmt,
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

      case 'manual-discounts': {
        const manualOrderIds = await this.branchOrderIds(tenantId, branchId);
        const adjustments = await this.adjustmentRepo.find({
          where: { tenant_id: tenantId, ...(manualOrderIds ? { order_id: In(manualOrderIds) } : {}) },
        });
        let totalManual = '0.00';
        const manual = adjustments.filter((a) => a.type === 'MANUAL' || a.source_type === 'MANUAL');

        // Who rang it up and who let it through, read from the order and the escalation the
        // discount was submitted with. These were hardcoded to 'CASHIER-1' and 'NONE', so a
        // manager-approved discount was reported as unapproved and by nobody.
        const manager = this.adjustmentRepo.manager;
        const orderIds = [...new Set(manual.map((a) => a.order_id))];
        const orders = orderIds.length ? await manager.find(OrderHeader, { where: { tenant_id: tenantId, id: In(orderIds) } }) : [];
        const orderById = new Map(orders.map((o) => [o.id, o]));
        const approvalIds = [...new Set(manual.map((a) => a.calculation_snapshot?.approvalRequestId).filter(Boolean))] as string[];
        const approvals = approvalIds.length ? await manager.find(ApprovalRequest, { where: { tenant_id: tenantId, id: In(approvalIds) } }) : [];
        const approvalById = new Map(approvals.map((r) => [r.id, r]));
        const decisions = approvalIds.length
          ? await manager.find(ApprovalDecision, { where: { tenant_id: tenantId, request_id: In(approvalIds), decision: 'APPROVED' } })
          : [];
        const approverByRequest = new Map(decisions.map((d) => [d.request_id, d.approver_user_id]));
        const userIds = [
          ...new Set([...orders.map((o) => o.created_by), ...decisions.map((d) => d.approver_user_id)].filter(Boolean)),
        ] as string[];
        const users = userIds.length ? await manager.find(AdminUser, { where: { tenant_id: tenantId, id: In(userIds) } }) : [];
        const nameOf = (id?: string | null) => (id ? users.find((u) => u.id === id)?.display_name || id : null);

        const rows = manual.map((a) => {
          const amtStr = MoneyUtil.format(a.amount || '0', 2);
          totalManual = MoneyUtil.add(totalManual, a.amount || '0', 2);
          const order = orderById.get(a.order_id);
          const approvalId: string | null = a.calculation_snapshot?.approvalRequestId || null;
          const approval = approvalId ? approvalById.get(approvalId) : undefined;
          const recordsApproval = a.calculation_snapshot && 'approvalRequestId' in a.calculation_snapshot;

          return {
            adjustment_id: a.id,
            order_id: a.order_id,
            order_number: order?.order_number || null,
            cashier_id: order?.created_by || null,
            cashier_name: nameOf(order?.created_by),
            amount: amtStr,
            reason: a.name || null,
            // WITHIN_LIMIT: no escalation was needed. NOT_RECORDED: the discount predates
            // approvals being kept on the adjustment, so the report cannot tell.
            approval_status: approval ? approval.status : recordsApproval ? 'WITHIN_LIMIT' : 'NOT_RECORDED',
            approval_request_id: approvalId,
            approved_by: nameOf(approverByRequest.get(approvalId || '')),
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            manual_discount_count: rows.length,
            amount: totalManual,
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

      case 'cash-discrepancies': {
        const shifts = await this.cashierShiftRepo.find({
          where: { tenant_id: tenantId, ...this.branchWhere(branchId) },
        });
        let totalAbsVariance = '0.00';

        const rows = shifts
          .filter((s) => MoneyUtil.greaterThan(MoneyUtil.abs(s.short_over || '0', 4), '0.001'))
          .map((s) => {
            const varStr = MoneyUtil.format(s.short_over || '0', 2);
            totalAbsVariance = MoneyUtil.add(totalAbsVariance, MoneyUtil.abs(s.short_over || '0', 2), 2);

            return {
              shift_id: s.id,
              date: s.closed_at ? new Date(s.closed_at).toISOString().split('T')[0] : '—',
              branch_id: s.branch_id,
              cashier_id: s.opened_by || 'CASHIER-1',
              expected_cash: MoneyUtil.format(s.expected_cash || '0', 2),
              actual_cash: MoneyUtil.format(s.actual_cash || '0', 2),
              variance: varStr,
              reason: s.closing_note || 'Till Over/Short',
              approval_status: s.approval_request_id ? 'APPROVED' : 'PENDING_REVIEW',
            };
          });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            discrepancy_count: rows.length,
            total_discrepancy_amount: totalAbsVariance,
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
            date: e.posted_at ? new Date(e.posted_at).toISOString().split('T')[0] : '—',
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

      case 'credit-eod-usage': {
        // Deliberately chain-wide. A credit account carries no branch — the customer owes the
        // chain, not a shop — so there is no branch answer to give, and attributing only the
        // entries that happen to hang off an order would show a manager purchases without the
        // repayments that settle them. Credit is a manager's area by design; see the
        // @Roles(...MANAGER_AND_ABOVE) on CreditController.
        const entries = await this.creditEntryRepo.find({ where: { tenant_id: tenantId, entry_type: 'PURCHASE' } });
        let totalUsage = '0.00';

        const rows = entries.map((e) => {
          const amtStr = MoneyUtil.abs(e.amount || '0', 2);
          totalUsage = MoneyUtil.add(totalUsage, amtStr, 2);

          return {
            date: e.posted_at ? new Date(e.posted_at).toISOString().split('T')[0] : '—',
            account_id: e.account_id,
            order_id: e.order_id || '—',
            purchase_amount: amtStr,
            balance_after: MoneyUtil.format(e.balance_after || '0', 2),
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            usage_count: entries.length,
            purchase_amount: totalUsage,
          },
        };
      }

      case 'credit-aging': {
        // Deliberately chain-wide. A credit account carries no branch — the customer owes the
        // chain, not a shop — so there is no branch answer to give, and attributing only the
        // entries that happen to hang off an order would show a manager purchases without the
        // repayments that settle them. Credit is a manager's area by design; see the
        // @Roles(...MANAGER_AND_ABOVE) on CreditController.
        const accounts = await this.creditAccountRepo.find({ where: { tenant_id: tenantId } });
        let totalBalance = '0.00';

        const rows = accounts.map((a) => {
          const balStr = MoneyUtil.format(a.current_balance || '0', 2);
          const limStr = MoneyUtil.format(a.credit_limit || '0', 2);
          const availStr = MoneyUtil.subtract(limStr, balStr, 2);
          totalBalance = MoneyUtil.add(totalBalance, balStr, 2);

          return {
            account_id: a.id,
            customer_id: a.customer_id,
            status: a.status || 'ACTIVE',
            credit_limit: limStr,
            current_balance: balStr,
            available_credit: availStr,
            current_0_30: balStr,
            aging_31_60: '0.00',
            aging_61_90: '0.00',
            aging_90_plus: '0.00',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            account_count: accounts.length,
            current_balance: totalBalance,
          },
        };
      }

      case 'customer-activity': {
        // Customers belong to the chain and carry no branch. What a branch may see is its
        // own trade with them, so the activity is counted from its own orders.
        const customers = await this.customerRepo.find({ where: { tenant_id: tenantId } });
        const orders = await this.orderRepo.find({
          where: { tenant_id: tenantId, ...this.branchWhere(branchId) },
        });

        const custOrderMap = new Map<string, OrderHeader[]>();
        orders.forEach((o) => {
          if (o.customer_id) {
            const list = custOrderMap.get(o.customer_id) || [];
            list.push(o);
            custOrderMap.set(o.customer_id, list);
          }
        });

        let totalGross = '0.00';

        const rows = customers.map((c) => {
          const cOrders = custOrderMap.get(c.id) || [];
          const grossStr = cOrders.reduce((sum, o) => MoneyUtil.add(sum, o.total_amount || '0', 2), '0.00');
          totalGross = MoneyUtil.add(totalGross, grossStr, 2);

          return {
            customer_id: c.id,
            customer_name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Valued Customer',
            phone: c.mobile || '—',
            order_count: cOrders.length,
            gross_sales: grossStr,
            first_order_date: cOrders.length > 0 ? new Date(cOrders[cOrders.length - 1].placed_at).toISOString().split('T')[0] : '—',
            last_order_date: cOrders.length > 0 ? new Date(cOrders[0].placed_at).toISOString().split('T')[0] : '—',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            total_customers: customers.length,
            gross_sales: totalGross,
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
            date: o.placed_at ? new Date(o.placed_at).toISOString().split('T')[0] : '—',
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

      case 'courier-attendance': {
        const attendances = await this.attendanceRepo.find({
          where: { tenant_id: tenantId, ...this.branchWhere(branchId) },
        });
        let totalHours = 0;

        const rows = attendances.map((a) => {
          const inTime = a.checked_in_at ? new Date(a.checked_in_at).getTime() : Date.now();
          const outTime = a.checked_out_at ? new Date(a.checked_out_at).getTime() : Date.now();
          const hrs = Math.max(0, (outTime - inTime) / (1000 * 60 * 60));
          totalHours += hrs;

          return {
            attendance_id: a.id,
            courier_id: a.courier_id,
            date: a.checked_in_at ? new Date(a.checked_in_at).toISOString().split('T')[0] : '—',
            check_in: a.checked_in_at ? new Date(a.checked_in_at).toLocaleTimeString() : '—',
            check_out: a.checked_out_at ? new Date(a.checked_out_at).toLocaleTimeString() : '—',
            status: a.status || 'CHECKED_IN',
            duration_hours: MoneyUtil.format(hrs, 1),
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            roster_entries: attendances.length,
            total_duration_hours: MoneyUtil.format(totalHours, 1),
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

      case 'courier-reconciliation': {
        const scopedSettlements = await this.settlementRepo.find({
          where: { tenant_id: tenantId, ...this.branchWhere(branchId) },
          select: ['id'],
        });
        const lines = scopedSettlements.length
          ? await this.settlementLineRepo.find({
              where: { settlement_id: In(scopedSettlements.map((s) => s.id)) },
            })
          : [];
        let totalCash = '0.00';
        let totalPos = '0.00';

        const rows = lines.map((l) => {
          const cashStr = MoneyUtil.format(l.actual_cash || '0', 2);
          const posStr = MoneyUtil.format(l.actual_pos || '0', 2);
          totalCash = MoneyUtil.add(totalCash, cashStr, 2);
          totalPos = MoneyUtil.add(totalPos, posStr, 2);

          return {
            line_id: l.id,
            order_id: l.order_id,
            delivery_assignment_id: l.delivery_assignment_id,
            cash_collected: cashStr,
            pos_collected: posStr,
            receipt_reference: 'REF-1234',
            discrepancy_reason: l.notes || 'NONE',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            line_count: lines.length,
            cash_collected: totalCash,
            pos_collected: totalPos,
          },
        };
      }

      case 'tax-packaging': {
        const orders = await this.orderRepo.find({
          where: { tenant_id: tenantId, ...this.branchWhere(branchId) },
        });
        let totalTaxable = '0.00';
        let totalTax = '0.00';
        let totalPackaging = '0.00';

        const rows = orders.map((o) => {
          const subStr = MoneyUtil.format(o.subtotal_amount || '0', 2);
          const taxStr = MoneyUtil.format(o.tax_amount || '0', 2);
          const packStr = MoneyUtil.format(o.packaging_total || '0', 2);

          totalTaxable = MoneyUtil.add(totalTaxable, subStr, 2);
          totalTax = MoneyUtil.add(totalTax, taxStr, 2);
          totalPackaging = MoneyUtil.add(totalPackaging, packStr, 2);

          return {
            order_number: o.order_number,
            date: o.placed_at ? new Date(o.placed_at).toISOString().split('T')[0] : '—',
            taxable_amount: subStr,
            tax_rate: '9.0%',
            tax_amount: taxStr,
            packaging_fee: packStr,
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            order_count: orders.length,
            taxable_amount: totalTaxable,
            tax_amount: totalTax,
            packaging_fee: totalPackaging,
          },
        };
      }

      case 'print-operations': {
        const jobs = await this.printJobRepo.find({
          where: { tenant_id: tenantId, ...this.branchWhere(branchId) },
        });
        let totalAttempts = 0;

        const rows = jobs.map((j) => {
          const attempts = j.copies || 1;
          totalAttempts += attempts;

          return {
            job_id: j.id,
            time: j.created_at ? new Date(j.created_at).toISOString() : '—',
            entity_type: j.entity_type || 'KITCHEN_TICKET',
            printer_id: j.printer_id || 'PRINTER-1',
            status: j.status || 'COMPLETED',
            attempts,
            error_message: j.reason || '—',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            job_count: jobs.length,
            total_attempts: totalAttempts,
          },
        };
      }

      case 'integration-operations': {
        const logs = await this.integrationLogRepo.find({ where: { tenant_id: tenantId } });
        let totalLatency = 0;

        const rows = logs.map((l) => {
          const lat = 120;
          totalLatency += lat;

          return {
            log_id: l.id,
            time: l.created_at ? new Date(l.created_at).toISOString() : '—',
            kind: l.provider || 'SNAPPFOOD',
            operation: l.event_type || 'ORDER_WEBHOOK',
            status: l.status || 'SUCCESS',
            latency_ms: lat,
            error_message: l.error_message || '—',
          };
        });

        return {
          report_code: reportCode,
          rows,
          summary_totals: {
            log_count: logs.length,
            avg_latency_ms: logs.length > 0 ? (totalLatency / logs.length).toFixed(0) : '0',
          },
        };
      }

      case 'v5-preview-inventory': {
        return {
          report_code: reportCode,
          is_v5_preview: true,
          label: 'V5 Preview Module Report',
          rows: [],
          summary_totals: {
            total_v5_records: 0,
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

    const job = this.exportJobRepo.create({
      tenant_id: tenantId,
      report_code: reportCode,
      format,
      filters,
      status: 'COMPLETED',
      filename,
      file_size: Buffer.from(contentBase64, 'base64').length,
      file_content_base64: contentBase64,
      completed_at: new Date(),
    });
    const savedJob = await this.exportJobRepo.save(job);

    // Audit Export
    await this.auditRepo.save(
      this.auditRepo.create({
        tenant_id: tenantId,
        actor_type: 'ADMIN',
        event_type: 'REPORT_EXPORTED',
        action: 'REPORT_EXPORTED',
        entity_type: 'ReportExportJob',
        entity_id: savedJob.id,
        correlation_id: savedJob.id,
        details: { reportCode, format, filename },
      }),
    );

    return {
      export_job_id: savedJob.id,
      filename,
      mime_type: format === 'CSV' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content_base64: contentBase64,
      content: utf8Content,
    };
  }

  async getExportJob(tenantId: string, id: string) {
    const job = await this.exportJobRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!job) throw new NotFoundException('Export job not found');
    return job;
  }

  // Saved Report Views
  async getSavedViews(tenantId: string, reportCode?: string) {
    const where: any = { tenant_id: tenantId };
    if (reportCode) where.report_code = reportCode;
    return await this.savedViewRepo.find({ where, order: { created_at: 'DESC' } });
  }

  async createSavedView(tenantId: string, userId: string, dto: any) {
    const view = this.savedViewRepo.create({
      tenant_id: tenantId,
      user_id: userId,
      name: dto.name || 'Saved View',
      report_code: dto.reportCode,
      filters: dto.filters || {},
      column_order: dto.columnOrder || [],
      column_visibility: dto.columnVisibility || {},
      grouping: dto.grouping,
      sort_by: dto.sortBy,
      is_default: Boolean(dto.isDefault),
    });
    const saved = await this.savedViewRepo.save(view);

    await this.auditRepo.save(
      this.auditRepo.create({
        tenant_id: tenantId,
        actor_type: 'ADMIN',
        event_type: 'SAVED_VIEW_CREATED',
        action: 'SAVED_VIEW_CREATED',
        entity_type: 'SavedReportView',
        entity_id: saved.id,
        correlation_id: saved.id,
        details: { name: saved.name, reportCode: saved.report_code },
      }),
    );

    return saved;
  }

  async deleteSavedView(tenantId: string, id: string) {
    const view = await this.savedViewRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!view) throw new NotFoundException('Saved view not found');
    await this.savedViewRepo.remove(view);
    return { success: true };
  }

  // Audit Logs with Masking & Paging
  /**
   * `branchId` confines the trail to one site. Most writers never tag a branch on the event,
   * so an event counts as the site's when it is tagged there or when one of the site's own
   * accounts did it. Head office's untagged work — menu edits, price changes — stays out.
   */
  async getAuditLogs(tenantId: string, query: any = {}, branchId?: string) {
    const { page = 1, limit = 50, action, actorType, entityId, entityType } = query;
    const qb = this.auditRepo.createQueryBuilder('a').where('a.tenant_id = :tenantId', { tenantId });

    if (branchId) {
      qb.andWhere(
        '(a.branch_id = :branchId OR a.actor_id IN (SELECT u.id FROM admin_user u WHERE u.branch_id = :branchId))',
        { branchId },
      );
    }

    if (action) qb.andWhere('a.action = :action', { action });
    if (actorType) qb.andWhere('a.actor_type = :actorType', { actorType });
    if (entityId) qb.andWhere('a.entity_id = :entityId', { entityId });
    if (entityType) qb.andWhere('a.entity_type = :entityType', { entityType });

    const [events, total] = await qb
      .orderBy('a.occurred_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const maskedEvents = events.map((e) => {
      const maskPayload = (obj: any) => {
        if (!obj || typeof obj !== 'object') return obj;
        const copy = JSON.parse(JSON.stringify(obj));
        if (copy.password) copy.password = '***MASKED***';
        if (copy.pin) copy.pin = '***MASKED***';
        if (copy.card_number) copy.card_number = '**** **** **** 1234';
        return copy;
      };

      return {
        ...e,
        before_data: maskPayload(e.before_data),
        after_data: maskPayload(e.after_data),
        details: maskPayload(e.details),
      };
    });

    return {
      data: maskedEvents,
      total,
      page: Number(page),
      limit: Number(limit),
    };
  }

  // Operational Alerts
  /** `branchId` confines the list to one site's alerts; head office passes nothing. */
  async getAlerts(tenantId: string, branchId?: string) {
    // The demo seed is decided on the whole tenant's count. Deciding it on the filtered one
    // would reseed every time a branch with no alerts of its own opened the screen.
    let alerts = await this.alertRepo.find({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });

    if (alerts.length === 0) {
      // Seed default operational alerts into PostgreSQL
      const alert1 = this.alertRepo.create({
        tenant_id: tenantId,
        type: 'CASH_DISCREPANCY',
        severity: 'WARNING',
        title: 'Cash Drawer Variance Detected',
        message: 'Shift SHIFT-1002 closed with cash discrepancy requiring manager approval.',
        acknowledged: false,
      });

      const alert2 = this.alertRepo.create({
        tenant_id: tenantId,
        type: 'PRINTER_FAULT',
        severity: 'CRITICAL',
        title: 'Kitchen Printer Spooler Failure',
        message: 'Kitchen Station #1 printer out of paper. Print jobs rerouted to Station #2.',
        acknowledged: false,
      });

      alerts = await this.alertRepo.save([alert1, alert2]);
    }

    return branchId ? alerts.filter((a) => a.branch_id === branchId) : alerts;
  }

  async acknowledgeAlert(tenantId: string, alertId: string, userId?: string, branchId?: string) {
    const alert = await this.alertRepo.findOne({ where: { id: alertId, tenant_id: tenantId } });
    // Another site's alert is answered as if it did not exist, the same as the list does.
    if (!alert || (branchId && alert.branch_id !== branchId)) throw new NotFoundException('Alert not found');

    alert.acknowledged = true;
    alert.acknowledged_by = userId || 'ADMIN';
    alert.acknowledged_at = new Date();
    const updated = await this.alertRepo.save(alert);

    // Audit alert acknowledgment
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId || '');
    await this.auditRepo.save(
      this.auditRepo.create({
        tenant_id: tenantId,
        actor_type: 'ADMIN',
        actor_id: isUuid ? userId : undefined,
        event_type: 'ALERT_ACKNOWLEDGED',
        action: 'ALERT_ACKNOWLEDGED',
        entity_type: 'OperationalAlert',
        entity_id: alertId,
        correlation_id: alertId,
        details: { title: alert.title, severity: alert.severity, acknowledged_by: userId },
      }),
    );

    return updated;
  }

  // Server-Derived Dashboard KPIs & Monitoring Summaries
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
    const alerts = await this.getAlerts(tenantId, branchId);

    const todayStr = new Date().toISOString().split('T')[0];
    const todayOrders = orders.filter((o) => o.placed_at && new Date(o.placed_at).toISOString().startsWith(todayStr));
    const salesToday = todayOrders.reduce((sum, o) => MoneyUtil.add(sum, o.total_amount || '0', 2), '0.00');
    const openOrders = orders.filter((o) => o.status === 'SUBMITTED' || o.status === 'ACCEPTED' || o.status === 'IN_PREPARATION');
    const openAlerts = alerts.filter((a) => !a.acknowledged);

    return {
      sales_today: salesToday,
      open_orders_count: openOrders.length,
      active_shifts_count: shifts.length,
      open_alerts_count: openAlerts.length,
      branch_health_percentage: 100,
      /** Null when the figures cover the whole chain, so the screen can say which it is. */
      branch_id: branchId ?? null,
      timestamp: new Date().toISOString(),
    };
  }
}
