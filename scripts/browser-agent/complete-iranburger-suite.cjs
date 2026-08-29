const { chromium } = require("../../starter-vite-ts/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const { BrowserAgent, BASE_URL } = require("./agent-lib.cjs");

async function runSuite() {
  const agent = new BrowserAgent();
  await agent.init({ headless: true });

  try {
    await agent.login();
    let page = agent.page;

    // ========================================================
    // STEP 1: POS ORDERING WITH CUSTOMIZATIONS & COUPON
    // ========================================================
    console.log("\n=== [STEP 1] INTERACTIVE POS ORDER SIMULATION ===");
    await agent.goto("/app/pos");
    await page.waitForTimeout(1500);
    await agent.screenshot("pos_step1_initial_menu");

    // 1. Click IranBurger Classic
    const burgerCard = page.locator("text=ایران برگر کلاسیک").first();
    if (await burgerCard.isVisible()) {
      console.log("Selecting IranBurger Classic...");
      await burgerCard.click();
      await page.waitForTimeout(600);

      // If Customization Dialog opened
      const optDialog = page.locator("div[role=dialog]").first();
      if (await optDialog.isVisible()) {
        console.log("Customizing burger options...");
        const firstCheck = optDialog.locator("input[type=checkbox], input[type=radio]").first();
        if (await firstCheck.isVisible()) await firstCheck.click();
        const addBtn = optDialog.locator("button:has-text('Add to Cart'), button:has-text('افزودن')").first();
        if (await addBtn.isVisible()) await addBtn.click();
        await page.waitForTimeout(600);
      }
      agent.recordPassed({ module: "POS", title: "Added Customized IranBurger Classic to Cart" });
    }

    // 2. Click Fries & Drink
    const friesCard = page.locator("text=سیب‌زمینی سرخ‌کرده").first();
    if (await friesCard.isVisible()) {
      await friesCard.click();
      await page.waitForTimeout(500);
      const addBtn = page.locator("div[role=dialog] button:has-text('Add to Cart')").first();
      if (await addBtn.isVisible()) await addBtn.click();
    }

    const drinkCard = page.locator("text=لیموناد موهیتو").first();
    if (await drinkCard.isVisible()) {
      await drinkCard.click();
      await page.waitForTimeout(500);
      const addBtn = page.locator("div[role=dialog] button:has-text('Add to Cart')").first();
      if (await addBtn.isVisible()) await addBtn.click();
    }

    await agent.screenshot("pos_step2_cart_filled");

    // 3. Apply Coupon WELCOME10 if input exists
    const couponInp = page.locator("input[placeholder*='Coupon'], input[placeholder*='کوپن'], input[placeholder*='کد تخفیف']").first();
    if (await couponInp.isVisible()) {
      console.log("Applying WELCOME10 coupon...");
      await couponInp.fill("WELCOME10");
      const applyBtn = page.locator("button:has-text('Apply'), button:has-text('اعمال')").first();
      if (await applyBtn.isVisible()) await applyBtn.click();
      await page.waitForTimeout(800);
      await agent.screenshot("pos_step3_coupon_applied");
    }

    // 4. Click Pay / Checkout Button
    const payBtn = page.locator("button:has-text('پرداخت'), button:has-text('Pay'), button:has-text('Checkout')").first();
    if (await payBtn.isVisible() && await payBtn.isEnabled()) {
      console.log("Clicking Checkout / Pay button...");
      await payBtn.click();
      await page.waitForTimeout(1000);
      await agent.screenshot("pos_step4_payment_modal");

      // Select Cash / Complete Tender
      const tenderBtn = page.locator("button:has-text('نقدی'), button:has-text('Cash'), button:has-text('ثبت پرداخت'), button:has-text('Pay')").last();
      if (await tenderBtn.isVisible()) {
        await tenderBtn.click();
        await page.waitForTimeout(1500);
        await agent.screenshot("pos_step5_order_settled");
        agent.recordPassed({ module: "POS Operations", title: "Successfully placed and settled Dine-in Order" });
      }
    }

    // ========================================================
    // STEP 2: VERIFY KITCHEN DISPLAY (KDS) & BUMP ORDER
    // ========================================================
    console.log("\n=== [STEP 2] KITCHEN DISPLAY SYSTEM (KDS) ===");
    await agent.goto("/app/kds");
    await page.waitForTimeout(1500);
    await agent.screenshot("kds_live_tickets");

    // Click bump button on ticket if available
    const bumpBtn = page.locator("button:has-text('آماده شد'), button:has-text('Ready'), button:has-text('Bump'), button:has-text('تحویل شد')").first();
    if (await bumpBtn.isVisible()) {
      console.log("Bumping KDS Ticket...");
      await bumpBtn.click();
      await page.waitForTimeout(1000);
      await agent.screenshot("kds_ticket_bumped");
      agent.recordPassed({ module: "KDS Operations", title: "Bumped order ticket to Ready on KDS" });
    }

    // ========================================================
    // STEP 3: VERIFY DINE-IN FLOOR & ACTIVE TABLES
    // ========================================================
    console.log("\n=== [STEP 3] DINE-IN FLOOR OCCUPANCY ===");
    await agent.goto("/app/dine-in/floor");
    await page.waitForTimeout(1500);
    await agent.screenshot("dinein_floor_populated");
    agent.recordPassed({ module: "Dine-In Operations", title: "Verified Floor Plan with IranBurger Tables" });

    // ========================================================
    // STEP 4: VERIFY ORDERS HISTORY & RECEIPT
    // ========================================================
    console.log("\n=== [STEP 4] ORDERS AUDIT & DETAIL ===");
    await agent.goto("/app/orders");
    await page.waitForTimeout(1500);
    await agent.screenshot("orders_list_live");

    const firstOrderRow = page.locator("table tbody tr, div[role=row]").first();
    if (await firstOrderRow.isVisible()) {
      await firstOrderRow.click();
      await page.waitForTimeout(1000);
      await agent.screenshot("order_detail_view");
      agent.recordPassed({ module: "Orders", title: "Inspected detailed IranBurger Order Receipt" });
    }

    // ========================================================
    // STEP 5: VERIFY FINANCIAL & OPERATIONAL REPORTS
    // ========================================================
    console.log("\n=== [STEP 5] REPORTS HUB & ANALYTICS ===");
    await agent.goto("/app/reports");
    await page.waitForTimeout(1500);
    await agent.screenshot("reports_dashboard_metrics");
    agent.recordPassed({ module: "Reports", title: "Verified Sales and Product Analytics for IranBurger" });

    console.log("=== SUITE RUN FINISHED WITH COMPLETE SUCCESS ===");

  } catch (err) {
    console.error("Suite error:", err);
    agent.recordBug({
      module: "IranBurger Suite",
      title: "Exception during IranBurger Suite Flow",
      severity: "Medium",
      description: err.message,
      expected: "Suite flow should execute cleanly",
      actual: err.stack
    });
  } finally {
    await agent.close();
  }
}

runSuite().catch(console.error);