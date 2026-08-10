import * as fs from 'fs';
import * as path from 'path';

function getNestedKeys(obj: any, prefix = ''): string[] {
  let keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const newPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      keys = keys.concat(getNestedKeys(val, newPrefix));
    } else {
      keys.push(newPrefix);
    }
  }
  return keys;
}

export function checkTranslations(): { success: boolean; missingEn: string[]; missingFa: string[] } {
  const enPath = path.resolve(__dirname, '../../../starter-vite-ts/src/locales/en.json');
  const faPath = path.resolve(__dirname, '../../../starter-vite-ts/src/locales/fa.json');

  if (!fs.existsSync(enPath) || !fs.existsSync(faPath)) {
    console.error('Translation files not found at expected paths!');
    return { success: false, missingEn: [], missingFa: [] };
  }

  const enContent = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const faContent = JSON.parse(fs.readFileSync(faPath, 'utf8'));

  const enKeys = new Set(getNestedKeys(enContent));
  const faKeys = new Set(getNestedKeys(faContent));

  const missingFa = Array.from(enKeys).filter((k) => !faKeys.has(k));
  const missingEn = Array.from(faKeys).filter((k) => !enKeys.has(k));

  console.log(`[Translation Check] Total EN keys: ${enKeys.size}`);
  console.log(`[Translation Check] Total FA keys: ${faKeys.size}`);

  if (missingFa.length > 0) {
    console.error(`[Translation Check] Missing FA keys (${missingFa.length}):`, missingFa);
  }
  if (missingEn.length > 0) {
    console.error(`[Translation Check] Missing EN keys (${missingEn.length}):`, missingEn);
  }

  const success = missingFa.length === 0 && missingEn.length === 0;
  if (success) {
    console.log('✅ Translation Check PASSED: 100% key parity between en.json and fa.json!');
  }

  return { success, missingEn, missingFa };
}

if (require.main === module) {
  const res = checkTranslations();
  process.exit(res.success ? 0 : 1);
}
