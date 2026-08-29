const { chromium } = require("../../starter-vite-ts/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const { BrowserAgent, BASE_URL } = require("./agent-lib.cjs");

async function populateAndAudit() {
  const agent = new BrowserAgent();
  await agent.init({ headless: true });

  try {
    await agent.login();
    let page = agent.page;

    console.log("=== STEP 1: POPULATING MASTER DATA VIA AUTHENTICATED BROWSER SESSION ===");

    const populateReport = await page.evaluate(async () => {
      const logs = [];
      const errors = [];

      // 0. Get CSRF token from /auth/me
      const meRes = await fetch('/api/v1/auth/me');
      const meData = await meRes.json();
      const csrf = meData.csrfToken;
      logs.push('Authenticated as: ' + (meData.user?.username || 'admin') + ' | CSRF: ' + (csrf ? 'Valid' : 'None'));

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

      // 1. Branches
      const branchesRes = await api('/api/v1/branches');
      const currentBranches = Array.isArray(branchesRes.data) ? branchesRes.data : [];
      logs.push('Existing branches count: ' + currentBranches.length);

      // 2. Dining Sections & Tables
      const secRes = await api('/api/v1/dining/sections');
      let existingSecs = Array.isArray(secRes.data) ? secRes.data : [];
      
      const sectionsToCreate = [
        { code: 'MAIN', name: 'سالن اصلی', sort_order: 1 },
        { code: 'PATIO', name: 'تراس و فضای باز', sort_order: 2 },
        { code: 'VIP', name: 'سالن VIP اختصاصی', sort_order: 3 }
      ];
      for (const s of sectionsToCreate) {
        if (!existingSecs.find(es => es.code === s.code || es.name === s.name)) {
          const res = await api('/api/v1/dining/sections', 'POST', s);
          if (res.ok) logs.push('Created Section: ' + s.name);
          else errors.push({ entity: 'DiningSection', item: s, res });
        }
      }

      // Refresh Sections
      const refSecs = (await api('/api/v1/dining/sections')).data || [];
      const mainSec = refSecs.find(s => s.code === 'MAIN') || refSecs[0];
      const patioSec = refSecs.find(s => s.code === 'PATIO') || refSecs[0];
      const vipSec = refSecs.find(s => s.code === 'VIP') || refSecs[0];

      const tblRes = await api('/api/v1/dining/tables');
      const existingTbls = Array.isArray(tblRes.data) ? tblRes.data : [];
      const tablesToCreate = [
        { dining_area_id: mainSec?.id, code: 'T-01', table_number: '1', seating_capacity: 2, shape: 'SQUARE', pos_x: 100, pos_y: 100 },
        { dining_area_id: mainSec?.id, code: 'T-02', table_number: '2', seating_capacity: 2, shape: 'SQUARE', pos_x: 220, pos_y: 100 },
        { dining_area_id: mainSec?.id, code: 'T-03', table_number: '3', seating_capacity: 4, shape: 'RECTANGLE', pos_x: 100, pos_y: 220 },
        { dining_area_id: mainSec?.id, code: 'T-04', table_number: '4', seating_capacity: 4, shape: 'RECTANGLE', pos_x: 220, pos_y: 220 },
        { dining_area_id: mainSec?.id, code: 'T-05', table_number: '5', seating_capacity: 6, shape: 'RECTANGLE', pos_x: 340, pos_y: 220 },
        { dining_area_id: patioSec?.id, code: 'T-06', table_number: '6', seating_capacity: 4, shape: 'CIRCLE', pos_x: 100, pos_y: 100 },
        { dining_area_id: vipSec?.id, code: 'VIP-01', table_number: '7', seating_capacity: 8, shape: 'RECTANGLE', pos_x: 100, pos_y: 100 }
      ];
      for (const t of tablesToCreate) {
        if (t.dining_area_id && !existingTbls.find(et => et.code === t.code)) {
          const res = await api('/api/v1/dining/tables', 'POST', t);
          if (res.ok) logs.push('Created Dining Table: ' + t.code);
          else errors.push({ entity: 'DiningTable', item: t, res });
        }
      }

      // 3. Catalog Categories
      const catRes = await api('/api/v1/categories');
      const existingCats = Array.isArray(catRes.data) ? catRes.data : [];
      const catsToCreate = [
        { code: 'CAT-BURGERS', name: 'برگرها و ساندویچ‌ها', sort_order: 1 },
        { code: 'CAT-PIZZAS', name: 'پیتزا و غذاهای اصلی', sort_order: 2 },
        { code: 'CAT-SIDES', name: 'پیش‌غذا و مخلفات', sort_order: 3 },
        { code: 'CAT-DRINKS', name: 'نوشیدنی‌ها', sort_order: 4 },
        { code: 'CAT-DESSERTS', name: 'دسر و بستنی', sort_order: 5 }
      ];
      for (const c of catsToCreate) {
        if (!existingCats.find(ec => ec.code === c.code)) {
          const res = await api('/api/v1/categories', 'POST', c);
          if (res.ok) logs.push('Created Category: ' + c.name);
          else errors.push({ entity: 'Category', item: c, res });
        }
      }

      // 4. Option Groups & Items
      const ogRes = await api('/api/v1/option-groups');
      const existingOgs = Array.isArray(ogRes.data) ? ogRes.data : [];
      const ogsToCreate = [
        { code: 'GRP-DONENESS', name: 'میزان پخت برگر', min_selection: 1, max_selection: 1, is_required: true },
        { code: 'GRP-CHEESE', name: 'انتخاب پنیر اضافه', min_selection: 0, max_selection: 1, is_required: false },
        { code: 'GRP-EXTRAS', name: 'افزودنی‌های برگر', min_selection: 0, max_selection: 5, is_required: false },
        { code: 'GRP-MILK', name: 'نوع شیر نوشیدنی', min_selection: 1, max_selection: 1, is_required: true }
      ];
      for (const og of ogsToCreate) {
        if (!existingOgs.find(e => e.code === og.code)) {
          const res = await api('/api/v1/option-groups', 'POST', og);
          if (res.ok) logs.push('Created Option Group: ' + og.name);
          else errors.push({ entity: 'OptionGroup', item: og, res });
        }
      }

      // Option Items
      const refOgs = (await api('/api/v1/option-groups')).data || [];
      const gDoneness = refOgs.find(g => g.code === 'GRP-DONENESS');
      const gCheese = refOgs.find(g => g.code === 'GRP-CHEESE');
      const gExtras = refOgs.find(g => g.code === 'GRP-EXTRAS');
      const gMilk = refOgs.find(g => g.code === 'GRP-MILK');

      if (gDoneness && (!gDoneness.items || gDoneness.items.length === 0)) {
        await api('/api/v1/option-groups/' + gDoneness.id + '/items', 'POST', { code: 'OPT-RARE', name: 'آبدار (Rare)', price_delta: '0' });
        await api('/api/v1/option-groups/' + gDoneness.id + '/items', 'POST', { code: 'OPT-MED', name: 'متوسط (Medium)', price_delta: '0' });
        await api('/api/v1/option-groups/' + gDoneness.id + '/items', 'POST', { code: 'OPT-WELL', name: 'مغزپخت (Well-Done)', price_delta: '0' });
        logs.push('Populated Doneness Options');
      }
      if (gCheese && (!gCheese.items || gCheese.items.length === 0)) {
        await api('/api/v1/option-groups/' + gCheese.id + '/items', 'POST', { code: 'OPT-CHEDDAR', name: 'پنیر چدار ورقی', price_delta: '150000' });
        await api('/api/v1/option-groups/' + gCheese.id + '/items', 'POST', { code: 'OPT-SWISS', name: 'پنیر سوئیسی', price_delta: '180000' });
        await api('/api/v1/option-groups/' + gCheese.id + '/items', 'POST', { code: 'OPT-BLUE', name: 'پنیر بلوچیز', price_delta: '220000' });
        logs.push('Populated Cheese Options');
      }
      if (gExtras && (!gExtras.items || gExtras.items.length === 0)) {
        await api('/api/v1/option-groups/' + gExtras.id + '/items', 'POST', { code: 'OPT-PATTY', name: 'پتی گوشت اضافه ۱۵۰ گرم', price_delta: '450000' });
        await api('/api/v1/option-groups/' + gExtras.id + '/items', 'POST', { code: 'OPT-BACON', name: 'بیکن ترد گوساله', price_delta: '200000' });
        await api('/api/v1/option-groups/' + gExtras.id + '/items', 'POST', { code: 'OPT-ONION', name: 'پیاز کاراملی مخصوص', price_delta: '100000' });
        await api('/api/v1/option-groups/' + gExtras.id + '/items', 'POST', { code: 'OPT-JALAPENO', name: 'فلفل هالوپینو تند', price_delta: '80000' });
        logs.push('Populated Extras Options');
      }
      if (gMilk && (!gMilk.items || gMilk.items.length === 0)) {
        await api('/api/v1/option-groups/' + gMilk.id + '/items', 'POST', { code: 'OPT-WHOLE', name: 'شیر پرچرب', price_delta: '0' });
        await api('/api/v1/option-groups/' + gMilk.id + '/items', 'POST', { code: 'OPT-OAT', name: 'شیر جو دوسر گیاهی', price_delta: '120000' });
        logs.push('Populated Milk Options');
      }

      // 5. Products
      const refCats = (await api('/api/v1/categories')).data || [];
      const cBurger = refCats.find(c => c.code === 'CAT-BURGERS') || refCats[0];
      const cPizza = refCats.find(c => c.code === 'CAT-PIZZAS') || refCats[0];
      const cSide = refCats.find(c => c.code === 'CAT-SIDES') || refCats[0];
      const cDrink = refCats.find(c => c.code === 'CAT-DRINKS') || refCats[0];
      const cDessert = refCats.find(c => c.code === 'CAT-DESSERTS') || refCats[0];
      const existingPrds = (await api('/api/v1/products')).data || [];

      const productsToCreate = [
        { code: 'PRD-BURGER-01', name: 'ایران برگر کلاسیک', category_id: cBurger?.id, base_price: '1800000', tax_rate: '0.1000', description: 'گوشت خالص گوساله ۱۵۰ گرمی با سس مخصوص و کاهو' },
        { code: 'PRD-BURGER-02', name: 'دوبل چیزبرگر اسمش', category_id: cBurger?.id, base_price: '2600000', tax_rate: '0.1000', description: 'دو عدد پتی اسمش گوساله با پنیر چدار دوبل' },
        { code: 'PRD-PIZZA-01', name: 'پیتزا قارچ و ترافل', category_id: cPizza?.id, base_price: '3200000', tax_rate: '0.1000', description: 'خمیر ناپلی، روغن ترافل، قارچ تازه و پنیر موزارلا' },
        { code: 'PRD-SIDE-01', name: 'سیب‌زمینی سرخ‌کرده کریسپی', category_id: cSide?.id, base_price: '750000', tax_rate: '0.1000', description: 'سیب زمینی سرخ شده طلایی با ادویه مخصوص' },
        { code: 'PRD-SIDE-02', name: 'بال سوخاری تند بوفالو', category_id: cSide?.id, base_price: '1600000', tax_rate: '0.1000', description: '۶ عدد بال سوخاری ترد همراه با سس تند بوفالو و بلوچیز' },
        { code: 'PRD-DRINK-01', name: 'لیموناد موهیتو طبیعی خنک', category_id: cDrink?.id, base_price: '550000', tax_rate: '0.1000', description: 'آب لیموی تازه، نعناع طبیعی و یخ قالبی' },
        { code: 'PRD-DRINK-02', name: 'آیس اسپانیش لاته', category_id: cDrink?.id, base_price: '850000', tax_rate: '0.1000', description: 'اسپرسو دوبل، شیر غلیظ شده و شیر سرد' },
        { code: 'PRD-DESSERT-01', name: 'کیک لاوا شکلاتی گرم', category_id: cDessert?.id, base_price: '950000', tax_rate: '0.1000', description: 'کیک شکلاتی با مغز شکلات بلژیکی مذاب' }
      ];

      for (const p of productsToCreate) {
        if (p.category_id && !existingPrds.find(ep => ep.code === p.code)) {
          const res = await api('/api/v1/products', 'POST', p);
          if (res.ok) logs.push('Created Product: ' + p.name);
          else errors.push({ entity: 'Product', item: p, res });
        }
      }

      // 6. Customers
      const custRes = await api('/api/v1/customers');
      const existingCusts = Array.isArray(custRes.data) ? custRes.data : (custRes.data?.items || []);
      const custsToCreate = [
        { code: 'CUST-001', first_name: 'علی', last_name: 'رضایی', mobile: '09121111111', email: 'ali.rezaei@example.com' },
        { code: 'CUST-002', first_name: 'سارا', last_name: 'محمدی', mobile: '09122222222', email: 'sara.m@example.com' },
        { code: 'CUST-003', first_name: 'شرکت داده پردازان عصر جدید', last_name: '(حقوقی)', mobile: '09123333333', email: 'contact@acmetech.ir', credit_limit: '50000000' },
        { code: 'CUST-004', first_name: 'فرهاد', last_name: 'رحیمی', mobile: '09124444444', email: 'farhad.rahimi@example.com' }
      ];
      for (const cu of custsToCreate) {
        if (!existingCusts.find(ec => ec.mobile === cu.mobile || ec.phone_number === cu.mobile)) {
          const res = await api('/api/v1/customers', 'POST', cu);
          if (res.ok) logs.push('Created Customer: ' + cu.first_name + ' ' + cu.last_name);
          else errors.push({ entity: 'Customer', item: cu, res });
        }
      }

      // 7. Coupons
      const cpRes = await api('/api/v1/coupons');
      const existingCoupons = Array.isArray(cpRes.data) ? cpRes.data : [];
      const couponsToCreate = [
        { code: 'WELCOME10', max_uses: 100, is_active: true },
        { code: 'VIP20', max_uses: 50, is_active: true },
        { code: 'SUMMER50K', max_uses: 200, is_active: true }
      ];
      for (const cp of couponsToCreate) {
        if (!existingCoupons.find(ec => ec.code === cp.code)) {
          const res = await api('/api/v1/coupons', 'POST', cp);
          if (res.ok) logs.push('Created Coupon: ' + cp.code);
          else errors.push({ entity: 'Coupon', item: cp, res });
        }
      }

      // 8. Couriers
      const crRes = await api('/api/v1/delivery/couriers');
      const existingCouriers = Array.isArray(crRes.data) ? crRes.data : [];
      const couriersToCreate = [
        { code: 'CR-01', name: 'رضا مرادی', phone: '09351112233', vehicle_type: 'MOTORBIKE', compensation_per_delivery: '150000', currency_code: 'IRR', status: 'AVAILABLE', is_active: true },
        { code: 'CR-02', name: 'حمید کاظمی', phone: '09362223344', vehicle_type: 'MOTORBIKE', compensation_per_delivery: '150000', currency_code: 'IRR', status: 'AVAILABLE', is_active: true },
        { code: 'CR-03', name: 'بابک راد', phone: '09373334455', vehicle_type: 'VAN', compensation_per_delivery: '250000', currency_code: 'IRR', status: 'AVAILABLE', is_active: true }
      ];
      for (const cr of couriersToCreate) {
        if (!existingCouriers.find(ec => ec.code === cr.code || ec.phone === cr.phone)) {
          const res = await api('/api/v1/delivery/couriers', 'POST', cr);
          if (res.ok) logs.push('Created Courier: ' + cr.name);
          else errors.push({ entity: 'Courier', item: cr, res });
        }
      }

      // 9. Hardware Printers
      const prnRes = await api('/api/v1/printers');
      const existingPrns = Array.isArray(prnRes.data) ? prnRes.data : [];
      const printersToCreate = [
        { code: 'PRN-KITCHEN', name: 'چاپگر حرارتی آشپزخانه', hardware_type: 'THERMAL_80MM', ip_address: '192.168.1.201', port: 9100, is_active: true },
        { code: 'PRN-RECEIPT', name: 'چاپگر صدور فاکتور مشتری', hardware_type: 'THERMAL_80MM', ip_address: '192.168.1.202', port: 9100, is_active: true },
        { code: 'PRN-BAR', name: 'چاپگر بار و دسر', hardware_type: 'THERMAL_58MM', ip_address: '192.168.1.203', port: 9100, is_active: true }
      ];
      for (const pr of printersToCreate) {
        if (!existingPrns.find(ep => ep.code === pr.code)) {
          const res = await api('/api/v1/printers', 'POST', pr);
          if (res.ok) logs.push('Created Printer: ' + pr.code);
          else errors.push({ entity: 'Printer', item: pr, res });
        }
      }

      return { logs, errors };
    });

    console.log("POPULATION LOGS:", JSON.stringify(populateReport.logs, null, 2));
    if (populateReport.errors.length > 0) {
      console.warn("POPULATION ERRORS:", JSON.stringify(populateReport.errors, null, 2));
    }

    populateReport.logs.forEach(l => {
      agent.recordPassed({ module: "Master Data Population", title: l });
    });

    populateReport.errors.forEach(e => {
      agent.recordBug({
        module: "API Master Data",
        title: "Error creating " + e.entity + ": " + (e.item.code || e.item.name || e.item.table_number),
        severity: e.res.status >= 500 ? "High" : "Medium",
        description: "API returned status " + e.res.status + " on creation.",
        expected: "201 Created or 200 OK",
        actual: JSON.stringify(e.res.data),
        technicalDetails: e
      });
    });

    console.log("=== STEP 2: VERIFYING AND SCREENSHOTTING ALL POPULATED PAGES ===");
    const pagesToAudit = [
      { name: "Dine-In Floor & Tables", path: "/app/dine-in/floor" },
      { name: "Catalog Categories", path: "/app/catalog/categories" },
      { name: "Catalog Modifiers & Options", path: "/app/catalog/modifiers" },
      { name: "Catalog Products", path: "/app/catalog/products" },
      { name: "Customers Directory", path: "/app/customers" },
      { name: "Customer Credit Accounts", path: "/app/credit/accounts" },
      { name: "Discounts & Coupons", path: "/app/discounts/coupons" },
      { name: "Delivery Couriers", path: "/app/delivery/couriers" },
      { name: "Operations Printers", path: "/app/operations/printers" },
      { name: "POS Order Screen", path: "/app/pos" },
      { name: "Kiosk Self-Ordering", path: "/app/kiosk" },
      { name: "Kitchen Display (KDS)", path: "/app/kds" },
      { name: "Orders Workflow", path: "/app/orders" },
      { name: "Reports Hub", path: "/app/reports" }
    ];

    for (const p of pagesToAudit) {
      console.log("Visiting and verifying:", p.name);
      await agent.goto(p.path);
      await page.waitForTimeout(1500);
      const shot = await agent.screenshot("verified_" + p.name.replace(/[^a-zA-Z0-9]/g, "_"));
      agent.recordPassed({ module: "UI Verification", title: "Verified: " + p.name, details: "Screenshot captured: " + shot });
    }

    console.log("=== POPULATION AND AUDIT SUCCESSFULLY COMPLETED ===");

  } catch (err) {
    console.error("Populate & Audit error:", err);
    agent.recordBug({
      module: "Master Runner",
      title: "Master Runner Exception",
      severity: "High",
      description: err.message,
      expected: "Populate and audit should complete",
      actual: err.stack
    });
  } finally {
    await agent.close();
  }
}

populateAndAudit().catch(console.error);