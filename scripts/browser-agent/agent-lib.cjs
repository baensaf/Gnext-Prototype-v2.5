const { chromium } = require("../../starter-vite-ts/node_modules/playwright");
const path = require("path");
const fs = require("fs");

const BASE_URL = "http://195.234.80.33:8080";
const SCREENSHOTS_DIR = path.join(__dirname, "../../screenshots");
const BUGS_FILE = path.join(__dirname, "../../IRANBURGER_AUDIT_AND_BUGS.md");

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

class BrowserAgent {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.bugs = [];
    this.networkLogs = [];
    this.consoleLogs = [];
    this.passedSteps = [];
    this.executedPages = new Set();
  }

  async init(options = {}) {
    this.browser = await chromium.launch({
      headless: options.headless !== undefined ? options.headless : true,
      slowMo: options.slowMo || 50
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "fa-IR"
    });
    this.page = await this.context.newPage();

    this.page.on("response", async (response) => {
      const status = response.status();
      const url = response.url();
      const method = response.request().method();
      if (status >= 400 && !url.includes(".png") && !url.includes(".woff") && !url.includes(".ico")) {
        let body = "";
        try {
          body = await response.text();
        } catch (e) {}
        const errorEntry = {
          timestamp: new Date().toISOString(),
          page: this.page.url(),
          method,
          url,
          status,
          body: body.length > 600 ? body.substring(0, 600) + "..." : body
        };
        this.networkLogs.push(errorEntry);
        console.warn(" [HTTP " + status + "] " + method + " " + url);
      }
    });

    this.page.on("pageerror", (err) => {
      const errorEntry = {
        timestamp: new Date().toISOString(),
        page: this.page.url(),
        message: err.message,
        stack: err.stack
      };
      this.consoleLogs.push(errorEntry);
      console.error(" [PAGE_ERROR] " + err.message);
    });

    this.page.on("console", (msg) => {
      if (msg.type() === "error") {
        this.consoleLogs.push({
          timestamp: new Date().toISOString(),
          page: this.page.url(),
          text: msg.text()
        });
      }
    });
  }

  async login(username = "admin@gnext.local", password = "GnextDemo!2026") {
    console.log(" Navigating to login...");
    await this.page.goto(BASE_URL + "/login", { waitUntil: "domcontentloaded" });
    await this.page.waitForSelector("input[type=password]", { timeout: 10000 });
    await this.page.locator("input").first().fill(username);
    await this.page.locator("input[type=password]").fill(password);
    await this.page.click("button[type=submit]");
    await this.page.waitForTimeout(2000);
    console.log(" Logged in. Current URL:", this.page.url());
  }

  async goto(routePath) {
    const fullUrl = routePath.startsWith("http") ? routePath : BASE_URL + routePath;
    console.log(" Visiting: " + fullUrl);
    this.executedPages.add(routePath);
    await this.page.goto(fullUrl, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(1000);
    return this.page;
  }

  async screenshot(name) {
    const filename = Date.now() + "_" + name.replace(/[^a-zA-Z0-9_-]/g, "_") + ".png";
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    await this.page.screenshot({ path: filepath, fullPage: true });
    return filename;
  }

  recordBug({ module, page, title, severity = "Medium", description, expected, actual, reproSteps = [], screenshot = null, technicalDetails = null }) {
    const bug = {
      id: "BUG-" + String(this.bugs.length + 1).padStart(3, "0"),
      timestamp: new Date().toISOString(),
      module,
      page: page || this.page.url(),
      title,
      severity,
      description,
      expected,
      actual,
      reproSteps,
      screenshot,
      technicalDetails
    };
    this.bugs.push(bug);
    console.log(" Recorded Bug [" + bug.id + "][" + severity + "]: " + title);
    this.syncBugReport();
    return bug;
  }

  recordPassed({ module, page, title, details }) {
    this.passedSteps.push({
      timestamp: new Date().toISOString(),
      module,
      page: page || this.page.url(),
      title,
      details
    });
    console.log(" Step Passed: [" + module + "] " + title);
    this.syncBugReport();
  }

  syncBugReport() {
    let md = "# 🐞 IranBurger System Audit & Bug Report\n\n";
    md += "**Generated:** " + new Date().toISOString() + "\n";
    md += "**Target URL:** " + BASE_URL + "\n";
    md += "**Total Bugs Identified:** " + this.bugs.length + "\n";
    md += "**Total Passed Steps / Populated Entities:** " + this.passedSteps.length + "\n\n";

    md += "## 📊 Summary by Severity\n\n";
    const severityCounts = this.bugs.reduce((acc, b) => {
      acc[b.severity] = (acc[b.severity] || 0) + 1;
      return acc;
    }, {});
    md += "| Severity | Count |\n|---|---|\n";
    ["Critical", "High", "Medium", "Low", "Cosmetic / UX"].forEach(s => {
      md += "| " + s + " | " + (severityCounts[s] || 0) + " |\n";
    });
    md += "\n---\n\n";

    md += "## 📋 Detailed Bug Inventory\n\n";
    if (this.bugs.length === 0) {
      md += "*No bugs recorded yet.*\n\n";
    }
    this.bugs.forEach((b, idx) => {
      md += "### " + (idx + 1) + ". [" + b.id + "] " + b.title + "\n\n";
      md += "- **Module:** " + b.module + "\n";
      md += "- **Page URL:** " + b.page + "\n";
      md += "- **Severity:** " + b.severity + "\n";
      md += "- **Timestamp:** " + b.timestamp + "\n\n";
      md += "**Description:**\n" + b.description + "\n\n";
      if (b.reproSteps && b.reproSteps.length > 0) {
        md += "**Steps to Reproduce:**\n";
        b.reproSteps.forEach((st, sIdx) => {
          md += (sIdx + 1) + ". " + st + "\n";
        });
        md += "\n";
      }
      md += "**Expected Behavior:**\n" + b.expected + "\n\n";
      md += "**Actual Behavior:**\n" + b.actual + "\n\n";
      if (b.technicalDetails) {
        md += "**Technical / Error Details:**\n" + "`json\n" + (typeof b.technicalDetails === "object" ? JSON.stringify(b.technicalDetails, null, 2) : b.technicalDetails) + "\n`\n\n";
      }
      if (b.screenshot) {
        md += "**Screenshot:** " + b.screenshot + "\n\n";
      }
      md += "---\n\n";
    });

    md += "## ✅ Passed Verification Steps & Populated Modules\n\n";
    md += "| Module | Action / Page | Status | Time | Details |\n|---|---|---|---|---|\n";
    this.passedSteps.forEach(p => {
      md += "| " + p.module + " | " + p.title + " | Passed | " + p.timestamp + " | " + (p.details || "-") + " |\n";
    });

    fs.writeFileSync(BUGS_FILE, md, "utf-8");
  }

  async close() {
    this.syncBugReport();
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = { BrowserAgent, BASE_URL };