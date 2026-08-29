const { chromium } = require("../../starter-vite-ts/node_modules/playwright");
const path = require("path");
const fs = require("fs");

const BASE_URL = "http://195.234.80.33:8080";
const SCREENSHOTS_DIR = path.join(__dirname, "../../screenshots");

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function runVerification() {
  console.log("==================================================");
  console.log("🚀 Starting IranBurger Live Bug Verification Suite");
  console.log("🎯 Target Environment:", BASE_URL);
  console.log("==================================================");

  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "fa-IR"
  });
  const page = await context.newPage();

  let capturedCsrfToken = "";

  page.on("response", async (res) => {
    if (res.url().includes("/auth/login") && res.status() === 200) {
      try {
        const json = await res.json();
        if (json.csrfToken) {
          capturedCsrfToken = json.csrfToken;
          console.log(" -> Captured CSRF Token from login:", capturedCsrfToken.substring(0, 16) + "...");
        }
      } catch (e) {}
    }
  });

  const results = {
    bug001_branches: false,
    bug002_discounts: false,
    bug003_printers: false,
    bug004_cart_asset: false,
    details: []
  };

  try {
    // ----------------------------------------------------
    // 1. Verify BUG-004: ic-cart.svg Static Asset
    // ----------------------------------------------------
    console.log("\n[TEST 1] Verifying BUG-004: Static Asset ic-cart.svg...");
    const cartRes = await page.request.get(`${BASE_URL}/assets/icons/navbar/ic-cart.svg`);
    console.log(` -> GET /assets/icons/navbar/ic-cart.svg Status: ${cartRes.status()}`);
    if (cartRes.status() === 200) {
      const text = await cartRes.text();
      if (text.includes("<svg") && text.includes("</svg>")) {
        console.log(" -> ✅ BUG-004 PASSED: ic-cart.svg is present and valid SVG!");
        results.bug004_cart_asset = true;
        results.details.push("BUG-004 (Navbar ic-cart.svg): HTTP 200 OK with valid SVG content");
      } else {
        console.error(" -> ❌ BUG-004 FAILED: ic-cart.svg is not SVG content");
      }
    } else {
      console.error(` -> ❌ BUG-004 FAILED: HTTP status ${cartRes.status()}`);
    }

    // ----------------------------------------------------
    // Login to Application
    // ----------------------------------------------------
    console.log("\n[AUTH] Logging in as admin@gnext.local...");
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("input[type=password]", { timeout: 15000 });
    await page.locator("input").first().fill("admin@gnext.local");
    await page.locator("input[type=password]").fill("GnextDemo!2026");
    await page.click("button[type=submit]");
    await page.waitForTimeout(3000);
    console.log(" -> Logged in successfully. Current URL:", page.url());

    // ----------------------------------------------------
    // 2. Verify BUG-001: Branch Creation & Operating Hours (POST /api/v1/branches)
    // ----------------------------------------------------
    console.log("\n[TEST 2] Verifying BUG-001: Branch Creation & Operating Hours...");
    await page.goto(`${BASE_URL}/app/operations/branches`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "verify_bug001_branches_page.png"), fullPage: true });

    const branchCode = `BR-V-${Date.now().toString().slice(-4)}`;
    const branchCreationRes = await page.evaluate(async ({ bCode, csrf }) => {
      const res = await fetch("/api/v1/branches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf
        },
        body: JSON.stringify({
          code: bCode,
          name: `شعبه تست اعتبارسنجی ${bCode}`,
          phone: "021-88776655",
          address: "تهران، خیابان ولیعصر، پلاک ۱۰۰",
          time_zone: "Asia/Tehran"
        })
      });
      const data = await res.json();
      return { status: res.status, data };
    }, { bCode: branchCode, csrf: capturedCsrfToken });

    console.log(` -> POST /api/v1/branches status: ${branchCreationRes.status}`);
    if (branchCreationRes.status === 201 || branchCreationRes.status === 200) {
      console.log(" -> ✅ Branch created successfully:", branchCreationRes.data.code);

      // Verify operating hours for the created branch
      const hoursRes = await page.evaluate(async (branchId) => {
        const res = await fetch(`/api/v1/branches/${branchId}/operating-hours`);
        const data = await res.json();
        return { status: res.status, count: Array.isArray(data) ? data.length : 0 };
      }, branchCreationRes.data.id);

      console.log(` -> GET /api/v1/branches/${branchCreationRes.data.id}/operating-hours Status: ${hoursRes.status}, Rows: ${hoursRes.count}`);
      if (hoursRes.status === 200 && hoursRes.count === 7) {
        console.log(" -> ✅ BUG-001 PASSED: Branch created and all 7 operating hours initialized without error!");
        results.bug001_branches = true;
        results.details.push("BUG-001 (Branch Creation & Operating Hours): HTTP 201 Created with 7 days operating hours");
      } else {
        console.error(" -> ❌ BUG-001 FAILED: Operating hours initialization failed", hoursRes);
      }
    } else {
      console.error(" -> ❌ BUG-001 FAILED: POST /api/v1/branches returned error:", branchCreationRes);
    }

    // ----------------------------------------------------
    // 3. Verify BUG-002: Discounts Retrieval (GET /api/v1/discounts)
    // ----------------------------------------------------
    console.log("\n[TEST 3] Verifying BUG-002: Discounts Query & Entity Alignment...");
    await page.goto(`${BASE_URL}/app/discounts/customer-rates`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "verify_bug002_discounts_page.png"), fullPage: true });

    const discountsRes = await page.evaluate(async () => {
      const res = await fetch("/api/v1/discounts");
      const data = await res.json();
      return { status: res.status, data };
    });

    console.log(` -> GET /api/v1/discounts status: ${discountsRes.status}`);
    if (discountsRes.status === 200 && Array.isArray(discountsRes.data)) {
      console.log(` -> ✅ BUG-002 PASSED: GET /api/v1/discounts returned 200 OK with ${discountsRes.data.length} items!`);
      results.bug002_discounts = true;
      results.details.push(`BUG-002 (Discounts Retrieval): HTTP 200 OK returning ${discountsRes.data.length} items without column error`);
    } else {
      console.error(" -> ❌ BUG-002 FAILED: GET /api/v1/discounts returned error:", discountsRes);
    }

    // ----------------------------------------------------
    // 4. Verify BUG-003: Printer Creation with Omitted Branch ID (POST /api/v1/printers)
    // ----------------------------------------------------
    console.log("\n[TEST 4] Verifying BUG-003: Printer Creation with Omitted Branch ID...");
    await page.goto(`${BASE_URL}/app/operations/printers`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "verify_bug003_printers_page.png"), fullPage: true });

    const prnCode = `PRN-V-${Date.now().toString().slice(-4)}`;
    const printerCreationRes = await page.evaluate(async ({ pCode, csrf }) => {
      // Intentionally omit branch_id / branchId
      const res = await fetch("/api/v1/printers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf
        },
        body: JSON.stringify({
          code: pCode,
          name: `چاپگر تست بدون شناسه شعبه ${pCode}`,
          printer_type: "THERMAL_RECEIPT",
          simulated_address: "192.168.1.250:9100",
          paper_width_mm: 80,
          is_active: true
        })
      });
      const data = await res.json();
      return { status: res.status, data };
    }, { pCode: prnCode, csrf: capturedCsrfToken });

    console.log(` -> POST /api/v1/printers (omitted branch_id) status: ${printerCreationRes.status}`);
    if (printerCreationRes.status === 201 || printerCreationRes.status === 200) {
      console.log(" -> ✅ Printer created with assigned default branch_id:", printerCreationRes.data.branch_id);
      if (printerCreationRes.data.branch_id) {
        console.log(" -> ✅ BUG-003 PASSED: Default branch fallback correctly assigned without null constraint failure!");
        results.bug003_printers = true;
        results.details.push(`BUG-003 (Printer Creation Default Branch): HTTP 201 Created with default branch_id '${printerCreationRes.data.branch_id}'`);
      } else {
        console.error(" -> ❌ BUG-003 FAILED: branch_id is empty in response");
      }
    } else {
      console.error(" -> ❌ BUG-003 FAILED: POST /api/v1/printers returned error:", printerCreationRes);
    }

    // Capture final summary screenshot
    await page.goto(`${BASE_URL}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "verify_pos_dashboard_final.png"), fullPage: true });

  } catch (err) {
    console.error("Unexpected error during verification:", err);
  } finally {
    await browser.close();
  }

  console.log("\n==================================================");
  console.log("📊 Final Live Verification Summary:");
  console.log(" - BUG-001 (Branch Operating Hours):", results.bug001_branches ? "✅ FIXED" : "❌ FAILED");
  console.log(" - BUG-002 (Discounts Query Fallback):", results.bug002_discounts ? "✅ FIXED" : "❌ FAILED");
  console.log(" - BUG-003 (Printer Branch ID Fallback):", results.bug003_printers ? "✅ FIXED" : "❌ FAILED");
  console.log(" - BUG-004 (Navbar ic-cart.svg Asset):", results.bug004_cart_asset ? "✅ FIXED" : "❌ FAILED");
  console.log("==================================================");

  return results;
}

runVerification().then((res) => {
  const allPassed = res.bug001_branches && res.bug002_discounts && res.bug003_printers && res.bug004_cart_asset;
  process.exit(allPassed ? 0 : 1);
});
