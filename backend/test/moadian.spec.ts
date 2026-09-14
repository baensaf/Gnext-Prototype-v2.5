import {
  buildInvoice,
  buildInvoiceLines,
  generateTaxId,
  moadianSetupProblem,
  resolveMoadianSettings,
  verhoeffCheckDigit,
} from '../src/common/utils/moadian.util';

// Moadian e-invoicing is simulated, but the tax ID and invoice body are built the way the
// tax office checks them, so these pin that arithmetic.
describe('moadian invoices', () => {
  it('computes Verhoeff check digits', () => {
    expect(verhoeffCheckDigit('236')).toBe(3);
    expect(verhoeffCheckDigit('12345')).toBe(1);
  });

  it('builds a 22-character tax ID from memory ID, day and serial', () => {
    const issuedAt = new Date('2026-09-14T08:30:00Z');
    const days = Math.floor(issuedAt.getTime() / 86400000);
    const taxId = generateTaxId('A1B2C3', issuedAt, 42);

    expect(taxId).toHaveLength(22);
    expect(taxId.slice(0, 6)).toBe('A1B2C3');
    expect(taxId.slice(6, 11)).toBe(days.toString(16).padStart(5, '0').toUpperCase());
    expect(taxId.slice(11, 21)).toBe('000000002A');
    // Letters become their character codes: A→65, B→66, C→67.
    const decimal = '651662673' +String(days).padStart(6, '0') + '000000000042';
    expect(taxId[21]).toBe(String(verhoeffCheckDigit(decimal)));
  });

  it('spreads the discount over lines in whole rials and keeps the totals consistent', () => {
    const lines = buildInvoiceLines(
      {
        items: [
          { name: 'Burger', quantity: '2.0000', gross: 1000000 },
          { name: 'Fries', quantity: '1.0000', gross: 333333 },
        ],
        discountTotal: 100001,
        taxTotal: 110999.9,
        deliveryFee: 25000,
      },
      { defaultSstid: '2720000114542', unitCode: '1627' },
    );

    expect(lines).toHaveLength(3);
    expect(lines.reduce((s, l) => s + l.dis, 0)).toBe(100001);
    for (const line of lines) {
      expect(line.prdis).toBe(line.am * line.fee);
      expect(line.adis).toBe(line.prdis - line.dis);
      expect(line.tsstam).toBe(line.adis + line.vam);
      expect(Number.isInteger(line.vam)).toBe(true);
    }
    expect(lines[0].vra).toBe(9);
    expect(lines[2]).toMatchObject({ sstt: 'هزینه ارسال', vra: 0, tsstam: 25000 });

    const invoice = buildInvoice({
      taxId: 'A1B2C3000000000000000X',
      serial: 7,
      issuedAt: new Date('2026-09-14T08:30:00Z'),
      subject: 1,
      referenceTaxId: null,
      sellerTaxId: '14000000000',
      lines,
    });
    expect(invoice.header).toMatchObject({ inty: 2, inp: 1, ins: 1, inno: '0000000007', setm: 1 });
    expect(invoice.header.tbill).toBe(lines.reduce((s, l) => s + l.tsstam, 0));
  });

  it('scales a partial return', () => {
    const source = { items: [{ name: 'Pizza', quantity: 1, gross: 800000 }], discountTotal: 0, taxTotal: 72000, deliveryFee: 0 };
    const [line] = buildInvoiceLines(source, { defaultSstid: 'x', unitCode: 'y' }, 0.25);
    expect(line).toMatchObject({ fee: 200000, vra: 9, vam: 18000, tsstam: 218000 });
  });

  it('refuses to issue until memory ID and economic code are set', () => {
    expect(moadianSetupProblem(resolveMoadianSettings({}))).toMatch(/turned off/);
    expect(moadianSetupProblem(resolveMoadianSettings({ enabled: true, memoryId: 'abc' }))).toMatch(/memory ID/);
    expect(moadianSetupProblem(resolveMoadianSettings({ enabled: true, memoryId: 'a1b2c3', economicCode: '1400' }))).toBeNull();
  });
});
