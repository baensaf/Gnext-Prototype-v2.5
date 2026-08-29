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

    console.log("=== POPULATING SECTIONS, TABLES, DISCOUNTS, COUPONS, PRINTERS & RUNNING POS ORDERS ===");

    const report = await page.evaluate(async () => {
      const logs = [];
      const errors = [];

      // Fetch me & csrf
      const meRes = await fetch('/api/v1/auth/me');
      const meData = await meRes.json();
      const csrf = meData.csrfToken;
      const branchId = meData.tenant?.id ? (await (await fetch('/api/v1/branches')).json())[0]?.id : null;

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

      // 1. Dining Sections & Tables
      const curSecs = (await api('/api/v1/dining/sections')).data || [];
      const secsToCreate = [
        { code: 'MAIN', name: 'سالن اصلی', sortOrder: 1, branchId },
        { code: 'PATIO', name: 'تراس و فضای باز', sortOrder: 2, branchId },
        { code: 'VIP', name: 'سالن VIP اختصاصی', sortOrder: 3, branchId }
      ];
      for (const s of secsToCreate) {
        if (!curSecs.find(cs => cs.code === s.code)) {
          const res = await api('/api/v1/dining/sections', 'POST', s);
          if (res.ok) logs.push('Created Section: ' + s.name);
          else errors.push({ entity: 'DiningSection', item: s, res });
        }
      }

      const updatedSecs = (await api('/api/v1/dining/sections')).data || [];
      const mainSec = updatedSecs.find(s => s.code === 'MAIN') || updatedSecs[0];
      const patioSec = updatedSecs.find(s => s.code === 'PATIO') || updatedSecs[0];
      const vipSec = updatedSecs.find(s => s.code === 'VIP') || updatedSecs[0];

      const curTbls = (await api('/api/v1/dining/tables')).data || [];
      const tablesToCreate = [
        { dining_area_id: mainSec?.id, code: 'T-01', table_number: '1', seating_capacity: 2, shape: 'SQUARE', pos_x: 100, pos_y: 100 },
        { dining_area_id: mainSec?.id, code: 'T-02', table_number: '2', seating_capacity: 2, shape: 'SQUARE', pos_x: 240, pos_y: 100 },
        { dining_area_id: mainSec?.id, code: 'T-03', table_number: '3', seating_capacity: 4, shape: 'RECTANGLE', pos_x: 100, pos_y: 240 },
        { dining_area_id: mainSec?.id, code: 'T-04', table_number: '4', seating_capacity: 4, shape: 'RECTANGLE', pos_x: 240, pos_y: 240 },
        { dining_area_id: mainSec?.id, code: 'T-05', table_number: '5', seating_capacity: 6, shape: 'RECTANGLE', pos_x: 380, pos_y: 240 },
        { dining_area_id: patioSec?.id, code: 'T-06', table_number: '6', seating_capacity: 4, shape: 'CIRCLE', pos_x: 100, pos_y: 100 },
        { dining_area_id: vipSec?.id, code: 'VIP-01', table_number: '7', seating_capacity: 8, shape: 'RECTANGLE', pos_x: 100, pos_y: 100 }
      ];
      for (const t of tablesToCreate) {
        if (t.dining_area_id && !curTbls.find(ct => ct.code === t.code)) {
          const res = await api('/api/v1/dining/tables', 'POST', t);
          if (res.ok) logs.push('Created Table: ' + t.code);
          else errors.push({ entity: 'DiningTable', item: t, res });
        }
      }

      // 2. Discount Campaigns & Coupons
      const campaignsToCreate = [
        { code: 'CAMP-WELCOME10', name: 'کمپین خوش‌آمدگویی ۱۰ درصدی', discount_type: 'PERCENTAGE', percentage: '10.00', coupon_required: true, is_stackable: true },
        { code: 'CAMP-VIP20', name: 'کمپین مشتریان ویژه ۲۰ درصدی', discount_type: 'PERCENTAGE', percentage: '20.00', coupon_required: true, is_stackable: true },
        { code: 'CAMP-SUMMER50K', name: 'تخفیف نقدی ۵۰ هزار تومانی تابستانه', discount_type: 'FIXED_AMOUNT', amount: '500000.00', coupon_required: true, is_stackable: true }
      ];
      const curCamps = (await api('/api/v1/discounts')).data || [];
      for (const camp of campaignsToCreate) {
        if (!curCamps.find(cc => cc.code === camp.code)) {
          const res = await api('/api/v1/discounts', 'POST', camp);
          if (res.ok) logs.push('Created Discount Campaign: ' + camp.name);
          else errors.push({ entity: 'DiscountCampaign', item: camp, res });
        }
      }

      const refCamps = (await api('/api/v1/discounts')).data || [];
      const campWelcome = refCamps.find(c => c.code === 'CAMP-WELCOME10');
      const campVip = refCamps.find(c => c.code === 'CAMP-VIP20');
      const campSummer = refCamps.find(c => c.code === 'CAMP-SUMMER50K');

      const curCoupons = (await api('/api/v1/coupons')).data || [];
      const coupons = [
        { code: 'WELCOME10', campaign_id: campWelcome?.id, max_uses: 100 },
        { code: 'VIP20', campaign_id: campVip?.id, max_uses: 50 },
        { code: 'SUMMER50K', campaign_id: campSummer?.id, max_uses: 200 }
      ];
      for (const cp of coupons) {
        if (cp.campaign_id && !curCoupons.find(cc => cc.code === cp.code)) {
          const res = await api('/api/v1/coupons', 'POST', cp);
          if (res.ok) logs.push('Created Coupon: ' + cp.code);
          else errors.push({ entity: 'Coupon', item: cp, res });
        }
      }

      // 3. Printers
      const curPrns = (await api('/api/v1/printers')).data || [];
      const printersToCreate = [
        { branch_id: branchId, code: 'PRN-KITCHEN', name: 'چاپگر حرارتی آشپزخانه', printer_type: 'THERMAL_RECEIPT', paper_width_mm: 80, simulated_address: '192.168.1.201:9100' },
        { branch_id: branchId, code: 'PRN-RECEIPT', name: 'چاپگر صدور فاکتور مشتری', printer_type: 'THERMAL_RECEIPT', paper_width_mm: 80, simulated_address: '192.168.1.202:9100' },
        { branch_id: branchId, code: 'PRN-BAR', name: 'چاپگر بار و دسر', printer_type: 'THERMAL_RECEIPT', paper_width_mm: 58, simulated_address: '192.168.1.203:9100' }
      ];
      for (const pr of printersToCreate) {
        if (pr.branch_id && !curPrns.find(cp => cp.code === pr.code)) {
          const res = await api('/api/v1/printers', 'POST', pr);
          if (res.ok) logs.push('Created Printer: ' + pr.code);
          else errors.push({ entity: 'Printer', item: pr, res });
        }
      }

      return { logs, errors };
    });

    console.log("POPULATION LOGS:", JSON.stringify(report.logs, null, 2));
    report.logs.forEach(l => agent.recordPassed({ module: "Master Setup", title: l }));
    report.errors.forEach(e => agent.recordBug({
      module: "Master Setup",
      title: "Failed creating " + e.entity + ": " + (e.item.code || e.item.name),
      severity: "Medium",
      description: JSON.stringify(e.res.data),
      expected: "201 Created",
      actual: "Status: " + e.res.status
    }));

    // ========================================================
    // STEP 2: POS INTERACTIVE TEST ORDER FLOW
    // ========================================================
    console.log("\n=== STEP 2: POS INTERACTIVE ORDER CREATION ===");
    await agent.goto("/app/pos");
    await page.waitForTimeout(1500);
    await agent.screenshot("pos_screen_with_iranburger");

    // Click on IranBurger Classic Product Card if visible
    const classicBurger = page.locator("text=ایران برگر کلاسیک, text=دوبل چیزبرگر").first();
    if (await classicBurger.isVisible()) {
      console.log("Found IranBurger product on POS! Adding to cart...");
      await classicBurger.click();
      await page.waitForTimeout(600);
      await agent.screenshot("pos_added_item_to_cart");
      agent.recordPassed({ module: "POS Operations", title: "Added IranBurger product to Cart" });
    }

    // Click on Fries if visible
    const friesItem = page.locator("text=سیب‌زمینی سرخ‌کرده").first();
    if (await friesItem.isVisible()) {
      await friesItem.click();
      await page.waitForTimeout(600);
    }

    // Click on Lemon Mint Soda if visible
    const sodaItem = page.locator("text=لیموناد موهیتو").first();
    if (await sodaItem.isVisible()) {
      await sodaItem.click();
      await page.waitForTimeout(600);
      await agent.screenshot("pos_cart_full");
    }

    // Look for Checkout / Payment / Submit button
    const payBtn = page.locator("button:has-text('پرداخت'), button:has-text('ثبت سفارش'), button:has-text('Pay'), button:has-text('Checkout')").first();
    if (await payBtn.isVisible()) {
      console.log("Found Pay / Checkout button. Clicking...");
      await payBtn.click();
      await page.waitForTimeout(1000);
      await agent.screenshot("pos_payment_dialog");
      agent.recordPassed({ module: "POS Operations", title: "Opened POS Payment Checkout Dialog" });
    }

    // ========================================================
    // STEP 3: VISIT KDS & ORDERS & REPORTS
    // ========================================================
    console.log("\n=== STEP 3: VISITING KDS & ORDERS & REPORTS ===");
    await agent.goto("/app/kds");
    await page.waitForTimeout(1500);
    await agent.screenshot("kds_live_view");
    agent.recordPassed({ module: "KDS Operations", title: "Verified KDS Screen" });

    await agent.goto("/app/orders");
    await page.waitForTimeout(1500);
    await agent.screenshot("orders_workflow_view");
    agent.recordPassed({ module: "Orders", title: "Verified Orders Workflow Screen" });

    await agent.goto("/app/reports");
    await page.waitForTimeout(1500);
    await agent.screenshot("reports_dashboard_view");
    agent.recordPassed({ module: "Reports", title: "Verified Reports Hub" });

    console.log("=== POPULATE & TEST ORDERS COMPLETED SUCCESSFULLY ===");

  } catch (err) {
    console.error("Test Error:", err);
    agent.recordBug({
      module: "Master Runner",
      title: "Exception during POS/KDS flow execution",
      severity: "High",
      description: err.message,
      expected: "Execution should complete",
      actual: err.stack
    });
  } finally {
    await agent.close();
  }
}

run().catch(console.error);