import Decimal from 'decimal.js';

// Configure decimal.js for financial precision per AD-04
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export class MoneyUtil {
  static add(a: string | number, b: string | number): string {
    return new Decimal(a || 0).plus(new Decimal(b || 0)).toFixed(4);
  }

  static subtract(a: string | number, b: string | number): string {
    return new Decimal(a || 0).minus(new Decimal(b || 0)).toFixed(4);
  }

  static multiply(a: string | number, b: string | number): string {
    return new Decimal(a || 0).times(new Decimal(b || 0)).toFixed(4);
  }

  static divide(a: string | number, b: string | number): string {
    if (new Decimal(b || 0).isZero()) {
      throw new Error('Division by zero');
    }
    return new Decimal(a || 0).div(new Decimal(b || 0)).toFixed(4);
  }

  static format(val: string | number): string {
    return new Decimal(val || 0).toFixed(4);
  }

  static lessThan(a: string | number, b: string | number): boolean {
    return new Decimal(a || 0).lessThan(new Decimal(b || 0));
  }

  static greaterThan(a: string | number, b: string | number): boolean {
    return new Decimal(a || 0).greaterThan(new Decimal(b || 0));
  }
}
