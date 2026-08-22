import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');

const farsiRegex = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const TECHNICAL_WHITELIST = new Set([
  'POS', 'KDS', 'IRR', 'USD', 'EUR', 'VAT', 'BNPL', 'OTP', 'COD', 'HMAC', 'API', 'SKU', 'CSV', 'XLSX',
  'JSON', 'ID', 'PIN', 'UI', 'CRM', 'SLA', 'VIP', 'RTL', 'LTR', 'SMS', 'URL', 'QR', 'mPOS',
  'BR-01', 'BR-02', 'POS-01', 'POS-02', 'TEH-CENTRAL', 'TEH-DOWNTOWN', 'PG-AIRPORT', 'CAT-BURGERS',
  'CAT-PIZZAS', 'CAT-DRINKS', 'CAT-APPETIZERS', 'CAT-DESSERTS', 'PRD-BURGER-01', 'PRD-DRINK-01',
  'CUST-001', 'CUST-002', 'CUST-003', 'CUST-004', 'GRP-CORP-VIP', 'SINGLE100', 'WELCOME10',
  'Snappfood', 'Tara', 'Tara BNPL', 'Gnext', 'Minimals', 'Acme Tech Solutions',
  'inherit', 'primary', 'secondary', 'error', 'warning', 'info', 'success', 'default',
  'small', 'medium', 'large', 'contained', 'outlined', 'text', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'body1', 'body2', 'subtitle1', 'subtitle2', 'caption', 'button', 'overline',
  'row', 'column', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around',
  'div', 'span', 'p', 'form', 'label', 'input', 'button', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'Content-Type', 'Authorization', 'Bearer', 'application/json'
]);

function isTechnical(str) {
  if (!str || str.length <= 1) return true;
  const trimmed = str.trim();
  if (TECHNICAL_WHITELIST.has(trimmed)) return true;
  if (/^[0-9\.\:\-\+\%\$\#\/\*\=\<\>\,\(\)\s\—\–\•\|]+$/.test(trimmed)) return true;
  if (/^[A-Z0-9_\-]+$/.test(trimmed) && (trimmed.includes('-') || trimmed.includes('_') || /^[0-9]+$/.test(trimmed))) return true;
  if (/^(\.\/|\.\.\/|\/|http|src\/|@mui|@iconify|lucide-react|axios|dayjs|framer-motion)/.test(trimmed)) return true;
  if (/^(rgb|rgba|hsl|hsla|#)/.test(trimmed)) return true;
  return false;
}

function scanDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (!['node_modules', 'dist', '.git', 'assets', 'theme'].includes(file)) {
        scanDir(fullPath, fileList);
      }
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      if (!file.endsWith('.d.ts') && !file.includes('_mock') && !file.includes('locales')) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

const files = scanDir(srcDir);
const hardcodedItemsByFile = {};

// Regex patterns to detect hardcoded user-facing strings
const patterns = [
  // JSX text content: >Some English Text<
  { name: 'JSX Text', regex: />\s*([A-Za-z][A-Za-z0-9\s,\.\?!:\'\-\(\)\/]{2,})\s*</g },
  // JSX attributes: label="Some Label", title="Some Title", placeholder="Some Placeholder", helperText="Some Text"
  { name: 'JSX Attribute', regex: /(?:label|title|placeholder|helperText|headerName|confirmText|cancelText|emptyText|emptyMessage|description)\s*=\s*["']([A-Za-z][A-Za-z0-9\s,\.\?!:\'\-\(\)\/]{2,})["']/g },
  // Alert/Toast messages: toast.error("Some error"), toast.success("Some success"), alert("...")
  { name: 'Toast/Alert', regex: /(?:toast\.(?:success|error|warning|info)|enqueueSnackbar|alert)\s*\(\s*["']([A-Za-z][A-Za-z0-9\s,\.\?!:\'\-\(\)\/]{2,})["']/g },
  // Button text in code: <Button ...>Text</Button>
  { name: 'Button Text', regex: /<Button[^>]*>\s*([A-Za-z][A-Za-z0-9\s,\.\?!:\'\-\(\)\/]{2,})\s*<\/Button>/g },
  // Table headerName: headerName: 'Some Header'
  { name: 'Table Header', regex: /headerName\s*:\s*["']([A-Za-z][A-Za-z0-9\s,\.\?!:\'\-\(\)\/]{2,})["']/g }
];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  const relPath = path.relative(rootDir, file).replace(/\\/g, '/');
  const fileItems = [];

  for (const pat of patterns) {
    let match;
    const re = new RegExp(pat.regex);
    while ((match = re.exec(content)) !== null) {
      const text = match[1].trim();
      if (!isTechnical(text) && !farsiRegex.test(text) && /[A-Za-z]{2,}/.test(text)) {
        // Exclude programming keywords
        if (!/^(import|export|const|let|var|function|return|interface|type|class|from|default|true|false|null|undefined|console|void|as|keyof|typeof|extends|implements)$/.test(text)) {
          fileItems.push({
            type: pat.name,
            text
          });
        }
      }
    }
  }

  if (fileItems.length > 0) {
    // Deduplicate
    const uniqueMap = new Map();
    for (const item of fileItems) {
      uniqueMap.set(item.text, item);
    }
    hardcodedItemsByFile[relPath] = Array.from(uniqueMap.values());
  }
}

fs.writeFileSync(
  path.join(__dirname, 'codebase-audit-results.json'),
  JSON.stringify(hardcodedItemsByFile, null, 2),
  'utf-8'
);

console.log(`Audited ${files.length} source files.`);
console.log(`Found hardcoded English UI strings across ${Object.keys(hardcodedItemsByFile).length} files.`);
