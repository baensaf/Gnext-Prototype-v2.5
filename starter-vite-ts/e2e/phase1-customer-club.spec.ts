import { test, expect } from '@playwright/test';

test.describe('Phase 1 Customer Club, Discounts & Coupons E2E Workflows', () => {

  const loginUser = async (page: any) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('gnext_locale', 'en'));
    await page.waitForLoadState('networkidle');
    await page.locator('input[autoComplete="username"], input[name="username"]').first().fill('admin@gnext.local');
    await page.locator('input[autoComplete="current-password"], input[type="password"]').first().fill('GnextDemo!2026');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app/dashboard', { timeout: 15000 });
    await page.evaluate(() => localStorage.setItem('gnext_locale', 'en'));
    await page.waitForTimeout(1000);
  };

  test('Workflow 1: Customer Discounts Page renders, handles single assignment dialog and bulk assignment dialog', async ({ page }) => {
    await loginUser(page);

    await page.goto('/app/discounts/customer-rates');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/Customer Specific Discounts|تخفیف‌های ویژه مشتریان|نرخ‌های ویژه مشتریان/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Assign Customer Discount|تخصیص تخفیف به مشتری/i);

    // Single Assignment Dialog
    const assignBtn = page.locator('button').filter({ hasText: /Assign Customer Discount|تخصیص تخفیف به مشتری/i }).first();
    await assignBtn.click();
    await expect(page.locator('.MuiDialog-root')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.MuiDialog-root')).toContainText(/Discount Percentage|درصد تخفیف/i);
    await page.keyboard.press('Escape');

    // Bulk Assignment Dialog
    const bulkBtn = page.locator('button').filter({ hasText: /Bulk Assign|تخصیص گروهی/i }).first();
    await bulkBtn.click();
    await expect(page.locator('.MuiDialog-root')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.MuiDialog-root')).toContainText(/Bulk Customer Discount Assignment|تخصیص گروهی تخفیف به مشتریان/i);
  });

  test('Workflow 2: One-Time Coupons Studio Page renders test bench and one-time coupon drawer', async ({ page }) => {
    await loginUser(page);

    await page.goto('/app/discounts/coupons');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/One-Time Promotional Coupons|کوپن‌های تخفیف یک‌بارمصرف|استودیو کوپن‌های تخفیف/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Test Bench|محیط آزمایشی/i);

    const createBtn = page.locator('button').filter({ hasText: /Create One-Time Coupon|ایجاد کوپن یک‌بارمصرف/i }).first();
    await createBtn.click();

    await expect(page.locator('.MuiDrawer-root')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.MuiDrawer-root')).toContainText(/Unique Coupon Code|کد یکتای کوپن/i);
  });

  test('Workflow 3: Cashier Manual Discount Authorizations Page displays role limits', async ({ page }) => {
    await loginUser(page);

    await page.goto('/app/discounts/authorizations');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/Cashier Manual Discount Authorizations|اختیارات تخفیف دستی صندوق‌داران|سقف اختیارات و قوانین پین/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Cashier Role Limits|سقف دسترسی صندوق‌دار/i);
    await expect(page.locator('body')).toContainText(/Supervisor Role Limits|سقف دسترسی سوپروایزر/i);
    await expect(page.locator('body')).toContainText(/Manager Role Limits|سقف دسترسی مدیر فروشگاه/i);
  });

  test('Workflow 4: Customer Club Wallet & Cashback Page saves policy and displays wallet balances', async ({ page }) => {
    await loginUser(page);

    await page.goto('/app/discounts/wallet');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/Customer Club Wallet & Cashback|کیف پول و کش‌بک باشگاه مشتریان|کیف پول و کش‌بک وفاداری/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Cashback Earning Policy|سیاست کسب کش‌بک/i);

    const savePolicyBtn = page.locator('button').filter({ hasText: /Save Policy|ذخیره سیاست/i }).first();
    await expect(savePolicyBtn).toBeVisible();
    await savePolicyBtn.click();
  });

  test('Discounts Hub tabs only show 4 Phase 1 tabs and redirects /discounts/campaigns to /customer-rates', async ({ page }) => {
    await loginUser(page);

    await page.goto('/app/discounts/campaigns');
    await page.waitForLoadState('networkidle');

    // Should redirect to customer-rates
    await expect(page).toHaveURL(/.*\/app\/discounts\/customer-rates/);
    await expect(page.locator('body')).not.toContainText(/Advanced Discount Campaigns/i);
    await expect(page.locator('body')).not.toContainText(/V5 Preview/i);

    // Verify all 4 tabs exist in tabs bar
    const tabList = page.locator('.MuiTabs-root');
    await expect(tabList).toBeVisible();
    await expect(tabList.locator('.MuiTab-root')).toHaveCount(4);
  });
});

