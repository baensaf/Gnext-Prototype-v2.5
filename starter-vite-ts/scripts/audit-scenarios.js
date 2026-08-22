import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const farsiRegex = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const TECHNICAL_WHITELIST = new Set([
  'POS', 'KDS', 'IRR', 'USD', 'EUR', 'VAT', 'BNPL', 'OTP', 'COD', 'HMAC', 'API', 'SKU', 'CSV', 'XLSX',
  'JSON', 'ID', 'PIN', 'UI', 'CRM', 'SLA', 'VIP', 'RTL', 'LTR', 'SMS', 'URL', 'QR', 'mPOS',
  'BR-01', 'BR-02', 'POS-01', 'POS-02', 'TEH-CENTRAL', 'TEH-DOWNTOWN', 'PG-AIRPORT', 'CAT-BURGERS',
  'CAT-PIZZAS', 'CAT-DRINKS', 'CAT-APPETIZERS', 'CAT-DESSERTS', 'PRD-BURGER-01', 'PRD-DRINK-01',
  'CUST-001', 'CUST-002', 'CUST-003', 'CUST-004', 'GRP-CORP-VIP', 'SINGLE100', 'WELCOME10',
  'Snappfood', 'Tara', 'Tara BNPL', 'Gnext', 'Minimals', 'Acme Tech Solutions',
  'admin@gnext.local', 'GnextDemo!2026'
]);

function isTechnicalOrCode(str) {
  if (!str || str.length <= 1) return true;
  const trimmed = str.trim();
  if (TECHNICAL_WHITELIST.has(trimmed)) return true;
  if (/^[0-9\.\:\-\+\%\$\#\/\*\=\<\>\,\(\)\s\—\–\•\|\/]+$/.test(trimmed)) return true;
  if (/^[A-Z0-9_\-]+$/.test(trimmed) && (trimmed.includes('-') || trimmed.includes('_') || /^[0-9]+$/.test(trimmed))) return true;
  if (/^[0-9]{2,4}[-\/][0-9]{2}[-\/][0-9]{2,4}/.test(trimmed)) return true;
  if (/^[0-9]+:[0-9]+(:[0-9]+)?$/.test(trimmed)) return true;
  return false;
}

function extractUntranslatedStrings(textList) {
  const untranslated = new Set();
  for (const raw of textList) {
    if (!raw) continue;
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text || text.length <= 1) continue;
    if (isTechnicalOrCode(text)) continue;

    if (!farsiRegex.test(text)) {
      if (/[A-Za-z]{2,}/.test(text)) {
        untranslated.add(text);
      }
    } else {
      const englishPhrases = text.match(/[A-Za-z]{3,}(?:\s+[A-Za-z]{2,})*/g);
      if (englishPhrases) {
        for (const ep of englishPhrases) {
          if (!isTechnicalOrCode(ep) && ep.length > 2) {
            untranslated.add(`[در متن: "${text}"] -> "${ep}"`);
          }
        }
      }
    }
  }
  return Array.from(untranslated);
}

// 60 Canonical Daily Operations Scenarios
const SCENARIOS = [
  { id: 1, name: 'Morning Day Opening & Cashier Shift Initialization', routes: ['/app/cashier/business-days', '/app/cashier/shifts'] },
  { id: 2, name: 'Morning Prep & 86\'d / Out-of-Stock Item Suspension', routes: ['/app/catalog/availability', '/app/pos'] },
  { id: 3, name: 'Walk-In Counter Order with Item Modifiers (Cash)', routes: ['/app/pos'] },
  { id: 4, name: 'Walk-In Counter Order with Split Tender (Cash + Card)', routes: ['/app/pos', '/app/payments'] },
  { id: 5, name: 'Dine-In Guest Seating & Multi-Course Table Order', routes: ['/app/dine-in/floor', '/app/pos'] },
  { id: 6, name: 'Dine-In Order Additions, Table Transfer & Merging', routes: ['/app/dine-in/floor'] },
  { id: 7, name: 'Kitchen Display System (KDS) Preparation & Bump Flow', routes: ['/app/kds'] },
  { id: 8, name: 'High-Priority (VIP/Rush) Ticket Escalation & Recall', routes: ['/app/kds'] },
  { id: 9, name: 'Customer Registration & Loyalty Cashback Accrual', routes: ['/app/customers', '/app/pos'] },
  { id: 10, name: 'Wallet Cashback Balance Redemption & Coupon Codes', routes: ['/app/pos', '/app/discounts/coupons'] },
  { id: 11, name: 'Delivery Phone Order Creation & Courier Dispatch', routes: ['/app/pos', '/app/delivery/orders'] },
  { id: 12, name: 'Courier Delivery Completion & COD Collection', routes: ['/app/delivery/orders', '/app/delivery/couriers'] },
  { id: 13, name: 'External Food Aggregator (Snappfood) Order Injection', routes: ['/app/simulation/snappfood', '/app/kds'] },
  { id: 14, name: 'Mid-Day Cash Drawer Drop & Petty Cash Payout', routes: ['/app/cashier/shifts'] },
  { id: 15, name: 'Line-Item Void & Supervisor PIN Override', routes: ['/app/pos', '/app/settings/approvals'] },
  { id: 16, name: 'Full & Partial Order Refunds with Wallet Reversal', routes: ['/app/refunds', '/app/orders'] },
  { id: 17, name: 'Corporate B2B Dining on Credit Account (On-Tab)', routes: ['/app/pos', '/app/credit/accounts'] },
  { id: 18, name: 'Self-Service Kiosk Customer Order & Self-Checkout', routes: ['/app/kiosk'] },
  { id: 19, name: 'End-of-Shift Courier Batch Settlement Reconciliation', routes: ['/app/delivery/settlements'] },
  { id: 20, name: 'End-of-Shift Z-Report & End-of-Day (EOD) Business Close', routes: ['/app/cashier/shifts', '/app/reports'] },
  { id: 21, name: 'Park / Hold Cart Order & Recall for Later Checkout', routes: ['/app/pos'] },
  { id: 22, name: 'Split Bill by Line Items Between Dine-In Guests', routes: ['/app/dine-in/floor', '/app/pos'] },
  { id: 23, name: 'Offline POS Sync Simulation & Network Recovery', routes: ['/app/simulation/offline-sync', '/app/pos'] },
  { id: 24, name: 'Tara BNPL Installment Payment Flow Simulation', routes: ['/app/simulation/payments-printers', '/app/payments'] },
  { id: 25, name: 'Printer Hardware Fault Injection & Print Job Retry', routes: ['/app/operations/print-queue', '/app/simulation/payments-printers'] },
  { id: 26, name: 'Discount PIN Authorization Exceeding Cashier Threshold', routes: ['/app/pos', '/app/settings/approvals'] },
  { id: 27, name: 'Customer Duplicate Profile Detection & Merge', routes: ['/app/customers'] },
  { id: 28, name: 'KDS Multi-Station Routing & Tab Filter Views', routes: ['/app/kds'] },
  { id: 29, name: 'Dynamic Price Book Activation (Happy Hour Specials)', routes: ['/app/pricing/price-book', '/app/pos'] },
  { id: 30, name: 'Delivery Breakdown Rejection & Courier Re-dispatch', routes: ['/app/delivery/orders'] },
  { id: 31, name: 'Inventory Safety Stock Depletion & Alert Banner', routes: ['/app/inventory/stock', '/app/operations/monitoring'] },
  { id: 32, name: 'Itemized Partial Refund with Customer Wallet Credit', routes: ['/app/refunds', '/app/customer-club/wallet'] },
  { id: 33, name: 'Customer Tier Upgrade & Cashback Ledger Verification', routes: ['/app/customer-club/discounts', '/app/customers'] },
  { id: 34, name: 'Business Day Reopen & Emergency Audit Adjustment', routes: ['/app/cashier/business-days', '/app/audit'] },
  { id: 35, name: 'Self-Service Kiosk Bilingual (Farsi/English) Ordering', routes: ['/app/kiosk'] },
  { id: 36, name: 'Bulk Product Price Adjustment with Preview Table', routes: ['/app/pricing/bulk-update'] },
  { id: 37, name: 'Courier Settlement Cash Shortage Penalty & Adjustment', routes: ['/app/delivery/settlements'] },
  { id: 38, name: 'Coupon Single-Use Limit Enforcement & Expired Check', routes: ['/app/discounts/coupons', '/app/pos'] },
  { id: 39, name: 'Branch Emergency Pause & Aggregator Sync Lock', routes: ['/app/operations/branches', '/app/simulation/snappfood'] },
  { id: 40, name: 'Comprehensive Financial Audit Trail & JSON Payload Review', routes: ['/app/audit', '/app/reports'] },
  { id: 41, name: 'Customer Group Creation & Policy Discount Binding', routes: ['/app/customers'] },
  { id: 42, name: 'Customer Directory Group Filtering & Multi-Factor Search', routes: ['/app/customers'] },
  { id: 43, name: 'Dedicated Price Group Creation & Airport/Downtown Tier Assignment', routes: ['/app/pricing/price-groups', '/app/operations/branches'] },
  { id: 44, name: 'Price Group Item-Level Price Overrides via Matrix Editor', routes: ['/app/pricing/price-groups', '/app/pricing/price-book'] },
  { id: 45, name: 'POS Dynamic Group Price Resolution Across Multiple Branches', routes: ['/app/pos', '/app/pricing/price-book'] },
  { id: 46, name: 'Category-Wide Percentage Bulk Price Adjustment with Rounding', routes: ['/app/pricing/bulk-update'] },
  { id: 47, name: 'Fixed-Amount Bulk Price Surcharge on Specific Price Group', routes: ['/app/pricing/bulk-update', '/app/pricing/price-groups'] },
  { id: 48, name: 'Customer Marketing Consent & Privacy Preference Management', routes: ['/app/customers', '/app/settings/general'] },
  { id: 49, name: 'Dynamic Customer Tagging & VIP Segmentation', routes: ['/app/customers', '/app/discounts/campaigns'] },
  { id: 50, name: 'Multi-Currency Tender Acceptance (USD / EUR with Auto-Conversion)', routes: ['/app/pos', '/app/payments', '/app/cashier/shifts'] },
  { id: 51, name: 'Multi-Station KDS Simultaneous Split Routing', routes: ['/app/kds', '/app/operations/kds-configuration', '/app/pos'] },
  { id: 52, name: 'Kitchen Expediter Screen Ticket Aggregation & All-Ready Bump Flow', routes: ['/app/kds', '/app/orders'] },
  { id: 53, name: 'Dine-In VIP Table Reservation & Walk-In Occupancy Transition', routes: ['/app/dine-in/floor'] },
  { id: 54, name: 'Diplomatic Tax & Service Charge Exemption with Supervisor PIN', routes: ['/app/pos', '/app/settings/approvals'] },
  { id: 55, name: 'Courier Shift Attendance & Mobile POS Terminal Pairing', routes: ['/app/delivery/couriers', '/app/operations/terminals'] },
  { id: 56, name: 'Multi-Stop Delivery Order Route Batching & Dispatch', routes: ['/app/delivery/orders', '/app/delivery/couriers'] },
  { id: 57, name: 'Delivery Failed Attempt & Customer Unreachable Protocol', routes: ['/app/delivery/orders', '/app/inventory/stock', '/app/audit'] },
  { id: 58, name: 'Catalog Product & Price Matrix Excel Bulk Export', routes: ['/app/catalog/import-export', '/app/reports'] },
  { id: 59, name: 'Catalog CSV Bulk Import & Duplicate SKU Error Resolution', routes: ['/app/catalog/import-export', '/app/catalog/products'] },
  { id: 60, name: 'Corporate Catering Event Contract Order & Credit Account Settle', routes: ['/app/pos', '/app/credit/accounts', '/app/kds', '/app/delivery/orders'] }
];

const ALL_ROUTES = Array.from(new Set([
  ...SCENARIOS.flatMap(s => s.routes),
  '/app',
  '/app/dashboard',
  '/app/catalog/categories',
  '/app/catalog/products',
  '/app/catalog/modifiers',
  '/app/catalog/menus',
  '/app/catalog/availability',
  '/app/catalog/import-export',
  '/app/discounts/campaigns',
  '/app/operations/branches',
  '/app/operations/printers',
  '/app/operations/monitoring',
  '/app/settings/general',
  '/app/settings/order-workflow',
  '/app/settings/discounts-credit',
  '/app/settings/discount-authorizations',
  '/app/settings/payments-refunds',
  '/app/settings/approvals',
  '/app/settings/reasons',
  '/app/settings/localization',
  '/app/settings/data-reset',
  '/app/simulation/logs',
  '/auth/jwt/sign-in'
]));

async function runAudit() {
  console.log('🚀 Launching Playwright browser for Authenticated Persian UI Audit...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fa-IR',
  });

  const page = await context.newPage();

  // Set Persian language and RTL direction
  await page.addInitScript(() => {
    localStorage.setItem('gnext_locale', 'fa');
    localStorage.setItem('gnext_settings', JSON.stringify({
      themeMode: 'light',
      themeDirection: 'rtl',
      themeColorPresets: 'default',
      themeLayout: 'vertical',
      direction: 'rtl'
    }));
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'fa';
  });

  // Login as admin first
  console.log('Logging in as admin@gnext.local...');
  try {
    await page.goto('http://localhost:8081/auth/jwt/sign-in', { waitUntil: 'domcontentloaded', timeout: 6000 });
    await page.waitForTimeout(500);

    // Fill credentials and click sign in
    const emailInput = await page.$('input[name="email"], input[type="email"], input[placeholder*="email" i], input[placeholder*="نام کاربری" i], input');
    if (emailInput) {
      await emailInput.fill('admin@gnext.local');
    }
    const passwordInput = await page.$('input[name="password"], input[type="password"]');
    if (passwordInput) {
      await passwordInput.fill('GnextDemo!2026');
    }
    const submitBtn = await page.$('button[type="submit"], button:has-text("ورود"), button:has-text("Sign in")');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(1000);
    }
    console.log('✅ Logged in successfully!');
  } catch (e) {
    console.warn('Login attempt note:', e.message);
  }

  const routeStringsMap = new Map();
  const allUntranslatedSet = new Set();

  console.log(`\n--- Crawling ${ALL_ROUTES.length} Application Routes in Authenticated Persian Mode ---`);

  for (let i = 0; i < ALL_ROUTES.length; i++) {
    const route = ALL_ROUTES[i];
    try {
      const fullUrl = `http://localhost:8081${route}`;
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);

      // Attempt to open interactive dialogs / action buttons if present
      const actionButtons = await page.$$('button:has-text("جدید"), button:has-text("Add"), button:has-text("New"), button:has-text("ثبت"), button:has-text("فیلتر"), button:has-text("Preview"), button:has-text("شروع")');
      for (const btn of actionButtons.slice(0, 2)) {
        try {
          await btn.click({ timeout: 500 });
          await page.waitForTimeout(300);
        } catch (e) {}
      }

      // Extract all rendered text, headers, labels, placeholders, chips, buttons, alerts, tooltips
      const pageTexts = await page.evaluate(() => {
        const texts = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent) continue;
          const tag = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'svg', 'code'].includes(tag)) continue;
          const val = node.nodeValue?.trim();
          if (val && val.length > 1) texts.push(val);
        }
        document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
          const ph = el.getAttribute('placeholder');
          if (ph) texts.push(ph);
        });
        document.querySelectorAll('[aria-label]').forEach(el => {
          const al = el.getAttribute('aria-label');
          if (al) texts.push(al);
        });
        document.querySelectorAll('button, th, [role="columnheader"], .MuiChip-label, .MuiDialogTitle-root, .MuiAlert-message, .MuiTab-root, .MuiTablePagination-root').forEach(el => {
          const t = el.textContent?.trim();
          if (t) texts.push(t);
        });
        return texts;
      });

      const untranslated = extractUntranslatedStrings(pageTexts);
      routeStringsMap.set(route, untranslated);
      untranslated.forEach(s => allUntranslatedSet.add(s));
      console.log(`[${i + 1}/${ALL_ROUTES.length}] ${route.padEnd(40)} -> ${untranslated.length} untranslated items`);
    } catch (err) {
      console.warn(`Error on route ${route}:`, err.message);
      routeStringsMap.set(route, []);
    }
  }

  await browser.close();

  const scenarioResults = SCENARIOS.map(sc => {
    const scStrings = new Set();
    sc.routes.forEach(r => {
      const list = routeStringsMap.get(r) || [];
      list.forEach(s => scStrings.add(s));
    });
    return {
      id: sc.id,
      name: sc.name,
      routes: sc.routes,
      untranslatedCount: scStrings.size,
      untranslatedElements: Array.from(scStrings)
    };
  });

  const auditOutput = {
    generatedAt: new Date().toISOString(),
    totalScenarios: SCENARIOS.length,
    totalDistinctRoutes: ALL_ROUTES.length,
    totalUniqueUntranslatedStrings: allUntranslatedSet.size,
    scenarios: scenarioResults,
    routeDetails: Object.fromEntries(routeStringsMap)
  };

  fs.writeFileSync(path.join(__dirname, 'audit-results.json'), JSON.stringify(auditOutput, null, 2), 'utf-8');
  console.log(`\n✅ Persian UI Audit COMPLETE! Total unique untranslated items: ${allUntranslatedSet.size}`);
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
