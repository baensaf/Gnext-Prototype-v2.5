import Decimal from 'decimal.js';

// Configure decimal.js for financial precision per AD-04 / Specification §17.13
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = string | number | Decimal | null | undefined;

export class MoneyUtil {
  static add(a: MoneyInput, b: MoneyInput, decimals: number = 4): string {
    return new Decimal(a || 0).plus(new Decimal(b || 0)).toFixed(decimals);
  }

  static subtract(a: MoneyInput, b: MoneyInput, decimals: number = 4): string {
    return new Decimal(a || 0).minus(new Decimal(b || 0)).toFixed(decimals);
  }

  static multiply(a: MoneyInput, b: MoneyInput, decimals: number = 4): string {
    return new Decimal(a || 0).times(new Decimal(b || 0)).toFixed(decimals);
  }

  static divide(a: MoneyInput, b: MoneyInput, decimals: number = 4): string {
    const divisor = new Decimal(b || 0);
    if (divisor.isZero()) {
      throw new Error('Division by zero');
    }
    return new Decimal(a || 0).div(divisor).toFixed(decimals);
  }

  static format(val: MoneyInput, decimals: number = 4): string {
    return new Decimal(val || 0).toFixed(decimals);
  }

  static round(val: MoneyInput, decimals: number = 4): string {
    return new Decimal(val || 0).toFixed(decimals);
  }

  /**
   * Formats a monetary value with thousand separators without passing through native floating-point numbers.
   */
  static formatCurrency(val: MoneyInput, decimals: number = 0): string {
    const d = new Decimal(val || 0);
    const fixedStr = d.toFixed(decimals);
    const [intPart, fracPart] = fixedStr.split('.');
    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fracPart !== undefined && decimals > 0 ? `${formattedInt}.${fracPart}` : formattedInt;
  }

  static equals(a: MoneyInput, b: MoneyInput): boolean {
    return new Decimal(a || 0).equals(new Decimal(b || 0));
  }

  static isZero(val: MoneyInput): boolean {
    return new Decimal(val || 0).isZero();
  }

  static lessThan(a: MoneyInput, b: MoneyInput): boolean {
    return new Decimal(a || 0).lessThan(new Decimal(b || 0));
  }

  static lessThanOrEqual(a: MoneyInput, b: MoneyInput): boolean {
    return new Decimal(a || 0).lessThanOrEqualTo(new Decimal(b || 0));
  }

  static greaterThan(a: MoneyInput, b: MoneyInput): boolean {
    return new Decimal(a || 0).greaterThan(new Decimal(b || 0));
  }

  static greaterThanOrEqual(a: MoneyInput, b: MoneyInput): boolean {
    return new Decimal(a || 0).greaterThanOrEqualTo(new Decimal(b || 0));
  }

  static abs(val: MoneyInput, decimals: number = 4): string {
    return new Decimal(val || 0).abs().toFixed(decimals);
  }

  static notEqual(a: MoneyInput, b: MoneyInput): boolean {
    return !new Decimal(a || 0).equals(new Decimal(b || 0));
  }

  static sum(items: Array<MoneyInput>, decimals: number = 4): string {
    return items.reduce<string>((acc, cur) => MoneyUtil.add(acc, cur, decimals), '0');
  }

  static isValid(val: MoneyInput): boolean {
    if (val === null || val === undefined || val === '') return false;
    try {
      const d = new Decimal(val);
      return !d.isNaN();
    } catch {
      return false;
    }
  }

  /**
   * Allocates a total amount proportionally among ratios without losing precision or pennies.
   * Uses the Hare-Niemeyer (Largest Remainder) method.
   */
  static allocate(totalAmount: MoneyInput, ratios: Array<MoneyInput>, decimals: number = 4): string[] {
    if (ratios.length === 0) return [];
    const totalRatio = ratios.reduce<Decimal>((sum, r) => sum.plus(new Decimal(r || 0)), new Decimal(0));
    if (totalRatio.isZero() || totalRatio.isNegative()) {
      throw new Error('Total ratio must be greater than zero');
    }

    const totalDecimal = new Decimal(totalAmount || 0);
    const unitMultiplier = new Decimal(10).pow(decimals);
    const totalUnits = totalDecimal.times(unitMultiplier).floor();

    const rawShares = ratios.map((r) => totalUnits.times(new Decimal(r || 0)).div(totalRatio));
    const floorShares = rawShares.map((share) => share.floor());
    const allocatedUnitsSum = floorShares.reduce((sum, share) => sum.plus(share), new Decimal(0));
    const remainderUnits = totalUnits.minus(allocatedUnitsSum).toNumber();

    // Sort remainders to distribute remaining units
    const indexedRemainders = rawShares.map((share, idx) => ({
      idx,
      remainder: share.minus(floorShares[idx]),
    }));
    indexedRemainders.sort((a, b) => (b.remainder.minus(a.remainder).isNegative() ? -1 : 1));

    const finalShares = [...floorShares];
    for (let i = 0; i < remainderUnits; i++) {
      const targetIdx = indexedRemainders[i % indexedRemainders.length].idx;
      finalShares[targetIdx] = finalShares[targetIdx].plus(1);
    }

    return finalShares.map((share) => share.div(unitMultiplier).toFixed(decimals));
  }
}
