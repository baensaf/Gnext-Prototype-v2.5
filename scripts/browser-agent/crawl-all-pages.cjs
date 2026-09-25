const { chromium } = require("../../starter-vite-ts/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const { BrowserAgent, BASE_URL } = require("./agent-lib.cjs");

const ALL_ROUTES = [
  { name: "Dashboard", path: "/app/dashboard" },
  { name: "POS Register", path: "/app/pos" },
  { name: "Self Kiosk", path: "/app/kiosk" },
  { name: "Orders Workflow", path: "/app/orders" },
  { name: "Dine-In Floor", path: "/app/dine-in/floor" },
  { name: "Kitchen Display (KDS)", path: "/app/kds" },
  { name: "Delivery Orders", path: "/app/delivery/orders" },
  { name: "Delivery Couriers", path: "/app/delivery/couriers" },
  { name: "Delivery Settlements", path: "/app/delivery/settlements" },
  { name: "Cashier Shifts", path: "/app/cashier/shifts" },
  { name: "Business Days", path: "/app/cashier/business-days" },
  { name: "Payments", path: "/app/payments" },
  { name: "Refunds", path: "/app/refunds" },
  { name: "Customers Directory", path: "/app/customers" },
  { name: "Customer Credit Accounts", path: "/app/credit/accounts" },
  { name: "Customer Club Discounts", path: "/app/customer-club/discounts" },
  { name: "Customer Club Wallet", path: "/app/customer-club/wallet" },
  { name: "Catalog Categories", path: "/app/catalog/categories" },
  { name: "Catalog Products", path: "/app/catalog/products" },
  { name: "Catalog Modifiers / Options", path: "/app/catalog/modifiers" },
  { name: "Catalog Availability (86)", path: "/app/catalog/availability" },
  { name: "Catalog Import/Export", path: "/app/catalog/import-export" },
  { name: "Pricing Price Book", path: "/app/pricing/price-book" },
  { name: "Pricing Price Groups", path: "/app/pricing/price-groups" },
  { name: "Pricing Bulk Update", path: "/app/pricing/bulk-update" },
  { name: "Discounts Customer Rates", path: "/app/discounts/customer-rates" },
  { name: "Discounts Coupons", path: "/app/discounts/coupons" },
  { name: "Discounts Authorizations", path: "/app/discounts/authorizations" },
  { name: "Discounts Wallet Cashback", path: "/app/discounts/wallet" },
  { name: "Operations Branches", path: "/app/operations/branches" },
  { name: "Operations Terminals", path: "/app/operations/terminals" },
  { name: "Operations KDS Config", path: "/app/operations/kds-configuration" },
  { name: "Operations Printers", path: "/app/operations/printers" },
  { name: "Operations Print Queue", path: "/app/operations/print-queue" },
  { name: "Operations Monitoring", path: "/app/operations/monitoring" },
  { name: "Simulation Center", path: "/app/simulation" },
  { name: "Simulation Snappfood", path: "/app/simulation/snappfood" },
  { name: "Simulation Payments & Printers", path: "/app/simulation/payments-printers" },
  { name: "Simulation Offline Sync", path: "/app/simulation/offline-sync" },
  { name: "Simulation Logs", path: "/app/simulation/logs" },
  { name: "Reports Hub", path: "/app/reports" },
  { name: "Audit Explorer", path: "/app/audit" },
  { name: "Settings General", path: "/app/settings/general" },
  { name: "Settings Order Workflow", path: "/app/settings/order-workflow" },
  { name: "Settings Discounts & Credit", path: "/app/settings/discounts-credit" },
  { name: "Settings Payments & Refunds", path: "/app/settings/payments-refunds" },
  { name: "Settings Approvals", path: "/app/settings/approvals" },
  { name: "Settings Reason Codes", path: "/app/settings/reasons" },
  { name: "Settings Localization", path: "/app/settings/localization" },
  { name: "Settings Data Reset", path: "/app/settings/data-reset" }
];

async function crawl() {
  const agent = new BrowserAgent();
  await agent.init({ headless: true });

  try {
    await agent.login();
    console.log("=== STARTING COMPLETE AUDIT OF " + ALL_ROUTES.length + " ROUTES ===");

    for (let i = 0; i < ALL_ROUTES.length; i++) {
      const item = ALL_ROUTES[i];
      console.log("\n[" + (i + 1) + "/" + ALL_ROUTES.length + "] Auditing " + item.name + " (" + item.path + ")...");

      const initialNetErrors = agent.networkLogs.length;
      const initialConsoleErrors = agent.consoleLogs.length;

      const page = await agent.goto(item.path);
      await page.waitForTimeout(1500);

      const shot = await agent.screenshot("page_" + item.name.replace(/[^a-zA-Z0-9]/g, "_"));

      const bodyText = await page.innerText("body");
      const hasCrashText = bodyText.includes("Something went wrong") || bodyText.includes("Cannot read properties") || bodyText.includes("Page Not Found") || bodyText.includes("404");

      if (hasCrashText && !item.path.includes("404")) {
        agent.recordBug({
          module: item.name,
          page: item.path,
          title: "Page crash or error boundary displayed on " + item.name,
          severity: "High",
          description: "The page rendered an error message or 404 state upon direct navigation.\nSnippet: " + bodyText.substring(0, 300),
          expected: "Page should load correctly with functional UI",
          actual: bodyText.substring(0, 200),
          screenshot: shot
        });
      }

      const tabs = await page.locator("[role=tab]").all();
      if (tabs.length > 0) {
        console.log("   Found " + tabs.length + " tabs on " + item.name + ". Clicking through each...");
        for (let t = 0; t < tabs.length; t++) {
          try {
            const tabText = await tabs[t].innerText();
            console.log("   -> Clicking Tab [" + t + "]: " + tabText.trim());
            await tabs[t].click();
            await page.waitForTimeout(800);
            await agent.screenshot("tab_" + item.name + "_" + t + "_" + tabText.trim().replace(/[^a-zA-Z0-9]/g, "_"));
          } catch (e) {
            console.warn("   Failed clicking tab " + t + ": " + e.message);
          }
        }
      }

      const newNetErrors = agent.networkLogs.slice(initialNetErrors);
      if (newNetErrors.length > 0) {
        newNetErrors.forEach(err => {
          agent.recordBug({
            module: item.name,
            page: item.path,
            title: "HTTP " + err.status + " Error on " + err.method + " " + err.url,
            severity: err.status >= 500 ? "High" : "Medium",
            description: "A network request failed with status code " + err.status + " when loading " + item.name + ".",
            expected: "All API requests should return 2xx successful responses.",
            actual: "Returned status " + err.status + " with body: " + err.body,
            technicalDetails: err,
            screenshot: shot
          });
        });
      }

      const newConsoleErrors = agent.consoleLogs.slice(initialConsoleErrors);
      if (newConsoleErrors.length > 0) {
        newConsoleErrors.forEach(err => {
          agent.recordBug({
            module: item.name,
            page: item.path,
            title: "Console " + (err.type || "Error") + ": " + (err.message || err.text || "").substring(0, 80),
            severity: "Low",
            description: "Client-side JavaScript console error occurred while visiting " + item.name + ".",
            expected: "No uncaught exceptions or error logs in console.",
            actual: err.message || err.text,
            technicalDetails: err,
            screenshot: shot
          });
        });
      }

      agent.recordPassed({
        module: item.name,
        page: item.path,
        title: "Page Crawl & Tab Navigation for " + item.name,
        details: "Verified rendering, screenshot captured, checked " + tabs.length + " tabs"
      });
    }

    console.log("=== CRAWL COMPLETE. TOTAL BUGS: " + agent.bugs.length + " ===");
  } catch (err) {
    console.error("Fatal crawl error:", err);
  } finally {
    await agent.close();
  }
}

crawl().catch(console.error);