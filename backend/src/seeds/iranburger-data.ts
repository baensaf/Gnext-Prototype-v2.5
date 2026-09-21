/**
 * Iran Burger (ایران برگر), the chain the demo tenant now represents.
 *
 * Sources, gathered 2026-09-21:
 * - Categories, product codes and names: the chain's own product list
 *   ("دسته بندی محصولات.txt.xlsx"). Only items with a published price are carried; the
 *   rest (Italian pizzas, single-serve meals, drinks, sauces, breads) had none.
 * - Prices: the chain's online menu, iranburgermenu.ir, which lists them in thousands of
 *   toman. They are stored here in rial (x 10,000). The menu's temporary "special offer"
 *   discounts are left out; these are the list prices.
 * - Photos: the chain's own product photos, resized to 800px, in seed-assets/iranburger.
 * - Branches: the Balad map listings for Iran Burger in Tehran and Shiraz. The chain says
 *   it has 40 branches; these are the 23 with a public listing. Phones are as listed.
 */

export const IRANBURGER_TENANT_NAME = 'ایران برگر';

export interface IranBurgerBranch {
  code: string;
  name: string;
  address: string;
  phone: string | null;
  branchType?: 'RESTAURANT' | 'COMMISSARY';
  /** The name this row carried before the rebrand, so an existing database is renamed in place. */
  legacyName?: string;
}

export const IRANBURGER_BRANCHES: IranBurgerBranch[] = [
  // The first three keep the codes of the old demo storefronts, so their terminals, printers,
  // floors, demo accounts and order history carry over unchanged.
  { code: 'TEH-CENTRAL', name: 'ایران برگر مرکزی شعبه ۱ (نصرت)', address: 'تهران، نصرت، بلوار کشاورز، خ دکتر قریب، خ طوسی', phone: '02166126097', legacyName: 'Central Plaza' },
  { code: 'TEH-DOWNTOWN', name: 'ایران برگر (ولیعصر)', address: 'تهران، ولیعصر، خ. زیرگذر چهارراه ولیعصر', phone: '09121157021', legacyName: 'Downtown Express' },
  { code: 'TEH-NORTH', name: 'ایران برگر (هروی)', address: 'تهران، حسین آباد، خ موسوی بین مکران جنوبی و گلستان پنجم', phone: '02122968319', legacyName: 'Northside Grill' },
  { code: 'TEH-KARGAR', name: 'ایران برگر (کارگر شمالی)', address: 'تهران، نصرت، خ. کارگر شمالی، خ. طباطبایی', phone: '02166127008' },
  { code: 'TEH-VALIASR-CAFE', name: 'کافه ایران برگر (ولیعصر)', address: 'تهران، چهارراه ولیعصر به سمت میدان انقلاب، قبل از خیابان مظفر', phone: '02166492142' },
  { code: 'TEH-YAKHCHIABAD', name: 'ایران برگر (یاخچی آباد)', address: 'تهران، یاخچی آباد، میدان بهشت', phone: '02155011176' },
  { code: 'TEH-DADMAN', name: 'ایران برگر (دادمان)', address: 'تهران، سپهر، بلوار دادمان، خ فایز دشتی', phone: '02188374030' },
  { code: 'TEH-KIANSHAHR', name: 'ایران برگر (کیانشهر)', address: 'تهران، کیانشهر شمالی، بلوار امام رضا، خ احدی، خ آل ابراهیم', phone: '02133617003' },
  { code: 'TEH-AZADI', name: 'ایران برگر (شهرک آزادی)', address: 'تهران، شهرک آزادی، میدان پلیس، خ امام خمینی', phone: null },
  { code: 'TEH-ZAFAR', name: 'ایران برگر (ظفر)', address: 'تهران، ظفر، بلوار نلسون ماندلا بین صانعی و شریفی', phone: '02188660667' },
  { code: 'TEH-HEKMAT', name: 'ایران برگر (حکمت)', address: 'تهران، حکمت، بلوار اندرزگو بین آشتیانی منفرد و احمدی', phone: '02122399007' },
  { code: 'SHZ-NIAYESH', name: 'ایران برگر (نیایش)', address: 'شیراز، ابیوردی، بلوار چمران، بلوار نیایش نبش کوچه ۱۰', phone: '09170917240' },
  { code: 'SHZ-YAS', name: 'ایران برگر (کوی یاس)', address: 'شیراز، کوی یاس، بلوار قدوسی غربی', phone: null },
  { code: 'SHZ-SANAYE', name: 'ایران برگر (صنایع)', address: 'شیراز، حسین آباد، بلوار میرزای شیرازی غربی', phone: '07136251515' },
  { code: 'SHZ-MAHALLATI', name: 'ایران برگر (محلاتی جنوبی)', address: 'شیراز، بلوار محلاتی جنوبی، نبش کوچه ۶', phone: '07138474000' },
  { code: 'SHZ-SERAJ', name: 'ایران برگر (شهرک سراج)', address: 'شیراز، شهرک سراج، بلوار پاسارگاد غربی', phone: '07138374000' },
  { code: 'SHZ-FALAKEH-GAS', name: 'ایران برگر (فلکه گاز)', address: 'شیراز، باغ تخت، بلوار قدس', phone: '07132277776' },
  { code: 'SHZ-VALFAJR', name: 'ایران برگر (والفجر)', address: 'شیراز، بلوار امیرکبیر', phone: '09170917154' },
  { code: 'SHZ-FADAK', name: 'ایران برگر (فدک)', address: 'شیراز، کوی زهرا، بلوار فدک', phone: '07137352020' },
  { code: 'SHZ-KASAEI', name: 'ایران برگر (کسایی)', address: 'شیراز، معالی آباد، تقاطع کسایی و دوستان', phone: '07136344030' },
  { code: 'SHZ-AFIFABAD', name: 'ایران برگر (عفیف آباد)', address: 'شیراز، عفیف آباد، خ عفیف آباد بیستم', phone: '07136269000' },
  { code: 'SHZ-KIANSHAHR', name: 'ایران برگر (کیان شهر)', address: 'شیراز، کیان شهر، خ پست', phone: null },
  { code: 'SHZ-MODARES', name: 'ایران برگر (بلوار مدرس)', address: 'شیراز، بریجستون، کنارگذر مدرس', phone: '07137200029' },
  // Not a public listing: the demo's production kitchen, kept so the chain still shows a
  // location that prepares food without selling it.
  { code: 'TEH-COMMISSARY', name: 'آشپزخانه مرکزی', address: 'تهران، منطقه صنعتی', phone: null, branchType: 'COMMISSARY', legacyName: 'Central Production Kitchen' },
];

export interface IranBurgerCategory {
  code: string;
  name: string;
  /** Product code whose photo stands for the category. */
  photo: string;
}

export const IRANBURGER_CATEGORIES: IranBurgerCategory[] = [
  { code: 'IB-BURGER', name: 'برگر', photo: '101001' },
  { code: 'IB-SANDWICH', name: 'ساندویچ', photo: '102017' },
  { code: 'IB-PIZZA', name: 'پیتزا', photo: '11106' },
  { code: 'IB-STROMBOLI', name: 'استرامبولی', photo: '11502' },
  { code: 'IB-FRIED', name: 'سوخاری', photo: '103019' },
  { code: 'IB-COMBO', name: 'کمبو', photo: '11303' },
  { code: 'IB-KIDS', name: 'منوی کودک', photo: '11403' },
  { code: 'IB-MINI', name: 'مینی', photo: '101050' },
  { code: 'IB-SIDES', name: 'سالاد و پیش غذا', photo: '104003' },
];

export interface IranBurgerProduct {
  code: string;
  category: string;
  name: string;
  /** Rial. */
  price: number;
  /** Whether seed-assets/iranburger/<code>.jpg exists. */
  photo: boolean;
}

// Rial from the menu's thousands of toman.
const t = (thousandToman: number) => thousandToman * 10_000;

export const IRANBURGER_PRODUCTS: IranBurgerProduct[] = [
  { code: '101001', category: 'IB-BURGER', name: 'ایران برگر', price: t(940), photo: true },
  { code: '101005', category: 'IB-BURGER', name: 'چوریتسو برگر', price: t(960), photo: true },
  { code: '101009', category: 'IB-BURGER', name: 'دوبل برگر', price: t(1100), photo: true },
  { code: '101002', category: 'IB-BURGER', name: 'چیز ماشروم برگر', price: t(840), photo: true },
  { code: '101004', category: 'IB-BURGER', name: 'باربیکیو برگر', price: t(755), photo: true },
  { code: '101042', category: 'IB-BURGER', name: 'میکس برگر', price: t(750), photo: true },
  { code: '101054', category: 'IB-BURGER', name: 'چیز برگر', price: t(740), photo: true },
  { code: '101003', category: 'IB-BURGER', name: 'سیمپل برگر', price: t(710), photo: true },
  { code: '101008', category: 'IB-BURGER', name: 'هالوپینو برگر', price: t(680), photo: true },
  { code: '101022', category: 'IB-BURGER', name: 'ساندویچ گریل فیلت', price: t(645), photo: true },
  { code: '101013', category: 'IB-BURGER', name: 'همبر دهه شصتی', price: t(620), photo: true },
  { code: '101012', category: 'IB-BURGER', name: 'زینگر برگر', price: t(580), photo: true },

  { code: '102016', category: 'IB-SANDWICH', name: 'هات میت', price: t(1350), photo: true },
  { code: '102017', category: 'IB-SANDWICH', name: 'گوشت تنوری', price: t(1070), photo: true },
  { code: '102005', category: 'IB-SANDWICH', name: 'ساندویچ هات داگ سوخاری', price: t(850), photo: true },
  { code: '102001', category: 'IB-SANDWICH', name: 'ساندویچ هات داگ تنوری', price: t(820), photo: true },
  { code: '102006', category: 'IB-SANDWICH', name: 'ساندویچ کریسپی چیکن نرمال', price: t(790), photo: true },
  { code: '102010', category: 'IB-SANDWICH', name: 'ساندویچ کریسپی چیکن اسپایسی', price: t(790), photo: true },

  { code: '11107', category: 'IB-PIZZA', name: 'پیتزا رست بیف ۳۰ سانتی دو نفره', price: t(1350), photo: true },
  { code: '11108', category: 'IB-PIZZA', name: 'پیتزا قارچ و گوشت ۳۰ سانتی دو نفره', price: t(1290), photo: true },
  { code: '11109', category: 'IB-PIZZA', name: 'پیتزا پپرونی ۳۰ سانتی دو نفره', price: t(1130), photo: true },
  { code: '11106', category: 'IB-PIZZA', name: 'پیتزا مخلوط ۳۰ سانتی دو نفره', price: t(1100), photo: true },
  { code: '11110', category: 'IB-PIZZA', name: 'پیتزا مرغ ۳۰ سانتی دو نفره', price: t(1050), photo: true },

  { code: '11502', category: 'IB-STROMBOLI', name: 'استرامبولی رست بیف', price: t(950), photo: true },
  { code: '11504', category: 'IB-STROMBOLI', name: 'استرامبولی هات داگ نرمال', price: t(910), photo: true },
  { code: '11506', category: 'IB-STROMBOLI', name: 'استرامبولی هات داگ اسپایسی', price: t(910), photo: true },
  { code: '11500', category: 'IB-STROMBOLI', name: 'استرامبولی گوشت و پنیر', price: t(850), photo: true },
  { code: '11505', category: 'IB-STROMBOLI', name: 'استرامبولی ژامبون', price: t(780), photo: true },
  { code: '11501', category: 'IB-STROMBOLI', name: 'استرامبولی فیله مرغ', price: t(780), photo: true },

  { code: '103019', category: 'IB-FRIED', name: 'فول فیله', price: t(1120), photo: true },
  { code: '103002', category: 'IB-FRIED', name: 'فیله استریپس چهار تکه', price: t(990), photo: true },
  { code: '103015', category: 'IB-FRIED', name: 'فیله استریپس سه تکه', price: t(840), photo: true },

  { code: '11303', category: 'IB-COMBO', name: 'کمبو آبی', price: t(975), photo: true },
  { code: '11304', category: 'IB-COMBO', name: 'کمبو صورتی', price: t(1550), photo: true },
  { code: '11305', category: 'IB-COMBO', name: 'کمبو سبز', price: t(2700), photo: true },

  { code: '11400', category: 'IB-KIDS', name: 'توپک', price: t(830), photo: false },
  { code: '11403', category: 'IB-KIDS', name: 'هپی پک گوشت پسرانه', price: t(650), photo: true },
  { code: '11404', category: 'IB-KIDS', name: 'هپی پک گوشت دخترانه', price: t(650), photo: true },
  { code: '11406', category: 'IB-KIDS', name: 'هپی پک مرغ پسرانه', price: t(600), photo: true },
  { code: '11405', category: 'IB-KIDS', name: 'هپی پک مرغ دخترانه', price: t(600), photo: true },

  { code: '103016', category: 'IB-MINI', name: 'مینی فیله استریپس', price: t(610), photo: true },
  { code: '101051', category: 'IB-MINI', name: 'مینی چیز ماشروم', price: t(450), photo: true },
  { code: '101050', category: 'IB-MINI', name: 'مینی زینگر', price: t(430), photo: true },

  { code: '104002', category: 'IB-SIDES', name: 'سالاد سزار پلاس', price: t(700), photo: true },
  { code: '104001', category: 'IB-SIDES', name: 'سالاد فصل', price: t(390), photo: true },
  { code: '104004', category: 'IB-SIDES', name: 'قارچ سوخاری', price: t(340), photo: true },
  { code: '104003', category: 'IB-SIDES', name: 'سیب زمینی سرخ شده', price: t(270), photo: true },
  { code: '104005', category: 'IB-SIDES', name: 'پیاز سوخاری', price: t(270), photo: true },
  { code: '104019', category: 'IB-SIDES', name: 'مینی سیب زمینی', price: t(130), photo: true },
];

/** The old demo catalogue, retired (not deleted) so orders that sold it still resolve. */
export const LEGACY_PRODUCT_CODES = ['PROD-CHEESEBURGER', 'PROD-FRIES', 'PROD-COLA'];
export const LEGACY_CATEGORY_CODE = 'CAT-FASTFOOD';
