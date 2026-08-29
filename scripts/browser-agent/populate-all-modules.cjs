const { chromium } = require("../../starter-vite-ts/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const { BrowserAgent, BASE_URL } = require("./agent-lib.cjs");

async function closeAnyModal(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

async function runPopulate() {
  const agent = new BrowserAgent();
  await agent.init({ headless: true });

  try {
    await agent.login();
    let page = agent.page;

    // ========================================================
    // 1. DINE-IN TABLES SETUP (/app/dine-in/floor)
    // ========================================================
    console.log("\n>>> [1/6] POPULATING DINE-IN TABLES...");
    await agent.goto("/app/dine-in/floor");
    await page.waitForTimeout(1000);

    const tables = [
      { code: "T-01", number: "1", capacity: "2" },
      { code: "T-02", number: "2", capacity: "2" },
      { code: "T-03", number: "3", capacity: "4" },
      { code: "T-04", number: "4", capacity: "4" },
      { code: "T-05", number: "5", capacity: "6" },
      { code: "T-06", number: "6", capacity: "4" },
      { code: "VIP-01", number: "7", capacity: "8" }
    ];

    for (const tbl of tables) {
      let bodyText = await page.innerText("body");
      if (bodyText.includes(tbl.code)) {
        console.log("  Table already present:", tbl.code);
        continue;
      }
      console.log("  Creating table:", tbl.code);
      const addTblBtn = page.locator("button:has-text('میز جدید'), button:has-text('Add Dining Table'), button:has-text('Add Table')").first();
      if (await addTblBtn.isVisible()) {
        await addTblBtn.click();
        await page.waitForTimeout(500);
        // Select Section
        const secSelect = page.locator("div[role=combobox], div.MuiSelect-select").first();
        if (await secSelect.isVisible()) {
          await secSelect.click();
          await page.waitForTimeout(300);
          const firstOpt = page.locator("li[role=option]").first();
          if (await firstOpt.isVisible()) await firstOpt.click();
          await page.waitForTimeout(300);
        }
        // Fill Code
        const codeInp = page.locator("input[placeholder*='T-01'], input[placeholder*='T-']").first();
        if (await codeInp.isVisible()) await codeInp.fill(tbl.code);
        // Fill Number
        const numInp = page.locator("input[placeholder*='1']").first();
        if (await numInp.isVisible()) await numInp.fill(tbl.number);
        // Fill Capacity
        const capInp = page.locator("input[type=number]").first();
        if (await capInp.isVisible()) await capInp.fill(tbl.capacity);
        // Submit
        await page.locator("button[type=submit]").click();
        await page.waitForTimeout(1500);
        await closeAnyModal(page);
        agent.recordPassed({ module: "Dine-In", title: "Created Table " + tbl.code, details: "Capacity: " + tbl.capacity });
      }
    }
    await agent.screenshot("dinein_tables_populated");

    // ========================================================
    // 2. CATALOG CATEGORIES (/app/catalog/categories)
    // ========================================================
    console.log("\n>>> [2/6] POPULATING CATALOG CATEGORIES...");
    await agent.goto("/app/catalog/categories");
    await page.waitForTimeout(1000);

    const categories = [
      { code: "CAT-BURGERS", name: "برگرها و ساندویچ‌ها" },
      { code: "CAT-PIZZAS", name: "پیتزا و غذاهای اصلی" },
      { code: "CAT-SIDES", name: "پیش‌غذا و مخلفات" },
      { code: "CAT-DRINKS", name: "نوشیدنی‌ها" },
      { code: "CAT-DESSERTS", name: "دسر و بستنی" }
    ];

    for (const c of categories) {
      let bodyText = await page.innerText("body");
      if (bodyText.includes(c.code) || bodyText.includes(c.name)) {
        console.log("  Category already present:", c.code);
        continue;
      }
      console.log("  Creating category:", c.code);
      const addCatBtn = page.locator("button:has-text('دسته‌بندی جدید'), button:has-text('Create Category'), button:has-text('افزودن دسته')").first();
      if (await addCatBtn.isVisible()) {
        await addCatBtn.click();
        await page.waitForTimeout(500);
        const codeInp = page.locator("input[placeholder*='CAT'], input[name*='code']").or(page.locator("input")).first();
        await codeInp.fill(c.code);
        const nameInp = page.locator("input[placeholder*='نام'], input[placeholder*='Category']").or(page.locator("input").nth(1)).first();
        await nameInp.fill(c.name);
        await page.locator("button[type=submit]").click();
        await page.waitForTimeout(1500);
        await closeAnyModal(page);
        agent.recordPassed({ module: "Catalog / Categories", title: "Created Category " + c.code, details: c.name });
      }
    }
    await agent.screenshot("categories_populated");

    // ========================================================
    // 3. CATALOG MODIFIERS / OPTIONS (/app/catalog/modifiers)
    // ========================================================
    console.log("\n>>> [3/6] POPULATING CATALOG MODIFIERS & OPTION GROUPS...");
    await agent.goto("/app/catalog/modifiers");
    await page.waitForTimeout(1000);

    const optionGroups = [
      { code: "GRP-DONENESS", name: "میزان پخت برگر" },
      { code: "GRP-CHEESE", name: "انتخاب پنیر اضافه" },
      { code: "GRP-EXTRAS", name: "افزودنی‌های برگر" },
      { code: "GRP-MILK", name: "نوع شیر نوشیدنی" }
    ];

    for (const g of optionGroups) {
      let bodyText = await page.innerText("body");
      if (bodyText.includes(g.code) || bodyText.includes(g.name)) {
        console.log("  Option Group already present:", g.code);
        continue;
      }
      console.log("  Creating option group:", g.code);
      const addGrpBtn = page.locator("button:has-text('گروه انتخاب جدید'), button:has-text('Create Group'), button:has-text('افزودن گروه')").first();
      if (await addGrpBtn.isVisible()) {
        await addGrpBtn.click();
        await page.waitForTimeout(500);
        const codeInp = page.locator("input[placeholder*='GRP'], input[name*='code']").or(page.locator("input")).first();
        await codeInp.fill(g.code);
        const nameInp = page.locator("input[placeholder*='نام'], input[placeholder*='Group']").or(page.locator("input").nth(1)).first();
        await nameInp.fill(g.name);
        await page.locator("button[type=submit]").click();
        await page.waitForTimeout(1500);
        await closeAnyModal(page);
        agent.recordPassed({ module: "Catalog / Modifiers", title: "Created Option Group " + g.code, details: g.name });
      }
    }
    await agent.screenshot("modifiers_populated");

    // ========================================================
    // 4. CATALOG PRODUCTS (/app/catalog/products)
    // ========================================================
    console.log("\n>>> [4/6] POPULATING PRODUCTS...");
    await agent.goto("/app/catalog/products");
    await page.waitForTimeout(1000);

    const products = [
      { code: "PRD-BURGER-01", name: "ایران برگر کلاسیک", price: "1800000", desc: "برگر مخصوص ایران برگر با گوشت تازه گوساله" },
      { code: "PRD-BURGER-02", name: "دوبل چیزبرگر اسمش", price: "2600000", desc: "دو عدد برگر اسمش لذیذ با پنیر چدار دوبل" },
      { code: "PRD-PIZZA-01", name: "پیتزا قارچ و ترافل", price: "3200000", desc: "پیتزا ایتالیایی مخصوص با روغن ترافل طبیعی" },
      { code: "PRD-SIDE-01", name: "سیب‌زمینی سرخ‌کرده کریسپی", price: "750000", desc: "سیب زمینی سرخ شده ترد طلایی با چاشنی ویژه" },
      { code: "PRD-SIDE-02", name: "بال سوخاری تند بوفالو", price: "1600000", desc: "بال سوخاری ۶ تکه با سس تند بوفالو" },
      { code: "PRD-DRINK-01", name: "لیموناد موهیتو طبیعی", price: "550000", desc: "لیموی تازه، نعناع طبیعی و سودا" },
      { code: "PRD-DRINK-02", name: "آیس اسپانیش لاته", price: "850000", desc: "اسپرسو دوبل با شیر غلیظ شده و یخ" },
      { code: "PRD-DESSERT-01", name: "کیک لاوا شکلاتی", price: "950000", desc: "کیک شکلات بلژیکی گرم با مغز مذاب" }
    ];

    for (const p of products) {
      let bodyText = await page.innerText("body");
      if (bodyText.includes(p.code) || bodyText.includes(p.name)) {
        console.log("  Product already present:", p.code);
        continue;
      }
      console.log("  Creating product:", p.code);
      const addPrdBtn = page.locator("button:has-text('محصول جدید'), button:has-text('Create Product'), button:has-text('افزودن محصول')").first();
      if (await addPrdBtn.isVisible()) {
        await addPrdBtn.click();
        await page.waitForTimeout(600);
        
        // Select Category dropdown
        const catSelect = page.locator("div[role=combobox], div.MuiSelect-select").first();
        if (await catSelect.isVisible()) {
          await catSelect.click();
          await page.waitForTimeout(300);
          const opt = page.locator("li[role=option]").first();
          if (await opt.isVisible()) await opt.click();
          await page.waitForTimeout(300);
        }
        const codeInp = page.locator("input[placeholder*='PRD'], input[name*='code']").first();
        if (await codeInp.isVisible()) await codeInp.fill(p.code);
        const nameInp = page.locator("input[placeholder*='نام'], input[placeholder*='Product']").first();
        if (await nameInp.isVisible()) await nameInp.fill(p.name);
        const priceInp = page.locator("input[placeholder*='1500000'], input[name*='base_price'], input[name*='price']").first();
        if (await priceInp.isVisible()) await priceInp.fill(p.price);
        const descInp = page.locator("textarea").first();
        if (await descInp.isVisible()) await descInp.fill(p.desc);
        await page.locator("button[type=submit]").click();
        await page.waitForTimeout(1500);
        await closeAnyModal(page);
        agent.recordPassed({ module: "Catalog / Products", title: "Created Product " + p.code, details: p.name + " (" + p.price + " IRR)" });
      }
    }
    await agent.screenshot("products_populated");

    // ========================================================
    // 5. CUSTOMERS & CREDIT (/app/customers)
    // ========================================================
    console.log("\n>>> [5/6] POPULATING CUSTOMERS...");
    await agent.goto("/app/customers");
    await page.waitForTimeout(1000);

    const customers = [
      { first: "علی", last: "رضایی", phone: "09121111111", email: "ali.rezaei@example.com" },
      { first: "سارا", last: "محمدی", phone: "09122222222", email: "sara.m@example.com" },
      { first: "شرکت داده پردازان عصر جدید", last: "(حقوقی)", phone: "09123333333", email: "contact@acmetech.ir" },
      { first: "فرهاد", last: "رحیمی", phone: "09124444444", email: "farhad.rahimi@example.com" }
    ];

    for (const c of customers) {
      let bodyText = await page.innerText("body");
      if (bodyText.includes(c.phone) || bodyText.includes(c.first)) {
        console.log("  Customer already present:", c.first, c.last);
        continue;
      }
      console.log("  Creating customer:", c.first, c.last);
      const addCustBtn = page.locator("button:has-text('مشتری جدید'), button:has-text('Create Customer'), button:has-text('افزودن مشتری')").first();
      if (await addCustBtn.isVisible()) {
        await addCustBtn.click();
        await page.waitForTimeout(500);
        const firstInp = page.locator("input[placeholder*='نام'], input[name*='first']").first();
        if (await firstInp.isVisible()) await firstInp.fill(c.first);
        const lastInp = page.locator("input[placeholder*='خانوادگی'], input[name*='last']").first();
        if (await lastInp.isVisible()) await lastInp.fill(c.last);
        const phoneInp = page.locator("input[placeholder*='0912'], input[name*='phone'], input[name*='mobile']").first();
        if (await phoneInp.isVisible()) await phoneInp.fill(c.phone);
        const emailInp = page.locator("input[type=email], input[name*='email']").first();
        if (await emailInp.isVisible()) await emailInp.fill(c.email);
        await page.locator("button[type=submit], button:has-text('ذخیره'), button:has-text('Save')").last().click();
        await page.waitForTimeout(1500);
        await closeAnyModal(page);
        agent.recordPassed({ module: "Customers", title: "Created Customer " + c.first + " " + c.last, details: c.phone });
      }
    }
    await agent.screenshot("customers_populated");

    // ========================================================
    // 6. COUPONS & DISCOUNTS (/app/discounts/coupons)
    // ========================================================
    console.log("\n>>> [6/6] POPULATING COUPONS...");
    await agent.goto("/app/discounts/coupons");
    await page.waitForTimeout(1000);

    const coupons = [
      { code: "WELCOME10", val: "10" },
      { code: "VIP20", val: "20" },
      { code: "SUMMER50K", val: "500000" }
    ];

    for (const cp of coupons) {
      let bodyText = await page.innerText("body");
      if (bodyText.includes(cp.code)) {
        console.log("  Coupon already present:", cp.code);
        continue;
      }
      console.log("  Creating coupon:", cp.code);
      const addCpBtn = page.locator("button:has-text('کوپن جدید'), button:has-text('Create Coupon'), button:has-text('افزودن کوپن')").first();
      if (await addCpBtn.isVisible()) {
        await addCpBtn.click();
        await page.waitForTimeout(500);
        await page.locator("input[placeholder*='WELCOME'], input[name*='code']").first().fill(cp.code);
        const valInp = page.locator("input[name*='value'], input[placeholder*='10']").first();
        if (await valInp.isVisible()) await valInp.fill(cp.val);
        await page.locator("button[type=submit], button:has-text('ذخیره'), button:has-text('Save')").last().click();
        await page.waitForTimeout(1500);
        await closeAnyModal(page);
        agent.recordPassed({ module: "Discounts / Coupons", title: "Created Coupon " + cp.code });
      }
    }
    await agent.screenshot("coupons_populated");

    console.log("\n=== ALL IRANBURGER DATA POPULATED SUCCESSFULLY ===");

  } catch (err) {
    console.error("Populate Error:", err);
    agent.recordBug({
      module: "Data Population",
      title: "Exception during IranBurger Master Data Population",
      severity: "High",
      description: err.message,
      expected: "Data population should complete successfully",
      actual: err.stack
    });
  } finally {
    await agent.close();
  }
}

runPopulate().catch(console.error);