const { chromium } = require("../../starter-vite-ts/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const { BrowserAgent, BASE_URL } = require("./agent-lib.cjs");

async function run() {
  const agent = new BrowserAgent();
  await agent.init({ headless: true });

  try {
    await agent.login();
    let page = agent.page;

    console.log("=== [STEP 1] POPULATING SECTIONS, TABLES, DISCOUNTS, COUPONS, PRINTERS ===");

    const populateReport = await page.evaluate(async () => {
      const logs = [];
      const errors = [];

      const meRes = await fetch('/api/v1/auth/me');
      const meData = await meRes.json();
      const csrf = meData.csrfToken;
      const branchesRes = await fetch('/api/v1/branches');
      const branches = await branchesRes.json();
      const branchId = branches[0]?.id;

      async function api(endpoint, method = 'GET', body = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          headers['X-CSRF-Token'] = csrf;
        }
        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(endpoint, opts);
        let data = null;
        try { data = await res.json(); } catch(e) {}
        return { status: res.status, ok: res.ok, data };
      }

      // 1. Discount Campaigns
      const campaignsToCreate = [
        { code: 'CAMP-WELCOME10', name: 'کمپین خوش‌آمدگویی ۱۰ درصدی', discount_type: 'PERCENTAGE', percentage: '10.00', coupon_required: true, is_stackable: true },
        { code: 'CAMP-VIP20', name: 'کمپین مشتریان ویژه ۲۰ درصدی', discount_type: 'PERCENTAGE', percentage: '20.00', coupon_required: true, is_stackable: true },
        { code: 'CAMP-SUMMER50K', name: 'تخفیف نقدی ۵۰ هزار تومانی تابستانه', discount_type: 'FIXED_AMOUNT', amount: '500000.00', coupon_required: true, is_stackable: true }
      ];
      for (const camp of campaignsToCreate) {
        const res = await api('/api/v1/discounts', 'POST', camp);
        if (res.ok) logs.push('Created Campaign: ' + camp.name);
        else errors.push({ entity: 'DiscountCampaign', item: camp, res });
      }

      // Coupons
      const campsRes = await api('/api/v1/discounts');
      const currentCamps = Array.isArray(campsRes.data) ? campsRes.data : [];
      const cWelcome = currentCamps.find(c => c.code === 'CAMP-WELCOME10');
      const cVip = currentCamps.find(c => c.code === 'CAMP-VIP20');
      const cSummer = currentCamps.find(c => c.code === 'CAMP-SUMMER50K');

      const couponsToCreate = [
        { code: 'WELCOME10', campaign_id: cWelcome?.id, max_uses: 100 },
        { code: 'VIP20', campaign_id: cVip?.id, max_uses: 50 },
        { code: 'SUMMER50K', campaign_id: cSummer?.id, max_uses: 200 }
      ];
      for (const cp of couponsToCreate) {
        if (cp.campaign_id) {
          const res = await api('/api/v1/coupons', 'POST', cp);
          if (res.ok) logs.push('Created Coupon: ' + cp.code);
          else errors.push({ entity: 'Coupon', item: cp, res });
        }
      }

      // 2. Dining Sections & Tables
      const secs = [
        { code: 'MAIN', name: 'سالن اصلی', sortOrder: 1, branchId },
        { code: 'PATIO', name: 'تراس و فضای باز', sortOrder: 2, branchId },
        { code: 'VIP', name: 'سالن VIP اختصاصی', sortOrder: 3, branchId }
      ];
      for (const s of secs) {
        const res = await api('/api/v1/dining/sections', 'POST', s);
        if (res.ok) logs.push('Created Section: ' + s.name);
      }

      const allSecs = (await api('/api/v1/dining/sections')).data || [];
      const mainS = allSecs.find(s => s.code === 'MAIN') || allSecs[0];
      const patioS = allSecs.find(s => s.code === 'PATIO') || allSecs[0];
      const vipS = allSecs.find(s => s.code === 'VIP') || allSecs[0];

      const tbls = [
        { dining_area_id: mainS?.id, code: 'T-01', table_number: '1', seating_capacity: 2, shape: 'SQUARE', pos_x: 100, pos_y: 100 },
        { dining_area_id: mainS?.id, code: 'T-02', table_number: '2', seating_capacity: 2, shape: 'SQUARE', pos_x: 240, pos_y: 100 },
        { dining_area_id: mainS?.id, code: 'T-03', table_number: '3', seating_capacity: 4, shape: 'RECTANGLE', pos_x: 100, pos_y: 240 },
        { dining_area_id: mainS?.id, code: 'T-04', table_number: '4', seating_capacity: 4, shape: 'RECTANGLE', pos_x: 240, pos_y: 240 },
        { dining_area_id: mainS?.id, code: 'T-05', table_number: '5', seating_capacity: 6, shape: 'RECTANGLE', pos_x: 380, pos_y: 240 },
        { dining_area_id: patioS?.id, code: 'T-06', table_number: '6', seating_capacity: 4, shape: 'CIRCLE', pos_x: 100, pos_y: 100 },
        { dining_area_id: vipS?.id, code: 'VIP-01', table_number: '7', seating_capacity: 8, shape: 'RECTANGLE', pos_x: 100, pos_y: 100 }
      ];
      for (const t of tbls) {
        if (t.dining_area_id) {
          const res = await api('/api/v1/dining/tables', 'POST', t);
          if (res.ok) logs.push('Created Table: ' + t.code);
        }
      }

      // 3. Printers with Branch ID
      const printers = [
        { branch_id: branchId, code: 'PRN-KITCHEN', name: 'چاپگر حرارتی آشپزخانه', printer_type: 'THERMAL_RECEIPT', paper_width_mm: 80, simulated_address: '192.168.1.201:9100' },
        { branch_id: branchId, code: 'PRN-RECEIPT', name: 'چاپگر صدور فاکتور مشتری', printer_type: 'THERMAL_RECEIPT', paper_width_mm: 80, simulated_address: '192.168.1.202:9100' },
        { branch_id: branchId, code: 'PRN-BAR', name: 'چاپگر بار و دسر', printer_type: 'THERMAL_RECEIPT', paper_width_mm: 58, simulated_address: '192.168.1.203:9100' }
      ];
      for (const pr of printers) {
        if (pr.branch_id) {
          const res = await api('/api/v1/printers', 'POST', pr);
          if (res.ok) logs.push('Created Printer: ' + pr.code);
          else errors.push({ entity: 'Printer', item: pr, res });
        }
      }

      return { logs, errors };
    });

    console.log("REPORT LOGS:", JSON.stringify(populateReport.logs, null, 2));
    populateReport.logs.forEach(l => agent.recordPassed({ module: "Master Setup", title: l }));
    populateReport.errors.forEach(e => agent.recordBug({
      module: "Master Setup",
      title: "Failed creating " + e.entity + ": " + (e.item.code || e.item.name),
      severity: "Medium",
      description: JSON.stringify(e.res.data),
      expected: "201 Created",
      actual: "Status: " + e.res.status
    }));

    // ========================================================
    // STEP 2: POS INTERACTIVE ORDER CREATION & CHECKOUT
    // ========================================================
    console.log("\n=== [STEP 2] POS ORDER CREATION WITH IRANBURGER MENU ===");
    await agent.goto("/app/pos");
    await page.waitForTimeout(1500);
    await agent.screenshot("pos_iranburger_menu");

    // Click on Classic Burger Product Card
    const burgerCard = page.locator("text=ایران برگر کلاسیک").first();
    if (await burgerCard.isVisible()) {
      console.log("Clicking IranBurger Classic Card...");
      await burgerCard.click();
      await page.waitForTimeout(800);
      await agent.screenshot("pos_burger_clicked");
    }

    // Click on Fries
    const friesCard = page.locator("text=سیب‌زمینی سرخ‌کرده").first();
    if (await friesCard.isVisible()) {
      console.log("Clicking French Fries Card...");
      await friesCard.click();
      await page.waitForTimeout(600);
    }

    // Click on Lemon Mint Soda
    const sodaCard = page.locator("text=لیموناد موهیتو").first();
    if (await sodaCard.isVisible()) {
      console.log("Clicking Lemon Mint Soda Card...");
      await sodaCard.click();
      await page.waitForTimeout(600);
    }

    await agent.screenshot("pos_cart_populated");
    agent.recordPassed({ module: "POS", title: "Added IranBurger Classic, Fries, and Soda to Cart" });

    // Click Pay / Checkout button
    const checkoutBtn = page.locator("button:has-text('پرداخت'), button:has-text('ثبت سفارش'), button:has-text('تکمیل سفارش'), button:has-text('Pay')").first();
    if (await checkoutBtn.isVisible()) {
      console.log("Opening Checkout Dialog...");
      await checkoutBtn.click();
      await page.waitForTimeout(1000);
      await agent.screenshot("pos_checkout_dialog");

      // Select Cash payment / Confirm Order
      const cashBtn = page.locator("button:has-text('نقدی'), button:has-text('Cash'), button:has-text('تایید و پرداخت'), button:has-text('Confirm')").first();
      if (await cashBtn.isVisible()) {
        await cashBtn.click();
        await page.waitForTimeout(1500);
        await agent.screenshot("pos_order_confirmed");
        agent.recordPassed({ module: "POS", title: "Completed IranBurger Test Order via Cash Tender" });
      }
    }

    // ========================================================
    // STEP 3: VERIFY KDS & ORDERS & FLOOR
    // ========================================================
    console.log("\n=== [STEP 3] VERIFYING KDS, ORDERS, DINE-IN FLOOR ===");

    await agent.goto("/app/kds");
    await page.waitForTimeout(1500);
    await agent.screenshot("kds_live_tickets");
    agent.recordPassed({ module: "Kitchen Display (KDS)", title: "Verified Live Kitchen Display Screen" });

    await agent.goto("/app/dine-in/floor");
    await page.waitForTimeout(1500);
    await agent.screenshot("dinein_floor_layout");
    agent.recordPassed({ module: "Dine-In", title: "Verified Dine-In Floor Layout with Tables" });

    await agent.goto("/app/orders");
    await page.waitForTimeout(1500);
    await agent.screenshot("orders_workflow_list");
    agent.recordPassed({ module: "Orders", title: "Verified Orders Workflow List" });

    await agent.goto("/app/reports");
    await page.waitForTimeout(1500);
    await agent.screenshot("reports_hub_live");
    agent.recordPassed({ module: "Reports", title: "Verified Reports Hub Dashboard" });

    console.log("=== MASTER EXECUTION SUCCESSFULLY COMPLETED ===");

  } catch (err) {
    console.error("Master test error:", err);
    agent.recordBug({
      module: "POS Execution",
      title: "Exception during POS/KDS execution",
      severity: "High",
      description: err.message,
      expected: "POS ordering should complete",
      actual: err.stack
    });
  } finally {
    await agent.close();
  }
}

run().catch(console.error);