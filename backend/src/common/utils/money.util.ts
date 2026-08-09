import Decimal from 'decimal.js';

// Configure decimal.js for financial precision per AD-04
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export class MoneyUtil {
  static add(a: string | number, b: string | number, decimals: number = 4): string {
    return new Decimal(a || 0).plus(new Decimal(b || 0)).toFixed(decimals);
  }

  static subtract(a: string | number, b: string | number, decimals: number = 4): string {
    return new Decimal(a || 0).minus(new Decimal(b || 0)).toFixed(decimals);
  }

  static multiply(a: string | number, b: string | number, decimals: number = 4): string {
    return new Decimal(a || 0).times(new Decimal(b || 0)).toFixed(decimals);
  }

  static divide(a: string | number, b: string | number, decimals: number = 4): string {
    const divisor = new Decimal(b || 0);
    if (divisor.isZero()) {
      throw new Error('Division by zero');
    }
    return new Decimal(a || 0).div(divisor).toFixed(decimals);
  }

  static format(val: string | number, decimals: number = 4): string {
    return new Decimal(val || 0).toFixed(decimals);
  }

  static round(val: string | number, decimals: number = 4): string {
    return new Decimal(val || 0).toFixed(decimals);
  }

  static equals(a: string | number, b: string | number): boolean {
    return new Decimal(a || 0).equals(new Decimal(b || 0));
  }

  static isZero(val: string | number): boolean {
    return new Decimal(val || 0).isZero();
  }

  static lessThan(a: string | number, b: string | number): boolean {
    return new Decimal(a || 0).lessThan(new Decimal(b || 0));
  }

  static lessThanOrEqual(a: string | number, b: string | number): boolean {
    return new Decimal(a || 0).lessThanOrEqualTo(new Decimal(b || 0));
  }

  static greaterThan(a: string | number, b: string | number): boolean {
    return new Decimal(a || 0).greaterThan(new Decimal(b || 0));
  }

  static greaterThanOrEqual(a: string | number, b: string | number): boolean {
    return new Decimal(a || 0).greaterThanOrEqualTo(new Decimal(b || 0));
  }

  static abs(val: string | number, decimals: number = 4): string {
    return new Decimal(val || 0).abs().toFixed(decimals);
  }

  static notEqual(a: string | number, b: string | number): boolean {
    return !new Decimal(a || 0).equals(new Decimal(b || 0));
  }

  /**
   * Allocates a total amount proportionally among ratios without losing precision or pennies.
   * Uses the Hare-Niemeyer (Largest Remainder) method.
   */
  static allocate(totalAmount: string | number, ratios: number[], decimals: number = 4): string[] {
    if (ratios.length === 0) return [];
    const totalRatio = ratios.reduce((sum, r) => sum + r, 0);
    if (totalRatio <= 0) {
      throw new Error('Total ratio must be greater than zero');
    }

    const totalDecimal = new Decimal(totalAmount || 0);
    const unitMultiplier = new Decimal(10).pow(decimals);
    const totalUnits = totalDecimal.times(unitMultiplier).floor();

    const rawShares = ratios.map((r) => totalUnits.times(r).div(totalRatio));
    const floorShares = rawShares.map((share) => share.floor());
    const allocatedUnitsSum = floorShares.reduce((sum, share) => sum.plus(share), new Decimal(0));
    let remainderUnits = totalUnits.minus(allocatedUnitsSum).toNumber();

    // Sort remainders to distribute remaining units
    const indexedRemainders = rawShares.map((share, idx) => ({
      idx,
      remainder: share.minus(floorShares[idx]),
    }));
    indexedRemainders.sort((a, b) => b.remainder.minus(a.remainder).toNumber());

    const finalShares = [...floorShares];
    for (let i = 0; i < remainderUnits; i++) {
      const targetIdx = indexedRemainders[i % indexedRemainders.length].idx;
      finalShares[targetIdx] = finalShares[targetIdx].plus(1);
    }

    return finalShares.map((share) => share.div(unitMultiplier).toFixed(decimals));
  }
}
