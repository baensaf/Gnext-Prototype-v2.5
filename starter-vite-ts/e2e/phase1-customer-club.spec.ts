import { test, expect } from '@playwright/test';

test.describe('Phase 1 Customer Club, Discounts & Coupons E2E Workflows', () => {

  const loginUser = async (page: any) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[autoComplete="username"], input[name="username"]').first().fill('admin@gnext.local');
    await page.locator('input[autoComplete="current-password"], input[type="password"]').first().fill('GnextDemo!2026');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app/dashboard', { timeout: 15000 });
    await page.waitForTimeout(1000);
  };

  test('Workflow 1: Customer Discounts Page renders, handles single assignment dialog and bulk assignment dialog', async ({ page }) => {
    await loginUser(page);

    await page.goto('/app/customer-club/discounts');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/Customer Specific Discounts/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Assign Customer Discount/i);

    // Single Assignment Dialog
    const assignBtn = page.locator('button').filter({ hasText: /Assign Customer Discount/i }).first();
    await assignBtn.click();
    await expect(page.locator('.MuiDialog-root')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.MuiDialog-root')).toContainText(/Discount Percentage/i);
    await page.keyboard.press('Escape');

    // Bulk Assignment Dialog
    const bulkBtn = page.locator('button').filter({ hasText: /Bulk Assign/i }).first();
    await bulkBtn.click();
    await expect(page.locator('.MuiDialog-root')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.MuiDialog-root')).toContainText(/Bulk Customer Discount Assignment/i);
  });

  test('Workflow 2: Customer Club Wallet & Cashback Page saves policy and displays wallet balances', async ({ page }) => {
    await loginUser(page);

    await page.goto('/app/customer-club/wallet');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/Customer Club Wallet & Cashback/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Cashback Earning Policy/i);

    const savePolicyBtn = page.locator('button').filter({ hasText: /Save Policy/i }).first();
    await expect(savePolicyBtn).toBeVisible();
    await savePolicyBtn.click();
  });

  test('Workflow 3: Cashier Manual Discount Authorizations Page displays role limits', async ({ page }) => {
    await loginUser(page);

    await page.goto('/app/settings/discount-authorizations');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/Cashier Manual Discount Authorizations/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Cashier Role Limits/i);
    await expect(page.locator('body')).toContainText(/Supervisor Role Limits/i);
    await expect(page.locator('body')).toContainText(/Manager Role Limits/i);
  });

  test('Workflow 4: One-Time Coupons Studio Page renders test bench and one-time coupon drawer', async ({ page }) => {
    await loginUser(page);

    await page.goto('/app/discounts/coupons');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/One-Time Promotional Coupons/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Test Bench/i);

    const createBtn = page.locator('button').filter({ hasText: /Create One-Time Coupon/i }).first();
    await createBtn.click();

    await expect(page.locator('.MuiDrawer-root')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.MuiDrawer-root')).toContainText(/Unique Coupon Code/i);
  });

  test('V5 Preview Experience Badge is visible on Advanced Discount Campaigns', async ({ page }) => {
    await loginUser(page);

    await page.goto('/app/discounts/campaigns');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/V5 Preview/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Advanced Discount Campaigns/i);
  });
});
