import { MoneyUtil } from '../src/common/utils/money.util';
import Decimal from 'decimal.js';

describe('Money Precision & Currency Math Regression Suite', () => {
  describe('Floating-point Edge Cases', () => {
    it('eliminates 0.1 + 0.2 floating-point representation error', () => {
      const nativeSum = 0.1 + 0.2;
      expect(nativeSum).not.toBe(0.3); // 0.30000000000000004 in native JS

      const safeSum = MoneyUtil.add('0.1', '0.2', 2);
      expect(safeSum).toBe('0.30');
    });

    it('handles cumulative floating-point drift over multiple additions', () => {
      let decimalSum = '0.00';
      for (let i = 0; i < 100; i++) {
        decimalSum = MoneyUtil.add(decimalSum, '0.07', 2);
      }
      expect(decimalSum).toBe('7.00'); // Exactly 7.00, not 7.0000000000000009
    });

    it('correctly handles small fractional amounts and tax precision', () => {
      const lineTotal = '15.99';
      const taxRate = '0.09'; // 9% tax
      const taxAmount = MoneyUtil.multiply(lineTotal, taxRate, 4);
      expect(taxAmount).toBe('1.4391');

      const totalWithTax = MoneyUtil.add(lineTotal, taxAmount, 4);
      expect(totalWithTax).toBe('17.4291');

      const roundedDisplay = MoneyUtil.format(totalWithTax, 2);
      expect(roundedDisplay).toBe('17.43');
    });
  });

  describe('Decimal-Safe Utility Functions', () => {
    it('compares amounts safely without float precision loss', () => {
      expect(MoneyUtil.equals('100.0000', '100.00')).toBe(true);
      expect(MoneyUtil.greaterThan('100.0001', '100.0000')).toBe(true);
      expect(MoneyUtil.lessThan('99.9999', '100.0000')).toBe(true);
      expect(MoneyUtil.isZero('0.0000')).toBe(true);
    });

    it('performs exact multi-way money allocation without losing cents', () => {
      // Allocate 100.00 into 3 equal ratios (1:1:1) with 2 decimal places
      const parts = MoneyUtil.allocate('100.00', [1, 1, 1], 2);
      expect(parts).toEqual(['33.34', '33.33', '33.33']);

      // Sum of allocated parts strictly equals original total
      const allocatedSum = parts.reduce((sum, p) => MoneyUtil.add(sum, p, 2), '0.00');
      expect(allocatedSum).toBe('100.00');
    });

    it('rounds using Decimal.ROUND_HALF_UP standard', () => {
      expect(MoneyUtil.round('12.345', 2)).toBe('12.35');
      expect(MoneyUtil.round('12.344', 2)).toBe('12.34');
      expect(MoneyUtil.round('12.3450', 2)).toBe('12.35');
    });

    it('formats numbers and numeric strings to fixed decimal places consistently', () => {
      expect(MoneyUtil.format(123.4, 2)).toBe('123.40');
      expect(MoneyUtil.format('123.456', 2)).toBe('123.46');
      expect(MoneyUtil.format('0', 4)).toBe('0.0000');
    });
  });

  describe('Courier Settlement & Delivery Discrepancy Precision', () => {
    it('calculates net settlement and discrepancies with strict 2-decimal safety', () => {
      const expCash = '1250000.00';
      const actCash = '1250000.00';
      const expPos = '750000.50';
      const actPos = '750000.50';
      const comp = '50000.00';
      const adj = '10000.00';

      const cashDisc = MoneyUtil.subtract(actCash, expCash, 2);
      const posDisc = MoneyUtil.subtract(actPos, expPos, 2);
      expect(cashDisc).toBe('0.00');
      expect(posDisc).toBe('0.00');

      const gross = MoneyUtil.add(actCash, actPos, 2);
      const afterComp = MoneyUtil.subtract(gross, comp, 2);
      const netSettlement = MoneyUtil.add(afterComp, adj, 2);

      expect(netSettlement).toBe('1960000.50');
    });

    it('detects fractional discrepancy without floating point errors', () => {
      const expCash = '100.05';
      const actCash = '100.00';

      const diff = MoneyUtil.subtract(actCash, expCash, 2);
      expect(diff).toBe('-0.05');
      expect(MoneyUtil.isZero(diff)).toBe(false);
    });
  });
});
