const { chromium } = require("../../starter-vite-ts/node_modules/playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("response", async (res) => {
    if (res.url().includes("/auth/") || res.url().includes("/api/")) {
      let body = "";
      try { body = await res.text(); } catch (e) {}
      console.log("RES:", res.request().method(), res.url(), res.status(), body.substring(0, 150));
    }
  });
  console.log("Navigating to login with domcontentloaded...");
  await page.goto("http://195.234.80.33:8080/login", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 10000 });
  console.log("Login page loaded.");
  await page.locator("input").first().fill("admin@gnext.local");
  await page.locator("input[type=password]").fill("GnextDemo!2026");
  console.log("Submitting...");
  await page.click("button[type=submit]");
  await page.waitForTimeout(3000);
  console.log("URL after login:", page.url());
  const storage = await page.evaluate(() => ({
    session: { ...sessionStorage },
    local: { ...localStorage }
  }));
  console.log("Auth Storage:", storage);
  await browser.close();
})();