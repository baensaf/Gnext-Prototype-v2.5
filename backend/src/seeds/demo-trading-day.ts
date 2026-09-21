import { EntityManager } from 'typeorm';
import { OrderHeader } from '../entities/OrderHeader.entity';
import { OrderItem } from '../entities/OrderItem.entity';
import { OrderStateEvent } from '../entities/OrderStateEvent.entity';
import { Payment } from '../entities/Payment.entity';
import { PaymentAllocation } from '../entities/PaymentAllocation.entity';
import { PaymentMethod } from '../entities/PaymentMethod.entity';
import { Refund } from '../entities/Refund.entity';
import { RefundAllocation } from '../entities/RefundAllocation.entity';
import { Branch } from '../entities/Branch.entity';
import { Terminal } from '../entities/Terminal.entity';
import { Product } from '../entities/Product.entity';
import { ProductVariant } from '../entities/ProductVariant.entity';
import { CashierShift } from '../entities/CashierShift.entity';
import { CashMovement } from '../entities/CashMovement.entity';
import { BusinessDayClose } from '../entities/BusinessDayClose.entity';
import { MoneyUtil } from '../common/utils/money.util';
import { BusinessDateUtil } from '../common/utils/business-date.util';

/**
 * Seeds one completed trading day so the reports, shift and business-day screens open
 * with content instead of empty state, and so the figures on them cross-foot.
 *
 * The numbers are chosen to be narratable and to demonstrate the reconciliation rules.
 * Prices are Iran Burger's menu prices in rial (see iranburger-data.ts):
 *
 *   ORD-DEMO-0001  24,200,000 + 9% tax = 26,378,000   cash
 *   ORD-DEMO-0002  23,200,000 + 9% tax = 25,288,000   card
 *   ORD-DEMO-0003  22,300,000 + 9% tax = 24,307,000   cash
 *   ORD-DEMO-0004  13,600,000 + 9% tax = 14,824,000   card, 2,700,000 refunded
 *   ORD-DEMO-0005  19,150,000 + 9% tax = 20,873,500   CANCELLED, never paid
 *
 *   Gross subtotal   83,300,000      (cancelled order excluded)
 *   Tax               7,497,000
 *   Day total        90,797,000      = business_day_close.totals.totalSales
 *   Refunded          2,700,000
 *   Net sales        80,600,000      = total - tax - refunded
 *
 *   Opening float     5,000,000
 *   Cash takings     50,685,000      (orders 1 and 3; the refund went back to card)
 *   Expected cash    55,685,000      actual matches, so the shift closes with zero variance
 *
 * The day is dated yesterday, which leaves today clean for the live demo: whatever the
 * operator rings up is the only thing on today's figures.
 */

const DEMO_ORDER_PREFIX = 'ORD-DEMO-';

type SeededLine = { code: string; variantCode?: string; qty: number };

type SeededOrder = {
  number: string;
  orderType: string;
  subtotal: string;
  tax: string;
  total: string;
  lines: SeededLine[];
  tender: 'CASH' | 'CARD_POS' | null;
  cancelled?: boolean;
  refund?: string;
};

// Product codes are Iran Burger's own.
const IRAN_BURGER = '101001'; // 9,400,000
const CHEESEBURGER = '101054'; // 7,400,000
const ZINGER = '101012'; // 5,800,000
const HOT_DOG = '102001'; // 8,200,000
const MIXED_PIZZA = '11106'; // 11,000,000
const BLUE_COMBO = '11303'; // 9,750,000
const SALAD = '104001'; // 3,900,000
const FRIES = '104003'; // 2,700,000

const DEMO_ORDERS: SeededOrder[] = [
  {
    number: `${DEMO_ORDER_PREFIX}0001`,
    orderType: 'DINE_IN',
    subtotal: '24200000.0000',
    tax: '2178000.0000',
    total: '26378000.0000',
    // 2 x 9,400,000 + 2 x 2,700,000
    lines: [
      { code: IRAN_BURGER, qty: 2 },
      { code: FRIES, qty: 2 },
    ],
    tender: 'CASH',
  },
  {
    number: `${DEMO_ORDER_PREFIX}0002`,
    orderType: 'TAKEAWAY',
    subtotal: '23200000.0000',
    tax: '2088000.0000',
    total: '25288000.0000',
    // 4 x 5,800,000
    lines: [{ code: ZINGER, qty: 4 }],
    tender: 'CARD_POS',
  },
  {
    number: `${DEMO_ORDER_PREFIX}0003`,
    orderType: 'DINE_IN',
    subtotal: '22300000.0000',
    tax: '2007000.0000',
    total: '24307000.0000',
    // 11,000,000 + 7,400,000 + 3,900,000
    lines: [
      { code: MIXED_PIZZA, qty: 1 },
      { code: CHEESEBURGER, qty: 1 },
      { code: SALAD, qty: 1 },
    ],
    tender: 'CASH',
  },
  {
    number: `${DEMO_ORDER_PREFIX}0004`,
    orderType: 'TAKEAWAY',
    subtotal: '13600000.0000',
    tax: '1224000.0000',
    total: '14824000.0000',
    // 8,200,000 + 2 x 2,700,000; one portion of fries comes back
    lines: [
      { code: HOT_DOG, qty: 1 },
      { code: FRIES, qty: 2 },
    ],
    tender: 'CARD_POS',
    refund: '2700000.0000',
  },
  {
    number: `${DEMO_ORDER_PREFIX}0005`,
    orderType: 'DINE_IN',
    subtotal: '19150000.0000',
    tax: '1723500.0000',
    total: '20873500.0000',
    // 9,750,000 + 9,400,000
    lines: [
      { code: BLUE_COMBO, qty: 1 },
      { code: IRAN_BURGER, qty: 1 },
    ],
    tender: null,
    cancelled: true,
  },
];

const OPENING_FLOAT = '5000000.0000';

export interface DemoTradingDayResult {
  seeded: boolean;
  businessDate: string;
  orderCount: number;
  totalSales: string;
  netSales: string;
  expectedCash: string;
}

export async function seedDemoTradingDay(
  em: EntityManager,
  tenantId: string,
  userId?: string,
): Promise<DemoTradingDayResult> {
  const businessDate = yesterday();

  // Idempotent: the trading day is either fully present or fully absent.
  const existing = await em.findOne(OrderHeader, {
    where: { tenant_id: tenantId, order_number: DEMO_ORDERS[0].number },
  });
  if (existing) {
    return summarise(businessDate, false);
  }

  const branch = await em.findOne(Branch, { where: { tenant_id: tenantId, code: 'TEH-CENTRAL' } });
  const terminal = await em.findOne(Terminal, { where: { tenant_id: tenantId, code: 'TERM-01' } });
  if (!branch || !terminal) {
    // Master data has not been seeded yet; nothing to attach the day to.
    return summarise(businessDate, false);
  }

  const methods = await em.find(PaymentMethod, { where: { tenant_id: tenantId } });
  const methodByCode = new Map(methods.map((m) => [m.code, m]));
  const products = await em.find(Product, { where: { tenant_id: tenantId } });
  const productByCode = new Map(products.map((p) => [p.code, p]));
  const variants = await em.find(ProductVariant, { where: { tenant_id: tenantId } });
  const variantByCode = new Map(variants.map((v) => [v.code, v]));

  const placedAt = new Date();
  placedAt.setDate(placedAt.getDate() - 1);
  placedAt.setHours(19, 30, 0, 0);

  const shift = await em.save(
    em.create(CashierShift, {
      tenant_id: tenantId,
      branch_id: branch.id,
      terminal_id: terminal.id,
      shift_number: `SHF-${businessDate.replace(/-/g, '')}-DEMO`,
      state: 'CLOSED',
      status: 'CLOSED',
      currency_code: 'IRR',
      business_date: businessDate,
      opened_by: userId || null,
      closed_by: userId || null,
      closed_at: placedAt,
      opening_cash: OPENING_FLOAT,
      opening_float: OPENING_FLOAT,
    }),
  );

  await em.save(
    em.create(CashMovement, {
      tenant_id: tenantId,
      shift_id: shift.id,
      type: 'OPENING_FLOAT',
      amount: OPENING_FLOAT,
      currency_code: 'IRR',
      posted_by: userId || null,
      reference: 'Opening Float',
    }),
  );

  let cashTakings = '0.0000';
  let totalSales = '0.0000';
  let netSales = '0.0000';
  let revenueOrderCount = 0;
  let paySeq = 1;

  for (const spec of DEMO_ORDERS) {
    const state = spec.cancelled ? 'CANCELLED' : 'COMPLETED';
    const paid = spec.cancelled ? '0.0000' : spec.total;
    const refunded = spec.refund || '0.0000';

    // Both state and status are written: OrderHeader carries status as a legacy alias and
    // the reporting predicate only treats an order as non-revenue when both agree.
    const order = await em.save(
      em.create(OrderHeader, {
        tenant_id: tenantId,
        branch_id: branch.id,
        terminal_id: terminal.id,
        shift_id: shift.id,
        order_number: spec.number,
        channel: 'POS',
        order_type: spec.orderType,
        state,
        status: state,
        currency_code: 'IRR',
        quote_version: '1',
        business_date: businessDate,
        placed_at: placedAt,
        submitted_at: placedAt,
        completed_at: spec.cancelled ? null : placedAt,
        cancelled_at: spec.cancelled ? placedAt : null,
        subtotal: spec.subtotal,
        subtotal_amount: spec.subtotal,
        delivery_fee: '0.0000',
        discount_total: '0.0000',
        discount_amount: '0.0000',
        tax_total: spec.tax,
        tax_amount: spec.tax,
        grand_total: spec.total,
        total_amount: spec.total,
        paid_total: paid,
        paid_amount: paid,
        refunded_total: refunded,
        outstanding_total: '0.0000',
        due_amount: '0.0000',
        created_by: userId || null,
      }),
    );

    let lineNo = 1;
    for (const line of spec.lines) {
      const product = productByCode.get(line.code);
      if (!product) continue;
      const variant = line.variantCode ? variantByCode.get(line.variantCode) : undefined;
      const unitPrice = MoneyUtil.format(variant?.base_price || product.base_price);
      const qty = MoneyUtil.format(line.qty);
      const lineTotal = MoneyUtil.multiply(unitPrice, qty);

      await em.save(
        em.create(OrderItem, {
          tenant_id: tenantId,
          order_id: order.id,
          line_number: lineNo++,
          product_id: product.id,
          product_code: product.code,
          product_name: product.name,
          variant_id: variant?.id || null,
          variant_name: variant?.name || null,
          quantity: qty,
          unit_price: unitPrice,
          base_total: lineTotal,
          modifier_total: '0.0000',
          discount_total: '0.0000',
          tax_total: '0.0000',
          packaging_total: '0.0000',
          subtotal: lineTotal,
          line_total: lineTotal,
          total_amount: lineTotal,
          state: 'ACTIVE',
          created_at: placedAt,
        }),
      );
    }

    await em.save(
      em.create(OrderStateEvent, {
        tenant_id: tenantId,
        order_id: order.id,
        from_state: null,
        to_state: state,
        action: spec.cancelled ? 'CANCEL' : 'COMPLETE',
        occurred_by: userId || null,
        occurred_at: placedAt,
      }),
    );

    if (spec.cancelled || !spec.tender) {
      continue;
    }

    const method = methodByCode.get(spec.tender);
    if (!method) continue;

    const payment = await em.save(
      em.create(Payment, {
        tenant_id: tenantId,
        order_id: order.id,
        payment_number: `PAY-${businessDate.replace(/-/g, '')}-${String(paySeq++).padStart(4, '0')}`,
        method_id: method.id,
        method_kind: method.kind,
        status: 'SUCCEEDED',
        amount: spec.total,
        currency_code: 'IRR',
        shift_id: shift.id,
        business_date: businessDate,
        initiated_at: placedAt,
        posted_at: placedAt,
      }),
    );

    await em.save(
      em.create(PaymentAllocation, {
        tenant_id: tenantId,
        payment_id: payment.id,
        order_id: order.id,
        amount: spec.total,
        currency_code: 'IRR',
      }),
    );

    if (method.kind === 'CASH') {
      cashTakings = MoneyUtil.add(cashTakings, spec.total);
      await em.save(
        em.create(CashMovement, {
          tenant_id: tenantId,
          shift_id: shift.id,
          type: 'CASH_PAYMENT',
          amount: spec.total,
          currency_code: 'IRR',
          payment_id: payment.id,
          posted_by: userId || null,
          reference: `Cash Payment ${order.order_number}`,
        }),
      );
    }

    if (spec.refund) {
      const refund = await em.save(
        em.create(Refund, {
          tenant_id: tenantId,
          order_id: order.id,
          refund_number: `REF-${businessDate.replace(/-/g, '')}-0001`,
          status: 'SUCCEEDED',
          method_id: method.id,
          method_kind: method.kind,
          amount: spec.refund,
          currency_code: 'IRR',
          reason_text: 'Customer returned one portion of fries',
          shift_id: shift.id,
          initiated_at: placedAt,
          posted_at: placedAt,
        }),
      );

      await em.save(
        em.create(RefundAllocation, {
          tenant_id: tenantId,
          refund_id: refund.id,
          refund_request_id: refund.id,
          payment_id: payment.id,
          payment_method_id: method.id,
          original_payment_id: payment.id,
          amount: spec.refund,
          amount_refunded: spec.refund,
        }),
      );
    }

    revenueOrderCount += 1;
    totalSales = MoneyUtil.add(totalSales, spec.total);
    netSales = MoneyUtil.add(netSales, MoneyUtil.subtract(MoneyUtil.subtract(spec.total, spec.tax), refunded));
  }

  const expectedCash = MoneyUtil.add(OPENING_FLOAT, cashTakings);
  shift.expected_cash = expectedCash;
  shift.actual_cash = expectedCash;
  shift.short_over = '0.0000';
  shift.over_short_amount = '0.0000';
  await em.save(CashierShift, shift);

  await em.save(
    em.create(BusinessDayClose, {
      tenant_id: tenantId,
      branch_id: branch.id,
      business_date: businessDate,
      currency_code: 'IRR',
      status: 'CLOSED',
      closed_by: userId || null,
      closed_at: placedAt,
      totals: { totalSales, orderCount: revenueOrderCount },
    }),
  );

  return {
    seeded: true,
    businessDate,
    orderCount: revenueOrderCount,
    totalSales,
    netSales,
    expectedCash,
  };
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return BusinessDateUtil.today(d);
}

function summarise(businessDate: string, seeded: boolean): DemoTradingDayResult {
  return {
    seeded,
    businessDate,
    orderCount: 0,
    totalSales: '0.0000',
    netSales: '0.0000',
    expectedCash: '0.0000',
  };
}
