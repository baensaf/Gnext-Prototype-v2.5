/**
 * Moadian (سامانه مودیان) invoice shapes and the arithmetic the tax office checks.
 *
 * Nothing here talks to the tax office — the prototype simulates that exchange — but the
 * tax ID and invoice JSON are built the way the real v2 API expects them, so what the
 * screens show is what would be sent.
 */

/** 1 original, 3 cancellation, 4 return from sale. Corrections (2) are not simulated. */
export type MoadianSubject = 1 | 3 | 4;

/** QUEUED waits to be sent; PENDING was sent and awaits the tax office's verdict. */
export type TaxInvoiceStatus = 'QUEUED' | 'PENDING' | 'SUCCESS' | 'FAILED';

export interface MoadianSettings {
  enabled: boolean;
  /** شناسه یکتای حافظه مالیاتی — six letters or digits, issued per taxpayer. */
  memoryId: string;
  /** The seller's economic code (tins). */
  economicCode: string;
  /** 13-digit goods/service id used for every line until products carry their own. */
  defaultSstid: string;
  /** Unit of measure code (mu). */
  unitCode: string;
  /** Share of invoices, 0–100, the simulated tax office rejects. */
  rejectionRate: number;
  /** Orders completed from here on are invoiced automatically. */
  enabledAt: string | null;
}

export const MOADIAN_DEFAULTS: MoadianSettings = {
  enabled: false,
  memoryId: '',
  economicCode: '',
  defaultSstid: '2720000114542',
  // Appears for "عدد" in published samples; check it against the tax office's unit table
  // before any real connection.
  unitCode: '1627',
  rejectionRate: 0,
  enabledAt: null,
};

export const MEMORY_ID_PATTERN = /^[A-Z0-9]{6}$/;

export function resolveMoadianSettings(value: Record<string, any> | undefined | null): MoadianSettings {
  const v = value || {};
  const text = (input: unknown, fallback: string) => (typeof input === 'string' ? input.trim() : fallback);
  const rate = Number(v.rejectionRate);
  return {
    enabled: v.enabled === true,
    memoryId: text(v.memoryId, MOADIAN_DEFAULTS.memoryId).toUpperCase(),
    economicCode: text(v.economicCode, MOADIAN_DEFAULTS.economicCode),
    defaultSstid: text(v.defaultSstid, '') || MOADIAN_DEFAULTS.defaultSstid,
    unitCode: text(v.unitCode, '') || MOADIAN_DEFAULTS.unitCode,
    rejectionRate: Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 100) : 0,
    enabledAt: typeof v.enabledAt === 'string' && !Number.isNaN(Date.parse(v.enabledAt)) ? v.enabledAt : null,
  };
}

/** Why these settings cannot issue an invoice, or null when they can. */
export function moadianSetupProblem(settings: MoadianSettings): string | null {
  if (!settings.enabled) return 'Moadian e-invoicing is turned off';
  if (!MEMORY_ID_PATTERN.test(settings.memoryId)) return 'The tax memory ID must be six letters or digits';
  if (!settings.economicCode) return 'The seller economic code is missing';
  return null;
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffCheckDigit(digits: string): number {
  let c = 0;
  const len = digits.length;
  for (let i = 0; i < len; i += 1) {
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][Number(digits[len - i - 1])]];
  }
  return VERHOEFF_INV[c];
}

/**
 * The 22-character tax ID: memory ID, days since 1970 in hex (5), serial in hex (10), and
 * a Verhoeff digit over the decimal form, where letters in the memory ID become their
 * character codes. The day must match the invoice's issue time or the tax office refuses it.
 */
export function generateTaxId(memoryId: string, issuedAt: Date, serial: number): string {
  const days = Math.floor(issuedAt.getTime() / 86400000);
  const numericMemory = memoryId
    .toUpperCase()
    .split('')
    .map((ch) => (/\d/.test(ch) ? ch : String(ch.charCodeAt(0))))
    .join('');
  const decimal = numericMemory + String(days).padStart(6, '0') + String(serial).padStart(12, '0');
  return (
    memoryId +
    days.toString(16).padStart(5, '0') +
    serial.toString(16).padStart(10, '0') +
    verhoeffCheckDigit(decimal)
  ).toUpperCase();
}

export interface InvoiceSourceItem {
  name: string;
  quantity: string | number;
  /** Price of the line before discount and tax, in rials. */
  gross: number;
}

export interface InvoiceSource {
  items: InvoiceSourceItem[];
  discountTotal: number;
  taxTotal: number;
  deliveryFee: number;
}

export interface MoadianLine {
  sstid: string;
  sstt: string;
  mu: string;
  am: number;
  fee: number;
  prdis: number;
  dis: number;
  adis: number;
  vra: number;
  vam: number;
  tsstam: number;
}

/** Splits a whole-rial total across weights, the remainder landing on the largest. */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor((total * w) / sum));
  const largest = weights.indexOf(Math.max(...weights));
  shares[largest] += total - shares.reduce((a, b) => a + b, 0);
  return shares;
}

/**
 * Order lines as Moadian lines. Amounts are whole rials (truncated), an order-level
 * discount is spread over the lines, and VAT is recomputed per line from the order's
 * effective rate so each line checks out on its own. `factor` scales everything for a
 * partial return.
 */
export function buildInvoiceLines(
  source: InvoiceSource,
  settings: Pick<MoadianSettings, 'defaultSstid' | 'unitCode'>,
  factor = 1,
): MoadianLine[] {
  const items = source.items.filter((item) => item.gross > 0);
  const grosses = items.map((item) => Math.floor(item.gross * factor));
  const grossTotal = grosses.reduce((a, b) => a + b, 0);
  const discountTotal = Math.min(Math.floor(source.discountTotal * factor), grossTotal);
  const taxable = grossTotal - discountTotal;
  const vra = taxable > 0 ? Math.round((source.taxTotal * factor * 100) / taxable) : 0;
  const discounts = allocate(discountTotal, grosses);

  const lines: MoadianLine[] = items.map((item, i) => {
    const am = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const fee = Math.floor(grosses[i] / am);
    const prdis = Math.floor(am * fee);
    const dis = Math.min(discounts[i], prdis);
    const adis = prdis - dis;
    const vam = Math.floor((adis * vra) / 100);
    return { sstid: settings.defaultSstid, sstt: item.name, mu: settings.unitCode, am, fee, prdis, dis, adis, vra, vam, tsstam: adis + vam };
  });

  const delivery = Math.floor(source.deliveryFee * factor);
  if (delivery > 0) {
    lines.push({
      sstid: settings.defaultSstid,
      sstt: 'هزینه ارسال',
      mu: settings.unitCode,
      am: 1,
      fee: delivery,
      prdis: delivery,
      dis: 0,
      adis: delivery,
      vra: 0,
      vam: 0,
      tsstam: delivery,
    });
  }
  return lines;
}

export interface MoadianInvoice {
  header: Record<string, string | number | null>;
  body: MoadianLine[];
  payments: Record<string, string | number>[];
}

/** A type-2 (consumer, no buyer), sales-pattern invoice, settled in cash. */
export function buildInvoice(args: {
  taxId: string;
  serial: number;
  issuedAt: Date;
  subject: MoadianSubject;
  referenceTaxId: string | null;
  sellerTaxId: string;
  lines: MoadianLine[];
}): MoadianInvoice {
  const sum = (key: keyof MoadianLine) => args.lines.reduce((total, line) => total + Number(line[key]), 0);
  const tbill = sum('tsstam');
  return {
    header: {
      taxid: args.taxId,
      inno: String(args.serial).padStart(10, '0'),
      indatim: args.issuedAt.getTime(),
      indati2m: args.issuedAt.getTime(),
      inty: 2,
      inp: 1,
      ins: args.subject,
      tins: args.sellerTaxId,
      irtaxid: args.referenceTaxId,
      tprdis: sum('prdis'),
      tdis: sum('dis'),
      tadis: sum('adis'),
      tvam: sum('vam'),
      todam: 0,
      tbill,
      setm: 1,
      cap: tbill,
      insp: 0,
    },
    body: args.lines,
    payments: [],
  };
}

/** Errors the simulated tax office answers with; the codes are the real ones. */
export function simulatedRejection(subject: MoadianSubject): { code: string; message: string } {
  if (subject !== 1) {
    return { code: '0306', message: 'شماره منحصر به فرد مالیاتی صورتحساب مرجع با اطلاعات سامانه مطابقت ندارد' };
  }
  const options = [
    { code: '0301', message: 'شماره منحصر به فرد مالیاتی با اطلاعات صورتحساب مطابقت ندارد' },
    { code: '0202', message: 'تاریخ و زمان صدور صورتحساب نامعتبر است' },
  ];
  return options[Math.floor(Math.random() * options.length)];
}

/** The legal window for sending an invoice after the sale. */
export const MOADIAN_SEND_DEADLINE_DAYS = 12;
