import { test, expect } from '@playwright/test';

test.describe('POS Order, Checkout / Pay Now, and Receipt Print E2E Workflow', () => {

  const loginUser = async (page: any) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[autoComplete="username"], input[name="username"]').first().fill('admin@gnext.local');
    await page.locator('input[autoComplete="current-password"], input[type="password"]').first().fill('GnextDemo!2026');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app/dashboard', { timeout: 15000 });
    await page.waitForTimeout(1000);
  };

  test('Complete Order Placement, Payment Tender Checkout, and Thermal Receipt Printing', async ({ page }) => {
    // 1. Authenticate
    await loginUser(page);

    // 2. Client-side navigation via sidebar to POS Register
    const posLink = page.locator('a[href="/app/pos"]').first();
    await expect(posLink).toBeVisible({ timeout: 10000 });
    await posLink.click();

    await page.waitForURL('**/app/pos', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/POS Register & Order Placement|Active Cart/i, { timeout: 15000 });

    // 3. Select product card from POS catalog grid
    const fastFoodTab = page.locator('.MuiTab-root').filter({ hasText: /Fast Food|Burger/i }).first();
    await expect(fastFoodTab).toBeVisible({ timeout: 10000 });
    await fastFoodTab.click();
    await page.waitForTimeout(500);

    const productCard = page.locator('.MuiPaper-root').filter({ hasText: /Cheeseburger|Burger|PROD-/i }).first();
    await expect(productCard).toBeVisible({ timeout: 15000 });
    await productCard.click();

    // Wait for option groups async fetch & dialog rendering to settle
    await page.waitForTimeout(3000);

    // Option Customization Dialog opens, click "Add to Cart"
    const customizeDialog = page.locator('.MuiDialog-root').filter({ hasText: /Customize/i }).first();
    await expect(customizeDialog).toBeVisible({ timeout: 10000 });
    const dialogAddBtn = customizeDialog.locator('button').filter({ hasText: /Add to Cart|افزودن/i }).first();
    await expect(dialogAddBtn).toBeVisible({ timeout: 5000 });
    await dialogAddBtn.click();
    await page.waitForTimeout(500);

    // Verify item is added to Active Cart
    await expect(page.locator('body')).toContainText(/Active Cart|سبد خرید فعال/i, { timeout: 10000 });

    // 4. Submit Order Draft ("Place Order")
    const placeOrderBtn = page.locator('button').filter({ hasText: /Place Order|Submit Order|ثبت سفارش/i }).first();
    await expect(placeOrderBtn).toBeEnabled({ timeout: 15000 });
    await placeOrderBtn.click();

    // 5. Assert Checkout Modal Opens ("Order Settlement & Checkout" / "تسویه و پرداخت سفارش")
    const checkoutDialog = page.locator('.MuiDialog-root').filter({ hasText: /Order Settlement & Checkout|تسویه و پرداخت سفارش|تسویه/i }).first();
    await expect(checkoutDialog).toBeVisible({ timeout: 15000 });

    // 6. Post Payment Tender ("Pay Now" / "Post Payment Tender")
    const postPaymentBtn = checkoutDialog.locator('button').filter({ hasText: /Post Payment Tender|Pay Now|پرداخت/i }).first();
    await expect(postPaymentBtn).toBeVisible({ timeout: 10000 });
    await postPaymentBtn.click();

    // 7. Verify Order is Fully Settled
    await expect(checkoutDialog).toContainText(/Order Fully Settled|سفارش به طور کامل تسویه شد/i, { timeout: 15000 });

    // 8. Click "Print Thermal Receipt" button
    const printReceiptBtn = checkoutDialog.locator('button').filter({ hasText: /Print Thermal Receipt|چاپ فاکتور/i }).first();
    await expect(printReceiptBtn).toBeVisible({ timeout: 10000 });
    await printReceiptBtn.click();

    // 9. Assert Navigation to Thermal Receipt Page
    await page.waitForURL('**/app/pos/receipt/*', { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // 10. Verify Thermal Receipt content structure
    await expect(page.locator('body')).toContainText(/Order #:|ORD-|شماره سفارش/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/TOTAL:|IRR|جمع کل/i);
    await expect(page.locator('body')).toContainText(/Payment Tenders Split:|پرداخت/i);

    // 11. Trigger Thermal Receipt Print action
    const printActionBtn = page.locator('button').filter({ hasText: /Print Receipt|چاپ فاکتور/i }).first();
    await expect(printActionBtn).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => {
      window.print = () => {
        document.body.setAttribute('data-printed', 'true');
      };
    });

    await printActionBtn.click();
    await expect(page.locator('body')).toHaveAttribute('data-printed', 'true', { timeout: 10000 });
  });

});
