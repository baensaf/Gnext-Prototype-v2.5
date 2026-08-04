import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Payment } from '../../entities/Payment.entity';
import { AuditEvent } from '../../entities/AuditEvent.entity';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { CashDrawerShift } from '../../entities/CashDrawerShift.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';

@Injectable()
export class ReportsService {
  private alertsStore: Array<{
    id: string;
    tenant_id: string;
    type: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    title: string;
    message: string;
    acknowledged: boolean;
    created_at: Date;
  }> = [
    {
      id: 'alert-1',
      tenant_id: 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e',
      type: 'CASH_DISCREPANCY',
      severity: 'WARNING',
      title: 'Cash Drawer Variance Detected',
      message: 'Shift SHIFT-1002 closed with $15.00 cash discrepancy requiring manager approval.',
      acknowledged: false,
      created_at: new Date(Date.now() - 3600000),
    },
    {
      id: 'alert-2',
      tenant_id: 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e',
      type: 'PRINTER_FAULT',
      severity: 'CRITICAL',
      title: 'Kitchen Printer Spooler Failure',
      message: 'Kitchen Station #1 printer out of paper. Print jobs rerouted to Station #2.',
      acknowledged: false,
      created_at: new Date(Date.now() - 7200000),
    },
  ];

  constructor(
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(AuditEvent) private readonly auditRepo: Repository<AuditEvent>,
    @InjectRepository(IntegrationLog) private readonly integrationLogRepo: Repository<IntegrationLog>,
    @InjectRepository(CashDrawerShift) private readonly shiftRepo: Repository<CashDrawerShift>,
    @InjectRepository(CourierSettlement) private readonly settlementRepo: Repository<CourierSettlement>,
  ) {}

  async getCatalog() {
    return [
      { code: 'sales-summary', name: 'Sales Summary', category: 'FINANCIAL' },
      { code: 'product-sales', name: 'Product & Category Velocity', category: 'CATALOG' },
      { code: 'payments-by-method', name: 'Payment Methods & Allocations', category: 'PAYMENT' },
      { code: 'discounts', name: 'Discounts & Promotion Performance', category: 'PROMOTION' },
      { code: 'cashier-shifts', name: 'Cashier Shifts & EOD Balancing', category: 'CASH' },
      { code: 'courier-settlements', name: 'Courier Cash & POS Settlements', category: 'DELIVERY' },
      { code: 'tax-packaging', name: 'Tax & Packaging Compliance', category: 'TAX' },
      { code: 'integration-operations', name: 'Integration & Webhook Operations', category: 'SIMULATION' },
    ];
  }

  async queryReport(tenantId: string, reportCode: string, filters: any = {}) {
    const orders = await this.orderRepo.find({ where: { tenant_id: tenantId } });

    if (reportCode === 'sales-summary') {
      let grossSubtotal = 0;
      let taxTotal = 0;
      let totalSales = 0;
      let paidTotal = 0;
      let orderCount = orders.length;

      const rows = orders.map((o) => {
        const sub = parseFloat(o.subtotal_amount || '0');
        const tax = parseFloat(o.tax_amount || '0');
        const tot = parseFloat(o.total_amount || '0');
        const paid = parseFloat(o.paid_amount || '0');

        grossSubtotal += sub;
        taxTotal += tax;
        totalSales += tot;
        paidTotal += paid;

        return {
          order_number: o.order_number,
          order_type: o.order_type,
          status: o.status,
          subtotal: sub.toFixed(2),
          tax: tax.toFixed(2),
          total: tot.toFixed(2),
          paid: paid.toFixed(2),
          date: o.placed_at,
        };
      });

      return {
        report_code: reportCode,
        filter_basis: 'business_date',
        rows,
        summary_totals: {
          order_count: orderCount,
          gross_subtotal: grossSubtotal.toFixed(2),
          tax_total: taxTotal.toFixed(2),
          net_sales: totalSales.toFixed(2),
          paid_total: paidTotal.toFixed(2),
        },
      };
    }

    if (reportCode === 'product-sales') {
      const items = await this.orderItemRepo.find({ where: { tenant_id: tenantId } });
      let totalQty = 0;
      let totalAmount = 0;

      const rows = items.map((i) => {
        const qty = parseFloat(i.quantity || '1');
        const tot = parseFloat(i.total_amount || '0');
        totalQty += qty;
        totalAmount += tot;

        return {
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: qty,
          unit_price: parseFloat(i.unit_price || '0').toFixed(2),
          total_sales: tot.toFixed(2),
        };
      });

      return {
        report_code: reportCode,
        rows,
        summary_totals: {
          total_items: items.length,
          total_quantity: totalQty,
          total_sales: totalAmount.toFixed(2),
        },
      };
    }

    return {
      report_code: reportCode,
      rows: [
        { id: '1', name: 'Sample Record 1', amount: '100.00', date: new Date() },
        { id: '2', name: 'Sample Record 2', amount: '250.00', date: new Date() },
      ],
      summary_totals: {
        total_records: 2,
        total_amount: '350.00',
      },
    };
  }

  async exportReport(tenantId: string, reportCode: string, filters: any = {}, format: 'CSV' | 'XLSX' = 'CSV') {
    const report = await this.queryReport(tenantId, reportCode, filters);

    if (format === 'CSV') {
      let csvContent = '\uFEFF';
      if (report.rows.length > 0) {
        const headers = Object.keys(report.rows[0]);
        csvContent += headers.join(',') + '\n';

        for (const row of report.rows) {
          const values = headers.map((h) => `"${String((row as any)[h]).replace(/"/g, '""')}"`);
          csvContent += values.join(',') + '\n';
        }
      }

      if (report.summary_totals) {
        csvContent += '\nTOTALS,' + Object.values(report.summary_totals).join(',') + '\n';
      }

      return {
        filename: `${reportCode}-${Date.now()}.csv`,
        mime_type: 'text/csv; charset=utf-8',
        content: csvContent,
      };
    }

    return {
      filename: `${reportCode}-${Date.now()}.xlsx`,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: Buffer.from('MOCK_XLSX_BINARY_STREAM').toString('base64'),
    };
  }

  async getAuditLogs(tenantId: string, filters: any = {}) {
    const events = await this.auditRepo.find({
      where: { tenant_id: tenantId },
      order: { occurred_at: 'DESC' },
      take: 100,
    });

    const maskedEvents = events.map((e) => {
      const maskPayload = (obj: any) => {
        if (!obj || typeof obj !== 'object') return obj;
        const copy = { ...obj };
        if (copy.password) copy.password = '***MASKED***';
        if (copy.pin) copy.pin = '***MASKED***';
        if (copy.card_number) copy.card_number = '**** **** **** 1234';
        return copy;
      };

      return {
        ...e,
        before_data: maskPayload(e.before_data),
        after_data: maskPayload(e.after_data),
      };
    });

    return maskedEvents;
  }

  async getAlerts(tenantId: string) {
    return this.alertsStore.filter((a) => a.tenant_id === tenantId);
  }

  async acknowledgeAlert(tenantId: string, alertId: string) {
    const alert = this.alertsStore.find((a) => a.id === alertId && a.tenant_id === tenantId);
    if (!alert) throw new NotFoundException('Alert not found');
    alert.acknowledged = true;
    return alert;
  }
}
