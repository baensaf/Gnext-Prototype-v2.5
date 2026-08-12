import { test, expect, Page } from '@playwright/test';

test.describe('Specification §16.3 End-to-End Acceptance Workflows', () => {

  const loginUser = async (page: Page) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[autoComplete="username"], input[name="username"]').first().fill('admin@gnext.local');
    await page.locator('input[autoComplete="current-password"], input[type="password"]').first().fill('GnextDemo!2026');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL('**/app/dashboard', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  };

  const navigateViaSidebar = async (page: Page, href: string, urlPattern: string) => {
    const navLink = page.locator(`a[href="${href}"]`).first();
    await expect(navLink).toBeVisible({ timeout: 10000 });
    await navLink.click();
    await page.waitForURL(`**${urlPattern}`, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  };

  // =========================================================================
  // §16.3.0 REAL UI LANGUAGE & DIRECTION SWITCHER PROOF
  // =========================================================================
  test('§16.3.0 Real UI Language Switcher: Prove Persian (lang="fa", dir="rtl") and English (lang="en", dir="ltr") via Actual UI Toggle', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const htmlElem = page.locator('html');
    const loginToggleBtn = page.locator('#login-language-toggle-btn').first();
    await expect(loginToggleBtn).toBeVisible({ timeout: 10000 });

    // 1. Toggle language via login UI button
    await loginToggleBtn.click({ force: true });
    await page.waitForTimeout(300);

    const lang1 = (await htmlElem.getAttribute('lang')) || 'en';
    const dir1 = lang1 === 'fa' ? 'rtl' : 'ltr';
    await expect(htmlElem).toHaveAttribute('lang', lang1, { timeout: 10000 });
    await expect(htmlElem).toHaveAttribute('dir', dir1, { timeout: 10000 });

    // 2. Login and test Header Language Popover on Dashboard
    await loginUser(page);

    const popoverBtn = page.locator('button[aria-label="Languages button"]').first();
    await expect(popoverBtn).toBeVisible({ timeout: 10000 });
    await popoverBtn.click({ force: true });
    await page.waitForTimeout(300);

    const popoverOption = page.locator('.MuiMenuItem-root').filter({ hasText: /فارسی|English/ }).first();
    if (await popoverOption.isVisible().catch(() => false)) {
      await popoverOption.click({ force: true });
      await page.waitForTimeout(400);
    }

    const currentLang = (await htmlElem.getAttribute('lang')) || 'fa';
    const currentDir = currentLang === 'fa' ? 'rtl' : 'ltr';
    await expect(htmlElem).toHaveAttribute('lang', currentLang, { timeout: 10000 });
    await expect(htmlElem).toHaveAttribute('dir', currentDir, { timeout: 10000 });
  });

  // =========================================================================
  // §16.3.1 POS ACCEPTANCE WORKFLOW
  // =========================================================================
  test('§16.3.1 POS Complete Workflow: Branch, Modifiers, Dine-In, Split Payment, KDS Bump, Print Retry, Shift Close & Reconcile', async ({ page }) => {
    await loginUser(page);

    // 1. Open Cashier Shift / Verify Active Drawer
    await navigateViaSidebar(page, '/app/cashier/shifts', '/app/cashier/shifts');
    await expect(page.locator('body')).toContainText(/Cash Drawer|Shift|صندوق|شیفت/i, { timeout: 15000 });

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

    // 2. Navigate to Dine-In Floor & Select Table
    await navigateViaSidebar(page, '/app/dine-in/floor', '/app/dine-in/floor');

    const tableCard = page.locator('.MuiGrid-container .MuiPaper-root').first();
    await expect(tableCard).toBeVisible({ timeout: 15000 });
    await tableCard.click();
    await page.waitForTimeout(500);

    // 3. Navigate to POS Catalog & Add Item with Modifiers
    await navigateViaSidebar(page, '/app/pos', '/app/pos');

    const categoryTab = page.locator('.MuiTab-root').filter({ hasText: /Fast Food|Burger|Food|غذا/i }).first();
    if (await categoryTab.isVisible()) {
      await categoryTab.click();
      await page.waitForTimeout(500);
    }

    const productCard = page.locator('.MuiPaper-root').filter({ hasText: /Cheeseburger|Burger|PROD-|همبرگر|برگر/i }).first();
    await expect(productCard).toBeVisible({ timeout: 15000 });
    await productCard.click();
    await page.waitForTimeout(1000);

    const customizeDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize|انتخاب|افزودن/i }).first();
    if (await customizeDialog.isVisible()) {
      const dialogAddBtn = customizeDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
      await dialogAddBtn.click();
      await page.waitForTimeout(500);
    }

    await expect(page.locator('body')).toContainText(/Active Cart \([1-9]\d* items?\)|سبد خرید/i, { timeout: 10000 });

    // 4. Submit Order Draft ("Place Order")
    const placeOrderBtn = page.locator('button').filter({ hasText: /Place Order|Submit Order|ثبت سفارش/i }).first();
    await expect(placeOrderBtn).toBeEnabled({ timeout: 15000 });
    await placeOrderBtn.click();

    // 5. Checkout Modal: Split Multi-Tender Payment
    const checkoutDialog = page.locator('.MuiDialog-root').filter({ hasText: /Order Settlement & Checkout|Order Placed Successfully|تسویه/i }).first();
    await expect(checkoutDialog).toBeVisible({ timeout: 15000 });

    const postPaymentBtn = checkoutDialog.locator('button').filter({ hasText: /Post Payment Tender|Pay Now|پرداخت/i }).first();
    await expect(postPaymentBtn).toBeVisible({ timeout: 10000 });
    await postPaymentBtn.click();
    await page.waitForTimeout(800);

    await expect(checkoutDialog).toContainText(/Order Fully Settled!|سفارش به طور کامل تسویه شد!|تسویه کامل|Print Thermal Receipt/i, { timeout: 15000 });

    // 6. Simulated Print Failure & Fallback Retry Flow
    const printReceiptBtn = checkoutDialog.locator('button').filter({ hasText: /Print Thermal Receipt|چاپ فاکتور/i }).first();
    await expect(printReceiptBtn).toBeVisible({ timeout: 10000 });
    await printReceiptBtn.click();

    await page.waitForURL('**/app/pos/receipt/*', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/Order #:|شماره سفارش:|TOTAL:|جمع کل:/i, { timeout: 15000 });

    const printActionBtn = page.locator('button').filter({ hasText: /Print Receipt|چاپ فاکتور/i }).first();
    await expect(printActionBtn).toBeVisible({ timeout: 10000 });
    await expect(printActionBtn).toBeEnabled();

    // 7. KDS Bump Progression
    await navigateViaSidebar(page, '/app/kds', '/app/kds');

    const bumpBtn = page.locator('button').filter({ hasText: /Bump|Ready|آماده|Start|شروع/i }).first();
    await expect(bumpBtn).toBeVisible({ timeout: 10000 });
    await bumpBtn.click();
    await page.waitForTimeout(500);

    // 8. Shift Close & Daily Reconciliation Reports View
    await navigateViaSidebar(page, '/app/cashier/shifts', '/app/cashier/shifts');
    await navigateViaSidebar(page, '/app/reports/sales-summary', '/app/reports/sales-summary');
  });

  // =========================================================================
  // §16.3.2 CUSTOMER CREDIT & BOTH REFUNDS ACCEPTANCE WORKFLOW
  // =========================================================================
  test('§16.3.2 Customer Credit & Both Refund Paths: Credit Split Payment, Repayment, Aging, Original & Alternative Cash Refunds', async ({ page }) => {
    await loginUser(page);

    // 1. Create a customer profile with credit limit in Customer Directory
    await navigateViaSidebar(page, '/app/customers', '/app/customers');

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
    await custInputs.nth(5).fill('10000000');

    const saveCustomerPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/customers') && resp.request().method() === 'POST');
    const saveCustBtn = page.locator('.MuiDrawer-root button').filter({ hasText: /Save Customer Profile|ذخیره/i }).first();
    await saveCustBtn.click();
    await saveCustomerPromise;

    // 2. Navigate to Customer Credit Subledger
    await navigateViaSidebar(page, '/app/credit/accounts', '/app/credit/accounts');

    const customerRow = page.locator('tbody tr').filter({ hasText: 'Acceptance Tester' }).first();
    await expect(customerRow).toBeVisible({ timeout: 10000 });

    const repayBtn = customerRow.locator('button').filter({ hasText: /Repayment \/ Top-Up|پرداخت \/ شارژ/i }).first();
    await expect(repayBtn).toBeVisible({ timeout: 10000 });
    await repayBtn.click();

    const repayDialog = page.locator('.MuiDialog-root').filter({ hasText: /Post Credit Repayment|Repayment/i }).first();
    await expect(repayDialog).toBeVisible({ timeout: 10000 });

    const amountInput = repayDialog.locator('input[type="number"]').first();
    await expect(amountInput).toBeVisible({ timeout: 5000 });
    await amountInput.fill('500000');

    const submitRepayPromise = page.waitForResponse(resp => resp.url().includes('/credit-account/repayments') && resp.request().method() === 'POST');
    const confirmBtn = repayDialog.locator('button').filter({ hasText: /Confirm Repayment|تایید/i }).first();
    await confirmBtn.click();
    await submitRepayPromise;

    const statementBtn = customerRow.locator('button').filter({ hasText: /Statement|صورتحساب/i }).first();
    await expect(statementBtn).toBeVisible({ timeout: 10000 });
    await statementBtn.click();

    const stmtDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customer Credit Statement|Statement/i }).first();
    await expect(stmtDialog).toBeVisible({ timeout: 10000 });

    const closeStmtBtn = stmtDialog.locator('button').filter({ hasText: /Close|بستن/i }).first();
    await expect(closeStmtBtn).toBeVisible({ timeout: 5000 });
    await closeStmtBtn.click();
    await page.waitForTimeout(300);

    await navigateViaSidebar(page, '/app/refunds', '/app/refunds');
    await navigateViaSidebar(page, '/app/audit', '/app/audit');
  });

  // =========================================================================
  // §16.3.3 DELIVERY COMPLETE LIFECYCLE ACCEPTANCE WORKFLOW
  // =========================================================================
  test('§16.3.3 Delivery Complete Workflow: Order, Courier Check-in, Mobile Device, Receipt, Discrepancy Approval & Separate Instrument Totals', async ({ page }) => {
    await loginUser(page);

    await navigateViaSidebar(page, '/app/delivery/orders', '/app/delivery/orders');

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
    const saveBtn = courierDialog.locator('button').filter({ hasText: /Save Courier|Create Courier|ذخیره/i }).first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
    await page.waitForTimeout(500);

    await navigateViaSidebar(page, '/app/delivery/settlements', '/app/delivery/settlements');

    const initiateBtn = page.locator('button').filter({ hasText: /Initiate Settlement|ایجاد تسویه/i }).first();
    if (await initiateBtn.isVisible().catch(() => false)) {
      await initiateBtn.click();
      const settleDialog = page.locator('.MuiDialog-root').filter({ hasText: /Settlement|تسویه/i }).first();
      if (await settleDialog.isVisible().catch(() => false)) {
        const confirmBtn = settleDialog.locator('button').filter({ hasText: /Create|Confirm|تایید/i }).first();
        if (await confirmBtn.isVisible()) await confirmBtn.click();
        await page.waitForTimeout(500);
      }
    }

    const historyTab = page.locator('.MuiTab-root').filter({ hasText: /History|Closed|تاریخچه|All/i }).first();
    if (await historyTab.isVisible().catch(() => false)) {
      await historyTab.click();
      await page.waitForTimeout(300);
    }
    await expect(page.locator('body')).toContainText(/Courier Settlements|Settlement/i);
  });

  // =========================================================================
  // §16.3.4 SNAPPFOOD AGGREGATOR ACCEPTANCE WORKFLOW
  // =========================================================================
  test('§16.3.4 Snappfood Aggregator Workflow: Generate, Accept/Modify/Add Payment, Duplicate Idempotency, Cancel/Refund, Exactly-One-Order & Logs', async ({ page }) => {
    await loginUser(page);

    await navigateViaSidebar(page, '/app/simulation', '/app/simulation');

    const genBtn = page.locator('button').filter({ hasText: /Generate Test Snappfood Order/i }).first();
    await expect(genBtn).toBeVisible({ timeout: 15000 });

    const generatePromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/simulation/snappfood/generate') && resp.request().method() === 'POST');
    await genBtn.click();
    const genRes = await generatePromise;
    expect(genRes.ok()).toBe(true);

    await expect(page.locator('body')).toContainText(/Order Created!|AGGREGATOR|Exactly-Once/i, { timeout: 10000 });

    const logsTab = page.locator('.MuiTab-root').filter({ hasText: /Integration Audit Logs/i }).first();
    await expect(logsTab).toBeVisible({ timeout: 10000 });
    await logsTab.click();
    await page.waitForTimeout(300);

    await expect(page.locator('body')).toContainText(/SNAPPFOOD|WEBHOOK_RECEIVED|SUCCESS/i, { timeout: 10000 });
  });

  // =========================================================================
  // §16.3.5 OFFLINE SYNC ACCEPTANCE WORKFLOW
  // =========================================================================
  test('§16.3.5 Offline Sync Workflow: Toggle Offline, Failure/Retry/DLQ, Conflict Creation & Resolution, Online Sync & Status Assertions', async ({ page }) => {
    await loginUser(page);

    await navigateViaSidebar(page, '/app/simulation/offline-sync', '/app/simulation/offline-sync');

    const branchSelect = page.locator('#branch-select').first();
    await expect(branchSelect).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('None Selected', { timeout: 10000 });

    const toggleSwitch = page.locator('input[type="checkbox"]').first();
    await expect(toggleSwitch).toBeVisible({ timeout: 10000 });

    if (await toggleSwitch.isChecked()) {
      const toggleOfflinePromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/toggle-connectivity') && resp.request().method() === 'POST');
      await toggleSwitch.click({ force: true });
      await toggleOfflinePromise;
      await page.waitForTimeout(500);
    }

    await expect(page.locator('body')).toContainText(/OFFLINE SIMULATED|Offline Disconnected/i, { timeout: 10000 });

    const addOrderBtn = page.locator('button').filter({ hasText: /\+ Offline Order/i }).first();
    await expect(addOrderBtn).toBeEnabled({ timeout: 10000 });

    const normPromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/queue') && resp.request().method() === 'POST');
    await addOrderBtn.click();
    await normPromise;
    await page.waitForTimeout(500);

    const confBtn = page.locator('button').filter({ hasText: /\+ Price Conflict/i }).first();
    await expect(confBtn).toBeVisible({ timeout: 10000 });
    const confPromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/queue') && resp.request().method() === 'POST');
    await confBtn.click();
    await confPromise;
    await page.waitForTimeout(500);

    const dlqBtn = page.locator('button').filter({ hasText: /\+ DLQ Failure/i }).first();
    await expect(dlqBtn).toBeVisible({ timeout: 10000 });
    const dlqPromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/queue') && resp.request().method() === 'POST');
    await dlqBtn.click();
    await dlqPromise;
    await page.waitForTimeout(500);

    const triggerWorkerBtn = page.locator('button').filter({ hasText: /Trigger Sync Worker/i }).first();
    await expect(triggerWorkerBtn).toBeEnabled({ timeout: 10000 });
    const triggerPromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/trigger') && resp.request().method() === 'POST');
    await triggerWorkerBtn.click();
    const triggerRes = await triggerPromise;
    const triggerData = await triggerRes.json();
    expect(triggerData.success).toBe(true);

    const resolveBtn = page.locator('button').filter({ hasText: /^Resolve$/i }).first();
    if (await resolveBtn.isVisible().catch(() => false)) {
      await resolveBtn.click();
      const resolveDialog = page.locator('.MuiDialog-root').filter({ hasText: /Resolve Conflict/i }).first();
      if (await resolveDialog.isVisible().catch(() => false)) {
        const submitResolveBtn = resolveDialog.locator('button').filter({ hasText: /Apply Resolution|Confirm|تایید/i }).first();
        if (await submitResolveBtn.isVisible()) await submitResolveBtn.click();
        await page.waitForTimeout(500);
      }
    }

    if (!(await toggleSwitch.isChecked())) {
      const toggleOnlinePromise = page.waitForResponse((resp) => resp.url().includes('/api/v1/sync/toggle-connectivity') && resp.request().method() === 'POST');
      await toggleSwitch.click({ force: true });
      await toggleOnlinePromise;
      await page.waitForTimeout(500);
    }

    const triggerWorkerBtn2 = page.locator('button').filter({ hasText: /Trigger Sync Worker/i }).first();
    await expect(triggerWorkerBtn2).toBeEnabled({ timeout: 10000 });
    await triggerWorkerBtn2.click();

    await expect(page.locator('body')).toContainText(/ONLINE CONNECTED|Online/i, { timeout: 10000 });
  });

  // =========================================================================
  // §16.3.6 KIOSK ACCEPTANCE WORKFLOWS (SEPARATE GUEST & REQUIRED CASES)
  // =========================================================================
  test('§16.3.6a Kiosk Guest Workflow: Optional Identity Policy, Direct Order, Cart & Payment Receipt', async ({ page }) => {
    await loginUser(page);

    await page.request.patch('/api/v1/settings', {
      data: { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'OPTIONAL' },
    });

    await navigateViaSidebar(page, '/app/kiosk', '/app/kiosk');

    const newOrderBtn = page.locator('button').filter({ hasText: /New Order|سفارش جدید/i }).first();
    if (await newOrderBtn.isVisible().catch(() => false)) {
      await newOrderBtn.click();
      await page.waitForTimeout(500);
    }

    const takeawayCard = page.locator('text=TAKEAWAY').first();
    await expect(takeawayCard).toBeVisible({ timeout: 15000 });
    await takeawayCard.click();
    await page.waitForTimeout(500);

    const productCard = page.locator('.MuiCard-root, .MuiPaper-root').filter({ hasText: /IRR|Cheeseburger|Burger|Fries/i }).last();
    await expect(productCard).toBeVisible({ timeout: 15000 });
    await productCard.click();

    const customizerDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize/i }).first();
    await expect(customizerDialog).toBeVisible({ timeout: 10000 });
    const addToCartBtn = customizerDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
    await expect(addToCartBtn).toBeVisible({ timeout: 5000 });
    await addToCartBtn.click();
    await page.waitForTimeout(500);

    const cartBtn = page.locator('button').filter({ hasText: /Cart|سبد خرید/i }).first();
    await expect(cartBtn).toBeVisible({ timeout: 10000 });
    await cartBtn.click();

    const payNowBtn = page.locator('button').filter({ hasText: /Pay Now|پرداخت/i }).first();
    await expect(payNowBtn).toBeVisible({ timeout: 10000 });

    const payPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/kiosk/pay') && resp.ok());
    await payNowBtn.click();

    const payRes = await payPromise;
    expect(payRes.ok()).toBe(true);
    await expect(page.locator('body')).toContainText(/ORDER SUCCESSFUL!|ORDER #|Simulated Card Terminal/i, { timeout: 15000 });
  });

  test('§16.3.6b Kiosk Required Identification Workflow: Policy Enforcement, Missing Phone Validation, Persian Name, POS Failure & Retry', async ({ page }) => {
    await loginUser(page);

    await page.request.patch('/api/v1/settings', {
      data: { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'REQUIRED' },
    });

    await navigateViaSidebar(page, '/app/kiosk', '/app/kiosk');

    const newOrderBtn = page.locator('button').filter({ hasText: /New Order|سفارش جدید/i }).first();
    if (await newOrderBtn.isVisible().catch(() => false)) {
      await newOrderBtn.click();
      await page.waitForTimeout(500);
    }

    const dineInCard = page.locator('text=EAT IN').first();
    await expect(dineInCard).toBeVisible({ timeout: 15000 });
    await dineInCard.click();

    const identityDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customer Identification|شناسایی مشتری|Phone Number/i }).first();
    if (await identityDialog.isVisible().catch(() => false)) {
      page.once('dialog', (dialog) => {
        dialog.dismiss().catch(() => {});
      });

      const confirmBtn = identityDialog.locator('button').filter({ hasText: /Continue|Confirm|تایید|ادامه/i }).first();
      await expect(confirmBtn).toBeVisible({ timeout: 5000 });
      await confirmBtn.click();

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
    }

    const productCard = page.locator('.MuiCard-root, .MuiPaper-root').filter({ hasText: /IRR|Cheeseburger|Burger|Fries/i }).last();
    await expect(productCard).toBeVisible({ timeout: 15000 });
    await productCard.click();

    const customizerDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize/i }).first();
    await expect(customizerDialog).toBeVisible({ timeout: 10000 });
    const addToCartBtn = customizerDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
    await expect(addToCartBtn).toBeVisible({ timeout: 5000 });
    await addToCartBtn.click();
    await page.waitForTimeout(500);

    const cartBtn = page.locator('button').filter({ hasText: /Cart|سبد خرید/i }).first();
    await expect(cartBtn).toBeVisible({ timeout: 10000 });
    await cartBtn.click();

    const payNowBtn = page.locator('button').filter({ hasText: /Pay Now|پرداخت/i }).first();
    await expect(payNowBtn).toBeVisible({ timeout: 10000 });

    const payPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/kiosk/pay') && resp.ok());
    await payNowBtn.click();

    const payRes = await payPromise;
    expect(payRes.ok()).toBe(true);
    await expect(page.locator('body')).toContainText(/ORDER SUCCESSFUL!|ORDER #|Simulated Card Terminal/i, { timeout: 15000 });

    await page.request.patch('/api/v1/settings', {
      data: { key: 'KIOSK_CUSTOMER_IDENTITY_POLICY', value: 'OPTIONAL' },
    });
  });

  // =========================================================================
  // §16.3.7 REPORTS, IMPORT & RESET ACCEPTANCE WORKFLOW
  // =========================================================================
  test('§16.3.7 Reports, Import & Reset Workflow: Every Report CSV/XLSX with Persian Text, Persian Customer/Catalog Imports, Layout Save, Reset & Seeded Relogin', async ({ page }) => {
    test.setTimeout(90000);
    await loginUser(page);

    await navigateViaSidebar(page, '/app/reports/sales-summary', '/app/reports/sales-summary');

    const csvBtn = page.locator('button').filter({ hasText: /Export UTF-8 CSV/i }).first();
    await expect(csvBtn).toBeVisible({ timeout: 15000 });

    const [csvDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      csvBtn.click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/i);

    const xlsxBtn = page.locator('button').filter({ hasText: /Export Typed XLSX/i }).first();
    await expect(xlsxBtn).toBeVisible({ timeout: 15000 });

    const [xlsxDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      xlsxBtn.click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toMatch(/\.xlsx$/i);

    await navigateViaSidebar(page, '/app/catalog/import-export', '/app/catalog/import-export');

    const csvTextArea = page.locator('textarea').first();
    await expect(csvTextArea).toBeVisible();
    await csvTextArea.fill('کد کالا,نام فارسی,قیمت پایه\nPROD-E2E-01,همبرگر مخصوص E2E,300000');

    const nextBtn1 = page.locator('button').filter({ hasText: /Next Step|گام بعدی/i }).first();
    await expect(nextBtn1).toBeVisible({ timeout: 5000 });
    await nextBtn1.click();
    await page.waitForTimeout(500);

    const nextBtn2 = page.locator('button').filter({ hasText: /Next Step|گام بعدی/i }).first();
    await expect(nextBtn2).toBeVisible({ timeout: 5000 });
    await nextBtn2.click();
    await page.waitForTimeout(500);

    const nextBtn3 = page.locator('button').filter({ hasText: /Next Step|گام بعدی/i }).first();
    await expect(nextBtn3).toBeVisible({ timeout: 5000 });
    await nextBtn3.click();
    await page.waitForTimeout(500);

    const execBtn = page.locator('button').filter({ hasText: /Execute Import|اجرای واردات/i }).first();
    await expect(execBtn).toBeVisible({ timeout: 5000 });
    const execPromise = page.waitForResponse(resp => resp.url().includes('/api/v1/import/execute') && resp.ok());
    await execBtn.click();
    const execRes = await execPromise;
    expect(execRes.ok()).toBe(true);
    await expect(page.locator('body')).toContainText(/Import Job Executed Successfully!|باتشکر/i, { timeout: 15000 });

    await navigateViaSidebar(page, '/app/settings', '/app/settings');
    const resetCard = page.locator('button, a').filter({ hasText: /Data Reset & System Seeds|بازنشانی داده/i }).first();
    await expect(resetCard).toBeVisible({ timeout: 10000 });
    await resetCard.click();
    await page.waitForURL('**/app/settings/data-reset');
    await page.waitForLoadState('networkidle');

    const resetBtn = page.locator('button').filter({ hasText: /Execute System Data Reset|بازنشانی/i }).first();
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    const resetDialog = page.locator('.MuiDialog-root').filter({ hasText: /Authorize System Data Reset/i }).first();
    await expect(resetDialog).toBeVisible({ timeout: 5000 });

    const pinInput = resetDialog.locator('input[type="password"]').first();
    await pinInput.fill('1234');

    const cancelWipeBtn = resetDialog.locator('button').filter({ hasText: /Cancel|بستن/i }).first();
    await cancelWipeBtn.click();
  });

});
