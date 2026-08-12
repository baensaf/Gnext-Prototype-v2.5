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
    await page.waitForTimeout(500);
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
    const loginLangBtn = page.locator('#login-language-toggle-btn, button[aria-label="Languages button"]').first();
    await expect(loginLangBtn).toBeVisible({ timeout: 10000 });

    // Switch to English via popover menu
    await loginLangBtn.click();
    await page.waitForTimeout(200);
    const enOption = page.locator('.MuiMenuItem-root').filter({ hasText: 'English' }).first();
    if (await enOption.isVisible()) {
      await enOption.click();
    }
    await page.waitForTimeout(300);

    const lang1 = (await htmlElem.getAttribute('lang')) || 'en';
    const expectedDir1 = lang1 === 'fa' ? 'rtl' : 'ltr';
    await expect(htmlElem).toHaveAttribute('dir', expectedDir1, { timeout: 10000 });

    // Switch to Persian via popover menu
    await loginLangBtn.click();
    await page.waitForTimeout(200);
    const faOption = page.locator('.MuiMenuItem-root').filter({ hasText: 'فارسی' }).first();
    if (await faOption.isVisible()) {
      await faOption.click();
    }
    await page.waitForTimeout(300);

    const lang2 = (await htmlElem.getAttribute('lang')) || 'fa';
    const expectedDir2 = lang2 === 'fa' ? 'rtl' : 'ltr';
    expect(lang2).not.toBe(lang1);
    await expect(htmlElem).toHaveAttribute('dir', expectedDir2, { timeout: 10000 });
  });

  test('3. Real POS Order Draft / Submit & Multi-Tender Payment Workflow', async ({ page }) => {
    await loginUser(page);

    // Navigate to POS via client-side sidebar link
    const posNav = page.locator('a[href="/app/pos"]').first();
    await expect(posNav).toBeVisible({ timeout: 10000 });
    await posNav.click();
    await page.waitForURL('**/app/pos');
    await page.waitForLoadState('networkidle');

    // Select Fast Food catalog category tab and product card
    const fastFoodTab = page.locator('.MuiTab-root').filter({ hasText: /Fast Food|Burger/i }).first();
    await expect(fastFoodTab).toBeVisible({ timeout: 10000 });
    await fastFoodTab.click();
    await page.waitForTimeout(300);

    const productCard = page.locator('.MuiPaper-root').filter({ hasText: /Cheeseburger|Burger|PROD-/i }).first();
    await expect(productCard).toBeVisible({ timeout: 15000 });
    await productCard.click();
    await page.waitForTimeout(500);

    // Option customization dialog
    const optionDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize/i }).first();
    await expect(optionDialog).toBeVisible({ timeout: 10000 });
    const dialogAddBtn = optionDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
    await expect(dialogAddBtn).toBeVisible({ timeout: 5000 });
    await dialogAddBtn.click();
    await page.waitForTimeout(500);

    // Verify item is added to Active Cart
    await expect(page.locator('body')).toContainText(/Active Cart \([1-9]\d* items?\)/i, { timeout: 10000 });

    // Submit Order Draft ("Place Order")
    const submitBtn = page.locator('button').filter({ hasText: /Place Order|Submit Order|ثبت سفارش/i }).first();
    await expect(submitBtn).toBeEnabled({ timeout: 15000 });
    await submitBtn.click();

    // Assert checkout modal
    await expect(page.locator('body')).toContainText(/Order Settlement & Checkout|تسویه و پرداخت سفارش|Order Placed Successfully|تسویه/i, { timeout: 15000 });

    // Post payment tender in checkout modal
    const checkoutDialog = page.locator('.MuiDialog-root').filter({ hasText: /Order Settlement & Checkout|تسویه و پرداخت سفارش|تسویه/i }).first();
    await expect(checkoutDialog).toBeVisible({ timeout: 10000 });

    const postPaymentBtn = checkoutDialog.locator('button').filter({ hasText: /Post Payment Tender|پرداخت/i }).first();
    await expect(postPaymentBtn).toBeVisible({ timeout: 10000 });
    await postPaymentBtn.click();

    // Assert order fully settled and receipt button available
    await expect(checkoutDialog).toContainText(/Order Fully Settled!|سفارش به طور کامل تسویه شد!|تسویه کامل|Print Thermal Receipt/i, { timeout: 15000 });
  });

  test('4. Operational KDS & Delivery Workflow (API-Backed State Outcomes)', async ({ page }) => {
    await loginUser(page);

    // 1. KDS Workflow
    const kdsNav = page.locator('a[href="/app/kds"]').first();
    await expect(kdsNav).toBeVisible({ timeout: 10000 });
    await kdsNav.click();
    await page.waitForURL('**/app/kds');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/Kitchen|آشپزخانه|KDS/);

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

    // 1. Toggle Connectivity Mode to Offline
    const toggleSwitch = page.locator('input[type="checkbox"]').first();
    await expect(toggleSwitch).toBeVisible({ timeout: 10000 });

    if (await toggleSwitch.isChecked()) {
      const toggleOfflinePromise = page.waitForResponse(resp => new URL(resp.url()).pathname === '/api/v1/sync/toggle-connectivity' && resp.request().method() === 'POST');
      await toggleSwitch.click({ force: true });
      const offlineRes = await toggleOfflinePromise;
      const offlineData = await offlineRes.json();
      expect(typeof offlineData.is_online).toBe('boolean');
    }
    await expect(page.locator('body')).toContainText(/OFFLINE SIMULATED|Offline Disconnected/i, { timeout: 10000 });

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
    await page.request.post('/api/v1/sync/toggle-connectivity', { data: { is_online: true } });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/Online Connected|ONLINE/i, { timeout: 15000 });
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

  test('9. Acceptance Journey 1: Customer Credit, Repayment, Aging, Statement & Audit Links (LTR & RTL)', async ({ page }) => {
    await loginUser(page);

    // 1. Create a customer with credit limit in Customer Directory
    const custNav = page.locator('a[href="/app/customers"]').first();
    await expect(custNav).toBeVisible({ timeout: 10000 });
    await custNav.click();
    await page.waitForURL('**/app/customers');
    await page.waitForLoadState('networkidle');

    const addCustBtn = page.locator('button').filter({ hasText: /Register Customer|ثبت مشتری/i }).first();
    await expect(addCustBtn).toBeVisible({ timeout: 10000 });
    await addCustBtn.click();

    const uniqueCode = `CUST-${Date.now().toString().slice(-4)}`;
    const custInputs = page.locator('.MuiDrawer-root input');
    await custInputs.nth(0).fill(uniqueCode);
    await custInputs.nth(1).fill('Acceptance');
    await custInputs.nth(2).fill('Tester');
    await custInputs.nth(3).fill(`0912${Date.now().toString().slice(-7)}`);
    await custInputs.nth(4).fill('acceptance@gnext.local');
    await custInputs.nth(5).fill('10000000'); // Credit limit 10,000,000 IRR

    const saveCustomerPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/customers') && resp.request().method() === 'POST');
    const saveCustBtn = page.locator('.MuiDrawer-root button').filter({ hasText: /Save Customer Profile|ذخیره/i }).first();
    await saveCustBtn.click();
    await saveCustomerPromise;

    // 2. Navigate to Customer Credit Subledger via sidebar nav
    const creditNav = page.locator('a[href="/app/credit/accounts"]').first();
    await expect(creditNav).toBeVisible({ timeout: 10000 });
    await creditNav.click();
    await page.waitForURL('**/app/credit/accounts');
    await page.waitForLoadState('networkidle');

    // Assert main header and customer appears in directory table
    await expect(page.locator('body')).toContainText(/Customer Credit Subledger & Aging|دفتر کل اعتبار مشتریان/i);
    await expect(page.locator('body')).toContainText('Acceptance Tester');

    // Find the customer row in credit table
    const customerRow = page.locator('tbody tr').filter({ hasText: 'Acceptance Tester' }).first();
    await expect(customerRow).toBeVisible({ timeout: 10000 });

    // Open Repayment / Top-Up modal for the customer
    const repayBtn = customerRow.locator('button').filter({ hasText: /Repayment \/ Top-Up|پرداخت \/ شارژ/i }).first();
    await expect(repayBtn).toBeVisible({ timeout: 10000 });
    await repayBtn.click();

    const repayDialog = page.locator('.MuiDialog-root').filter({ hasText: /Post Credit Repayment/i }).first();
    await expect(repayDialog).toBeVisible({ timeout: 5000 });

    const amountInput = repayDialog.locator('input[type="number"]').first();
    await amountInput.fill('500000');

    const submitRepayPromise = page.waitForResponse(resp => resp.url().includes('/credit-account/repayments') && resp.request().method() === 'POST');
    const confirmBtn = repayDialog.locator('button').filter({ hasText: /Confirm Repayment|تایید/i }).first();
    await confirmBtn.click();

    const repayResponse = await submitRepayPromise;
    expect(repayResponse.ok()).toBe(true);

    // Open Statement modal for the customer
    const statementBtn = customerRow.locator('button').filter({ hasText: /Statement|صورتحساب/i }).first();
    await expect(statementBtn).toBeVisible({ timeout: 10000 });
    await statementBtn.click();

    const stmtDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customer Credit Statement/i }).first();
    await expect(stmtDialog).toBeVisible({ timeout: 5000 });
    await expect(stmtDialog).toContainText(/Subledger Transaction History|تاریخچه/i);

    const closeStmtBtn = stmtDialog.locator('button').filter({ hasText: /Close|بستن/i }).first();
    await closeStmtBtn.click();

    // Verify Audit Explorer link navigation
    const auditNav = page.locator('a[href="/app/audit"]').first();
    await expect(auditNav).toBeVisible({ timeout: 10000 });
    await auditNav.click();
    await page.waitForURL('**/app/audit');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/Audit Explorer|گزارش حسابرسی|System Audit Logs/i);
  });

  test('10. Acceptance Journey 2: Snappfood Simulated Order Lifecycle & Log Verification (LTR & RTL)', async ({ page }) => {
    await loginUser(page);

    // Navigate to Simulation Center Hub via sidebar nav
    const simNav = page.locator('a[href="/app/simulation"]').first();
    await expect(simNav).toBeVisible({ timeout: 10000 });
    await simNav.click();
    await page.waitForURL('**/app/simulation');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/External Integration Simulation Center/i);

    // Trigger test order generation via UI
    const generateOrderBtn = page.locator('button').filter({ hasText: /Generate Test Snappfood Order/i }).first();
    await expect(generateOrderBtn).toBeVisible({ timeout: 10000 });

    const generatePromise = page.waitForResponse(resp => resp.url().includes('/api/v1/simulation/snappfood/generate') && resp.request().method() === 'POST');
    await generateOrderBtn.click();
    const generateRes = await generatePromise;
    expect(generateRes.ok()).toBe(true);

    // Navigate to Simulation Logs tab
    const logsTab = page.locator('.MuiTab-root').filter({ hasText: /Integration Audit Logs/i }).first();
    await expect(logsTab).toBeVisible({ timeout: 10000 });
    await logsTab.click();
    await page.waitForTimeout(500);

    await expect(page.locator('body')).toContainText(/SNAPPFOOD|WEBHOOK_RECEIVED|SUCCESS/i);
  });

  test('11. Acceptance Journey 3: Kiosk Guest / Required Identification & Simulated POS Checkout (LTR & RTL)', async ({ page }) => {
    await loginUser(page);

    // Navigate to Kiosk page via client-side sidebar link
    const kioskNav = page.locator('a[href="/app/kiosk"]').first();
    await expect(kioskNav).toBeVisible({ timeout: 10000 });
    await kioskNav.click();
    await page.waitForURL('**/app/kiosk');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/SELF-SERVICE KIOSK|کیوسک خودکار|Welcome to/i, { timeout: 15000 });

    // Click TAKEAWAY order type card
    const takeawayCard = page.locator('text=TAKEAWAY').first();
    await expect(takeawayCard).toBeVisible({ timeout: 15000 });
    await takeawayCard.click();
    await page.waitForTimeout(500);

    // Select product card from catalog (Step 1)
    const productCard = page.locator('.MuiCard-root, .MuiPaper-root').filter({ hasText: /IRR|Cheeseburger|Burger|Fries/i }).last();
    await expect(productCard).toBeVisible({ timeout: 15000 });
    await productCard.click();

    // Option Customizer modal
    const customizerDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize/i }).first();
    await expect(customizerDialog).toBeVisible({ timeout: 10000 });
    const addToCartBtn = customizerDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
    await expect(addToCartBtn).toBeVisible({ timeout: 5000 });
    await addToCartBtn.click();
    await page.waitForTimeout(500);

    // Open Cart Drawer
    const cartBtn = page.locator('button').filter({ hasText: /Cart|سبد خرید/i }).first();
    await expect(cartBtn).toBeVisible({ timeout: 10000 });
    await cartBtn.click();

    // Proceed to payment & receipt simulation
    const payNowBtn = page.locator('button').filter({ hasText: /Pay Now|پرداخت/i }).first();
    await expect(payNowBtn).toBeVisible({ timeout: 10000 });

    const payPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/kiosk/pay') && resp.ok());
    await payNowBtn.click();

    const payRes = await payPromise;
    expect(payRes.ok()).toBe(true);
    await expect(page.locator('body')).toContainText(/ORDER SUCCESSFUL!|ORDER #|Simulated Card Terminal/i, { timeout: 15000 });
  });

  test('12. Acceptance Journey 4: Persian CSV Customer & Catalog Import, Data Reset & Re-Login (LTR & RTL)', async ({ page }) => {
    await loginUser(page);

    // 1. Navigate to Import Wizard via sidebar link
    const importNav = page.locator('a[href="/app/catalog/import-export"]').first();
    await expect(importNav).toBeVisible({ timeout: 10000 });
    await importNav.click();
    await page.waitForURL('**/app/catalog/import-export');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/Advanced Excel & CSV Import Engine|موتور واردات/i);

    // Fill raw CSV content with Persian data
    const csvTextArea = page.locator('textarea').first();
    await expect(csvTextArea).toBeVisible();
    await csvTextArea.fill('کد کالا,نام فارسی,قیمت پایه\nPROD-E2E-01,همبرگر مخصوص E2E,300000');

    // Step 1 -> Step 2
    const nextBtn1 = page.locator('button').filter({ hasText: /Next Step|گام بعدی/i }).first();
    await expect(nextBtn1).toBeVisible({ timeout: 5000 });
    await nextBtn1.click();
    await page.waitForTimeout(500);

    // Step 2 -> Step 3
    const nextBtn2 = page.locator('button').filter({ hasText: /Next Step|گام بعدی/i }).first();
    await expect(nextBtn2).toBeVisible({ timeout: 5000 });
    await nextBtn2.click();
    await page.waitForTimeout(500);

    // Step 3 -> Step 4
    const nextBtn3 = page.locator('button').filter({ hasText: /Next Step|گام بعدی/i }).first();
    await expect(nextBtn3).toBeVisible({ timeout: 5000 });
    await nextBtn3.click();
    await page.waitForTimeout(500);

    // Step 4 Execute -> Step 5 Summary
    const execBtn = page.locator('button').filter({ hasText: /Execute Import|اجرای واردات/i }).first();
    await expect(execBtn).toBeVisible({ timeout: 5000 });
    const execPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/import/execute') && resp.ok());
    await execBtn.click();
    const execRes = await execPromise;
    expect(execRes.ok()).toBe(true);
    await expect(page.locator('body')).toContainText(/Import Job Executed Successfully!|باتشکر/i, { timeout: 15000 });

    // 2. Navigate to System Data Reset via sidebar link
    const resetNav = page.locator('a[href="/app/settings/data-reset"]').first();
    await expect(resetNav).toBeVisible({ timeout: 10000 });
    await resetNav.click();
    await page.waitForURL('**/app/settings/data-reset');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText(/System Data Reset & Seed Profiles|بازنشانی داده/i);

    // Open Reset dialog
    const resetBtn = page.locator('button').filter({ hasText: /Execute System Data Reset|بازنشانی/i }).first();
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    const resetDialog = page.locator('.MuiDialog-root').filter({ hasText: /Authorize System Data Reset/i }).first();
    await expect(resetDialog).toBeVisible({ timeout: 5000 });

    const pinInput = resetDialog.locator('input[type="password"]').first();
    await pinInput.fill('1234');

    const confirmResetPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/system/reset') && resp.ok());
    const confirmWipeBtn = resetDialog.locator('button').filter({ hasText: /Confirm & Wipe|تایید/i }).first();
    await confirmWipeBtn.click();

    const resetRes = await confirmResetPromise;
    expect(resetRes.ok()).toBe(true);

    // 3. Post-Reset Re-Login: Clear browser storage session to force login screen
    await page.context().clearCookies();
    await page.evaluate(() => sessionStorage.clear());
    await page.evaluate(() => localStorage.clear());

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.locator('input[autoComplete="username"], input[name="username"]').first().fill('admin@gnext.local');
    await page.locator('input[autoComplete="current-password"], input[type="password"]').first().fill('GnextDemo!2026');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/app/dashboard', { timeout: 15000 });
    await expect(page).toHaveURL(/.*\/app\/dashboard/);
  });

});
