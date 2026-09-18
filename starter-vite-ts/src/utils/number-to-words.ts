/**
 * A whole amount written out, so a price typed with one zero too many is caught by reading
 * it: "379,000" under the box says "three hundred seventy-nine thousand". Snappfood's panel
 * does this under every price field. Whole numbers only; fractions are dropped.
 */

const FA_ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const FA_TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const FA_TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const FA_HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const FA_SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'هزار میلیارد'];

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const EN_TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function faBelowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(FA_HUNDREDS[h]);
  if (rest >= 10 && rest < 20) parts.push(FA_TEENS[rest - 10]);
  else {
    if (Math.floor(rest / 10)) parts.push(FA_TENS[Math.floor(rest / 10)]);
    if (rest % 10) parts.push(FA_ONES[rest % 10]);
  }
  return parts.join(' و ');
}

function enBelowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(`${EN_ONES[h]} hundred`);
  if (rest >= 10 && rest < 20) parts.push(EN_TEENS[rest - 10]);
  else if (rest) {
    const tens = EN_TENS[Math.floor(rest / 10)];
    const ones = EN_ONES[rest % 10];
    parts.push(tens && ones ? `${tens}-${ones}` : tens || ones);
  }
  return parts.join(' ');
}

/** Splits into groups of three digits, lowest first. */
function groupsOf(n: number): number[] {
  const out: number[] = [];
  let rest = n;
  while (rest > 0) {
    out.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  return out;
}

export function numberToWords(value: string | number, lang: 'fa' | 'en'): string {
  const n = Math.floor(Math.abs(Number(value)));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return lang === 'fa' ? 'صفر' : 'zero';
  const groups = groupsOf(n);
  if (groups.length > FA_SCALES.length) return '';
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (lang === 'fa') {
      // "هزار" alone, not "یک هزار", as it is said.
      const head = i === 1 && g === 1 ? '' : faBelowThousand(g);
      words.push([head, FA_SCALES[i]].filter(Boolean).join(' '));
    } else {
      words.push([enBelowThousand(g), EN_SCALES[i]].filter(Boolean).join(' '));
    }
  }
  return words.join(lang === 'fa' ? ' و ' : ' ');
}
