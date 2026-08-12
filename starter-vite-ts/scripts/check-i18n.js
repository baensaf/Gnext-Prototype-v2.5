import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const enPath = path.join(rootDir, 'src', 'locales', 'en.json');
const faPath = path.join(rootDir, 'src', 'locales', 'fa.json');

const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
const fa = JSON.parse(fs.readFileSync(faPath, 'utf-8'));

function getFlattenedKeys(obj, prefix = '') {
  let keys = {};
  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      Object.assign(keys, getFlattenedKeys(obj[key], prefix ? `${prefix}.${key}` : key));
    } else {
      keys[prefix ? `${prefix}.${key}` : key] = obj[key];
    }
  }
  return keys;
}

const enKeys = getFlattenedKeys(en);
const faKeys = getFlattenedKeys(fa);

console.log('=== I18N KEY PARITY CHECK ===');
let parityErrors = 0;

for (const key of Object.keys(enKeys)) {
  if (!(key in faKeys)) {
    console.error(`❌ Missing key in fa.json: "${key}"`);
    parityErrors++;
  }
}

for (const key of Object.keys(faKeys)) {
  if (!(key in enKeys)) {
    console.error(`❌ Missing key in en.json: "${key}"`);
    parityErrors++;
  }
}

if (parityErrors === 0) {
  console.log(`✅ Translation key parity check PASSED! (${Object.keys(enKeys).length} keys matched)`);
} else {
  console.error(`❌ Found ${parityErrors} key parity mismatch(es)!`);
}

// Hardcoded string audit in JSX/TSX
console.log('\n=== JSX HARDCODED STRING AUDIT ===');
const srcDir = path.join(rootDir, 'src');

function scanDirectory(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      scanDirectory(filePath, fileList);
    } else if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allFiles = scanDirectory(srcDir);
let hardcodedCount = 0;

// Patterns to detect potential hardcoded user-facing strings in JSX
const textNodeRegex = />\s*([A-Za-z]{3,}[A-Za-z0-9\s,\.\?!:\'\-\(\)]+)\s*</g;

for (const file of allFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  let match;
  while ((match = textNodeRegex.exec(content)) !== null) {
    const text = match[1].trim();
    // Exclude common code keywords / numbers / identifiers / imports
    if (
      !/^(import|export|const|let|var|function|return|interface|type|class|from|default|true|false|null|undefined|console|void|as|keyof|typeof)$/.test(text) &&
      !/^[0-9\.\s\:\-\+\%\$\#\/\*\=\<\>\,\(\)]+$/.test(text) &&
      !text.startsWith('http') &&
      !text.startsWith('src/')
    ) {
      const relativePath = path.relative(rootDir, file).replace(/\\/g, '/');
      console.warn(`⚠️ Potential hardcoded string in [${relativePath}]: "${text}"`);
      hardcodedCount++;
    }
  }
}

console.log(`\nScan summary: ${hardcodedCount} potential hardcoded string(s) flagged.`);

if (parityErrors > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
