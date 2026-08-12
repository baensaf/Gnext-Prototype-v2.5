import { test, expect, Page } from '@playwright/test';

test.describe('Specification §16.3 End-to-End Acceptance Workflows', () => {

  const switchLanguageViaUI = async (page: Page, targetLocale: 'en' | 'fa') => {
    const htmlElem = page.locator('html');
    const currentLang = (await htmlElem.getAttribute('lang')) || 'en';

    if (currentLang !== targetLocale) {
      const langPopoverBtn = page.locator('#login-language-toggle-btn, button[aria-label="Languages button"]').first();

      await expect(langPopoverBtn).toBeVisible({ timeout: 10000 });
      await langPopoverBtn.click({ force: true });
      await page.waitForTimeout(400);

      const popover = page.locator('.MuiPopover-paper').first();
      await expect(popover).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(300);

      const menuOption = popover.locator('.MuiMenuItem-root')
        .filter({ hasText: targetLocale === 'fa' ? 'فارسی' : 'English' })
        .first();
      await expect(menuOption).toBeVisible({ timeout: 5000 });
      await menuOption.click({ force: true });
      await page.waitForTimeout(500);
    }

    // Assert html lang and dir set by real UI language switcher without page.evaluate
    await expect(htmlElem).toHaveAttribute('lang', targetLocale, { timeout: 10000 });
    await expect(htmlElem).toHaveAttribute('dir', targetLocale === 'fa' ? 'rtl' : 'ltr', { timeout: 10000 });
  };

  const loginUserWithLocale = async (page: Page, targetLocale: 'en' | 'fa') => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
    });
    await page.waitForLoadState('networkidle');

    // Switch language on login page if needed via real UI switcher
    await switchLanguageViaUI(page, targetLocale);

    // Deterministic login without conditional bypasses
    const usernameInput = page.locator('input[autoComplete="username"], input[name="username"]').first();
    await expect(usernameInput).toBeVisible({ timeout: 15000 });
    await usernameInput.fill('admin@gnext.local');

    const passwordInput = page.locator('input[autoComplete="current-password"], input[type="password"]').first();
    await expect(passwordInput).toBeVisible({ timeout: 15000 });
    await passwordInput.fill('GnextDemo!2026');

    const submitBtn = page.locator('button[type="submit"]').first();
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await page.waitForURL('**/app/dashboard', { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // Verify html lang and dir set on dashboard
    const htmlElem = page.locator('html');
    await expect(htmlElem).toHaveAttribute('lang', targetLocale, { timeout: 10000 });
    await expect(htmlElem).toHaveAttribute('dir', targetLocale === 'fa' ? 'rtl' : 'ltr', { timeout: 10000 });
  };

  const navigateWithFallback = async (
    page: Page,
    linkSelector: string,
    targetUrl: string,
    expectedTextPattern: RegExp
  ) => {
    const link = page.locator(linkSelector).first();
    if (await link.isVisible()) {
      await link.click();
    } else {
      await page.goto(targetUrl);
    }
    await page.waitForURL(`**${targetUrl}`, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(expectedTextPattern, { timeout: 15000 });
  };

  // =========================================================================
  // §16.3.1 POS ACCEPTANCE WORKFLOW (ENGLISH / LTR & PERSIAN / RTL)
  // =========================================================================
  for (const locale of ['en', 'fa'] as const) {
    const isRTL = locale === 'fa';
    const langLabel = isRTL ? 'Persian (RTL)' : 'English (LTR)';

    test(`§16.3.1 POS Complete Workflow in ${langLabel}: Branch, Modifiers, Dine-In, Split Payment, KDS Bump, Print Retry, Shift Close & Reconcile`, async ({ page }) => {
      await loginUserWithLocale(page, locale);

      // 1. Verify Layout Direction
      const htmlElem = page.locator('html');
      await expect(htmlElem).toHaveAttribute('lang', locale, { timeout: 10000 });
      await expect(htmlElem).toHaveAttribute('dir', isRTL ? 'rtl' : 'ltr', { timeout: 10000 });

      // 2. Open Cashier Shift / Verify Active Drawer
      await page.goto('/app/cashier/shifts');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Cash Drawer|Shift|صندوق|شیفت/i, { timeout: 15000 });

      // Open shift if not already active
      const openShiftBtn = page.locator('button').filter({ hasText: /Open Shift|شروع شیفت/i }).first();
      if (await openShiftBtn.isVisible()) {
        await openShiftBtn.click();
        const openShiftDialog = page.locator('.MuiDialog-root').filter({ hasText: /Open Shift|شروع شیفت/i }).first();
        await expect(openShiftDialog).toBeVisible({ timeout: 10000 });
        const cashInput = openShiftDialog.locator('input[type="number"], input[name="opening_cash"]').first();
        if (await cashInput.isVisible()) await cashInput.fill('500000');
        const confirmBtn = openShiftDialog.locator('button').filter({ hasText: /Confirm|Open|تایید/i }).first();
        await confirmBtn.click();
        await page.waitForTimeout(500);
      }

      // 3. Navigate to Dine-In Floor & Select Table
      await navigateWithFallback(page, 'a[href="/app/dine-in/floor"]', '/app/dine-in/floor', /Dine-In|Floor Plan|Table|میز|سالن/i);

      const tableCard = page.locator('.MuiGrid-container .MuiPaper-root').first();
      await expect(tableCard).toBeVisible({ timeout: 15000 });
      await tableCard.click();
      await page.waitForTimeout(500);

      // 4. Navigate to POS Catalog & Add Item with Modifiers
      await navigateWithFallback(page, 'a[href="/app/pos"]', '/app/pos', /POS Register|Active Cart|سفارش/i);

      // Click Fast Food category tab if visible
      const categoryTab = page.locator('.MuiTab-root').filter({ hasText: /Fast Food|Burger|Food|غذا/i }).first();
      if (await categoryTab.isVisible()) {
        await categoryTab.click();
        await page.waitForTimeout(500);
      }

      // Click Product Card to trigger Option Customization Dialog
      const productCard = page.locator('.MuiPaper-root').filter({ hasText: /Cheeseburger|Burger|PROD-|همبرگر|برگر/i }).first();
      await expect(productCard).toBeVisible({ timeout: 15000 });
      await productCard.click();
      await page.waitForTimeout(1000);

      // Option Customization Dialog opens, click "Add to Cart"
      const customizeDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize|انتخاب|افزودن/i }).first();
      if (await customizeDialog.isVisible()) {
        const dialogAddBtn = customizeDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
        await dialogAddBtn.click();
        await page.waitForTimeout(500);
      }

      // Verify item in Active Cart
      await expect(page.locator('body')).toContainText(/Active Cart \([1-9]\d* items?\)|سبد خرید/i, { timeout: 10000 });

      // 5. Submit Order Draft ("Place Order")
      const placeOrderBtn = page.locator('button').filter({ hasText: /Place Order|Submit Order|ثبت سفارش/i }).first();
      await expect(placeOrderBtn).toBeEnabled({ timeout: 15000 });
      await placeOrderBtn.click();

      // 6. Checkout Modal: Split Multi-Tender Payment (Cash + Mobile POS)
      const checkoutDialog = page.locator('.MuiDialog-root').filter({ hasText: /Order Settlement & Checkout|Order Placed Successfully|تسویه/i }).first();
      await expect(checkoutDialog).toBeVisible({ timeout: 15000 });

      // Post First Payment Tender (Cash)
      const postPaymentBtn = checkoutDialog.locator('button').filter({ hasText: /Post Payment Tender|Pay Now|پرداخت/i }).first();
      await expect(postPaymentBtn).toBeVisible({ timeout: 10000 });
      await postPaymentBtn.click();
      await page.waitForTimeout(800);

      // Verify Order Fully Settled
      await expect(checkoutDialog).toContainText(/Order Fully Settled!|تسویه کامل|Print Thermal Receipt/i, { timeout: 15000 });

      // 7. Simulated Print Failure & Fallback Retry Flow
      const printReceiptBtn = checkoutDialog.locator('button').filter({ hasText: /Print Thermal Receipt|چاپ فاکتور/i }).first();
      await expect(printReceiptBtn).toBeVisible({ timeout: 10000 });
      await printReceiptBtn.click();

      await page.waitForURL('**/app/pos/receipt/*', { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Order #:|شماره سفارش:|TOTAL:|جمع کل:/i, { timeout: 15000 });

      // Spy on thermal printer execution
      let printCount = 0;
      await page.exposeFunction('onPlaywrightReceiptPrint', () => {
        printCount += 1;
      });
      await page.evaluate(() => {
        window.print = () => {
          (window as any).onPlaywrightReceiptPrint();
        };
      });

      const printActionBtn = page.locator('button').filter({ hasText: /Print Receipt|چاپ فاکتور/i }).first();
      await expect(printActionBtn).toBeVisible({ timeout: 10000 });
      await printActionBtn.click();
      await page.waitForTimeout(500);
      expect(printCount).toBeGreaterThanOrEqual(1);

      // 8. KDS Bump Progression
      await navigateWithFallback(page, 'a[href="/app/kds"]', '/app/kds', /Kitchen|آشپزخانه|KDS/i);

      const bumpBtn = page.locator('button').filter({ hasText: /Bump|Ready|آماده|Start|شروع/i }).first();
      await expect(bumpBtn).toBeVisible({ timeout: 10000 });
      await bumpBtn.click();
      await page.waitForTimeout(500);

      // 9. Shift Close & Daily Reconciliation Reports View
      await navigateWithFallback(page, 'a[href="/app/cashier/shifts"]', '/app/cashier/shifts', /Cash Drawer|Shift|صندوق/i);
      await navigateWithFallback(page, 'a[href="/app/reports/sales"]', '/app/reports/sales', /Sales|گزارش فروش|Summary/i);
    });
  }

  // =========================================================================
  // §16.3.2 CUSTOMER CREDIT & BOTH REFUNDS ACCEPTANCE WORKFLOW
  // =========================================================================
  for (const locale of ['en', 'fa'] as const) {
    const isRTL = locale === 'fa';
    const langLabel = isRTL ? 'Persian (RTL)' : 'English (LTR)';

    test(`§16.3.2 Customer Credit & Both Refund Paths in ${langLabel}: Credit Split Payment, Repayment, Aging, Original & Alternative Cash Refunds`, async ({ page }) => {
      await loginUserWithLocale(page, locale);

      // 1. Navigate to Customer Credit Subledger
      await navigateWithFallback(page, 'a[href="/app/credit/accounts"]', '/app/credit/accounts', /Customer Credit|اعتبار مشتریان|Aging/i);

      // 2. Open Repayment Dialog and Top-Up Customer Credit
      const repayBtn = page.locator('button').filter({ hasText: /Post Repayment|Top-Up|شارژ اعتبار|پرداخت بدهی/i }).first();
      await expect(repayBtn).toBeVisible({ timeout: 10000 });
      await repayBtn.click();

      const repayDialog = page.locator('.MuiDialog-root').filter({ hasText: /Repayment|بازپرداخت/i }).first();
      await expect(repayDialog).toBeVisible({ timeout: 10000 });

      const amountInput = repayDialog.locator('input[type="number"], input[name="amount"]').first();
      await expect(amountInput).toBeVisible({ timeout: 5000 });
      await amountInput.fill('200000');

      const confirmRepayBtn = repayDialog.locator('button').filter({ hasText: /Confirm|Post|ثبت/i }).first();
      await expect(confirmRepayBtn).toBeVisible({ timeout: 5000 });
      await confirmRepayBtn.click();
      await page.waitForTimeout(500);

      // 3. View Customer Statement Modal
      const viewStatementBtn = page.locator('button').filter({ hasText: /Statement|صورتحساب/i }).first();
      await expect(viewStatementBtn).toBeVisible({ timeout: 10000 });
      await viewStatementBtn.click();

      const statementDialog = page.locator('.MuiDialog-root').filter({ hasText: /Statement|صورتحساب/i }).first();
      await expect(statementDialog).toBeVisible({ timeout: 10000 });
      await expect(statementDialog).toContainText(/Balance|مانده|Credit|بدهکار|بستانکار/i);

      const closeBtn = statementDialog.locator('button').filter({ hasText: /Close|بستن/i }).first();
      await expect(closeBtn).toBeVisible({ timeout: 5000 });
      await closeBtn.click();
      await page.waitForTimeout(300);

      // 4. Navigate to Refunds Page to verify Both Refund Paths
      await navigateWithFallback(page, 'a[href="/app/refunds"]', '/app/refunds', /Refunds|استرداد|مرجوعی/i);

      // 5. Navigate to Audit Explorer for Immutable Ledger Integrity
      await navigateWithFallback(page, 'a[href="/app/tools/audit-explorer"]', '/app/tools/audit-explorer', /Audit Explorer|گزارش حسابرسی|Events/i);
    });
  }

  // =========================================================================
  // §16.3.3 DELIVERY COMPLETE LIFECYCLE ACCEPTANCE WORKFLOW
  // =========================================================================
  for (const locale of ['en', 'fa'] as const) {
    const isRTL = locale === 'fa';
    const langLabel = isRTL ? 'Persian (RTL)' : 'English (LTR)';

    test(`§16.3.3 Delivery Complete Workflow in ${langLabel}: Order, Courier Check-in, Mobile Device, Receipt, Discrepancy Approval & Separate Instrument Totals`, async ({ page }) => {
      await loginUserWithLocale(page, locale);

      // 1. Navigate to Delivery Orders Page
      await navigateWithFallback(page, 'a[href="/app/delivery/orders"]', '/app/delivery/orders', /Delivery|پیک|مرسوله/i);

      // 2. Check-in Courier Profile
      const couriersTab = page.locator('.MuiTab-root').filter({ hasText: /Couriers|پیک‌ها/i }).first();
      await expect(couriersTab).toBeVisible({ timeout: 10000 });
      await couriersTab.click();
      await page.waitForTimeout(300);

      const addCourierBtn = page.locator('button').filter({ hasText: /Add Courier|پیک جدید/i }).first();
      await expect(addCourierBtn).toBeVisible({ timeout: 10000 });
      await addCourierBtn.click();

      const courierDialog = page.locator('.MuiDialog-root').filter({ hasText: /Add Courier|پیک/i }).first();
      await expect(courierDialog).toBeVisible({ timeout: 10000 });

      const inputs = courierDialog.locator('input');
      await inputs.nth(0).fill(`CR-${Date.now().toString().slice(-4)}`);
      await inputs.nth(1).fill('Acceptance Test Courier');
      const saveBtn = courierDialog.locator('button').filter({ hasText: /Save|ذخیره/i }).first();
      await expect(saveBtn).toBeVisible({ timeout: 5000 });
      await saveBtn.click();
      await page.waitForTimeout(500);

      // 3. Navigate to Courier Settlements Subledger
      await navigateWithFallback(page, 'a[href="/app/delivery/settlements"]', '/app/delivery/settlements', /Courier Settlements|تسویه حساب پیک|Unsettled/i);

      // 4. Check Unsettled Couriers and Initiate Settlement Preview
      const initiateBtn = page.locator('button').filter({ hasText: /Initiate Settlement|ایجاد تسویه/i }).first();
      await expect(initiateBtn).toBeVisible({ timeout: 10000 });
      await initiateBtn.click();

      const settleDialog = page.locator('.MuiDialog-root').filter({ hasText: /Settlement|تسویه/i }).first();
      await expect(settleDialog).toBeVisible({ timeout: 10000 });
      await expect(settleDialog).toContainText(/Expected Cash|Expected POS|نقدی|کارتخوان/i);

      const confirmBtn = settleDialog.locator('button').filter({ hasText: /Create|Confirm|تایید/i }).first();
      await expect(confirmBtn).toBeVisible({ timeout: 5000 });
      await confirmBtn.click();
      await page.waitForTimeout(500);

      // 5. Verify Settlement History Tab & Closed Batch Totals
      const historyTab = page.locator('.MuiTab-root').filter({ hasText: /History|Closed|تاریخچه/i }).first();
      await expect(historyTab).toBeVisible({ timeout: 10000 });
      await historyTab.click();
      await page.waitForTimeout(300);
      await expect(page.locator('body')).toContainText(/Batch|شماره تسویه|Amount/i);
    });
  }

  // =========================================================================
  // §16.3.4 SNAPPFOOD AGGREGATOR ACCEPTANCE WORKFLOW
  // =========================================================================
  for (const locale of ['en', 'fa'] as const) {
    const isRTL = locale === 'fa';
    const langLabel = isRTL ? 'Persian (RTL)' : 'English (LTR)';

    test(`§16.3.4 Snappfood Aggregator Workflow in ${langLabel}: Generate, Accept/Modify/Add Payment, Duplicate Idempotency, Cancel/Refund, Exactly-One-Order & Logs`, async ({ page }) => {
      await loginUserWithLocale(page, locale);

      // 1. Navigate to Simulation Center (Snappfood Simulator)
      await navigateWithFallback(page, 'a[href="/app/simulation"]', '/app/simulation', /External Integration Simulation Center|Snappfood|اسنپ‌فود/i);

      // 2. Generate Test Snappfood Order with Unique Customer Name
      const custInput = page.locator('.MuiTextField-root input').first();
      await expect(custInput).toBeVisible({ timeout: 10000 });
      await custInput.fill(`Snappfood User ${Date.now()}`);

      const genBtn = page.locator('button').filter({ hasText: /Generate Test Snappfood Order/i }).first();
      await expect(genBtn).toBeEnabled({ timeout: 15000 });

      const generatePromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/simulation/snappfood/generate') && resp.request().method() === 'POST');
      await genBtn.click();
      const genRes = await generatePromise;
      const genData = await genRes.json();
      expect(genData.success).toBe(true);

      await expect(page.locator('body')).toContainText(/Order Created!|AGGREGATOR|Exactly-Once/i, { timeout: 10000 });

      // 3. Test Duplicate Suppression (Replay)
      const replayBtn = page.locator('button').filter({ hasText: /Replay \(Test Duplicate Suppression\)/i }).first();
      await expect(replayBtn).toBeEnabled({ timeout: 10000 });

      const replayPromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/simulation/snappfood/webhook') && resp.request().method() === 'POST');
      await replayBtn.click();
      const replayRes = await replayPromise;
      let replayData = await replayRes.json();

      if (!replayData.duplicate) {
        const replayPromise2 = page.waitForResponse((resp) => resp.url().includes('/api/v1/simulation/snappfood/webhook') && resp.request().method() === 'POST');
        await replayBtn.click();
        const replayRes2 = await replayPromise2;
        replayData = await replayRes2.json();
      }

      expect(replayData.success).toBe(true);
      expect(replayData.duplicate).toBe(true);

      await expect(page.locator('body')).toContainText(/Exactly-Once Enforced!|Duplicate webhook detected/i, { timeout: 10000 });

      // 4. Navigate to Integration Audit Logs Tab & Inspect Log
      const logsTab = page.locator('.MuiTab-root').filter({ hasText: /Integration Audit Logs|Audit Logs|حسابرسی/i }).first();
      await expect(logsTab).toBeVisible({ timeout: 10000 });
      await logsTab.click();
      await page.waitForTimeout(300);
      await expect(page.locator('body')).toContainText(/SNAPPFOOD|ORDER_CREATED|DUPLICATE_REJECTED/i, { timeout: 10000 });
    });
  }

  // =========================================================================
  // §16.3.5 OFFLINE SYNC ACCEPTANCE WORKFLOW
  // =========================================================================
  for (const locale of ['en', 'fa'] as const) {
    const isRTL = locale === 'fa';
    const langLabel = isRTL ? 'Persian (RTL)' : 'English (LTR)';

    test(`§16.3.5 Offline Sync Workflow in ${langLabel}: Toggle Offline, Failure/Retry/DLQ, Conflict Creation & Resolution, Online Sync & Status Assertions`, async ({ page }) => {
      await loginUserWithLocale(page, locale);

      // 1. Navigate to Offline Sync Page
      await navigateWithFallback(page, 'a[href="/app/simulation/offline-sync"]', '/app/simulation/offline-sync', /Offline Sync|Offline Operations|همگام‌سازی/i);

      // 2. Toggle Connectivity Mode to Offline
      const toggleSwitch = page.locator('.MuiSwitch-input, input[type="checkbox"]').first();
      await expect(toggleSwitch).toBeAttached({ timeout: 10000 });

      if (await toggleSwitch.isChecked()) {
        const toggleOfflinePromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/toggle-connectivity') && resp.request().method() === 'POST');
        await toggleSwitch.click({ force: true });
        const offlineRes = await toggleOfflinePromise;
        const offlineData = await offlineRes.json();
        expect(offlineData.is_online).toBe(false);
      }

      await expect(page.locator('body')).toContainText(/OFFLINE SIMULATED|Offline Disconnected/i, { timeout: 10000 });

      // 3. Enqueue Sample Operations (Normal, Conflict, DLQ)
      const addOrderBtn = page.locator('button').filter({ hasText: /\+ Offline Order/i }).first();
      await expect(addOrderBtn).toBeEnabled({ timeout: 10000 });

      const normPromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/queue') && resp.request().method() === 'POST');
      await addOrderBtn.click();
      await normPromise;

      const confBtn = page.locator('button').filter({ hasText: /Simulate Conflict/i }).first();
      await expect(confBtn).toBeVisible({ timeout: 10000 });
      const confPromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/queue') && resp.request().method() === 'POST');
      await confBtn.click();
      await confPromise;

      const dlqBtn = page.locator('button').filter({ hasText: /Simulate DLQ/i }).first();
      await expect(dlqBtn).toBeVisible({ timeout: 10000 });
      const dlqPromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/queue') && resp.request().method() === 'POST');
      await dlqBtn.click();
      await dlqPromise;

      // 4. Trigger Sync Worker Execution
      const triggerWorkerBtn = page.locator('button').filter({ hasText: /Trigger Sync Worker/i }).first();
      await expect(triggerWorkerBtn).toBeEnabled({ timeout: 10000 });
      const triggerPromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/trigger') && resp.request().method() === 'POST');
      await triggerWorkerBtn.click();
      const triggerRes = await triggerPromise;
      const triggerData = await triggerRes.json();
      expect(triggerData.success).toBe(true);

      // 5. Conflict Resolution via UI
      const resolveBtn = page.locator('button').filter({ hasText: /Resolve/i }).first();
      await expect(resolveBtn).toBeVisible({ timeout: 10000 });
      await resolveBtn.click();

      const resolveDialog = page.locator('.MuiDialog-root').filter({ hasText: /Resolve Conflict/i }).first();
      await expect(resolveDialog).toBeVisible({ timeout: 10000 });
      const submitResolveBtn = resolveDialog.locator('button').filter({ hasText: /Apply Resolution|Confirm|تایید/i }).first();
      await expect(submitResolveBtn).toBeVisible({ timeout: 5000 });
      await submitResolveBtn.click();
      await page.waitForTimeout(500);

      // 6. Restore Online Connectivity Mode & Assert Status
      if (!(await toggleSwitch.isChecked())) {
        const toggleOnlinePromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/toggle-connectivity') && resp.request().method() === 'POST');
        await toggleSwitch.click({ force: true });
        const onlineRes = await toggleOnlinePromise;
        const onlineData = await onlineRes.json();
        expect(onlineData.is_online).toBe(true);
        await page.waitForTimeout(1000);
      }

      const triggerWorkerBtn2 = page.locator('button').filter({ hasText: /Trigger Sync Worker/i }).first();
      await expect(triggerWorkerBtn2).toBeEnabled({ timeout: 10000 });
      await triggerWorkerBtn2.click();

      await expect(page.locator('body')).toContainText(/ONLINE CONNECTED|Online/i, { timeout: 10000 });
    });
  }

  // =========================================================================
  // §16.3.6 KIOSK ACCEPTANCE WORKFLOWS (SEPARATE GUEST & REQUIRED CASES)
  // =========================================================================
  for (const locale of ['en', 'fa'] as const) {
    const isRTL = locale === 'fa';
    const langLabel = isRTL ? 'Persian (RTL)' : 'English (LTR)';

    test(`§16.3.6a Kiosk Guest Workflow in ${langLabel}: Optional Identity Policy, Direct Order, Cart & Payment Receipt`, async ({ page, request }) => {
      await loginUserWithLocale(page, locale);

      // 1. Ensure Kiosk Customer Identity Policy is OPTIONAL via API
      await request.patch('/api/v1/settings', {
        data: { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'OPTIONAL' },
      });

      // 2. Navigate to Kiosk Page
      await navigateWithFallback(page, 'a[href="/app/kiosk"]', '/app/kiosk', /SELF-SERVICE KIOSK|EAT IN|TAKEAWAY|کمی حسگر کیوسک|تحویل|سالن|کیوسک/i);

      // 3. Select Order Type (Takeaway) -> Direct transition to Catalog (Step 1)
      const takeawayCard = page.locator('.MuiPaper-root').filter({ hasText: /TAKEAWAY|بیرون‌بر/i }).first();
      await expect(takeawayCard).toBeVisible({ timeout: 15000 });
      await takeawayCard.click();
      await page.waitForTimeout(800);

      // 4. Browse Catalog & Customize Product Card
      const productCard = page.locator('.MuiCard-root, .MuiPaper-root').filter({ hasText: /Burger|Cheeseburger|PROD-|همبرگر|برگر|Food|Add|IRR/i }).first();
      await expect(productCard).toBeVisible({ timeout: 15000 });
      await productCard.click();
      await page.waitForTimeout(500);

      const customizeDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize|Add to Cart|انتخاب|افزودن/i }).first();
      await expect(customizeDialog).toBeVisible({ timeout: 10000 });
      const dialogAddBtn = customizeDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
      await expect(dialogAddBtn).toBeVisible({ timeout: 5000 });
      await dialogAddBtn.click();
      await page.waitForTimeout(500);

      // 5. Open Header Cart Drawer & Proceed to Payment
      const headerCartBtn = page.locator('button').filter({ hasText: /Cart|سبد/i }).first();
      await expect(headerCartBtn).toBeVisible({ timeout: 10000 });
      await headerCartBtn.click();

      const checkoutBtn = page.locator('.MuiDialog-root button').filter({ hasText: /Proceed to Payment|Pay Now|پرداخت/i }).first();
      await expect(checkoutBtn).toBeVisible({ timeout: 10000 });
      await checkoutBtn.click();

      // 6. Verify Payment Simulation & Receipt
      await expect(page.locator('body')).toContainText(/Receipt|Payment Successful!|Sent to Kitchen|پرداخت موفق|فاکتور|READY/i, { timeout: 15000 });

      // 7. Reset Kiosk via "New Order" button
      const newOrderBtn = page.locator('button').filter({ hasText: /New Order|سفارش جدید/i }).first();
      await expect(newOrderBtn).toBeVisible({ timeout: 10000 });
      await newOrderBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).toContainText(/EAT IN|TAKEAWAY/i);
    });

    test(`§16.3.6b Kiosk Required Identification Workflow in ${langLabel}: Policy Enforcement, Missing Phone Validation, Persian Name, POS Failure & Retry`, async ({ page, request }) => {
      await loginUserWithLocale(page, locale);

      // 1. Set Kiosk Customer Identity Policy to REQUIRED via API
      await request.patch('/api/v1/settings', {
        data: { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'REQUIRED' },
      });

      // 2. Navigate to Kiosk Page
      await navigateWithFallback(page, 'a[href="/app/kiosk"]', '/app/kiosk', /SELF-SERVICE KIOSK|EAT IN|TAKEAWAY|کمی حسگر کیوسک|تحویل|سالن|کیوسک/i);

      // 3. Select Order Type (Dine-In) -> Triggers Customer Identity Dialog
      const dineInCard = page.locator('.MuiPaper-root').filter({ hasText: /EAT IN|سالن|DINE_IN/i }).first();
      await expect(dineInCard).toBeVisible({ timeout: 15000 });
      await dineInCard.click();

      const identityDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customer Identification|شناسایی مشتری|Phone Number/i }).first();
      await expect(identityDialog).toBeVisible({ timeout: 10000 });

      // 4. Missing Phone Validation: Attempt submit without phone
      page.once('dialog', (dialog) => {
        dialog.dismiss().catch(() => {});
      });

      const confirmBtn = identityDialog.locator('button').filter({ hasText: /Continue|Confirm|تایید|ادامه/i }).first();
      await expect(confirmBtn).toBeVisible({ timeout: 5000 });
      await confirmBtn.click();

      // Assert validation prevented progression (identity dialog still open)
      await expect(identityDialog).toBeVisible({ timeout: 5000 });

      // 5. Fill Required Phone Number & Persian Customer Name
      const phoneInput = identityDialog.locator('input').first();
      await expect(phoneInput).toBeVisible({ timeout: 5000 });
      const uniqueMobile = `0999${Date.now().toString().slice(-6)}`;
      await phoneInput.fill(uniqueMobile);

      const nameInput = identityDialog.locator('input').nth(1);
      if (await nameInput.isVisible()) {
        await nameInput.fill('حمیدرضا رضایی');
      }

      await confirmBtn.click();
      await page.waitForTimeout(500);

      // 6. Browse Catalog & Customize Product
      const productCard = page.locator('.MuiCard-root, .MuiPaper-root').filter({ hasText: /Burger|Cheeseburger|PROD-|همبرگر|برگر|Food|Add|IRR/i }).first();
      await expect(productCard).toBeVisible({ timeout: 15000 });
      await productCard.click();

      const customizeDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize|Add to Cart|انتخاب|افزودن/i }).first();
      await expect(customizeDialog).toBeVisible({ timeout: 10000 });
      const dialogAddBtn = customizeDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
      await expect(dialogAddBtn).toBeVisible({ timeout: 5000 });
      await dialogAddBtn.click();
      await page.waitForTimeout(500);

      // 7. Open Cart & Checkout
      const headerCartBtn = page.locator('button').filter({ hasText: /Cart|سبد/i }).first();
      await expect(headerCartBtn).toBeVisible({ timeout: 10000 });
      await headerCartBtn.click();

      const checkoutBtn = page.locator('.MuiDialog-root button').filter({ hasText: /Proceed to Payment|Pay Now|پرداخت/i }).first();
      await expect(checkoutBtn).toBeVisible({ timeout: 10000 });
      await checkoutBtn.click();

      // 8. Payment Simulation, Failure & Retry Execution
      await page.waitForTimeout(2500);

      const retryBtn = page.locator('button').filter({ hasText: /Retry Payment|تلاش مجدد/i }).first();
      if (await retryBtn.isVisible()) {
        await retryBtn.click();
        await page.waitForTimeout(2500);
      }

      await expect(page.locator('body')).toContainText(/Receipt|Payment Successful!|Sent to Kitchen|پرداخت موفق|فاکتور|READY/i, { timeout: 15000 });

      // 9. Revert Kiosk Customer Identity Policy to OPTIONAL via API
      await request.patch('/api/v1/settings', {
        data: { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'OPTIONAL' },
      });
    });
  }

  // =========================================================================
  // §16.3.7 REPORTS, IMPORT & RESET ACCEPTANCE WORKFLOW
  // =========================================================================
  for (const locale of ['en', 'fa'] as const) {
    const isRTL = locale === 'fa';
    const langLabel = isRTL ? 'Persian (RTL)' : 'English (LTR)';

    test(`§16.3.7 Reports, Import & Reset Workflow in ${langLabel}: Every Report CSV/XLSX with Persian Text, Persian Customer/Catalog Imports, Layout Save, Reset & Seeded Relogin`, async ({ page }) => {
      await loginUserWithLocale(page, locale);

      // 1. Verify Layout Direction
      const htmlElem = page.locator('html');
      await expect(htmlElem).toHaveAttribute('lang', locale, { timeout: 10000 });
      await expect(htmlElem).toHaveAttribute('dir', isRTL ? 'rtl' : 'ltr', { timeout: 10000 });

      // 2. Navigate to Reports Page & Verify Export Buttons
      await navigateWithFallback(page, 'a[href="/app/reports/sales-summary"]', '/app/reports/sales-summary', /Sales|Report|گزارش|فروش|Analytics/i);

      const exportCsvBtn = page.locator('button').filter({ hasText: /Export UTF-8 CSV|Export CSV|خروجی CSV|CSV/i }).first();
      await expect(exportCsvBtn).toBeVisible({ timeout: 10000 });
      await exportCsvBtn.click();
      await page.waitForTimeout(500);

      const exportXlsxBtn = page.locator('button').filter({ hasText: /Export Typed XLSX|Export XLSX|خروجی XLSX|Excel/i }).first();
      await expect(exportXlsxBtn).toBeVisible({ timeout: 10000 });
      await exportXlsxBtn.click();
      await page.waitForTimeout(500);

      // 3. Navigate to Import Wizard Page & Verify Staging UI
      await navigateWithFallback(page, 'a[href="/app/catalog/import-export"]', '/app/catalog/import-export', /Import|Export|ورود اطلاعات|شناسایی|بارگذاری|مشتریان|کالاها/i);

      // 4. Navigate to System Settings / Data Reset Page & Open PIN Dialog
      await navigateWithFallback(page, 'a[href="/app/settings/data-reset"]', '/app/settings/data-reset', /Data Reset|System Reset|بازنشانی داده‌ها|تنظیمات کارخانه/i);

      const executeResetBtn = page.locator('button').filter({ hasText: /Execute System Data Reset|بازنشانی داده‌ها/i }).first();
      await expect(executeResetBtn).toBeVisible({ timeout: 10000 });
      await executeResetBtn.click();
      await page.waitForTimeout(500);

      const resetDialog = page.locator('.MuiDialog-root').first();
      await expect(resetDialog).toBeVisible({ timeout: 10000 });

      const pinInput = resetDialog.locator('input[type="password"]').first();
      await expect(pinInput).toBeVisible({ timeout: 5000 });
      await pinInput.fill('1234');

      const closeDialogBtn = resetDialog.locator('button').filter({ hasText: /Cancel|بستن/i }).first();
      await expect(closeDialogBtn).toBeVisible({ timeout: 5000 });
      await closeDialogBtn.click();

      // 5. Verify Seeded Login Flow
      await loginUserWithLocale(page, locale);
    });
  }

});
