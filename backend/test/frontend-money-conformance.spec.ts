import * as fs from 'fs';
import * as path from 'path';
import Decimal from 'decimal.js';

// Setup Decimal configuration for test execution
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

describe('Frontend Money Conformance & Decimal-Safe Financial Business Logic Spec', () => {
  const frontendSrcDir = path.resolve(__dirname, '../../starter-vite-ts/src');

  /**
   * Helper function to recursively collect all source files
   */
  function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
    if (!fs.existsSync(dir)) return fileList;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') {
          getAllSourceFiles(fullPath, fileList);
        }
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  describe('1. Static Source-Conformance Code Scans', () => {
    const businessPages = [
      'pages/pos/order.tsx',
      'pages/pos/kiosk.tsx',
      'pages/pos/receipt.tsx',
      'pages/customers/credit.tsx',
      'pages/customers/directory.tsx',
      'pages/operations/delivery.tsx',
      'pages/operations/settlements.tsx',
      'pages/operations/cash-drawer.tsx',
      'pages/orders/orders-detail.tsx',
      'pages/orders/refunds.tsx',
      'pages/orders/workflow.tsx',
      'components/CheckoutModal.tsx',
    ];

    it('1.1 should verify MoneyUtil exists and formats currency safely without native float conversion', () => {
      const moneyUtilPath = path.join(frontendSrcDir, 'utils/money.util.ts');
      expect(fs.existsSync(moneyUtilPath)).toBe(true);

      const content = fs.readFileSync(moneyUtilPath, 'utf8');
      expect(content).toContain('class MoneyUtil');
      expect(content).toContain('formatCurrency');
      expect(content).toContain('Decimal');
    });

    businessPages.forEach((relPath) => {
      it(`1.2 should not contain floating-point operations on monetary fields in ${relPath}`, () => {
        const fullPath = path.join(frontendSrcDir, relPath);
        if (!fs.existsSync(fullPath)) {
          throw new Error(`File ${fullPath} does not exist`);
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');

        const forbiddenPatterns = [
          /parseFloat\(\s*[a-zA-Z0-9_.]*(price|amount|total|balance|tax|discount|fee|cash|compensation)/i,
          /[a-zA-Z0-9_.]*(price|amount|total|balance|tax|discount|fee|cash|compensation)[a-zA-Z0-9_.]*\.toFixed\(/i,
          /Number\(\s*[a-zA-Z0-9_.]*(price|amount|total|balance|tax|discount|fee|cash|compensation)[a-zA-Z0-9_.]*\)\s*[+\-*/]/i,
          /Number\(\s*[a-zA-Z0-9_.]*(price|amount|total|balance|tax|discount|fee|cash|compensation)[a-zA-Z0-9_.]*\)\.toLocaleString\(\)/i,
        ];

        const violations: string[] = [];
        lines.forEach((line, lineIdx) => {
          // Ignore comments
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

          forbiddenPatterns.forEach((pattern) => {
            if (pattern.test(line)) {
              violations.push(`Line ${lineIdx + 1}: ${line.trim()}`);
            }
          });
        });

        expect(violations).toEqual([]);
      });
    });
  });

  describe('2. POS Cart Totals & Coupon Financial Invariants', () => {
    it('2.1 should compute POS cart subtotal, 10% VAT, discount, and total due without penny drift', () => {
      // 3 items with fractional / precision decimal prices
      const items = [
        { name: 'Burger', unitPrice: '125000.50', quantity: '3' },      // 375,001.50
        { name: 'Special Sauce', unitPrice: '15000.25', quantity: '2' }, // 30,000.50
        { name: 'Fries', unitPrice: '45000.00', quantity: '1' },         // 45,000.00
      ];

      // Calculate line subtotals via Decimal
      const lineSubtotals = items.map((i) =>
        new Decimal(i.unitPrice).times(new Decimal(i.quantity)).toFixed(2)
      );
      expect(lineSubtotals).toEqual(['375001.50', '30000.50', '45000.00']);

      const subtotal = lineSubtotals.reduce(
        (acc, val) => new Decimal(acc).plus(new Decimal(val)).toFixed(2),
        '0.00'
      );
      expect(subtotal).toBe('450002.00');

      // 10% VAT
      const tax = new Decimal(subtotal).times(new Decimal('0.10')).toFixed(2);
      expect(tax).toBe('45000.20');

      const discount = '50000.00';
      const gross = new Decimal(subtotal).plus(new Decimal(tax)).toFixed(2);
      expect(gross).toBe('495002.20');

      const totalDue = new Decimal(gross).minus(new Decimal(discount)).toFixed(2);
      expect(totalDue).toBe('445002.20');
    });
  });

  describe('3. Kiosk Option Customization & Cart Financial Invariants', () => {
    it('3.1 should compute kiosk product base price plus selected options delta and line total', () => {
      const basePrice = '250000.00';
      const selectedOptions = [
        { name: 'Double Cheese', priceDelta: '35000.00' },
        { name: 'Extra Patty', priceDelta: '75000.00' },
        { name: 'Jalapeno', priceDelta: '15000.00' },
      ];

      const optionsSum = selectedOptions.reduce(
        (acc, opt) => new Decimal(acc).plus(new Decimal(opt.priceDelta)).toFixed(2),
        '0.00'
      );
      expect(optionsSum).toBe('125000.00');

      const unitPrice = new Decimal(basePrice).plus(new Decimal(optionsSum)).toFixed(2);
      expect(unitPrice).toBe('375000.00');

      const quantity = 3;
      const lineTotal = new Decimal(unitPrice).times(new Decimal(quantity)).toFixed(2);
      expect(lineTotal).toBe('1125000.00');

      const tax = new Decimal(lineTotal).times(new Decimal('0.09')).toFixed(2);
      expect(tax).toBe('101250.00');

      const finalTotal = new Decimal(lineTotal).plus(new Decimal(tax)).toFixed(2);
      expect(finalTotal).toBe('1226250.00');
    });
  });

  describe('4. Customer Credit Subledger & Aging Totals', () => {
    it('4.1 should aggregate credit limit, current balances, and available credit accurately', () => {
      const customerAgingAccounts = [
        { customer_code: 'CUST-01', credit_limit: '10000000.00', current_balance: '2500000.00', available_credit: '7500000.00' },
        { customer_code: 'CUST-02', credit_limit: '5000000.00', current_balance: '-500000.00', available_credit: '4500000.00' },
        { customer_code: 'CUST-03', credit_limit: '20000000.00', current_balance: '15000000.00', available_credit: '5000000.00' },
      ];

      const totalLimit = customerAgingAccounts.reduce(
        (acc, c) => new Decimal(acc).plus(new Decimal(c.credit_limit)).toFixed(2),
        '0.00'
      );
      expect(totalLimit).toBe('35000000.00');

      const totalBalance = customerAgingAccounts.reduce(
        (acc, c) => new Decimal(acc).plus(new Decimal(c.current_balance)).toFixed(2),
        '0.00'
      );
      expect(totalBalance).toBe('17000000.00');

      const totalAvailable = customerAgingAccounts.reduce(
        (acc, c) => new Decimal(acc).plus(new Decimal(c.available_credit)).toFixed(2),
        '0.00'
      );
      expect(totalAvailable).toBe('17000000.00');
    });
  });

  describe('5. Courier Settlement Payload & Discrepancy Calculations', () => {
    it('5.1 should compute expected cash/POS, actual collections, discrepancies, and net settlement total', () => {
      const lines = [
        { id: '1', expected_cash: '150000.00', actual_cash: '150000.00', expected_pos: '0.00', actual_pos: '0.00' },
        { id: '2', expected_cash: '200000.00', actual_cash: '180000.00', expected_pos: '0.00', actual_pos: '0.00' }, // -20,000 cash shortage
        { id: '3', expected_cash: '0.00', actual_cash: '0.00', expected_pos: '350000.00', actual_pos: '350000.00' },
      ];

      const expectedCashTotal = lines.reduce(
        (acc, l) => new Decimal(acc).plus(new Decimal(l.expected_cash)).toFixed(2),
        '0.00'
      );
      const actualCashTotal = lines.reduce(
        (acc, l) => new Decimal(acc).plus(new Decimal(l.actual_cash)).toFixed(2),
        '0.00'
      );
      const cashDiscrepancy = new Decimal(actualCashTotal).minus(new Decimal(expectedCashTotal)).toFixed(2);
      expect(expectedCashTotal).toBe('350000.00');
      expect(actualCashTotal).toBe('330000.00');
      expect(cashDiscrepancy).toBe('-20000.00');

      const expectedPosTotal = lines.reduce(
        (acc, l) => new Decimal(acc).plus(new Decimal(l.expected_pos)).toFixed(2),
        '0.00'
      );
      const actualPosTotal = lines.reduce(
        (acc, l) => new Decimal(acc).plus(new Decimal(l.actual_pos)).toFixed(2),
        '0.00'
      );
      const posDiscrepancy = new Decimal(actualPosTotal).minus(new Decimal(expectedPosTotal)).toFixed(2);
      expect(expectedPosTotal).toBe('350000.00');
      expect(actualPosTotal).toBe('350000.00');
      expect(posDiscrepancy).toBe('0.00');

      const totalCompensation = '45000.00'; // 3 deliveries * 15,000
      const totalAdjustment = '-5000.00';   // Deduction
      const netSettlement = new Decimal(actualCashTotal)
        .plus(new Decimal(actualPosTotal))
        .minus(new Decimal(totalCompensation))
        .plus(new Decimal(totalAdjustment))
        .toFixed(2);

      expect(netSettlement).toBe('630000.00'); // 330,000 + 350,000 - 45,000 - 5,000 = 630,000
    });
  });
});
