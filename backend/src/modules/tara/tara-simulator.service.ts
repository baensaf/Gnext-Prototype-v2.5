import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import * as crypto from 'crypto';
import { TaraGroup, TaraSimPurchase } from '../../entities/Tara.entity';

/**
 * A stand-in for Tara's in-store purchase API ("مستند سرویس‌های خرید تارا", v5, 1400/09/03).
 * Each method is one of the document's services, takes the body it documents and answers in
 * its shapes: `{ success: true, code: 0, ... }`, or `{ success: false, data: { code, message } }`
 * for what the document calls a non-200 answer. A lost answer is thrown as `TaraNoReply`
 * after the simulator has acted on the call, which is what a timeout looks like from outside.
 *
 * Nothing here is Gnext's: it keeps its own table (`tara_sim_purchase`) and knows customers
 * only by the demo barcodes below. `tenantId` is passed along only so a test's teardown finds
 * the rows its tenant made.
 */

/** A call whose answer never arrived: Tara may or may not have acted on it. */
export class TaraNoReply extends Error {
  constructor(service: string) {
    super(`Tara did not answer ${service}`);
  }
}

export type TaraOutcome = 'APPROVED' | 'NOT_ELIGIBLE' | 'LOW_LIMIT' | 'REQUEST_NO_REPLY' | 'VERIFY_NO_REPLY';

/** The customers the simulator knows, by the barcode their Tara app shows. Amounts in rials. */
export const TARA_DEMO_CUSTOMERS: Array<{ barcode: string; outcome: TaraOutcome; mobile: string; limit: number }> = [
  { barcode: '980000000001', outcome: 'APPROVED', mobile: '09120000001', limit: 500_000_000 },
  { barcode: '980000000002', outcome: 'NOT_ELIGIBLE', mobile: '09120000002', limit: 0 },
  { barcode: '980000000003', outcome: 'LOW_LIMIT', mobile: '09120000003', limit: 2_000_000 },
  { barcode: '980000000004', outcome: 'REQUEST_NO_REPLY', mobile: '09120000004', limit: 500_000_000 },
  { barcode: '980000000005', outcome: 'VERIFY_NO_REPLY', mobile: '09120000005', limit: 500_000_000 },
];

/** Tara's product groups, as the MerchandiseGroup service lists them. */
export const TARA_SIM_GROUPS: TaraGroup[] = [
  { tag: 'food', id: 101, name: 'prepared-food', title: 'غذای آماده' },
  { tag: 'food', id: 102, name: 'fast-food', title: 'فست فود' },
  { tag: 'drink', id: 103, name: 'beverages', title: 'نوشیدنی' },
  { tag: 'food', id: 104, name: 'dessert', title: 'دسر و شیرینی' },
  { tag: 'grocery', id: 105, name: 'dairy', title: 'لبنیات' },
  { tag: 'other', id: 106, name: 'other', title: 'سایر' },
];

/** Terminals the simulator gives each branch code. */
const TERMINALS_PER_BRANCH = 3;
/** A held amount goes back to the customer if neither verify nor reverse comes in time. */
const HOLD_MINUTES = 30;

export type TaraFailure = { success: false; data: { code: number; message: string } };
type Ok<T> = { success: true; code: 0; message: string; doTime: string } & T;

const fail = (code: number, message: string): TaraFailure => ({ success: false, data: { code, message } });
const ok = <T extends object>(body: T, message = 'OK'): Ok<T> => ({
  success: true,
  code: 0,
  message,
  doTime: new Date().toISOString(),
  ...body,
});
const digits = (n: number) => Array.from(crypto.randomBytes(n), (b) => String(b % 10)).join('');
const maskMobile = (m: string | null) => (m ? `${m.slice(0, 4)}***${m.slice(-4)}` : '');

@Injectable()
export class TaraSimulatorService {
  constructor(private readonly dataSource: DataSource) {}

  /** 1. Login: a username and password give the token the setup calls use. */
  async login(tenantId: string, body: { principal?: string; password?: string }) {
    if (!String(body?.principal || '').trim() || !String(body?.password || '').trim()) {
      return fail(401, 'نام کاربری یا رمز عبور اشتباه است');
    }
    return ok({ accessCode: `sim-login.${tenantId}.${digits(16)}` });
  }

  /** 2. MerchantAccessCode: a long-lived token for each of the branch's terminals. */
  async merchantAccessCode(tenantId: string, token: string, branchCode: string) {
    if (!this.isLoginToken(token, tenantId)) return fail(401, 'توکن نامعتبر است');
    if (!/^\d{4,12}$/.test(String(branchCode || ''))) return fail(1101, 'کد پذیرنده یافت نشد');
    return Array.from({ length: TERMINALS_PER_BRANCH }, (_, i) => {
      const terminalCode = `${branchCode}${String(i + 1).padStart(2, '0')}`;
      return {
        accessCode: `sim-term.${tenantId}.${terminalCode}.${digits(16)}`,
        merchantCode: `M${branchCode}`,
        terminalCode,
        terminalTitle: `صندوق ${i + 1}`,
      };
    });
  }

  /** 3. MerchandiseGroup: Tara's product groups, for the store to map its own products to. */
  async merchandiseGroups(tenantId: string, token: string) {
    if (!this.isLoginToken(token, tenantId)) return fail(401, 'توکن نامعتبر است');
    return TARA_SIM_GROUPS.map((g) => ({ ...g }));
  }

  /** Purchase 1. Trace: the scanned barcodes and amounts; Tara checks the customer may buy here. */
  async trace(tenantId: string, token: string, terminalCode: string, body: { payment?: Array<{ barcode?: string; amount?: number }> }) {
    if (!this.isTerminalToken(token, tenantId, terminalCode)) return fail(401, 'توکن نامعتبر است');
    const lines = Array.isArray(body?.payment) ? body.payment : [];
    if (!lines.length) return fail(1001, 'اطلاعات پرداخت ارسال نشده است');
    let amount = 0;
    let customer: (typeof TARA_DEMO_CUSTOMERS)[number] | undefined;
    for (const line of lines) {
      const who = TARA_DEMO_CUSTOMERS.find((c) => c.barcode === String(line?.barcode || '').trim());
      if (!who) return fail(1004, 'مشتری با این بارکد یافت نشد');
      if (who.outcome === 'NOT_ELIGIBLE') return fail(1005, 'امکان خرید این مشتری از این فروشگاه وجود ندارد');
      const value = Number(line?.amount);
      if (!Number.isInteger(value) || value <= 0) return fail(1006, 'مبلغ نامعتبر است');
      amount += value;
      customer = customer ?? who;
    }
    const traceNumber = digits(12);
    await this.repo().save(
      this.repo().create({
        trace_number: traceNumber,
        tenant_id: tenantId,
        terminal_code: terminalCode,
        barcode: customer!.barcode,
        mobile: customer!.mobile,
        amount: String(amount),
        status: 'TRACED',
        track: [{ amount, doTime: new Date().toISOString(), type: 'TRACE' }],
      }),
    );
    return ok({ mobile: maskMobile(customer!.mobile), traceNumber });
  }

  /** Purchase 2. PurchaseRequest: checks the customer's credit and holds the amount (30 minutes). */
  async request(
    tenantId: string,
    token: string,
    traceNumber: string,
    body: { amount?: number; invoiceNumber?: string; invoiceData?: any },
  ) {
    return await this.dataSource.transaction(async (em) => {
      const sale = await this.find(em, traceNumber);
      if (!sale || !this.isTerminalToken(token, tenantId, sale.terminal_code)) return fail(1201, 'کد پیگیری یافت نشد');
      if (sale.status !== 'TRACED') return fail(1202, 'درخواست خرید برای این کد پیگیری قبلا ارسال شده است');
      const amount = Number(body?.amount);
      if (!Number.isInteger(amount) || amount <= 0 || amount > Number(sale.amount)) return fail(1203, 'مبلغ قابل پرداخت نامعتبر است');
      if (!String(body?.invoiceNumber || '').trim()) return fail(1204, 'شماره فاکتور ارسال نشده است');
      const items = Array.isArray(body?.invoiceData?.items) ? body.invoiceData.items : [];
      if (!items.length) return fail(1204, 'اطلاعات کالا ارسال نشده است');
      const known = new Set(TARA_SIM_GROUPS.map((g) => String(g.id)));
      if (items.some((i: any) => !known.has(String(i?.group)))) return fail(1205, 'گروه کالایی نامعتبر است');

      const customer = TARA_DEMO_CUSTOMERS.find((c) => c.barcode === sale.barcode)!;
      const used = await this.heldOrSpent(em, sale.barcode);
      if (amount > customer.limit - used) return fail(1210, 'اعتبار مشتری کافی نیست');

      sale.status = 'HELD';
      sale.amount = String(amount);
      sale.held_at = new Date();
      sale.reference_number = `R${digits(11)}`;
      sale.invoice = { invoiceNumber: body.invoiceNumber, invoiceData: body.invoiceData };
      sale.track = [...sale.track, { amount, doTime: new Date().toISOString(), type: 'REQUEST' }];
      const lost = this.dropsOnce(sale, 'REQUEST_NO_REPLY', 'REQUEST');
      await em.save(TaraSimPurchase, sale);
      if (lost) return 'NO_REPLY' as const;
      return ok({ traceNumber: sale.trace_number, referenceNumber: sale.reference_number });
    }).then((res) => this.orLost(res, 'PurchaseRequest'));
  }

  /** Purchase 3. VerifyPurchase: the held amount is taken; the sale is final. */
  async verify(tenantId: string, token: string, traceNumber: string) {
    return await this.dataSource.transaction(async (em) => {
      const sale = await this.find(em, traceNumber);
      if (!sale || !this.isTerminalToken(token, tenantId, sale.terminal_code)) return fail(1201, 'کد پیگیری یافت نشد');
      this.expire(sale);
      if (sale.status === 'TRACED') return fail(1302, 'برای این کد پیگیری درخواست خریدی ثبت نشده است');
      if (sale.status === 'REVERSED' || sale.status === 'EXPIRED') {
        await em.save(TaraSimPurchase, sale);
        return fail(1301, 'این خرید لغو شده است');
      }
      // Asked again after a lost answer: the same answer.
      if (sale.status === 'HELD') {
        sale.status = 'VERIFIED';
        sale.track = [...sale.track, { amount: Number(sale.amount), doTime: new Date().toISOString(), type: 'VERIFY' }];
      }
      const lost = this.dropsOnce(sale, 'VERIFY_NO_REPLY', 'VERIFY');
      await em.save(TaraSimPurchase, sale);
      if (lost) return 'NO_REPLY' as const;
      return ok({ traceNumber: sale.trace_number, referenceNumber: sale.reference_number });
    }).then((res) => this.orLost(res, 'VerifyPurchase'));
  }

  /** Purchase 4. ReversePurchase: the hold, or the sale, is cancelled and the customer's credit restored. */
  async reverse(tenantId: string, token: string, traceNumber: string) {
    return await this.dataSource.transaction(async (em) => {
      const sale = await this.find(em, traceNumber);
      if (!sale || !this.isTerminalToken(token, tenantId, sale.terminal_code)) return fail(1201, 'کد پیگیری یافت نشد');
      this.expire(sale);
      if (sale.status !== 'REVERSED' && sale.status !== 'EXPIRED') {
        sale.status = 'REVERSED';
        sale.track = [...sale.track, { amount: Number(sale.amount), doTime: new Date().toISOString(), type: 'REVERSE' }];
      }
      await em.save(TaraSimPurchase, sale);
      return ok({ traceNumber: sale.trace_number, referenceNumber: sale.reference_number });
    });
  }

  /** Purchase 5. InquiryPurchase: what happened to a sale, by trace or reference number. */
  async inquiry(tenantId: string, token: string, id: string) {
    return await this.dataSource.transaction(async (em) => {
      const key = String(id || '').trim();
      const sale =
        (await this.find(em, key)) ??
        (await em.findOne(TaraSimPurchase, { where: { reference_number: key }, lock: { mode: 'pessimistic_write' } }));
      if (!sale || !this.isTerminalToken(token, tenantId, sale.terminal_code)) return fail(1404, 'خریدی با این شناسه یافت نشد');
      if (this.expire(sale)) await em.save(TaraSimPurchase, sale);
      return ok(
        { traceNumber: sale.trace_number, referenceNumber: sale.reference_number, purchaseTrack: sale.track },
        sale.status,
      );
    });
  }

  private repo() {
    return this.dataSource.getRepository(TaraSimPurchase);
  }

  private async find(em: EntityManager, traceNumber: string) {
    return await em.findOne(TaraSimPurchase, {
      where: { trace_number: String(traceNumber || '').trim() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** What the customer has on hold or has spent already, against their limit. */
  private async heldOrSpent(em: EntityManager, barcode: string): Promise<number> {
    const [row] = await em.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS used FROM tara_sim_purchase
        WHERE barcode = $1 AND status IN ('HELD', 'VERIFIED')`,
      [barcode],
    );
    return Number(row?.used || 0);
  }

  /** A hold older than 30 minutes with no verify or reverse has gone back to the customer. */
  private expire(sale: TaraSimPurchase): boolean {
    if (sale.status !== 'HELD' || !sale.held_at) return false;
    if (Date.now() - new Date(sale.held_at).getTime() < HOLD_MINUTES * 60_000) return false;
    sale.status = 'EXPIRED';
    sale.track = [...sale.track, { amount: Number(sale.amount), doTime: new Date().toISOString(), type: 'EXPIRE' }];
    return true;
  }

  /** The demo customers whose first answer to one call is lost (the call itself went through). */
  private dropsOnce(sale: TaraSimPurchase, outcome: TaraOutcome, call: string): boolean {
    const customer = TARA_DEMO_CUSTOMERS.find((c) => c.barcode === sale.barcode);
    if (customer?.outcome !== outcome || sale.dropped.includes(call)) return false;
    sale.dropped = [...sale.dropped, call];
    return true;
  }

  private orLost<T>(res: T | 'NO_REPLY', service: string): T {
    if (res === 'NO_REPLY') throw new TaraNoReply(service);
    return res;
  }

  private isLoginToken(token: string, tenantId: string) {
    return String(token || '').startsWith(`sim-login.${tenantId}.`);
  }

  private isTerminalToken(token: string, tenantId: string, terminalCode: string) {
    return String(token || '').startsWith(`sim-term.${tenantId}.${terminalCode}.`);
  }
}
