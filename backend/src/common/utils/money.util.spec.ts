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

  it('should allocate total amount across ratios without losing pennies (USD 2 decimals)', () => {
    const total = '100.00';
    const ratios = [1, 1, 1]; // Split $100 across 3 items
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
