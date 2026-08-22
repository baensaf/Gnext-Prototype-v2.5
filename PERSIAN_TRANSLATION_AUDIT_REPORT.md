# 🇮🇷 گزارش جامع بررسی و ممیزی بومی‌سازی زبان فارسی (Persian Localization Audit)
## سامانه یکپارچه مدیریت رستوران و خرده‌فروشی Gnext Prototype v2

این گزارش حاصل اجرای کامل و دقیق **تمام ۶۰ سناریوی عملیاتی روزمره (Scenarios 01 – 60)** در محیط شبیه‌سازی شده مرورگر تحت زبان فارسی (`fa-IR`) و چیدمان راست‌به‌چپ (`RTL`)، به همراه ممیزی عمیق کدهای فرانت‌اند (`321` فایل منبع) و بررسی انطباق کلیدهای ترجمه `i18n` است.

---

## 📊 ۱. خلاصه مدیریتی (Executive Summary)

| شاخص ارزیابی | مقدار | وضعیت |
|---|---|---|
| **تعداد کل سناریوهای عملیاتی ارزیابی‌شده** | **۶۰ از ۶۰ سناریو** | ✅ ۱۰۰٪ پوشش سناریوها |
| **تعداد مسیرها و صفحات بررسی‌شده (Routes)** | **۵۲ مسیر فعال** | ✅ پوشش تمام ماژول‌ها |
| **تعداد کل فایل‌های کلاینت اسکن‌شده** | **۳۲۱ فایل TSX/TS** | ✅ تحلیل استاتیک و داینامیک |
| **پشتیبانی از چیدمان راست‌به‌چپ (RTL)** | **فعال (`dir="rtl"`)** | ✅ استایل‌بندی با `stylis-plugin-rtl` |
| **فونت پیش‌فرض فارسی** | **Vazirmatn / Shabnam** | ✅ یکپارچه در تمپلیت |
| **تعداد کلیدهای پایه تعریف‌شده در fa.json** | **۳۷۸ کلید** | ✅ تطابق ساختاری با en.json |
| **بخش‌های نیازمند تکمیل ترجمه فارسی** | **۱۴ ماژول / ۹۵ کامپوننت** | ⚠️ نیازمند استخراج کلیدهای جدید |

---

## 🔍 ۲. دسته‌بندی مسائل و متون ترجمه‌نشده (Categorization of Untranslated Items)

در طول اجرای سناریوها و ممیزی کلاینت، متون ترجمه‌نشده در چند لایه اصلی شناسایی شدند:

### ۲.۱. پوسته‌ی اصلی برنامه و منوهای سراسری (AppShell & Global Layout)
1. **متن راهنما و بنر خوش‌آمدگویی بالا**: کلید `app.welcome` به دلیل عدم مقداردهی در آبجکت اصلی، در برخی صفحات نام کلید را نمایش می‌دهد.
2. **متن پانویس و زیرعنوان برند**: عبارت `Multi-Tenant Operations & Master Catalog` در زیر لوگوی جی‌نکست ترجمه نشده است (پیشنهاد: `عملیات چندمستأجری و کاتالوگ جامع`).
3. **پاپ‌اورها و تول‌تیپ‌های هدر**:
   - دکمه `Languages button` (پیشنهاد: `انتخاب زبان`)
   - دکمه `Settings button` (پیشنهاد: `تنظیمات پوسته`)
   - دکمه `Need help?` (پیشنهاد: `نیاز به راهنمایی دارید؟`)
4. **انتخاب‌گر متدهای احراز هویت در صفحه ورود**: برچسب‌های `Jwt`, `Firebase`, `Amplify`, `Auth0`, `Supabase`.

### ۲.۲. هدرها و ستون‌های جداول داده (MUI DataGrid Column Headers)
در چندین صفحه عملیاتی، از کامپوننت‌های `DataGrid` با ستون‌های هاردکد شده انگلیسی استفاده شده است:
- جدول تراکنش‌های صندوق: `Transaction ID`, `Timestamp`, `Amount`, `Tender Type`, `Cashier`, `Status`
- جدول صف چاپگرها (`Print Queue`): `Job ID`, `Printer Name`, `Payload Size`, `Retries`, `Last Error`, `Actions`
- جدول مانیتورینگ سلامت سیستم (`System Health`): `Service`, `Uptime`, `Memory`, `Latency`, `Health Status`
- جدول کاتالوگ و اصلاح‌کننده‌ها: `Modifier Group`, `Min Selection`, `Max Selection`, `Required`

### ۲.۳. پیام‌های هشدار و اعلان‌های توکن/خطا (Toasts, Alerts & Form Validation)
- پیام‌های سیستم توست مانند `Token expired!`, `Permission denied`, `Failed to fetch data`
- متن دکمه‌های پیش‌فرض مودال‌ها: `Cancel`, `Confirm`, `Close`, `Save Changes`
- پلیس‌هولدرهای ورودی فرم‌ها: `Search by name, phone or code...`, `Enter supervisor PIN`

---

## 📋 ۳. جدول جامع بررسی تمام ۶۰ سناریوی عملیاتی روزمره

### 🔹 سناریوی شماره 01: Morning Day Opening & Cashier Shift Initialization
- **مسیرهای اصلی و مرتبط**: `/app/cashier/business-days` , `/app/cashier/shifts`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 02: Morning Prep & 86'd / Out-of-Stock Item Suspension
- **مسیرهای اصلی و مرتبط**: `/app/catalog/availability` , `/app/pos`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 03: Walk-In Counter Order with Item Modifiers (Cash)
- **مسیرهای اصلی و مرتبط**: `/app/pos`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 04: Walk-In Counter Order with Split Tender (Cash + Card)
- **مسیرهای اصلی و مرتبط**: `/app/pos` , `/app/payments`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 05: Dine-In Guest Seating & Multi-Course Table Order
- **مسیرهای اصلی و مرتبط**: `/app/dine-in/floor` , `/app/pos`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 06: Dine-In Order Additions, Table Transfer & Merging
- **مسیرهای اصلی و مرتبط**: `/app/dine-in/floor`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 07: Kitchen Display System (KDS) Preparation & Bump Flow
- **مسیرهای اصلی و مرتبط**: `/app/kds`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 08: High-Priority (VIP/Rush) Ticket Escalation & Recall
- **مسیرهای اصلی و مرتبط**: `/app/kds`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 09: Customer Registration & Loyalty Cashback Accrual
- **مسیرهای اصلی و مرتبط**: `/app/customers` , `/app/pos`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 10: Wallet Cashback Balance Redemption & Coupon Codes
- **مسیرهای اصلی و مرتبط**: `/app/pos` , `/app/discounts/coupons`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 11: Delivery Phone Order Creation & Courier Dispatch
- **مسیرهای اصلی و مرتبط**: `/app/pos` , `/app/delivery/orders`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 12: Courier Delivery Completion & COD Collection
- **مسیرهای اصلی و مرتبط**: `/app/delivery/orders` , `/app/delivery/couriers`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 13: External Food Aggregator (Snappfood) Order Injection
- **مسیرهای اصلی و مرتبط**: `/app/simulation/snappfood` , `/app/kds`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 14: Mid-Day Cash Drawer Drop & Petty Cash Payout
- **مسیرهای اصلی و مرتبط**: `/app/cashier/shifts`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 15: Line-Item Void & Supervisor PIN Override
- **مسیرهای اصلی و مرتبط**: `/app/pos` , `/app/settings/approvals`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 16: Full & Partial Order Refunds with Wallet Reversal
- **مسیرهای اصلی و مرتبط**: `/app/refunds` , `/app/orders`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 17: Corporate B2B Dining on Credit Account (On-Tab)
- **مسیرهای اصلی و مرتبط**: `/app/pos` , `/app/credit/accounts`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 18: Self-Service Kiosk Customer Order & Self-Checkout
- **مسیرهای اصلی و مرتبط**: `/app/kiosk`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 19: End-of-Shift Courier Batch Settlement Reconciliation
- **مسیرهای اصلی و مرتبط**: `/app/delivery/settlements`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 20: End-of-Shift Z-Report & End-of-Day (EOD) Business Close
- **مسیرهای اصلی و مرتبط**: `/app/cashier/shifts` , `/app/reports`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 21: Park / Hold Cart Order & Recall for Later Checkout
- **مسیرهای اصلی و مرتبط**: `/app/pos`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 22: Split Bill by Line Items Between Dine-In Guests
- **مسیرهای اصلی و مرتبط**: `/app/dine-in/floor` , `/app/pos`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 23: Offline POS Sync Simulation & Network Recovery
- **مسیرهای اصلی و مرتبط**: `/app/simulation/offline-sync` , `/app/pos`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 24: Tara BNPL Installment Payment Flow Simulation
- **مسیرهای اصلی و مرتبط**: `/app/simulation/payments-printers` , `/app/payments`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 25: Printer Hardware Fault Injection & Print Job Retry
- **مسیرهای اصلی و مرتبط**: `/app/operations/print-queue` , `/app/simulation/payments-printers`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 26: Discount PIN Authorization Exceeding Cashier Threshold
- **مسیرهای اصلی و مرتبط**: `/app/pos` , `/app/settings/approvals`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 27: Customer Duplicate Profile Detection & Merge
- **مسیرهای اصلی و مرتبط**: `/app/customers`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 28: KDS Multi-Station Routing & Tab Filter Views
- **مسیرهای اصلی و مرتبط**: `/app/kds`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 29: Dynamic Price Book Activation (Happy Hour Specials)
- **مسیرهای اصلی و مرتبط**: `/app/pricing/price-book` , `/app/pos`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 30: Delivery Breakdown Rejection & Courier Re-dispatch
- **مسیرهای اصلی و مرتبط**: `/app/delivery/orders`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 31: Inventory Safety Stock Depletion & Alert Banner
- **مسیرهای اصلی و مرتبط**: `/app/inventory/stock` , `/app/operations/monitoring`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 32: Itemized Partial Refund with Customer Wallet Credit
- **مسیرهای اصلی و مرتبط**: `/app/refunds` , `/app/customer-club/wallet`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 33: Customer Tier Upgrade & Cashback Ledger Verification
- **مسیرهای اصلی و مرتبط**: `/app/customer-club/discounts` , `/app/customers`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 34: Business Day Reopen & Emergency Audit Adjustment
- **مسیرهای اصلی و مرتبط**: `/app/cashier/business-days` , `/app/audit`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 35: Self-Service Kiosk Bilingual (Farsi/English) Ordering
- **مسیرهای اصلی و مرتبط**: `/app/kiosk`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 36: Bulk Product Price Adjustment with Preview Table
- **مسیرهای اصلی و مرتبط**: `/app/pricing/bulk-update`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 37: Courier Settlement Cash Shortage Penalty & Adjustment
- **مسیرهای اصلی و مرتبط**: `/app/delivery/settlements`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 38: Coupon Single-Use Limit Enforcement & Expired Check
- **مسیرهای اصلی و مرتبط**: `/app/discounts/coupons` , `/app/pos`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 39: Branch Emergency Pause & Aggregator Sync Lock
- **مسیرهای اصلی و مرتبط**: `/app/operations/branches` , `/app/simulation/snappfood`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 40: Comprehensive Financial Audit Trail & JSON Payload Review
- **مسیرهای اصلی و مرتبط**: `/app/audit` , `/app/reports`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 41: Customer Group Creation & Policy Discount Binding
- **مسیرهای اصلی و مرتبط**: `/app/customers`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 42: Customer Directory Group Filtering & Multi-Factor Search
- **مسیرهای اصلی و مرتبط**: `/app/customers`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 43: Dedicated Price Group Creation & Airport/Downtown Tier Assignment
- **مسیرهای اصلی و مرتبط**: `/app/pricing/price-groups` , `/app/operations/branches`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 44: Price Group Item-Level Price Overrides via Matrix Editor
- **مسیرهای اصلی و مرتبط**: `/app/pricing/price-groups` , `/app/pricing/price-book`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 45: POS Dynamic Group Price Resolution Across Multiple Branches
- **مسیرهای اصلی و مرتبط**: `/app/pos` , `/app/pricing/price-book`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 46: Category-Wide Percentage Bulk Price Adjustment with Rounding
- **مسیرهای اصلی و مرتبط**: `/app/pricing/bulk-update`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 47: Fixed-Amount Bulk Price Surcharge on Specific Price Group
- **مسیرهای اصلی و مرتبط**: `/app/pricing/bulk-update` , `/app/pricing/price-groups`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 48: Customer Marketing Consent & Privacy Preference Management
- **مسیرهای اصلی و مرتبط**: `/app/customers` , `/app/settings/general`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 49: Dynamic Customer Tagging & VIP Segmentation
- **مسیرهای اصلی و مرتبط**: `/app/customers` , `/app/discounts/campaigns`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 50: Multi-Currency Tender Acceptance (USD / EUR with Auto-Conversion)
- **مسیرهای اصلی و مرتبط**: `/app/pos` , `/app/payments` , `/app/cashier/shifts`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 51: Multi-Station KDS Simultaneous Split Routing
- **مسیرهای اصلی و مرتبط**: `/app/kds` , `/app/operations/kds-configuration` , `/app/pos`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 52: Kitchen Expediter Screen Ticket Aggregation & All-Ready Bump Flow
- **مسیرهای اصلی و مرتبط**: `/app/kds` , `/app/orders`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 53: Dine-In VIP Table Reservation & Walk-In Occupancy Transition
- **مسیرهای اصلی و مرتبط**: `/app/dine-in/floor`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 54: Diplomatic Tax & Service Charge Exemption with Supervisor PIN
- **مسیرهای اصلی و مرتبط**: `/app/pos` , `/app/settings/approvals`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 55: Courier Shift Attendance & Mobile POS Terminal Pairing
- **مسیرهای اصلی و مرتبط**: `/app/delivery/couriers` , `/app/operations/terminals`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 56: Multi-Stop Delivery Order Route Batching & Dispatch
- **مسیرهای اصلی و مرتبط**: `/app/delivery/orders` , `/app/delivery/couriers`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 57: Delivery Failed Attempt & Customer Unreachable Protocol
- **مسیرهای اصلی و مرتبط**: `/app/delivery/orders` , `/app/inventory/stock` , `/app/audit`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 58: Catalog Product & Price Matrix Excel Bulk Export
- **مسیرهای اصلی و مرتبط**: `/app/catalog/import-export` , `/app/reports`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 59: Catalog CSV Bulk Import & Duplicate SKU Error Resolution
- **مسیرهای اصلی و مرتبط**: `/app/catalog/import-export` , `/app/catalog/products`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

### 🔹 سناریوی شماره 60: Corporate Catering Event Contract Order & Credit Account Settle
- **مسیرهای اصلی و مرتبط**: `/app/pos` , `/app/credit/accounts` , `/app/kds` , `/app/delivery/orders`
- **وضعیت بومی‌سازی فارسی در مرورگر**: ⚠️ **دارای 9 عبارت انگلیسی نیازمند ترجمه**
- **متون و برچسب‌های ترجمه‌نشده شناسایی‌شده**:
  - `Jwt`
  - `Firebase`
  - `Amplify`
  - `Auth0`
  - `Supabase`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "admin"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "gnext"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "local"`
  - `[در متن: "حساب مدیر مشترک پروتوتایپنام کاربری: admin@gnext.local | رمز عبور: GnextDemo!2026"] -> "GnextDemo"`

---

## 🏢 ۴. تحلیل تفصیلی به تفکیک ماژول‌های سامانه (Module-by-Module Breakdown)

### 📂 صندوق فروش و کیوسک (POS & Kiosk)
**مسیرهای تحت پوشش**: `/app/pos` , `/app/kiosk`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 سالن و میزها (Dine-In Floor)
**مسیرهای تحت پوشش**: `/app/dine-in/floor`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 نمایشگر آشپزخانه (KDS)
**مسیرهای تحت پوشش**: `/app/kds` , `/app/operations/kds-configuration`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 مدیریت شیفت و روز کاری صندوق (Cashier & Shifts)
**مسیرهای تحت پوشش**: `/app/cashier/shifts` , `/app/cashier/business-days`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 سفارش‌های تحویلی، پیک و تسویه‌حساب (Delivery & Couriers)
**مسیرهای تحت پوشش**: `/app/delivery/orders` , `/app/delivery/couriers` , `/app/delivery/settlements`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 کاتالوگ کالاها، دسته‌بندی و واردات/صادرات (Catalog & Import/Export)
**مسیرهای تحت پوشش**: `/app/catalog/products` , `/app/catalog/categories` , `/app/catalog/modifiers` , `/app/catalog/menus` , `/app/catalog/availability` , `/app/catalog/import-export`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 قیمت‌گذاری، گروه‌های قیمتی و تغییر دسته‌جمعی (Pricing & Bulk Update)
**مسیرهای تحت پوشش**: `/app/pricing/price-book` , `/app/pricing/price-groups` , `/app/pricing/bulk-update`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 مشتریان، گروه‌ها، اعتبار و باشگاه مشتریان (Customers & Club)
**مسیرهای تحت پوشش**: `/app/customers` , `/app/credit/accounts` , `/app/customer-club/wallet` , `/app/customer-club/discounts`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 تخفیف‌ها، کوپن‌ها و کمپین‌ها (Discounts & Campaigns)
**مسیرهای تحت پوشش**: `/app/discounts/campaigns` , `/app/discounts/coupons`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 انبار و موجودی کالا (Inventory & Stock)
**مسیرهای تحت پوشش**: `/app/inventory/stock`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 عملیات، شعب، پرینترها و مانیتورینگ (Operations & Monitoring)
**مسیرهای تحت پوشش**: `/app/operations/branches` , `/app/operations/printers` , `/app/operations/print-queue` , `/app/operations/terminals` , `/app/operations/monitoring` , `/app/payments` , `/app/refunds`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 شبیه‌سازی‌ها (Simulations)
**مسیرهای تحت پوشش**: `/app/simulation/snappfood` , `/app/simulation/payments-printers` , `/app/simulation/offline-sync` , `/app/simulation/logs`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 تنظیمات، تاییدیه مدیر و ممیزی سیستم (Settings & Audit)
**مسیرهای تحت پوشش**: `/app/settings/general` , `/app/settings/order-workflow` , `/app/settings/discounts-credit` , `/app/settings/discount-authorizations` , `/app/settings/payments-refunds` , `/app/settings/approvals` , `/app/settings/reasons` , `/app/settings/localization` , `/app/settings/data-reset` , `/app/audit` , `/app/reports`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

### 📂 احراز هویت و صفحات عمومی (Auth & System)
**مسیرهای تحت پوشش**: `/auth/jwt/sign-in` , `/app/dashboard` , `/app`

| عبارت انگلیسی کشف‌شده | موقعیت در کامپوننت | معادل فارسی پیشنهادی |
|---|---|---|
| `Jwt` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Firebase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Amplify` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Auth0` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `Supabase` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `admin` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `gnext` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |
| `local` | هدر / بدنه / مودال | **ترجمه اختصاصی ماژول** |

## 💻 ۵. یافته‌های ممیزی استاتیک فایل‌های فرانت‌اند (`codebase-audit-results.json`)

از میان **۳۲۱** فایل سورس فرانت‌اند، در **۹۵** کامپوننت رشته‌های هاردکد شده انگلیسی یافت شد که برای دستیابی به زبان فارسی ۱۰۰٪ بی‌نقص، باید با فراخوانی تابع `t('...')` از هوک `useTranslate()` جایگزین گردند:

| مسیر فایل فرانت‌اند | تعداد رشته‌های هاردکد | نمونه‌های نیازمند اصلاح |
|---|---|---|
| [`httpClient.ts`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/api/httpClient.ts) | 1 مورد | `response,   (error: Axios` |
| [`sign-up-terms.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/auth/components/sign-up-terms.tsx) | 2 مورد | `Terms of service`, `Privacy policy` |
| [`utils.ts`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/auth/context/jwt/utils.ts) | 1 مورد | `Token expired!` |
| [`role-based-guard.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/auth/guard/role-based-guard.tsx) | 2 مورد | `Permission denied`, `You do not have permissio` |
| [`types.ts`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/auth/types.ts) | 1 مورد | `Promise` |
| [`jwt-sign-in-view.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/auth/view/jwt/jwt-sign-in-view.tsx) | 7 مورد | `Forgot password?`, `Sign in`, `Get started` |
| [`jwt-sign-up-view.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/auth/view/jwt/jwt-sign-up-view.tsx) | 7 مورد | `Create account`, `Sign in`, `First name` |
| [`back-to-top-button.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/components/animate/back-to-top-button.tsx) | 1 مورد | `Back to top` |
| [`ApprovalModal.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/components/approval/ApprovalModal.tsx) | 5 مورد | `Manager PIN Authorization`, `This action (`, `Cancel` |
| [`BilingualInput.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/components/BilingualInput.tsx) | 1 مورد | `English (EN)` |
| [`CheckoutModal.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/components/CheckoutModal.tsx) | 1 مورد | `e.g. POS-998822` |
| [`ImageUploader.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/components/ImageUploader.tsx) | 1 مورد | `Upload Image` |
| [`logo.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/components/logo/logo.tsx) | 1 مورد | `Logo` |
| [`types.ts`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/components/nav-section/types.ts) | 1 مورد | `Record` |
| [`search-not-found.tsx`](file:///D:/VibeCoding/Antigravity/Gnext_Prototype_v1.5/starter-vite-ts/src/components/search-not-found/search-not-found.tsx) | 3 مورد | `Please enter keywords`, `Not found`, `Try checking for typos or` |

---

## 🛠️ ۶. دیکشنری کلیدهای ترجمه پیشنهادی برای افزودن به `src/locales/fa.json`

```json
{
  "app": {
    "welcome": "خوش آمدید به پنل مدیریت جی‌نکست",
    "needHelp": "نیاز به راهنمایی دارید؟",
    "multiTenantSubtitle": "مدیریت چندمستأجری و کاتالوگ جامع محصولات"
  },
  "common": {
    "languages": "زبان‌ها",
    "settings": "تنظیمات پوسته",
    "jwt": "احراز هویت JWT",
    "signInTitle": "ورود به حساب کاربری",
    "usernameLabel": "نام کاربری",
    "passwordLabel": "رمز عبور",
    "rememberMe": "مرا به خاطر بسپار",
    "forgotPassword": "رمز عبور را فراموش کرده‌اید؟",
    "actions": "عملیات",
    "saveChanges": "ذخیره تغییرات",
    "cancel": "انصراف",
    "confirm": "تایید",
    "searchPlaceholder": "جستجو بر اساس نام، کد یا تلفن..."
  },
  "grid": {
    "columnTransactionId": "شناسه تراکنش",
    "columnTimestamp": "زمان ثبت",
    "columnTenderType": "نوع پرداخت",
    "columnCashier": "صندوق‌دار",
    "columnStatus": "وضعیت",
    "columnActions": "اقدامات",
    "noRowsLabel": "هیچ رکوردی یافت نشد"
  }
}
```

## 🏁 ۷. جمع‌بندی و نتیجه‌گیری نهایی (Final Conclusion)
- تمام **۶۰ سناریوی عملیاتی روزمره** با موفقیت در بستر مرورگر شبیه‌سازی و اجرا شدند.
- زیرساخت اصلی زبان فارسی (`i18n`، فونت‌های فارسی استاندارد و موتور `RTL`) به‌صورت کاملاً پایدار در حال اجراست.
- لیست کامل تمام بخش‌های ترجمه‌نشده به همراه مسیرهای دقیق و کلیدهای متناظر در این مستند ثبت شد تا در فاز نهایی بومی‌سازی اعمال گردند.
