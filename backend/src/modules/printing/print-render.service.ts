import { Injectable } from '@nestjs/common';
import { CalendarSystem, formatBusinessDateTime } from '../../common/utils/calendar.util';

export interface RenderDocOptions {
  documentType: 'CUSTOMER_RECEIPT' | 'KITCHEN_TICKET' | 'COURIER_SLIP' | 'GUEST_BILL' | string;
  orderNumber: string;
  /** The branch's number for the order today (123): what prints large and what staff call. */
  callNumber?: number | null;
  /** The printer group's choice; unset takes the document's default. */
  template?: TicketTemplate | null;
  /** The chain's name, printed as the heading of customer documents. */
  brandName?: string;
  branchName?: string;
  branchAddress?: string;
  branchPhone?: string;
  orderType?: string;
  /** POS, KIOSK, AGGREGATOR...: where the order came from, when that matters to staff. */
  channel?: string;
  tableNumber?: string;
  customerName?: string;
  customerMobile?: string;
  deliveryAddress?: string;
  orderNotes?: string;
  placedAt?: Date | string;
  /** The calendar the date prints in, on the business clock. Jalali unless given. */
  calendar?: CalendarSystem;
  /** On a kitchen chit: the station it is for, e.g. "Grill (1/3)" when the order is split. */
  stationLabel?: string;
  /**
   * Set on a kitchen ticket that amends one the kitchen already holds. The chit is
   * retitled so a cook cannot mistake it for a fresh order, and each line says whether
   * it is being struck off or added.
   */
  kitchenChange?: 'AMENDED' | 'CANCELLED';
  changeReason?: string;
  /** A second copy of something already printed. Marked, so nobody cooks or charges it twice. */
  isReprint?: boolean;
  items: Array<{
    product_name: string;
    quantity: number | string;
    unit_price?: number | string;
    total_price?: number | string;
    special_instructions?: string;
    options_summary?: string;
    change?: 'VOID' | 'ADD';
  }>;
  subtotal?: string;
  discountTotal?: string;
  taxTotal?: string;
  deliveryFee?: string;
  packagingTotal?: string;
  grandTotal?: string;
  paidTotal?: string;
  outstandingTotal?: string;
  payments?: Array<{ method: string; amount: string }>;
}

export type TicketTemplate = 'COMPACT' | 'DETAILED';

/**
 * A kitchen chit is compact unless its station asks for more, as Iranian kitchens work: the
 * number and the food. Customer paper is detailed unless the counter asks for less.
 */
export function defaultTemplate(documentType: string): TicketTemplate {
  return documentType === 'KITCHEN_TICKET' ? 'COMPACT' : 'DETAILED';
}

/** Where a reprinted job's marker goes. A job reprinted as-is swaps it for the marker. */
export const REPRINT_SLOT = '<!--gnext:reprint-->';

const REPRINT_MARK = '<div class="box">چاپ مجدد — نسخه تکراری</div>';

/** A stored job reprinted as it was, marked as a copy where the original left room for it. */
export function markAsReprint(html: string): string {
  return html && html.includes(REPRINT_SLOT) ? html.replace(REPRINT_SLOT, REPRINT_MARK) : html;
}

const ORDER_TYPES: Record<string, string> = {
  DINE_IN: 'سالن',
  TAKEAWAY: 'بیرون‌بر',
  DELIVERY: 'ارسال با پیک',
  AGGREGATOR: 'سفارش آنلاین',
};

const CHANNELS: Record<string, string> = {
  KIOSK: 'کیوسک',
  AGGREGATOR: 'اسنپ‌فود',
  SNAPPFOOD: 'اسنپ‌فود',
  ONLINE: 'سفارش آنلاین',
};

const PAYMENT_METHODS: Record<string, string> = {
  CASH: 'نقد',
  CARD: 'کارتخوان',
  POS: 'کارتخوان',
  CARD_POS: 'کارتخوان',
  NETWORK_POS: 'کارتخوان',
  MOBILE_POS: 'کارتخوان سیار',
  CUSTOMER_CREDIT: 'اعتبار مشتری',
  BANK_TRANSFER: 'کارت به کارت',
  ONLINE: 'پرداخت آنلاین',
};

/**
 * The paper a branch prints: receipts, guest bills and courier slips for customers and couriers,
 * chits for the kitchen. Persian, right to left, laid out 300 CSS px wide, which the branch agent
 * scales to the 80 mm roll (agent/internal/printing/render.go keeps the same width).
 */
@Injectable()
export class PrintRenderService {
  renderDocument(opts: RenderDocOptions): string {
    const template = opts.template || defaultTemplate(opts.documentType);
    const body =
      opts.documentType === 'KITCHEN_TICKET'
        ? template === 'COMPACT'
          ? this.compactKitchenChit(opts)
          : this.kitchenChit(opts)
        : template === 'COMPACT' && opts.documentType !== 'COURIER_SLIP'
          ? this.compactReceipt(opts)
          : this.customerDocument(opts);
    return this.page(body);
  }

  /**
   * The page a printer prints when it is set up: which printer this is, so a counter with three
   * printers can tell which one answered, and the full paper width, so a narrow roll shows.
   */
  renderTestPage(printerName: string, branchName?: string, at: Date = new Date()): string {
    return this.page(`<div class="inv">چاپ آزمایشی</div>
<div class="c title">${this.esc(printerName)}</div>
${branchName ? `<div class="c small">${this.esc(branchName)}</div>` : ''}
<hr/>
<div class="c">اگر این برگه خوانا است، چاپگر درست کار می‌کند.</div>
<div class="box">&nbsp;</div>
<div class="c small">${this.date({ documentType: 'TEST_PRINT', orderNumber: '', items: [], placedAt: at })}</div>`);
  }

  private page(body: string): string {
    return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  /* 300 px plus the padding is the 332 px the agent scales to the roll's width. */
  body { box-sizing: content-box; font-family: Tahoma, 'Segoe UI', Arial, sans-serif; width: 300px; margin: 0 auto; padding: 16px; background: #fff; color: #000; font-size: 13px; line-height: 1.55; }
  .c { text-align: center; }
  .brand { font-size: 20px; font-weight: bold; }
  .small { font-size: 11px; }
  .title { font-size: 15px; font-weight: bold; margin: 6px 0 2px; }
  .big { font-size: 30px; font-weight: bold; line-height: 1.2; }
  .huge { font-size: 64px; font-weight: bold; line-height: 1.1; text-align: center; }
  .box { border: 2px solid #000; padding: 4px; margin: 6px 0; text-align: center; font-weight: bold; font-size: 15px; }
  .inv { background: #000; color: #fff; padding: 6px 4px; margin: 6px 0; text-align: center; font-weight: bold; font-size: 20px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; }
  .num { text-align: left; white-space: nowrap; padding-right: 6px; }
  .ltr { direction: ltr; unicode-bidi: embed; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .total { font-size: 17px; font-weight: bold; }
  .sub { font-size: 12px; padding-right: 10px; }
  .note { font-weight: bold; border: 1px solid #000; padding: 2px 4px; margin-top: 2px; display: inline-block; }
  .item { font-size: 18px; font-weight: bold; }
  .void { text-decoration: line-through; }
  .tag { font-size: 12px; font-weight: bold; border: 1px solid #000; padding: 0 3px; margin-left: 4px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  }

  // --- kitchen ------------------------------------------------------------------------------

  private changeBanner(o: RenderDocOptions): string {
    return o.kitchenChange === 'CANCELLED'
      ? '<div class="inv">لغو سفارش — آماده نکنید</div>'
      : o.kitchenChange === 'AMENDED'
        ? '<div class="inv">تغییر سفارش</div>'
        : '';
  }

  /** The station's lines, each with what the cook must know: VOID/ADD, add-ons, the note. */
  private kitchenLines(o: RenderDocOptions): string {
    return o.items
      .map((item) => {
        const tag = item.change === 'VOID' ? '<span class="tag">حذف</span>' : item.change === 'ADD' ? '<span class="tag">اضافه</span>' : '';
        return `<tr><td>
  <div class="item">${tag}<span${item.change === 'VOID' ? ' class="void"' : ''}>${this.fa(this.qty(item.quantity))} × ${this.esc(item.product_name)}</span></div>
  ${item.options_summary ? `<div class="sub">+ ${this.esc(item.options_summary)}</div>` : ''}
  ${item.special_instructions ? `<div class="note">* ${this.esc(item.special_instructions)}</div>` : ''}
</td></tr>`;
      })
      .join('<tr><td><hr/></td></tr>');
  }

  /**
   * What an Iranian kitchen chit is: the number the order is called by, very large, and this
   * station's items. A change, a cancel or a copy still says so, since a cook acting on it
   * as a fresh order makes the wrong food.
   */
  private compactKitchenChit(o: RenderDocOptions): string {
    return `${o.isReprint ? REPRINT_MARK : REPRINT_SLOT}
${this.changeBanner(o)}
<div class="huge">${this.fa(this.displayNumber(o))}</div>
<hr/>
<table>${this.kitchenLines(o)}</table>`;
  }

  private kitchenChit(o: RenderDocOptions): string {
    const station = o.stationLabel ? `<div class="inv">${this.fa(this.esc(o.stationLabel))}</div>` : '';

    return `${o.isReprint ? REPRINT_MARK : REPRINT_SLOT}
${this.changeBanner(o)}
${station}
<div class="c">
  <div class="small">شماره سفارش</div>
  <div class="big">${this.fa(this.displayNumber(o))}</div>
  <div class="title">${this.orderTypeLine(o)}</div>
  <div>${this.date(o)}</div>
</div>
${o.changeReason ? `<div class="box">علت: ${this.esc(o.changeReason)}</div>` : ''}
<hr/>
<table>${this.kitchenLines(o)}</table>
${o.orderNotes ? `<hr/><div class="note">توضیحات سفارش: ${this.esc(o.orderNotes)}</div>` : ''}
<hr/>
<div class="c small ltr">${this.esc(o.orderNumber)}</div>`;
  }

  // --- receipt, guest bill, courier slip ------------------------------------------------------

  private customerDocument(o: RenderDocOptions): string {
    const isSlip = o.documentType === 'COURIER_SLIP';
    const title =
      o.documentType === 'GUEST_BILL' ? 'صورتحساب' : isSlip ? 'برگه پیک' : o.documentType === 'CUSTOMER_RECEIPT' ? 'فاکتور فروش' : o.documentType;

    const outstanding = this.money(o.outstandingTotal);
    const paidInFull = o.outstandingTotal !== undefined && outstanding <= 0n;

    const lines = o.items
      .map((item) => {
        const unit = item.unit_price !== undefined && item.unit_price !== null && item.unit_price !== '' ? this.rial(item.unit_price) : '';
        const lineTotal = this.rial(item.total_price ?? item.unit_price ?? '');
        if (isSlip) {
          // The courier checks the bag, not the prices.
          return `<tr><td>${this.fa(this.qty(item.quantity))} × ${this.esc(item.product_name)}</td></tr>`;
        }
        return `<tr>
  <td>${this.esc(item.product_name)}
    <div class="small">${this.fa(this.qty(item.quantity))} × ${unit}</div>
    ${item.options_summary ? `<div class="sub">+ ${this.esc(item.options_summary)}</div>` : ''}
    ${item.special_instructions ? `<div class="sub">* ${this.esc(item.special_instructions)}</div>` : ''}
  </td>
  <td class="num">${lineTotal}</td>
</tr>`;
      })
      .join('');

    const row = (label: string, value?: string, cls = '') =>
      value !== undefined && value !== '' ? `<div class="row ${cls}"><span>${label}</span><span>${value}</span></div>` : '';
    const positive = (v?: string) => (this.money(v) > 0n ? this.rial(v!) : undefined);

    const totals = isSlip
      ? ''
      : `<hr/>
${row('جمع اقلام', o.subtotal !== undefined ? this.rial(o.subtotal) : undefined)}
${positive(o.discountTotal) ? row('تخفیف', `${positive(o.discountTotal)}-`) : ''}
${row('بسته‌بندی', positive(o.packagingTotal))}
${row('هزینه ارسال', positive(o.deliveryFee))}
${row('مالیات بر ارزش افزوده', positive(o.taxTotal))}
${row('مبلغ قابل پرداخت', o.grandTotal !== undefined ? `${this.rial(o.grandTotal)} ریال` : undefined, 'total')}`;

    const payments = (o.payments || []).length
      ? `<hr/>${(o.payments || []).map((p) => row(PAYMENT_METHODS[p.method] || p.method, this.rial(p.amount))).join('')}`
      : '';

    let status = '';
    if (o.outstandingTotal !== undefined) {
      if (isSlip) {
        status = paidInFull
          ? '<div class="box">پرداخت شده — وجهی دریافت نشود</div>'
          : `<div class="inv">دریافت از مشتری: ${this.rial(o.outstandingTotal)} ریال</div>`;
      } else if (o.documentType === 'CUSTOMER_RECEIPT') {
        status = paidInFull ? '<div class="box">پرداخت شد</div>' : `<div class="box">پرداخت نشده — مانده ${this.rial(o.outstandingTotal)} ریال</div>`;
      } else if (!paidInFull) {
        status = `<div class="box">مانده قابل پرداخت: ${this.rial(o.outstandingTotal)} ریال</div>`;
      }
    }

    const customer = [
      row('مشتری', o.customerName ? this.esc(o.customerName) : undefined),
      row('تلفن', o.customerMobile ? `<span class="ltr">${this.fa(this.esc(o.customerMobile))}</span>` : undefined),
    ].join('');
    const address = o.deliveryAddress ? `<div class="${isSlip ? 'box' : ''}">نشانی: ${this.esc(o.deliveryAddress)}</div>` : '';

    return `<div class="c">
  <div class="brand">${this.esc(o.brandName || o.branchName || '')}</div>
  ${o.brandName && o.branchName ? `<div>${this.esc(o.branchName)}</div>` : ''}
  ${o.branchAddress ? `<div class="small">${this.esc(o.branchAddress)}</div>` : ''}
  ${o.branchPhone ? `<div class="small">تلفن: <span class="ltr">${this.fa(this.esc(o.branchPhone))}</span></div>` : ''}
</div>
<hr/>
${o.isReprint ? REPRINT_MARK : REPRINT_SLOT}
<div class="c">
  <div class="title">${title}</div>
  <div class="small">شماره سفارش</div>
  <div class="big">${this.fa(this.displayNumber(o))}</div>
  <div>${this.orderTypeLine(o)}</div>
</div>
${row('تاریخ', this.date(o))}
${row('سفارش', `<span class="ltr">${this.esc(o.orderNumber)}</span>`)}
${customer}
${address}
<hr/>
<table>${lines}</table>
${totals}
${payments}
${status}
${o.orderNotes ? `<div class="sub">توضیحات: ${this.esc(o.orderNotes)}</div>` : ''}
<hr/>
<div class="c small">${isSlip ? 'نسخه پیک' : 'از خرید شما سپاسگزاریم'}</div>`;
  }

  // --- helpers --------------------------------------------------------------------------------

  private orderTypeLine(o: RenderDocOptions): string {
    const parts = [ORDER_TYPES[o.orderType || ''] || o.orderType || ''];
    if (o.tableNumber) parts.push(`میز ${this.esc(o.tableNumber)}`);
    const channel = CHANNELS[o.channel || ''];
    if (channel && channel !== parts[0]) parts.push(channel);
    return this.fa(parts.filter(Boolean).join(' — '));
  }

  private date(o: RenderDocOptions): string {
    return formatBusinessDateTime(o.placedAt || new Date(), o.calendar, true);
  }

  /**
   * A receipt for the counter that wants it short: who sold it, the number to wait for, what
   * was bought and for how much, and whether it is paid.
   */
  private compactReceipt(o: RenderDocOptions): string {
    const title = o.documentType === 'GUEST_BILL' ? 'صورتحساب' : 'فاکتور فروش';
    const lines = o.items
      .map(
        (item) => `<tr>
  <td>${this.fa(this.qty(item.quantity))} × ${this.esc(item.product_name)}</td>
  <td class="num">${this.rial(item.total_price ?? item.unit_price ?? '')}</td>
</tr>`,
      )
      .join('');
    const owed = this.money(o.outstandingTotal);
    const status =
      o.outstandingTotal === undefined
        ? ''
        : owed <= 0n
          ? '<div class="box">پرداخت شد</div>'
          : `<div class="box">مانده: ${this.rial(o.outstandingTotal)} ریال</div>`;

    return `<div class="c brand">${this.esc(o.brandName || o.branchName || '')}</div>
${o.isReprint ? REPRINT_MARK : REPRINT_SLOT}
<div class="c small">${title} — ${this.date(o)}</div>
<div class="huge">${this.fa(this.displayNumber(o))}</div>
<hr/>
<table>${lines}</table>
<hr/>
${o.grandTotal !== undefined ? `<div class="row total"><span>مبلغ کل</span><span>${this.rial(o.grandTotal)} ریال</span></div>` : ''}
${status}`;
  }

  /** The number that prints large: the branch's call number, else the tail of the order number. */
  private displayNumber(o: RenderDocOptions): string {
    return o.callNumber ? String(o.callNumber) : this.shortNumber(o.orderNumber);
  }

  /** The part of the order number people call out: ORD-20260922-0012 is order 12. */
  private shortNumber(orderNumber: string): string {
    const tail = String(orderNumber || '').split('-').pop() || '';
    const trimmed = tail.replace(/^0+(?=\d)/, '');
    return /^\d+$/.test(trimmed) ? trimmed : this.esc(orderNumber);
  }

  private qty(q: number | string): string {
    const n = Number(q);
    return Number.isFinite(n) ? String(n) : this.esc(String(q));
  }

  /** Whole rials. Amounts arrive as numeric strings such as "42292000.0000". */
  private money(value?: string | number | null): bigint {
    const s = String(value ?? '').trim();
    const m = /^(-?)(\d+)/.exec(s);
    if (!m) return 0n;
    const n = BigInt(m[2]);
    return m[1] ? -n : n;
  }

  private rial(value: string | number): string {
    const n = this.money(value as any);
    const neg = n < 0n;
    const grouped = (neg ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
    return this.fa(`${neg ? '-' : ''}${grouped}`);
  }

  /** Persian digits for what is read on paper. */
  private fa(s: string): string {
    return s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  }

  private esc(str: string): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
