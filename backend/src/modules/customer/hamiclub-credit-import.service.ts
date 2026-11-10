import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Like, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Customer } from '../../entities/Customer.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { jalaliToBusinessDate } from '../../common/utils/calendar.util';
import { CreditService } from './credit.service';
import { CustomerService, normalizePhone, toWesternDigits } from './customer.service';

/** One customer's credit with one last day, from the HamiClub file. */
interface CarriedCredit {
  phone: string;
  amount: string;
  expiresOn: string;
  /** As HamiClub wrote it, for the preview and the entry's note. */
  expiresJalali: string;
}

export interface HamiClubImportResult {
  applied: boolean;
  rowsRead: number;
  /** One per customer and last day: rows for the same phone and day are added together. */
  credits: number;
  customers: number;
  total: string;
  newCustomers: number;
  alreadyCarried: number;
  skipped: { row: number; reason: 'NO_PHONE' | 'NO_AMOUNT' | 'NO_DATE' | 'ENDED' }[];
  sample: { phone: string; amount: string; expiresOn: string; expiresJalali: string; known: boolean }[];
}

// The columns of HamiClub's "هدایا" (PCDAssign) export, filtered to credit; a plain sheet with
// phone / amount / expires works too.
const PHONE_HEADERS = ['تلفن', 'موبایل', 'همراه', 'phone', 'mobile'];
const AMOUNT_HEADERS = ['مانده', 'remaining', 'amount', 'مبلغ'];
const EXPIRY_HEADERS = ['اعتبار', 'تاریخ اعتبار', 'انقضا', 'expires', 'expiry', 'valid until'];

/**
 * Carries a branch's live HamiClub credit into Gnext wallets on its switch day (2026-11-10).
 * HamiClub has no API, so head office exports the branch's open credit from the HamiClub panel
 * and uploads the file. Each credit keeps HamiClub's last day; customers not in Gnext yet are
 * added by phone. Previewed first; applying twice adds nothing the second time.
 */
@Injectable()
export class HamiClubCreditImportService {
  constructor(
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    private readonly customers: CustomerService,
    private readonly credit: CreditService,
    private readonly dataSource: DataSource,
  ) {}

  async importFile(
    tenantId: string,
    file: { buffer: Buffer; originalname?: string } | undefined,
    apply: boolean,
    userId?: string,
    correlationId = 'hamiclub-import',
  ): Promise<HamiClubImportResult> {
    if (!file?.buffer?.length) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choose the file exported from HamiClub' });
    const rows = await this.readRows(file);
    const today = (await loadBusinessClock(this.dataSource.manager, tenantId)).today();
    const { credits, skipped } = this.readCredits(rows, today);

    const known = new Map<string, string>();
    for (const phone of new Set(credits.map((c) => c.phone))) {
      const id = await this.customerIdByPhone(tenantId, phone);
      if (id) known.set(phone, id);
    }

    const result: HamiClubImportResult = {
      applied: apply,
      rowsRead: Math.max(rows.length - 1, 0),
      credits: credits.length,
      customers: new Set(credits.map((c) => c.phone)).size,
      total: credits.reduce((sum, c) => MoneyUtil.add(sum, c.amount), '0.0000'),
      newCustomers: new Set(credits.filter((c) => !known.has(c.phone)).map((c) => c.phone)).size,
      alreadyCarried: 0,
      skipped,
      sample: credits.slice(0, 20).map((c) => ({ ...c, known: known.has(c.phone) })),
    };
    if (!apply) return result;

    for (const c of credits) {
      let customerId = known.get(c.phone);
      if (!customerId) {
        const created = await this.customers.createCustomer(tenantId, { mobile: c.phone }, correlationId, userId);
        customerId = created.id;
        known.set(c.phone, customerId);
      }
      const outcome = await this.dataSource.transaction((em) =>
        this.credit.postOpeningCredit(
          em,
          tenantId,
          customerId!,
          {
            amount: c.amount,
            expiresOn: c.expiresOn,
            reference: `HAMICLUB_${c.expiresOn}`,
            note: `HamiClub credit carried over, last day ${c.expiresJalali}`,
          },
          userId,
        ),
      );
      if (outcome === 'ALREADY_CARRIED') result.alreadyCarried += 1;
    }
    return result;
  }

  private async customerIdByPhone(tenantId: string, phone: string): Promise<string | null> {
    const last10 = phone.replace(/\D/g, '').slice(-10);
    const found = await this.customerRepo.find({ where: { tenant_id: tenantId, is_active: true, mobile: Like(`%${last10}`) } });
    return (found || []).find((c) => normalizePhone(c.mobile) === phone)?.id ?? null;
  }

  /** The sheet as rows of text cells; the first sheet of a workbook, or a CSV. */
  private async readRows(file: { buffer: Buffer; originalname?: string }): Promise<string[][]> {
    const isZip = file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
    if (!isZip) {
      return file.buffer
        .toString('utf8')
        .replace(/^﻿/, '')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => line.split(/[,;\t]/).map((cell) => cell.replace(/^"|"$/g, '').trim()));
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const v: any = cell.value;
        cells[col - 1] = v === null || v === undefined ? '' : typeof v === 'object' ? String(v.text ?? v.result ?? v.richText?.map((r: any) => r.text).join('') ?? '') : String(v);
      });
      rows.push(Array.from(cells, (c) => (c ?? '').trim()));
    });
    return rows;
  }

  private readCredits(rows: string[][], today: string) {
    const norm = (s: string) => toWesternDigits(s || '').trim().toLowerCase();
    // HamiClub's export puts a title row above the headers.
    const headerAt = rows.slice(0, 5).findIndex((r) => r.some((c) => AMOUNT_HEADERS.includes(norm(c))));
    if (headerAt < 0) {
      throw new BadRequestException({ code: 'COLUMNS_NOT_FOUND', message: 'No "مانده" (amount left) column: export the credit list from HamiClub\'s هدایا report' });
    }
    const header = rows[headerAt].map(norm);
    const col = (names: string[]) => header.findIndex((h) => names.includes(h));
    const amountCol = col(AMOUNT_HEADERS);
    const expiryCol = col(EXPIRY_HEADERS);
    const data = rows.slice(headerAt + 1);
    let phoneCol = header.findIndex((h) => PHONE_HEADERS.some((p) => h.includes(p)));
    if (phoneCol < 0) {
      // HamiClub leaves the phone column's header blank: it is the one holding mobile numbers.
      const looksLikePhone = (s: string) => /^(\+?98|0)?9\d{9}$/.test(norm(s).replace(/[\s-]/g, ''));
      const width = Math.max(...data.slice(0, 20).map((r) => r.length), 0);
      phoneCol = Array.from({ length: width }, (_, i) => i).find((i) => data.slice(0, 20).filter((r) => looksLikePhone(r[i] || '')).length >= Math.min(3, data.length)) ?? -1;
    }
    if (phoneCol < 0 || expiryCol < 0) {
      throw new BadRequestException({ code: 'COLUMNS_NOT_FOUND', message: 'The file needs a phone column and an "اعتبار" (last day) column' });
    }

    const byKey = new Map<string, CarriedCredit>();
    const skipped: HamiClubImportResult['skipped'] = [];
    data.forEach((r, i) => {
      const row = headerAt + i + 2;
      const rawPhone = norm(r[phoneCol] || '').replace(/[\s-]/g, '');
      const phone = normalizePhone(/^9\d{9}$/.test(rawPhone) ? `0${rawPhone}` : rawPhone);
      if (phone.replace(/\D/g, '').length < 12) return void skipped.push({ row, reason: 'NO_PHONE' });
      const amountText = norm(r[amountCol] || '').replace(/[,٬\s]/g, '');
      if (!/^\d+(\.\d+)?$/.test(amountText) || !MoneyUtil.greaterThan(amountText, '0')) return void skipped.push({ row, reason: 'NO_AMOUNT' });
      const rawDate = norm(r[expiryCol] || '');
      const expiresOn = /^\d{4}-\d{2}-\d{2}/.test(rawDate) && Number(rawDate.slice(0, 4)) > 1900 ? rawDate.slice(0, 10) : jalaliToBusinessDate(rawDate);
      if (!expiresOn) return void skipped.push({ row, reason: 'NO_DATE' });
      if (expiresOn < today) return void skipped.push({ row, reason: 'ENDED' });
      const key = `${phone}|${expiresOn}`;
      const prev = byKey.get(key);
      byKey.set(key, { phone, expiresOn, expiresJalali: rawDate.slice(0, 10), amount: MoneyUtil.add(prev?.amount || '0', amountText) });
    });
    return { credits: [...byKey.values()], skipped };
  }
}
