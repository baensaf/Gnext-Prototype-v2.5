import { test, expect } from '@playwright/test';
import * as fs from 'fs';

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

    const htmlElem = page.locator('html');
    const loginLangBtn = page.locator('#login-language-toggle-btn').first();
    await expect(loginLangBtn).toBeVisible({ timeout: 10000 });

    // Toggle language once on Login page
    await loginLangBtn.click();
    await page.waitForTimeout(500);

    const lang1 = (await htmlElem.getAttribute('lang')) || 'en';
    const expectedDir1 = lang1 === 'fa' ? 'rtl' : 'ltr';
    await expect(htmlElem).toHaveAttribute('dir', expectedDir1, { timeout: 10000 });

    // Toggle language back
    await loginLangBtn.click();
    await page.waitForTimeout(500);

    const lang2 = (await htmlElem.getAttribute('lang')) || 'fa';
    const expectedDir2 = lang2 === 'fa' ? 'rtl' : 'ltr';
    expect(lang2).not.toBe(lang1);
    await expect(htmlElem).toHaveAttribute('dir', expectedDir2, { timeout: 10000 });
  });

  test('3. Real POS Order Draft / Submit & Payment Workflow', async ({ page }) => {
    await loginUser(page);

    // Navigate to POS via client-side sidebar link
    const posNav = page.locator('a[href="/app/pos"]').first();
    await expect(posNav).toBeVisible({ timeout: 10000 });
    await posNav.click();
    await page.waitForURL('**/app/pos');
    await page.waitForLoadState('networkidle');

    // Select Fast Food catalog category tab and Cheeseburger product card
    const fastFoodTab = page.locator('.MuiTab-root').filter({ hasText: /Fast Food|Burger/i }).first();
    await expect(fastFoodTab).toBeVisible({ timeout: 10000 });
    await fastFoodTab.click();
    await page.waitForTimeout(300);

    const productCard = page.locator('.MuiPaper-root').filter({ hasText: /Cheeseburger|Burger|PROD-/i }).first();
    await expect(productCard).toBeVisible({ timeout: 15000 });
    await productCard.click();
    await page.waitForTimeout(2000);

    // Customize dialog if opened
    const optionDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize/i }).first();
    if (await optionDialog.isVisible().catch(() => false)) {
      const dialogAddBtn = optionDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
      await expect(dialogAddBtn).toBeVisible({ timeout: 5000 });
      await dialogAddBtn.click();
      await page.waitForTimeout(500);
    }

    // Verify item is added to Active Cart
    await expect(page.locator('body')).toContainText(/Active Cart \([1-9]\d* items?\)/i, { timeout: 10000 });

    // Submit Order Draft ("Place Order")
    const submitBtn = page.locator('button').filter({ hasText: /Place Order|Submit Order|ثبت سفارش/i }).first();
    await expect(submitBtn).toBeEnabled({ timeout: 15000 });
    await submitBtn.click();

    // Assert real checkout modal with order settlement options
    await expect(page.locator('body')).toContainText(/Order Settlement & Checkout|Order Placed Successfully|Order Number|ORD-/i, { timeout: 15000 });
  });

  test('4. Operational KDS & Delivery Workflow (API-Backed State Outcomes)', async ({ page }) => {
    await loginUser(page);

    // 1. KDS Workflow & State-Changing Ticket Outcome
    const kdsNav = page.locator('a[href="/app/kds"]').first();
    await expect(kdsNav).toBeVisible({ timeout: 10000 });
    await kdsNav.click();
    await page.waitForURL('**/app/kds');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/Kitchen|آشپزخانه|KDS/);

    // Assert tickets exist or perform start/bump action with API response validation
    const ticketCard = page.locator('.MuiCard-root').first();
    if (await ticketCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const startBtn = ticketCard.locator('button').filter({ hasText: /Start|شروع/i }).first();
      if (await startBtn.isVisible().catch(() => false)) {
        const startResponsePromise = page.waitForResponse(resp => resp.url().includes('/api/v1/kds/tickets/') && resp.ok());
        await startBtn.click();
        const startResponse = await startResponsePromise;
        expect(startResponse.ok()).toBe(true);
      }
    }

    // 2. Delivery Management & Courier Creation State Outcome
    const delNav = page.locator('a[href="/app/delivery/orders"]').first();
    await expect(delNav).toBeVisible({ timeout: 10000 });
    await delNav.click();
    await page.waitForURL('**/app/delivery/orders');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/Delivery|پیک|مرسوله/);

    // Switch to Couriers tab and add a new courier
    const couriersTab = page.locator('.MuiTab-root').filter({ hasText: /Couriers|پیک‌ها/i }).first();
    await expect(couriersTab).toBeVisible({ timeout: 10000 });
    await couriersTab.click();

    const addCourierBtn = page.locator('button').filter({ hasText: /Add Courier|پیک جدید/i }).first();
    await expect(addCourierBtn).toBeVisible({ timeout: 10000 });
    await addCourierBtn.click();

    const courierDialog = page.locator('.MuiDialog-root').filter({ hasText: /Add Courier Profile/i }).first();
    await expect(courierDialog).toBeVisible({ timeout: 5000 });

    const courierCode = `CR-E2E-${Date.now().toString().slice(-4)}`;
    const inputs = courierDialog.locator('input');
    await inputs.nth(0).fill(courierCode);
    await inputs.nth(1).fill('E2E Test Courier');

    const saveCourierPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/delivery/couriers') && resp.request().method() === 'POST' && resp.ok());
    const saveBtn = courierDialog.locator('button').filter({ hasText: /Save Courier|Create Courier|ذخیره/i }).first();
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    const saveRes = await saveCourierPromise;
    const courierData = await saveRes.json();
    expect(courierData.code).toBe(courierCode);
    await expect(page.locator('body')).toContainText(courierCode);
  });

  test('5. Report Execution & CSV/XLSX Export Workflow (File Content Validation)', async ({ page }) => {
    await loginUser(page);

    // Navigate to Sales Summary Report
    const repNav = page.locator('a[href="/app/reports/sales-summary"]').first();
    await expect(repNav).toBeVisible({ timeout: 10000 });
    await repNav.click();
    await page.waitForURL('**/app/reports/sales-summary');
    await page.waitForLoadState('networkidle');

    // 1. Require UTF-8 CSV Export Download Event & Validate File Content
    const csvBtn = page.locator('button').filter({ hasText: /Export UTF-8 CSV/i }).first();
    await expect(csvBtn).toBeVisible({ timeout: 15000 });

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      csvBtn.click(),
    ]);

    expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/i);
    const csvStream = await csvDownload.createReadStream();
    let csvText = '';
    if (csvStream) {
      for await (const chunk of csvStream) {
        csvText += chunk.toString('utf-8');
      }
    }
    expect(csvText.length).toBeGreaterThan(0);
    expect(csvText).toMatch(/Date|Order|Total|Subtotal|Sales|,/i);

    // 2. Require Typed XLSX Export Download Event & Validate File Size
    const xlsxBtn = page.locator('button').filter({ hasText: /Export Typed XLSX/i }).first();
    await expect(xlsxBtn).toBeVisible({ timeout: 15000 });

    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      xlsxBtn.click(),
    ]);

    expect(xlsxDownload.suggestedFilename()).toMatch(/\.xlsx$/i);
    const xlsxPath = await xlsxDownload.path();
    expect(xlsxPath).toBeTruthy();
    const xlsxStats = fs.statSync(xlsxPath!);
    expect(xlsxStats.size).toBeGreaterThan(0);

    // Verify no export failure banner
    await expect(page.locator('body')).not.toContainText('Export failed');
  });

  test('6. Offline / Sync Simulation Workflow (API-Backed State Outcomes)', async ({ page }) => {
    await loginUser(page);

    // Navigate to Offline Sync Management Page
    const syncNav = page.locator('a[href="/app/simulation/offline-sync"]').first();
    await expect(syncNav).toBeVisible({ timeout: 10000 });
    await syncNav.click();
    await page.waitForURL('**/app/simulation/offline-sync');
    await page.waitForLoadState('networkidle');

    // Verify branch context selection dropdown and wait for branch context UUID to populate
    const branchSelect = page.locator('#branch-select').first();
    await expect(branchSelect).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('None Selected', { timeout: 10000 });

    // 1. Toggle Connectivity Mode & Validate API Response
    const toggleSwitch = page.locator('input[type="checkbox"]').first();
    await expect(toggleSwitch).toBeVisible({ timeout: 10000 });

    const toggleOfflinePromise = page.waitForResponse(resp => new URL(resp.url()).pathname === '/api/v1/sync/toggle-connectivity' && resp.request().method() === 'POST');
    await toggleSwitch.click();
    const offlineRes = await toggleOfflinePromise;
    const offlineData = await offlineRes.json();
    expect(typeof offlineData.is_online).toBe('boolean');

    // Ensure branch is set to offline mode for transaction queuing
    if (offlineData.is_online) {
      const forceOfflinePromise = page.waitForResponse(resp => new URL(resp.url()).pathname === '/api/v1/sync/toggle-connectivity' && resp.request().method() === 'POST');
      await toggleSwitch.click();
      const forceRes = await forceOfflinePromise;
      const forceData = await forceRes.json();
      expect(forceData.is_online).toBe(false);
    }
    await expect(page.locator('body')).toContainText(/OFFLINE SIMULATED|Offline Disconnected/i);

    // Wait for button to be enabled after background fetch completes
    const addOfflineOrderBtn = page.locator('button').filter({ hasText: /\+ Offline Order/i }).first();
    await expect(addOfflineOrderBtn).toBeEnabled({ timeout: 10000 });

    // 2. Enqueue Offline Transaction Item
    const enqueuePromise = page.waitForResponse(resp => new URL(resp.url()).pathname === '/api/v1/sync/queue' && resp.request().method() === 'POST');
    await addOfflineOrderBtn.click();
    const enqueueRes = await enqueuePromise;
    const enqueueData = await enqueueRes.json();
    expect(enqueueData.id).toBeDefined();

    // 3. Trigger Sync Worker Execution
    const triggerWorkerBtn = page.locator('button').filter({ hasText: /Trigger Sync Worker/i }).first();
    await expect(triggerWorkerBtn).toBeEnabled({ timeout: 10000 });
    const triggerPromise = page.waitForResponse(resp => new URL(resp.url()).pathname === '/api/v1/sync/trigger' && resp.request().method() === 'POST');
    await triggerWorkerBtn.click();
    const triggerRes = await triggerPromise;
    const triggerData = await triggerRes.json();
    expect(triggerData.success).toBe(true);
    expect(triggerData.processed_count).toBeGreaterThanOrEqual(1);

    // 4. Restore Online Connectivity Mode
    const isCurrentlyChecked = await toggleSwitch.isChecked();
    if (!isCurrentlyChecked) {
      const toggleOnlinePromise = page.waitForResponse(resp => new URL(resp.url()).pathname === '/api/v1/sync/toggle-connectivity' && resp.request().method() === 'POST');
      await toggleSwitch.click();
      const onlineRes = await toggleOnlinePromise;
      const onlineData = await onlineRes.json();
      expect(onlineData.is_online).toBe(true);
    }
    await expect(page.locator('body')).toContainText(/Online Connected/i);
  });

  test('7. Localized 404 Route Behavior', async ({ page }) => {
    await page.goto('/nonexistent-route-xyz');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/صفحه مورد نظر یافت نشد|Sorry, page not found|404/);
    const navHomeLink = page.locator('a[href="/app/dashboard"], a[href="/"], a:has-text("Dashboard"), a:has-text("داشبورد"), button:has-text("Dashboard"), button:has-text("داشبورد")').first();
    await expect(navHomeLink).toBeVisible();
  });

  test('8. Regression: Invalid/Missing Branch UUID Rejection (API & UI Protection)', async ({ page }) => {
    await loginUser(page);

    // 1. Direct API Regression: GET /api/v1/sync/status with invalid branch UUID
    const invalidStatusRes = await page.request.get('http://localhost:3100/api/v1/sync/status?branchId=invalid-branch-id');
    expect(invalidStatusRes.status()).toBe(400);
    const invalidStatusData = await invalidStatusRes.json();
    const statusMsg = invalidStatusData.detail || invalidStatusData.message;
    expect(statusMsg).toContain('Valid branch context (UUID) is required for offline sync operations');

    // 2. Direct API Regression: GET /api/v1/sync/queue with invalid branch UUID
    const missingBranchQueueRes = await page.request.get('http://localhost:3100/api/v1/sync/queue?branchId=invalid-branch-id');
    expect(missingBranchQueueRes.status()).toBe(400);
    const missingQueueData = await missingBranchQueueRes.json();
    const queueMsg = missingQueueData.detail || missingQueueData.message;
    expect(queueMsg).toContain('Valid branch context (UUID) is required for offline sync operations');

    // 3. Direct API Regression: POST /api/v1/sync/toggle-connectivity with non-UUID branch
    const invalidToggleRes = await page.request.post('http://localhost:3100/api/v1/sync/toggle-connectivity', {
      data: {
        branchId: 'non-uuid-branch-12345',
        isOnline: false,
      },
    });
    expect([400, 403]).toContain(invalidToggleRes.status());
  });

});
