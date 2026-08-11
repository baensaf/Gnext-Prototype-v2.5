import { MoneyUtil } from '../src/common/utils/money.util';

describe('MoneyUtil Precision-Sensitive Financial Math Spec', () => {
  it('1. should perform exact addition without JS floating point representation error (0.1 + 0.2)', () => {
    const jsResult = 0.1 + 0.2;
    expect(jsResult).not.toBe(0.3); // JS float returns 0.30000000000000004

    const decimalResult = MoneyUtil.add('0.1', '0.2', 2);
    expect(decimalResult).toBe('0.30');
  });

  it('2. should accurately calculate subtotal minus discount and tax with 4 decimal places', () => {
    const subtotal = '19.99';
    const discount = '2.50';
    const taxRate = '0.09'; // 9%

    const afterDiscount = MoneyUtil.subtract(subtotal, discount, 4);
    expect(afterDiscount).toBe('17.4900');

    const taxAmount = MoneyUtil.multiply(afterDiscount, taxRate, 4);
    expect(taxAmount).toBe('1.5741'); // 17.49 * 0.09 = 1.5741 exactly

    const grandTotal = MoneyUtil.add(afterDiscount, taxAmount, 4);
    expect(grandTotal).toBe('19.0641');
  });

  it('3. should perform Hare-Niemeyer proportional allocation without losing pennies', () => {
    const totalAmount = '10.0000';
    const ratios = [1, 1, 1]; // Split $10 equally among 3 recipients

    const allocated = MoneyUtil.allocate(totalAmount, ratios, 4);
    expect(allocated.length).toBe(3);

    // Sum of allocated shares must equal exact totalAmount (no penny leakage)
    const sum = allocated.reduce((acc, val) => MoneyUtil.add(acc, val, 4), '0.0000');
    expect(sum).toBe('10.0000');

    // First share gets remainder unit: 3.3334, 3.3333, 3.3333
    expect(allocated[0]).toBe('3.3334');
    expect(allocated[1]).toBe('3.3333');
    expect(allocated[2]).toBe('3.3333');
  });

  it('4. should handle large transaction amounts without precision degradation', () => {
    const largeAmount1 = '999999999999.9999';
    const largeAmount2 = '0.0001';

    const total = MoneyUtil.add(largeAmount1, largeAmount2, 4);
    expect(total).toBe('1000000000000.0000');
  });

  it('5. should correctly evaluate greaterThan and lessThan decimal comparisons', () => {
    expect(MoneyUtil.greaterThan('100.0001', '100.0000')).toBe(true);
    expect(MoneyUtil.lessThan('99.9999', '100.0000')).toBe(true);
    expect(MoneyUtil.equals('15.5000', '15.5')).toBe(true);
  });
});
