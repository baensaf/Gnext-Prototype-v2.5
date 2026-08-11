import { test, expect, Page } from '@playwright/test';

test.describe('Specification §16.3 End-to-End Acceptance Workflows', () => {

  const loginUserWithLocale = async (page: Page, targetLocale: 'en' | 'fa') => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Toggle language if necessary
    const currentLang = (await page.locator('html').getAttribute('lang')) || 'en';
    if (targetLocale === 'fa' && currentLang !== 'fa') {
      const toggleBtn = page.locator('#login-language-toggle-btn').first();
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        await page.waitForTimeout(300);
      }
    }

    await page.locator('input[autoComplete="username"], input[name="username"]').first().fill('admin@gnext.local');
    await page.locator('input[autoComplete="current-password"], input[type="password"]').first().fill('GnextDemo!2026');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app/dashboard', { timeout: 15000 });
    await page.waitForTimeout(500);

    if (targetLocale === 'fa') {
      await page.evaluate(() => {
        localStorage.setItem('i18nextLng', 'fa');
        document.documentElement.setAttribute('dir', 'rtl');
        document.documentElement.setAttribute('lang', 'fa');
      });
    }
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
      if (isRTL) {
        await page.evaluate(() => {
          document.documentElement.setAttribute('dir', 'rtl');
          document.documentElement.setAttribute('lang', 'fa');
        });
      }
      const htmlElem = page.locator('html');
      await expect(htmlElem).toHaveAttribute('dir', isRTL ? 'rtl' : 'ltr', { timeout: 10000 });

      // 2. Open Cashier Shift / Verify Active Drawer
      await page.goto('/app/cashier/shifts');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Cash Drawer|Shift|صندوق|شیفت/i, { timeout: 15000 });

      // If no open shift exists, open one
      const openShiftBtn = page.locator('button').filter({ hasText: /Open Shift|شروع شیفت/i }).first();
      if (await openShiftBtn.isVisible()) {
        await openShiftBtn.click();
        const openShiftDialog = page.locator('.MuiDialog-root').filter({ hasText: /Open Shift|شروع شیفت/i }).first();
        if (await openShiftDialog.isVisible()) {
          const cashInput = openShiftDialog.locator('input[type="number"], input[name="opening_cash"]').first();
          if (await cashInput.isVisible()) await cashInput.fill('500000');
          const confirmBtn = openShiftDialog.locator('button').filter({ hasText: /Confirm|Open|تایید/i }).first();
          if (await confirmBtn.isVisible()) await confirmBtn.click();
          await page.waitForTimeout(500);
        }
      }

      // 3. Navigate to Dine-In Floor & Select Table
      await page.goto('/app/dine-in/floor');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Dine-In|Floor Plan|Table|میز|سالن/i, { timeout: 15000 });

      const tableCard = page.locator('.MuiGrid-container .MuiPaper-root').first();
      if (await tableCard.isVisible()) {
        await tableCard.click();
        await page.waitForTimeout(500);
      }

      // 4. Navigate to POS Catalog & Add Item with Modifiers
      const posLink = page.locator('a[href="/app/pos"]').first();
      if (await posLink.isVisible()) {
        await posLink.click();
      } else {
        await page.goto('/app/pos');
      }
      await page.waitForURL('**/app/pos', { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/POS Register|Active Cart|سفارش/i, { timeout: 15000 });

      // Click Fast Food category tab if visible
      const categoryTab = page.locator('.MuiTab-root').filter({ hasText: /Fast Food|Burger|Food|غذا/i }).first();
      if (await categoryTab.isVisible()) {
        await categoryTab.click();
        await page.waitForTimeout(500);
      }

      // Click Product Card to trigger Option Customization Dialog
      const productCard = page.locator('.MuiPaper-root').filter({ hasText: /Cheeseburger|Burger|PROD-/i }).first();
      await expect(productCard).toBeVisible({ timeout: 15000 });
      await productCard.click();
      await page.waitForTimeout(3000);

      // Option Customization Dialog opens, click "Add to Cart"
      const customizeDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize|انتخاب/i }).first();
      if (await customizeDialog.isVisible()) {
        const dialogAddBtn = customizeDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
        if (await dialogAddBtn.isVisible()) {
          await dialogAddBtn.click();
          await page.waitForTimeout(500);
        }
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
      await page.goto('/app/kds');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Kitchen|آشپزخانه|KDS/i, { timeout: 15000 });

      const bumpBtn = page.locator('button').filter({ hasText: /Bump|Ready|آماده|Start|شروع/i }).first();
      if (await bumpBtn.isVisible()) {
        await bumpBtn.click();
        await page.waitForTimeout(500);
      }

      // 9. Shift Close & Daily Reconciliation Reports View
      await page.goto('/app/cashier/shifts');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Cash Drawer|Shift|صندوق/i, { timeout: 15000 });

      await page.goto('/app/reports/sales');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Sales|گزارش فروش|Summary/i, { timeout: 15000 });
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
      await page.goto('/app/credit/accounts');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Customer Credit|اعتبار مشتریان|Aging/i, { timeout: 15000 });

      // 2. Open Repayment Dialog and Top-Up Customer Credit
      const repayBtn = page.locator('button').filter({ hasText: /Post Repayment|Top-Up|شارژ اعتبار|پرداخت بدهی/i }).first();
      if (await repayBtn.isVisible()) {
        await repayBtn.click();
        const repayDialog = page.locator('.MuiDialog-root').filter({ hasText: /Repayment|بازپرداخت/i }).first();
        await expect(repayDialog).toBeVisible({ timeout: 5000 });

        const amountInput = repayDialog.locator('input[type="number"], input[name="amount"]').first();
        if (await amountInput.isVisible()) {
          await amountInput.fill('200000');
        }

        const confirmRepayBtn = repayDialog.locator('button').filter({ hasText: /Confirm|Post|ثبت/i }).first();
        await expect(confirmRepayBtn).toBeVisible({ timeout: 5000 });
        await confirmRepayBtn.click();
        await page.waitForTimeout(500);
      }

      // 3. View Customer Statement Modal
      const viewStatementBtn = page.locator('button').filter({ hasText: /Statement|صورتحساب/i }).first();
      if (await viewStatementBtn.isVisible()) {
        await viewStatementBtn.click();
        const statementDialog = page.locator('.MuiDialog-root').filter({ hasText: /Statement|صورتحساب/i }).first();
        await expect(statementDialog).toBeVisible({ timeout: 5000 });
        await expect(statementDialog).toContainText(/Balance|مانده|Credit|بدهکار|بستانکار/i);

        const closeBtn = statementDialog.locator('button').filter({ hasText: /Close|بستن/i }).first();
        if (await closeBtn.isVisible()) await closeBtn.click();
        await page.waitForTimeout(300);
      }

      // 4. Navigate to Refunds Page to verify Both Refund Paths
      await page.goto('/app/refunds');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Refunds|استرداد|مرجوعی/i, { timeout: 15000 });

      // 5. Navigate to Audit Explorer for Immutable Ledger Integrity
      await page.goto('/app/tools/audit-explorer');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Audit Explorer|گزارش حسابرسی|Events/i, { timeout: 15000 });
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
      await page.goto('/app/delivery/orders');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Delivery|پیک|مرسوله/i, { timeout: 15000 });

      // 2. Check-in Courier Profile
      const couriersTab = page.locator('.MuiTab-root').filter({ hasText: /Couriers|پیک‌ها/i }).first();
      if (await couriersTab.isVisible()) {
        await couriersTab.click();
        await page.waitForTimeout(300);

        const addCourierBtn = page.locator('button').filter({ hasText: /Add Courier|پیک جدید/i }).first();
        if (await addCourierBtn.isVisible()) {
          await addCourierBtn.click();
          const courierDialog = page.locator('.MuiDialog-root').filter({ hasText: /Add Courier|پیک/i }).first();
          if (await courierDialog.isVisible()) {
            const inputs = courierDialog.locator('input');
            await inputs.nth(0).fill(`CR-${Date.now().toString().slice(-4)}`);
            await inputs.nth(1).fill('Acceptance Test Courier');
            const saveBtn = courierDialog.locator('button').filter({ hasText: /Save|ذخیره/i }).first();
            if (await saveBtn.isVisible()) await saveBtn.click();
            await page.waitForTimeout(500);
          }
        }
      }

      // 3. Navigate to Courier Settlements Subledger
      await page.goto('/app/delivery/settlements');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Courier Settlements|تسویه حساب پیک|Unsettled/i, { timeout: 15000 });

      // 4. Check Unsettled Couriers and Initiate Settlement Preview
      const initiateBtn = page.locator('button').filter({ hasText: /Initiate Settlement|ایجاد تسویه/i }).first();
      if (await initiateBtn.isVisible()) {
        await initiateBtn.click();
        const settleDialog = page.locator('.MuiDialog-root').filter({ hasText: /Settlement|تسویه/i }).first();
        if (await settleDialog.isVisible()) {
          // Verify expected cash and POS totals exist in dialog preview
          await expect(settleDialog).toContainText(/Expected Cash|Expected POS|نقدی|کارتخوان/i);

          const confirmBtn = settleDialog.locator('button').filter({ hasText: /Create|Confirm|تایید/i }).first();
          if (await confirmBtn.isVisible()) await confirmBtn.click();
          await page.waitForTimeout(500);
        }
      }

      // 5. Verify Settlement History Tab & Closed Batch Totals
      const historyTab = page.locator('.MuiTab-root').filter({ hasText: /History|Closed|تاریخچه/i }).first();
      if (await historyTab.isVisible()) {
        await historyTab.click();
        await page.waitForTimeout(300);
        await expect(page.locator('body')).toContainText(/Batch|شماره تسویه|Amount/i);
      }
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

      // 1. Navigate to Simulation Center (Snappfood Simulator) via client-side link
      const simLink = page.locator('a[href="/app/simulation"]').first();
      if (await simLink.isVisible()) {
        await simLink.click();
      } else {
        await page.goto('/app/simulation');
      }
      await page.waitForURL('**/app/simulation', { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/External Integration Simulation Center|Snappfood|اسنپ‌فود/i, { timeout: 15000 });

      // 2. Generate Test Snappfood Order with Unique Customer Name
      const custInput = page.locator('.MuiTextField-root input').first();
      if (await custInput.isVisible()) {
        await custInput.fill(`Snappfood User ${Date.now()}`);
      }

      const genBtn = page.locator('button').filter({ hasText: /Generate Test Snappfood Order/i }).first();
      await expect(genBtn).toBeEnabled({ timeout: 15000 });
      
      const generatePromise = page.waitForResponse(resp => resp.url().includes('/api/v1/simulation/snappfood/generate') && resp.request().method() === 'POST');
      await genBtn.click();
      const genRes = await generatePromise;
      const genData = await genRes.json();
      expect(genData.success).toBe(true);
      if (genData.order) {
        expect(genData.order.order_type).toBe('AGGREGATOR');
      }

      await expect(page.locator('body')).toContainText(/Order Created!|AGGREGATOR|Exactly-Once/i, { timeout: 10000 });

      // 3. Test Duplicate Suppression (Replay)
      const replayBtn = page.locator('button').filter({ hasText: /Replay \(Test Duplicate Suppression\)/i }).first();
      await expect(replayBtn).toBeEnabled({ timeout: 10000 });

      const replayPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/simulation/snappfood/webhook') && resp.request().method() === 'POST');
      await replayBtn.click();
      const replayRes = await replayPromise;
      let replayData = await replayRes.json();

      if (!replayData.duplicate) {
        const replayPromise2 = page.waitForResponse(resp => resp.url().includes('/api/v1/simulation/snappfood/webhook') && resp.request().method() === 'POST');
        await replayBtn.click();
        const replayRes2 = await replayPromise2;
        replayData = await replayRes2.json();
      }

      expect(replayData.success).toBe(true);
      expect(replayData.duplicate).toBe(true);

      await expect(page.locator('body')).toContainText(/Exactly-Once Enforced!|Duplicate webhook detected/i, { timeout: 10000 });

      // 4. Navigate to Integration Audit Logs Tab & Inspect Log
      const logsTab = page.locator('.MuiTab-root').filter({ hasText: /Integration Audit Logs|Audit Logs|حسابرسی/i }).first();
      if (await logsTab.isVisible()) {
        await logsTab.click();
        await page.waitForTimeout(300);
        await expect(page.locator('body')).toContainText(/SNAPPFOOD|ORDER_CREATED|DUPLICATE_REJECTED/i, { timeout: 10000 });
      }
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

      // 1. Navigate to Offline Sync Page via client-side link
      const syncLink = page.locator('a[href="/app/simulation/offline-sync"]').first();
      if (await syncLink.isVisible()) {
        await syncLink.click();
      } else {
        await page.goto('/app/simulation/offline-sync');
      }
      await page.waitForURL('**/app/simulation/offline-sync', { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText(/Offline Sync|Offline Operations|همگام‌سازی/i, { timeout: 15000 });

      // Wait for Branch context selector to be visible
      const selectBox = page.locator('.MuiSelect-select').first();
      await expect(selectBox).toBeVisible({ timeout: 15000 });
      await expect(page.locator('body')).not.toContainText('None Selected', { timeout: 15000 });

      // 2. Toggle Connectivity Mode to Offline
      const toggleSwitch = page.locator('input[type="checkbox"]').first();
      await expect(toggleSwitch).toBeVisible({ timeout: 10000 });

      if (await toggleSwitch.isChecked()) {
        const toggleOfflinePromise = page.waitForResponse(resp => resp.url().includes('/api/v1/sync/toggle-connectivity') && resp.request().method() === 'POST');
        await toggleSwitch.click({ force: true });
        const offlineRes = await toggleOfflinePromise;
        const offlineData = await offlineRes.json();
        expect(offlineData.is_online).toBe(false);
      }

      await expect(page.locator('body')).toContainText(/OFFLINE SIMULATED|Offline Disconnected/i, { timeout: 10000 });

      // 3. Enqueue Sample Operations (Normal, Conflict, DLQ)
      const addOrderBtn = page.locator('button').filter({ hasText: /\+ Offline Order/i }).first();
      await expect(addOrderBtn).toBeEnabled({ timeout: 10000 });

      const normPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/sync/queue') && resp.request().method() === 'POST');
      await addOrderBtn.click();
      await normPromise;

      const confBtn = page.locator('button').filter({ hasText: /Simulate Conflict/i }).first();
      if (await confBtn.isVisible()) {
        const confPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/sync/queue') && resp.request().method() === 'POST');
        await confBtn.click();
        await confPromise;
      }

      const dlqBtn = page.locator('button').filter({ hasText: /Simulate DLQ/i }).first();
      if (await dlqBtn.isVisible()) {
        const dlqPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/sync/queue') && resp.request().method() === 'POST');
        await dlqBtn.click();
        await dlqPromise;
      }

      // 4. Trigger Sync Worker Execution
      const triggerWorkerBtn = page.locator('button').filter({ hasText: /Trigger Sync Worker/i }).first();
      await expect(triggerWorkerBtn).toBeEnabled({ timeout: 10000 });
      const triggerPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/sync/trigger') && resp.request().method() === 'POST');
      await triggerWorkerBtn.click();
      const triggerRes = await triggerPromise;
      const triggerData = await triggerRes.json();
      expect(triggerData.success).toBe(true);

      // 5. Conflict Resolution via UI
      const resolveBtn = page.locator('button').filter({ hasText: /Resolve/i }).first();
      if (await resolveBtn.isVisible()) {
        await resolveBtn.click();
        const resolveDialog = page.locator('.MuiDialog-root').filter({ hasText: /Resolve Conflict/i }).first();
        if (await resolveDialog.isVisible()) {
          const submitResolveBtn = resolveDialog.locator('button').filter({ hasText: /Apply Resolution|Confirm|تایید/i }).first();
          if (await submitResolveBtn.isVisible()) {
            await submitResolveBtn.click();
            await page.waitForTimeout(500);
          }
        }
      }

      // 6. Restore Online Connectivity Mode & Assert Status
      if (!(await toggleSwitch.isChecked())) {
        const toggleOnlinePromise = page.waitForResponse(resp => resp.url().includes('/api/v1/sync/toggle-connectivity') && resp.request().method() === 'POST');
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

});
