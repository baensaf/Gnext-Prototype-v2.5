import { Injectable } from '@nestjs/common';
import { CalendarSystem, formatBusinessDateTime } from '../../common/utils/calendar.util';

export interface RenderDocOptions {
  documentType: 'CUSTOMER_RECEIPT' | 'KITCHEN_TICKET' | 'COURIER_SLIP' | 'GUEST_BILL' | string;
  orderNumber: string;
  branchName?: string;
  orderType?: string;
  tableNumber?: string;
  customerName?: string;
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
  grandTotal?: string;
  payments?: Array<{ method: string; amount: string }>;
}

@Injectable()
export class PrintRenderService {
  renderDocument(opts: RenderDocOptions): string {
    const titleMap: Record<string, string> = {
      CUSTOMER_RECEIPT: 'CUSTOMER RECEIPT',
      KITCHEN_TICKET: 'KITCHEN DISPATCH CHIT',
      COURIER_SLIP: 'COURIER DELIVERY SLIP',
      GUEST_BILL: 'DINE-IN GUEST BILL',
    };

    const changeTitleMap: Record<string, string> = {
      AMENDED: 'KITCHEN CHANGE - ORDER AMENDED',
      CANCELLED: '*** ORDER CANCELLED - STOP ***',
    };

    const docTitle =
      (opts.kitchenChange && changeTitleMap[opts.kitchenChange]) || titleMap[opts.documentType] || opts.documentType;
    const dateStr = formatBusinessDateTime(opts.placedAt || new Date(), opts.calendar);

    const changeMarker = (change?: 'VOID' | 'ADD') =>
      change === 'VOID' ? '<strong>VOID</strong> ' : change === 'ADD' ? '<strong>ADD</strong> ' : '';

    const itemsHtml = opts.items
      .map(
        (item) => `
        <tr>
          <td style="padding: 4px 0; border-bottom: 1px dashed #eee;">
            ${changeMarker(item.change)}<span${item.change === 'VOID' ? ' style="text-decoration: line-through;"' : ''}><strong>${item.quantity}x</strong> ${this.escapeHtml(item.product_name)}</span>
            ${item.options_summary ? `<br/><small style="color: #666;">+ ${this.escapeHtml(item.options_summary)}</small>` : ''}
            ${item.special_instructions ? `<br/><small style="color: #d32f2f;">* ${this.escapeHtml(item.special_instructions)}</small>` : ''}
          </td>
          ${opts.documentType !== 'KITCHEN_TICKET' ? `<td style="padding: 4px 0; text-align: right; border-bottom: 1px dashed #eee;">${item.total_price || item.unit_price || ''}</td>` : ''}
        </tr>
      `,
      )
      .join('');

    const totalsHtml =
      opts.documentType !== 'KITCHEN_TICKET'
        ? `
        <div style="margin-top: 12px; border-top: 1px solid #000; padding-top: 8px;">
          ${opts.subtotal ? `<div style="display: flex; justify-content: space-between;"><span>Subtotal:</span><span>${opts.subtotal}</span></div>` : ''}
          ${opts.discountTotal ? `<div style="display: flex; justify-content: space-between; color: #d32f2f;"><span>Discount:</span><span>-${opts.discountTotal}</span></div>` : ''}
          ${opts.taxTotal ? `<div style="display: flex; justify-content: space-between;"><span>Tax:</span><span>${opts.taxTotal}</span></div>` : ''}
          ${opts.grandTotal ? `<div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 16px; margin-top: 4px;"><span>GRAND TOTAL:</span><span>${opts.grandTotal}</span></div>` : ''}
        </div>
      `
        : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <style>
          body { font-family: 'Courier New', Courier, monospace; width: 300px; margin: 0 auto; padding: 16px; background: #fff; color: #000; font-size: 13px; }
          .banner { background: #fff3cd; color: #856404; border: 1px dashed #ffeeba; text-align: center; font-weight: bold; font-size: 11px; padding: 4px; margin-bottom: 12px; }
          .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
          .title { font-weight: bold; font-size: 15px; margin: 4px 0; }
          .info { font-size: 12px; margin-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          .footer { text-align: center; margin-top: 16px; border-top: 1px solid #000; padding-top: 8px; font-size: 11px; color: #555; }
        </style>
      </head>
      <body>
        <div class="banner">*** SIMULATED HARDWARE OUTPUT ***</div>
        <div class="header">
          <div style="font-weight: bold; font-size: 16px;">${this.escapeHtml(opts.branchName || 'MAIN BRANCH')}</div>
          <div class="title">${docTitle}</div>
          ${opts.stationLabel ? `<div class="title">&gt;&gt; ${this.escapeHtml(opts.stationLabel)} &lt;&lt;</div>` : ''}
        </div>
        <div class="info">
          <div><strong>ORDER #:</strong> ${this.escapeHtml(opts.orderNumber)}</div>
          <div><strong>DATE:</strong> ${dateStr}</div>
          ${opts.orderType ? `<div><strong>TYPE:</strong> ${opts.orderType} ${opts.tableNumber ? `(Table ${opts.tableNumber})` : ''}</div>` : ''}
          ${opts.customerName ? `<div><strong>CUSTOMER:</strong> ${this.escapeHtml(opts.customerName)}</div>` : ''}
          ${opts.changeReason ? `<div><strong>REASON:</strong> ${this.escapeHtml(opts.changeReason)}</div>` : ''}
        </div>
        <table>
          ${itemsHtml}
        </table>
        ${totalsHtml}
        <div class="footer">
          <div>Gnext Prototype v2 Simulated Thermal Print</div>
        </div>
      </body>
      </html>
    `;
  }

  private escapeHtml(str: string): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
