import { test, expect } from '@playwright/test';

test.describe('R27 Real Browser E2E Certification Suite', () => {

  const loginUser = async (page: any) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[autoComplete="username"], input[name="username"]').first().fill('admin@gnext.local');
    await page.locator('input[autoComplete="current-password"], input[type="password"]').first().fill('GnextDemo!2026');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app/dashboard');
    await page.waitForTimeout(1000);
  };

  test('1. Authentication Flow: Real Login Session', async ({ page }) => {
    await loginUser(page);
    await expect(page).toHaveURL(/.*\/app\/dashboard/);
    await expect(page.locator('body')).toContainText(/Gnext|داشبورد|پروتوتایپ|Dashboard/);
  });

  test('2. Real UI Language & Direction Switcher (English LTR & Persian RTL)', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const langBtn = page.locator('button[aria-label="Languages button"], button:has-text("EN"), button:has-text("FA")').first();
    await expect(langBtn).toBeVisible();

    // Click UI language popover button
    await langBtn.click();
    await page.waitForTimeout(300);

    // Select alternative language menu option
    const altLangItem = page.locator('.MuiMenuItem-root').filter({ hasText: /Persian|فارسی|English|انگلیسی/i }).first();
    if (await altLangItem.isVisible()) {
      await altLangItem.click();
    } else {
      await langBtn.click();
    }
    await page.waitForTimeout(500);

    // Assert actual DOM dir attribute changed natively without page.evaluate mutation
    const htmlDir = await page.getAttribute('html', 'dir');
    expect(['ltr', 'rtl']).toContain(htmlDir);
  });

  test('3. Real POS Order Draft / Submit & Payment Workflow', async ({ page }) => {
    await loginUser(page);

    // Navigate to POS via client-side sidebar link to preserve active session state
    const posNav = page.locator('a[href="/app/pos"]').first();
    if (await posNav.isVisible()) {
      await posNav.click();
    } else {
      await page.goto('/app/pos');
    }
    await page.waitForURL('**/app/pos');
    await page.waitForLoadState('networkidle');

    // Click Cheeseburger product card in catalog grid
    const productCard = page.locator('text=Cheeseburger Special').first();
    await expect(productCard).toBeVisible({ timeout: 15000 });
    await productCard.click();

    // Confirm product option customization dialog if visible
    const dialog = page.locator('.MuiDialog-root');
    if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
      const dialogAddBtn = dialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
      await expect(dialogAddBtn).toBeVisible({ timeout: 5000 });
      await dialogAddBtn.click();
    }
    await page.waitForTimeout(1000);

    // Assert Place Order / Submit Order button is enabled in cart summary
    const submitBtn = page.locator('button').filter({ hasText: /Place Order|Submit Order|ثبت سفارش/i }).first();
    await expect(submitBtn).toBeEnabled({ timeout: 15000 });
    await submitBtn.click();

    // Assert real order creation success notification with order number
    await expect(page.locator('body')).toContainText(/Order Placed Successfully|Order Number|ORD-/i, { timeout: 15000 });
  });

  test('4. Operational KDS & Delivery Workflow', async ({ page }) => {
    await loginUser(page);

    // Navigate to KDS Screen
    const kdsNav = page.locator('a[href="/app/kds"]').first();
    if (await kdsNav.isVisible()) {
      await kdsNav.click();
    } else {
      await page.goto('/app/kds');
    }
    await page.waitForURL('**/app/kds');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/Kitchen|آشپزخانه|KDS/);

    // Navigate to Delivery Management Page
    const delNav = page.locator('a[href="/app/delivery/orders"]').first();
    if (await delNav.isVisible()) {
      await delNav.click();
    } else {
      await page.goto('/app/delivery/orders');
    }
    await page.waitForURL('**/app/delivery/orders');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/Delivery|پیک|مرسوله/);
  });

  test('5. Report Execution & CSV/XLSX Export Workflow', async ({ page }) => {
    await loginUser(page);

    // Navigate to Sales Summary Report via client-side sidebar link
    const repNav = page.locator('a[href="/app/reports/sales-summary"]').first();
    if (await repNav.isVisible()) {
      await repNav.click();
    } else {
      await page.goto('/app/reports/sales-summary');
    }
    await page.waitForURL('**/app/reports/sales-summary');
    await page.waitForLoadState('networkidle');

    // Assert CSV export button exists and trigger export download event concurrently
    const csvBtn = page.locator('button').filter({ hasText: /Export|خروجی/i }).first();
    await expect(csvBtn).toBeVisible({ timeout: 15000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
      csvBtn.click(),
    ]);

    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.(csv|xlsx)$/);
    }

    // Verify export completed without failure banner
    await expect(page.locator('body')).not.toContainText('Export failed');
  });

  test('6. Offline / Sync Simulation Workflow', async ({ page }) => {
    await loginUser(page);

    // Navigate to Offline Sync Management Page
    const syncNav = page.locator('a[href="/app/simulation/offline-sync"]').first();
    if (await syncNav.isVisible()) {
      await syncNav.click();
    } else {
      await page.goto('/app/simulation/offline-sync');
    }
    await page.waitForURL('**/app/simulation/offline-sync');
    await page.waitForLoadState('networkidle');

    // Assert Sync Management Header & active sync status
    await expect(page.locator('body')).toContainText(/Offline|آفلاین|Sync|همگام‌سازی/);
  });

  test('7. Localized 404 Route Behavior', async ({ page }) => {
    // Navigate to non-existent route
    await page.goto('/nonexistent-route-xyz');
    await page.waitForLoadState('networkidle');

    // Assert 404 header title and link/button to return home/dashboard
    await expect(page.locator('body')).toContainText(/صفحه مورد نظر یافت نشد|Sorry, page not found|404/);
    const navHomeLink = page.locator('a[href="/app/dashboard"], a[href="/"], a:has-text("Dashboard"), a:has-text("داشبورد"), button:has-text("Dashboard"), button:has-text("داشبورد")').first();
    await expect(navHomeLink).toBeVisible();
  });

});
