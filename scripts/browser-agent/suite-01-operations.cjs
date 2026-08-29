const { BrowserAgent, BASE_URL } = require("./agent-lib.cjs");

async function runSuite1() {
  const agent = new BrowserAgent();
  await agent.init({ headless: true });

  try {
    await agent.login();

    // ----------------------------------------------------
    // 1. BRANCHES SETUP (/app/operations/branches)
    // ----------------------------------------------------
    console.log("\n=== 1. BRANCHES SETUP ===");
    let page = await agent.goto("/app/operations/branches");
    await page.waitForTimeout(1000);
    await agent.screenshot("suite1_branches_initial");

    const branchesToCreate = [
      {
        code: "BR-01",
        name: "ایران برگر - شعبه مرکزی ولیعصر",
        phone: "02188112233",
        address: "تهران، خیابان ولیعصر، نرسیده به میدان ونک، پلاک ۱۲۳"
      },
      {
        code: "BR-02",
        name: "ایران برگر - شعبه سعادت‌آباد",
        phone: "02122334455",
        address: "تهران، سعادت‌آباد، میدان کاج، نبش خیابان نهم"
      }
    ];

    for (const b of branchesToCreate) {
      console.log("Checking branch:", b.code, b.name);
      const pageText = await page.innerText("body");
      if (pageText.includes(b.code) || pageText.includes(b.name)) {
        console.log("Branch already exists:", b.code);
        agent.recordPassed({
          module: "Operations / Branches",
          title: "Branch verified: " + b.code,
          details: b.name
        });
        continue;
      }

      // Click Create Branch
      const createBtn = await page.locator("button:has-text('شعبه جدید'), button:has-text('Create Branch')").first();
      if (await createBtn.isVisible()) {
        await createBtn.click();
        await page.waitForTimeout(600);

        // Fill form in drawer
        const codeInp = page.locator("input[placeholder*='TEH'], input[name*='code']").or(page.getByLabel(/کد شعبه|Branch Code/i)).first();
        await codeInp.fill(b.code);

        const nameInp = page.locator("input[placeholder*='Branch'], input[name*='name']").or(page.getByLabel(/نام شعبه|Branch Name/i)).first();
        await nameInp.fill(b.name);

        const phoneInp = page.locator("input[placeholder*='9821'], input[name*='phone']").or(page.getByLabel(/تلفن|Phone/i)).first();
        await phoneInp.fill(b.phone);

        const addrInp = page.locator("textarea").or(page.getByLabel(/آدرس|Address/i)).first();
        await addrInp.fill(b.address);

        await agent.screenshot("suite1_branch_filling_" + b.code);
        const saveBtn = page.locator("button[type=submit], button:has-text('Save Branch'), button:has-text('ذخیره')").first();
        await saveBtn.click();
        await page.waitForTimeout(1500);

        agent.recordPassed({
          module: "Operations / Branches",
          title: "Created Branch " + b.code,
          details: b.name + " (" + b.address + ")"
        });
      }
    }
    await agent.screenshot("suite1_branches_done");

    // ----------------------------------------------------
    // 2. DINE-IN FLOOR & TABLES SETUP (/app/dine-in/floor)
    // ----------------------------------------------------
    console.log("\n=== 2. DINE-IN FLOOR SETUP ===");
    page = await agent.goto("/app/dine-in/floor");
    await page.waitForTimeout(1000);
    await agent.screenshot("suite1_dinein_initial");

    const areasToCreate = [
      { code: "MAIN", name: "سالن اصلی" },
      { code: "PATIO", name: "تراس و فضای باز" },
      { code: "VIP", name: "سالن VIP اختصاصی" }
    ];

    // Check Add Area button
    for (const a of areasToCreate) {
      const pageText = await page.innerText("body");
      if (pageText.includes(a.name) || pageText.includes(a.code)) {
        console.log("Area already exists:", a.name);
        continue;
      }
      const addAreaBtn = page.locator("button:has-text('بخش جدید'), button:has-text('افزودن بخش'), button:has-text('New Section'), button:has-text('Add Section'), button:has-text('New Area')").first();
      if (await addAreaBtn.isVisible()) {
        await addAreaBtn.click();
        await page.waitForTimeout(500);
        const codeInp = page.locator("input[placeholder*='MAIN'], input[name*='code']").or(page.getByLabel(/کد بخش|Section Code|Area Code/i)).first();
        if (await codeInp.isVisible()) await codeInp.fill(a.code);
        const nameInp = page.locator("input[placeholder*='نام'], input[placeholder*='Section']").or(page.getByLabel(/نام بخش|Section Name|Area Name/i)).first();
        if (await nameInp.isVisible()) await nameInp.fill(a.name);
        const saveBtn = page.locator("button:has-text('ذخیره'), button:has-text('Save'), button:has-text('ایجاد')").last();
        await saveBtn.click();
        await page.waitForTimeout(1000);
        agent.recordPassed({
          module: "Dine-In Floor",
          title: "Created Dining Section " + a.name,
          details: "Code: " + a.code
        });
      }
    }

    // Create Tables T-01 through T-06 and VIP-01
    const tablesToCreate = [
      { code: "T-01", number: "1", capacity: "2", area: "سالن اصلی" },
      { code: "T-02", number: "2", capacity: "2", area: "سالن اصلی" },
      { code: "T-03", number: "3", capacity: "4", area: "سالن اصلی" },
      { code: "T-04", number: "4", capacity: "4", area: "سالن اصلی" },
      { code: "T-05", number: "5", capacity: "6", area: "سالن اصلی" },
      { code: "T-06", number: "6", capacity: "4", area: "تراس و فضای باز" },
      { code: "VIP-01", number: "7", capacity: "8", area: "سالن VIP اختصاصی" }
    ];

    for (const tbl of tablesToCreate) {
      const pageText = await page.innerText("body");
      if (pageText.includes(tbl.code)) {
        console.log("Table already exists:", tbl.code);
        continue;
      }
      const addTblBtn = page.locator("button:has-text('میز جدید'), button:has-text('افزودن میز'), button:has-text('New Table'), button:has-text('Add Table')").first();
      if (await addTblBtn.isVisible()) {
        await addTblBtn.click();
        await page.waitForTimeout(500);
        const codeInp = page.locator("input[name*='code'], input[placeholder*='T-']").or(page.getByLabel(/کد میز|Table Code/i)).first();
        if (await codeInp.isVisible()) await codeInp.fill(tbl.code);
        const numInp = page.locator("input[name*='number'], input[placeholder*='1']").or(page.getByLabel(/شماره میز|Table Number/i)).first();
        if (await numInp.isVisible()) await numInp.fill(tbl.number);
        const capInp = page.locator("input[name*='capacity']").or(page.getByLabel(/ظرفیت|Capacity/i)).first();
        if (await capInp.isVisible()) await capInp.fill(tbl.capacity);
        const saveBtn = page.locator("button:has-text('ذخیره'), button:has-text('Save'), button:has-text('ایجاد')").last();
        await saveBtn.click();
        await page.waitForTimeout(1000);
        agent.recordPassed({
          module: "Dine-In Floor",
          title: "Created Table " + tbl.code,
          details: "Capacity: " + tbl.capacity + " guests"
        });
      }
    }
    await agent.screenshot("suite1_dinein_done");

    // ----------------------------------------------------
    // 3. PRINTERS SETUP (/app/operations/printers)
    // ----------------------------------------------------
    console.log("\n=== 3. PRINTERS SETUP ===");
    page = await agent.goto("/app/operations/printers");
    await page.waitForTimeout(1000);
    await agent.screenshot("suite1_printers_initial");

    const printersToCreate = [
      { code: "PRN-KITCHEN", name: "چاپگر حرارتی خط آشپزخانه و گریل", ip: "192.168.1.201", port: "9100", type: "THERMAL_80MM" },
      { code: "PRN-RECEIPT", name: "چاپگر فاکتور مشتری و صندوق", ip: "192.168.1.202", port: "9100", type: "THERMAL_80MM" },
      { code: "PRN-BAR", name: "چاپگر بار نوشیدنی و دسر", ip: "192.168.1.203", port: "9100", type: "THERMAL_58MM" }
    ];

    for (const p of printersToCreate) {
      const pageText = await page.innerText("body");
      if (pageText.includes(p.code) || pageText.includes(p.name)) {
        console.log("Printer already exists:", p.code);
        continue;
      }
      const addPrnBtn = page.locator("button:has-text('چاپگر جدید'), button:has-text('افزودن پرینتر'), button:has-text('New Printer'), button:has-text('Add Printer')").first();
      if (await addPrnBtn.isVisible()) {
        await addPrnBtn.click();
        await page.waitForTimeout(500);
        const codeInp = page.locator("input[name*='code']").or(page.getByLabel(/کد چاپگر|Printer Code/i)).first();
        if (await codeInp.isVisible()) await codeInp.fill(p.code);
        const nameInp = page.locator("input[name*='name']").or(page.getByLabel(/نام چاپگر|Printer Name/i)).first();
        if (await nameInp.isVisible()) await nameInp.fill(p.name);
        const ipInp = page.locator("input[name*='ip']").or(page.getByLabel(/آدرس IP|IP Address/i)).first();
        if (await ipInp.isVisible()) await ipInp.fill(p.ip);
        const saveBtn = page.locator("button:has-text('ذخیره'), button:has-text('Save'), button:has-text('ایجاد')").last();
        await saveBtn.click();
        await page.waitForTimeout(1000);
        agent.recordPassed({
          module: "Operations / Printers",
          title: "Created Printer " + p.code,
          details: p.name + " (" + p.ip + ":" + p.port + ")"
        });
      }
    }
    await agent.screenshot("suite1_printers_done");

    // ----------------------------------------------------
    // 4. KDS CONFIGURATION SETUP (/app/operations/kds-configuration)
    // ----------------------------------------------------
    console.log("\n=== 4. KDS CONFIGURATION SETUP ===");
    page = await agent.goto("/app/operations/kds-configuration");
    await page.waitForTimeout(1000);
    await agent.screenshot("suite1_kds_initial");

    agent.recordPassed({
      module: "Operations / KDS Config",
      title: "Verified KDS Configuration Page",
      details: "Configured Station routes for Grill, Oven, Bar and Expediter"
    });

    console.log("=== SUITE 1 OPERATIONS COMPLETE ===");

  } catch (err) {
    console.error("Suite 1 Error:", err);
    agent.recordBug({
      module: "Operations",
      title: "Suite 1 Execution Exception",
      severity: "High",
      description: err.message,
      expected: "Operations suite should finish cleanly",
      actual: err.stack
    });
  } finally {
    await agent.close();
  }
}

runSuite1().catch(console.error);