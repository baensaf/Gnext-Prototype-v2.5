import { MoneyUtil } from './money.util';

describe('MoneyUtil Foundations & Allocation Properties', () => {
  it('should add monetary values with exact precision', () => {
    expect(MoneyUtil.add('10.2500', '5.7500')).toBe('16.0000');
    expect(MoneyUtil.add('100.00', '0.05', 2)).toBe('100.05');
  });

  it('should subtract monetary values with exact precision', () => {
    expect(MoneyUtil.subtract('100.5000', '0.5000')).toBe('100.0000');
  });

  it('should multiply and divide without floating point drift', () => {
    expect(MoneyUtil.multiply('19.99', '3', 2)).toBe('59.97');
    expect(MoneyUtil.divide('100.00', '3', 2)).toBe('33.33');
  });

  it('should format currency with comma separation without native float drift', () => {
    expect(MoneyUtil.formatCurrency('1250000', 0)).toBe('1,250,000');
    expect(MoneyUtil.formatCurrency('1250000.50', 2)).toBe('1,250,000.50');
    expect(MoneyUtil.formatCurrency('0', 0)).toBe('0');
  });

  it('should sum monetary lists accurately', () => {
    expect(MoneyUtil.sum(['10.50', '20.25', '30.25'], 2)).toBe('61.00');
  });

  it('should validate decimal strings accurately', () => {
    expect(MoneyUtil.isValid('100.50')).toBe(true);
    expect(MoneyUtil.isValid('0')).toBe(true);
    expect(MoneyUtil.isValid('-50.00')).toBe(true);
    expect(MoneyUtil.isValid('')).toBe(false);
    expect(MoneyUtil.isValid(null)).toBe(false);
    expect(MoneyUtil.isValid('invalid-num')).toBe(false);
  });

  it('should compare monetary values without float conversion errors', () => {
    expect(MoneyUtil.lessThan('10.00', '20.00')).toBe(true);
    expect(MoneyUtil.greaterThan('20.00', '10.00')).toBe(true);
    expect(MoneyUtil.equals('10.0000', '10.00')).toBe(true);
    expect(MoneyUtil.isZero('0.0000')).toBe(true);
    expect(MoneyUtil.isZero('0.0001')).toBe(false);
  });

  it('should allocate total amount across string/decimal ratios without losing pennies (USD 2 decimals)', () => {
    const total = '100.00';
    const ratios = ['1', '1', '1']; // Split $100 across 3 items
    const shares = MoneyUtil.allocate(total, ratios, 2);

    expect(shares).toEqual(['33.34', '33.33', '33.33']);
    const sum = shares.reduce((acc, val) => MoneyUtil.add(acc, val, 2), '0.00');
    expect(sum).toBe('100.00');
  });

  it('should allocate total amount across ratios for zero-decimal currencies (IRR 0 decimals)', () => {
    const total = '100000';
    const ratios = [1, 1, 1];
    const shares = MoneyUtil.allocate(total, ratios, 0);

    expect(shares).toEqual(['33334', '33333', '33333']);
    const sum = shares.reduce((acc, val) => MoneyUtil.add(acc, val, 0), '0');
    expect(sum).toBe('100000');
  });
});
