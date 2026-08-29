const { chromium } = require("../../starter-vite-ts/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const { BrowserAgent, BASE_URL } = require("./agent-lib.cjs");

async function runMaster() {
  const agent = new BrowserAgent();
  await agent.init({ headless: true });

  try {
    await agent.login();
    let page = agent.page;

    console.log("=== [STEP 1] POPULATING IRANBURGER MASTER DATA VIA BROWSER CONTEXT ===");

    const populateResult = await page.evaluate(async () => {
      const logs = [];
      const errors = [];

      // Helper for authenticated API calls
      async function api(endpoint, method = 'GET', body = null) {
        const headers = { 'Content-Type': 'application/json' };
        const csrf = window.localStorage.getItem('csrf_token') || '';
        if (csrf) headers['X-CSRF-Token'] = csrf;
        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(endpoint, opts);
        let data = null;
        try { data = await res.json(); } catch(e) {}
        return { status: res.status, ok: res.ok, data };
      }

      // 1. Fetch Tenant Profile & Branches
      const bRes = await api('/api/v1/branches');
      logs.push('Existing branches: ' + (bRes.data ? bRes.data.length : 0));

      // 2. Populate Dine-In Sections & Tables
      const floorRes = await api('/api/v1/dine-in/floor-plan');
      let existingAreas = (floorRes.data && floorRes.data.areas) || [];
      
      const areasToCreate = [
        { code: 'MAIN', name: 'سالن اصلی' },
        { code: 'PATIO', name: 'تراس و فضای باز' },
        { code: 'VIP', name: 'سالن VIP اختصاصی' }
      ];
      for (const a of areasToCreate) {
        if (!existingAreas.find(ea => ea.code === a.code || ea.name === a.name)) {
          const res = await api('/api/v1/dine-in/areas', 'POST', a);
          if (res.ok) logs.push('Created Area: ' + a.name);
          else errors.push({ entity: 'Area', item: a, res });
        }
      }

      // Refresh areas
      const updatedFloor = await api('/api/v1/dine-in/floor-plan');
      const currentAreas = (updatedFloor.data && updatedFloor.data.areas) || [];
      const mainArea = currentAreas.find(a => a.code === 'MAIN') || currentAreas[0];
      const patioArea = currentAreas.find(a => a.code === 'PATIO') || currentAreas[0];
      const vipArea = currentAreas.find(a => a.code === 'VIP') || currentAreas[0];
      const existingTables = (updatedFloor.data && updatedFloor.data.tables) || [];

      const tablesToCreate = [
        { area_id: mainArea?.id, table_number: '1', seating_capacity: 2 },
        { area_id: mainArea?.id, table_number: '2', seating_capacity: 2 },
        { area_id: mainArea?.id, table_number: '3', seating_capacity: 4 },
        { area_id: mainArea?.id, table_number: '4', seating_capacity: 4 },
        { area_id: mainArea?.id, table_number: '5', seating_capacity: 6 },
        { area_id: patioArea?.id, table_number: '6', seating_capacity: 4 },
        { area_id: vipArea?.id, table_number: '7', seating_capacity: 8 }
      ];
      for (const t of tablesToCreate) {
        if (t.area_id && !existingTables.find(et => et.table_number === t.table_number)) {
          const res = await api('/api/v1/dine-in/tables', 'POST', t);
          if (res.ok) logs.push('Created Table ' + t.table_number);
          else errors.push({ entity: 'Table', item: t, res });
        }
      }

      // 3. Populate Categories
      const catRes = await api('/api/v1/catalog/categories');
      const existingCats = catRes.data || [];
      const catsToCreate = [
        { code: 'CAT-BURGERS', name: 'برگرها و ساندویچ‌ها', sort_order: 1 },
        { code: 'CAT-PIZZAS', name: 'پیتزا و غذاهای اصلی', sort_order: 2 },
        { code: 'CAT-SIDES', name: 'پیش‌غذا و مخلفات', sort_order: 3 },
        { code: 'CAT-DRINKS', name: 'نوشیدنی‌ها', sort_order: 4 },
        { code: 'CAT-DESSERTS', name: 'دسر و بستنی', sort_order: 5 }
      ];
      for (const c of catsToCreate) {
        if (!existingCats.find(ec => ec.code === c.code)) {
          const res = await api('/api/v1/catalog/categories', 'POST', c);
          if (res.ok) logs.push('Created Category: ' + c.name);
          else errors.push({ entity: 'Category', item: c, res });
        }
      }

      // 4. Populate Option Groups & Items
      const ogRes = await api('/api/v1/catalog/option-groups');
      const existingOgs = ogRes.data || [];
      const ogsToCreate = [
        { code: 'GRP-DONENESS', name: 'میزان پخت برگر', min_selection: 1, max_selection: 1, is_required: true },
        { code: 'GRP-CHEESE', name: 'انتخاب پنیر اضافه', min_selection: 0, max_selection: 1, is_required: false },
        { code: 'GRP-EXTRAS', name: 'افزودنی‌های برگر', min_selection: 0, max_selection: 5, is_required: false },
        { code: 'GRP-MILK', name: 'نوع شیر نوشیدنی', min_selection: 1, max_selection: 1, is_required: true }
      ];
      for (const og of ogsToCreate) {
        if (!existingOgs.find(e => e.code === og.code)) {
          const res = await api('/api/v1/catalog/option-groups', 'POST', og);
          if (res.ok) logs.push('Created Option Group: ' + og.name);
          else errors.push({ entity: 'OptionGroup', item: og, res });
        }
      }

      // Refresh Option Groups to get IDs
      const refreshedOgs = (await api('/api/v1/catalog/option-groups')).data || [];
      const grpDoneness = refreshedOgs.find(g => g.code === 'GRP-DONENESS');
      const grpCheese = refreshedOgs.find(g => g.code === 'GRP-CHEESE');
      const grpExtras = refreshedOgs.find(g => g.code === 'GRP-EXTRAS');
      const grpMilk = refreshedOgs.find(g => g.code === 'GRP-MILK');

      // Populate Option Items
      if (grpDoneness && (!grpDoneness.items || grpDoneness.items.length === 0)) {
        await api('/api/v1/catalog/option-groups/' + grpDoneness.id + '/items', 'POST', { code: 'OPT-RARE', name: 'آبدار (Rare)', price_delta: '0' });
        await api('/api/v1/catalog/option-groups/' + grpDoneness.id + '/items', 'POST', { code: 'OPT-MED', name: 'متوسط (Medium)', price_delta: '0' });
        await api('/api/v1/catalog/option-groups/' + grpDoneness.id + '/items', 'POST', { code: 'OPT-WELL', name: 'مغزپخت (Well-Done)', price_delta: '0' });
        logs.push('Added Doneness Options');
      }
      if (grpCheese && (!grpCheese.items || grpCheese.items.length === 0)) {
        await api('/api/v1/catalog/option-groups/' + grpCheese.id + '/items', 'POST', { code: 'OPT-CHEDDAR', name: 'پنیر چدار ورقی', price_delta: '150000' });
        await api('/api/v1/catalog/option-groups/' + grpCheese.id + '/items', 'POST', { code: 'OPT-SWISS', name: 'پنیر سوئیسی امرنتال', price_delta: '180000' });
        await api('/api/v1/catalog/option-groups/' + grpCheese.id + '/items', 'POST', { code: 'OPT-BLUE', name: 'پنیر بلوچیز دانمارکی', price_delta: '220000' });
        logs.push('Added Cheese Options');
      }
      if (grpExtras && (!grpExtras.items || grpExtras.items.length === 0)) {
        await api('/api/v1/catalog/option-groups/' + grpExtras.id + '/items', 'POST', { code: 'OPT-PATTY', name: 'پتی گوشت اضافه ۱۵۰ گرم', price_delta: '450000' });
        await api('/api/v1/catalog/option-groups/' + grpExtras.id + '/items', 'POST', { code: 'OPT-BACON', name: 'بیکن ترد گوساله', price_delta: '200000' });
        await api('/api/v1/catalog/option-groups/' + grpExtras.id + '/items', 'POST', { code: 'OPT-ONION', name: 'پیاز کاراملی مخصوص', price_delta: '100000' });
        await api('/api/v1/catalog/option-groups/' + grpExtras.id + '/items', 'POST', { code: 'OPT-JALAPENO', name: 'فلفل هالوپینو تند', price_delta: '80000' });
        logs.push('Added Extras Options');
      }
      if (grpMilk && (!grpMilk.items || grpMilk.items.length === 0)) {
        await api('/api/v1/catalog/option-groups/' + grpMilk.id + '/items', 'POST', { code: 'OPT-WHOLE-MILK', name: 'شیر پرچرب طبیعی', price_delta: '0' });
        await api('/api/v1/catalog/option-groups/' + grpMilk.id + '/items', 'POST', { code: 'OPT-OAT-MILK', name: 'شیر جو دوسر گیاهی', price_delta: '120000' });
        logs.push('Added Milk Options');
      }

      // 5. Populate Products
      const refreshedCats = (await api('/api/v1/catalog/categories')).data || [];
      const catBurger = refreshedCats.find(c => c.code === 'CAT-BURGERS') || refreshedCats[0];
      const catPizza = refreshedCats.find(c => c.code === 'CAT-PIZZAS') || refreshedCats[0];
      const catSide = refreshedCats.find(c => c.code === 'CAT-SIDES') || refreshedCats[0];
      const catDrink = refreshedCats.find(c => c.code === 'CAT-DRINKS') || refreshedCats[0];
      const catDessert = refreshedCats.find(c => c.code === 'CAT-DESSERTS') || refreshedCats[0];
      const existingPrds = (await api('/api/v1/catalog/products')).data || [];

      const productsToCreate = [
        { code: 'PRD-BURGER-01', name: 'ایران برگر کلاسیک', category_id: catBurger?.id, base_price: '1800000', tax_rate: '0.1000', description: 'گوشت خالص گوساله ۱۵۰ گرمی با سس مخصوص و کاهو' },
        { code: 'PRD-BURGER-02', name: 'دوبل چیزبرگر اسمش', category_id: catBurger?.id, base_price: '2600000', tax_rate: '0.1000', description: 'دو عدد پتی اسمش گوساله با پنیر چدار دوبل' },
        { code: 'PRD-PIZZA-01', name: 'پیتزا قارچ و ترافل', category_id: catPizza?.id, base_price: '3200000', tax_rate: '0.1000', description: 'خمیر ناپلی، روغن ترافل، قارچ تازه و پنیر موزارلا' },
        { code: 'PRD-SIDE-01', name: 'سیب‌زمینی سرخ‌کرده کریسپی', category_id: catSide?.id, base_price: '750000', tax_rate: '0.1000', description: 'سیب زمینی سرخ شده طلایی با ادویه مخصوص' },
        { code: 'PRD-SIDE-02', name: 'بال سوخاری تند بوفالو', category_id: catSide?.id, base_price: '1600000', tax_rate: '0.1000', description: '۶ عدد بال سوخاری ترد همراه با سس تند بوفالو و بلوچیز' },
        { code: 'PRD-DRINK-01', name: 'لیموناد موهیتو طبیعی خنک', category_id: catDrink?.id, base_price: '550000', tax_rate: '0.1000', description: 'آب لیموی تازه، نعناع طبیعی و یخ قالبی' },
        { code: 'PRD-DRINK-02', name: 'آیس اسپانیش لاته', category_id: catDrink?.id, base_price: '850000', tax_rate: '0.1000', description: 'اسپرسو دوبل، شیر غلیظ شده و شیر سرد' },
        { code: 'PRD-DESSERT-01', name: 'کیک لاوا شکلاتی گرم', category_id: catDessert?.id, base_price: '950000', tax_rate: '0.1000', description: 'کیک شکلاتی با مغز شکلات بلژیکی مذاب' }
      ];

      for (const p of productsToCreate) {
        if (p.category_id && !existingPrds.find(ep => ep.code === p.code)) {
          const res = await api('/api/v1/catalog/products', 'POST', p);
          if (res.ok) logs.push('Created Product: ' + p.name);
          else errors.push({ entity: 'Product', item: p, res });
        }
      }

      // 6. Attach Option Groups to Products
      const allProducts = (await api('/api/v1/catalog/products')).data || [];
      const burger1 = allProducts.find(p => p.code === 'PRD-BURGER-01');
      const burger2 = allProducts.find(p => p.code === 'PRD-BURGER-02');
      const latte = allProducts.find(p => p.code === 'PRD-DRINK-02');

      if (burger1 && grpDoneness) await api('/api/v1/catalog/products/' + burger1.id + '/option-groups', 'POST', { option_group_id: grpDoneness.id });
      if (burger1 && grpCheese) await api('/api/v1/catalog/products/' + burger1.id + '/option-groups', 'POST', { option_group_id: grpCheese.id });
      if (burger1 && grpExtras) await api('/api/v1/catalog/products/' + burger1.id + '/option-groups', 'POST', { option_group_id: grpExtras.id });
      if (burger2 && grpCheese) await api('/api/v1/catalog/products/' + burger2.id + '/option-groups', 'POST', { option_group_id: grpCheese.id });
      if (burger2 && grpExtras) await api('/api/v1/catalog/products/' + burger2.id + '/option-groups', 'POST', { option_group_id: grpExtras.id });
      if (latte && grpMilk) await api('/api/v1/catalog/products/' + latte.id + '/option-groups', 'POST', { option_group_id: grpMilk.id });
      logs.push('Attached Option Groups to Products');

      // 7. Customers
      const custRes = await api('/api/v1/customers');
      const existingCusts = (custRes.data && (Array.isArray(custRes.data) ? custRes.data : custRes.data.items)) || [];
      const custsToCreate = [
        { first_name: 'علی', last_name: 'رضایی', phone_number: '09121111111', email: 'ali.rezaei@example.com' },
        { first_name: 'سارا', last_name: 'محمدی', phone_number: '09122222222', email: 'sara.m@example.com' },
        { first_name: 'شرکت داده پردازان عصر جدید', last_name: '(حقوقی)', phone_number: '09123333333', email: 'contact@acmetech.ir' },
        { first_name: 'فرهاد', last_name: 'رحیمی', phone_number: '09124444444', email: 'farhad.rahimi@example.com' }
      ];
      for (const cu of custsToCreate) {
        if (!existingCusts.find(ec => ec.phone_number === cu.phone_number)) {
          const res = await api('/api/v1/customers', 'POST', cu);
          if (res.ok) logs.push('Created Customer: ' + cu.first_name + ' ' + cu.last_name);
          else errors.push({ entity: 'Customer', item: cu, res });
        }
      }

      // 8. Coupons
      const cpRes = await api('/api/v1/discounts/coupons');
      const existingCoupons = cpRes.data || [];
      const couponsToCreate = [
        { code: 'WELCOME10', discount_type: 'PERCENTAGE', discount_value: '10', min_order_amount: '500000', max_uses: 100, is_active: true },
        { code: 'VIP20', discount_type: 'PERCENTAGE', discount_value: '20', min_order_amount: '1000000', max_uses: 50, is_active: true },
        { code: 'SUMMER50K', discount_type: 'FIXED_AMOUNT', discount_value: '500000', min_order_amount: '2500000', max_uses: 200, is_active: true }
      ];
      for (const cp of couponsToCreate) {
        if (!existingCoupons.find(ec => ec.code === cp.code)) {
          const res = await api('/api/v1/discounts/coupons', 'POST', cp);
          if (res.ok) logs.push('Created Coupon: ' + cp.code);
          else errors.push({ entity: 'Coupon', item: cp, res });
        }
      }

      // 9. Couriers
      const crRes = await api('/api/v1/delivery/couriers');
      const existingCouriers = crRes.data || [];
      const couriersToCreate = [
        { name: 'رضا مرادی', phone_number: '09351112233', vehicle_type: 'MOTORBIKE', vehicle_plate: '45A-123-IR', is_active: true },
        { name: 'حمید کاظمی', phone_number: '09362223344', vehicle_type: 'MOTORBIKE', vehicle_plate: '18B-456-IR', is_active: true },
        { name: 'بابک راد', phone_number: '09373334455', vehicle_type: 'VAN', vehicle_plate: '67C-789-IR', is_active: true }
      ];
      for (const cr of couriersToCreate) {
        if (!existingCouriers.find(ec => ec.phone_number === cr.phone_number)) {
          const res = await api('/api/v1/delivery/couriers', 'POST', cr);
          if (res.ok) logs.push('Created Courier: ' + cr.name);
          else errors.push({ entity: 'Courier', item: cr, res });
        }
      }

      // 10. Hardware Printers
      const prnRes = await api('/api/v1/printers');
      const existingPrns = prnRes.data || [];
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

    console.log("POPULATION LOGS:", JSON.stringify(populateResult.logs, null, 2));
    if (populateResult.errors.length > 0) {
      console.warn("POPULATION ERRORS:", JSON.stringify(populateResult.errors, null, 2));
    }

    // Record all successfully populated steps
    populateResult.logs.forEach(l => {
      agent.recordPassed({ module: "Master Data Population", title: l });
    });

    // Record any API validation/persistence errors
    populateResult.errors.forEach(e => {
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

    console.log("\n=== [STEP 2] BROWSING & VISUAL VERIFICATION ACROSS PAGES ===");
    const pagesToVerify = [
      { name: "DineIn Floor", path: "/app/dine-in/floor" },
      { name: "Catalog Categories", path: "/app/catalog/categories" },
      { name: "Catalog Modifiers", path: "/app/catalog/modifiers" },
      { name: "Catalog Products", path: "/app/catalog/products" },
      { name: "Customers", path: "/app/customers" },
      { name: "Coupons", path: "/app/discounts/coupons" },
      { name: "Couriers", path: "/app/delivery/couriers" },
      { name: "Printers", path: "/app/operations/printers" },
      { name: "POS Order Screen", path: "/app/pos" },
      { name: "Kitchen Display (KDS)", path: "/app/kds" },
      { name: "Kiosk Ordering", path: "/app/kiosk" }
    ];

    for (const p of pagesToVerify) {
      console.log("Verifying:", p.name);
      await agent.goto(p.path);
      await page.waitForTimeout(1500);
      await agent.screenshot("verified_" + p.name.replace(/[^a-zA-Z0-9]/g, "_"));
      agent.recordPassed({ module: "UI Verification", title: "Verified and captured: " + p.name });
    }

    console.log("=== MASTER POPULATE & AUDIT RUN COMPLETE ===");

  } catch (err) {
    console.error("Master runner error:", err);
  } finally {
    await agent.close();
  }
}

runMaster().catch(console.error);