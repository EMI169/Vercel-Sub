🛡 Sub Panel — پنل مدیریت ساب‌لینک






پشتیبانی چند-کاربره، دو زبان و تم روشن/تیره.
✨ امکانات
🔗 لینک ثابت برای هر بخش — آدرس لینک هیچ‌وقت عوض نمی‌شود؛ محتوا با هر ذخیره به‌روز می‌شود
🆕 افزودن بخشِ بی‌نهایت با دکمه‌ی «+» — تا ۲۰۰ بخش برای هر کاربر
♻️ تعویض آدرس — لینک جدید تصادفی؛ لینک قدیمی بلافاصله از کار می‌افتد
✂️ کوتاه‌سازی لینک (is.gd) + نمایش QR برای هر لینک
📦 ظرفیت بالا: تا ۲۵۶ کیلوبایت متن در هر بخش (~۱۰۰۰+ کانفیگ)
👥 چند-کاربره — نقش ادمین/کاربر؛ ادمین کاربران را می‌سازد، نقش عوض می‌کند و حذف می‌کند
🔐 ورود سرور-ساید: نشست‌ها در دیتابیس؛ رمزها SHA-256 + salt
🌐 دو زبان (فارسی/English) + تم روشن/تیره — با ذخیره‌ی انتخاب
📊 آمار زنده: تعداد بخش‌ها، کانفیگ‌ها، لینک‌ها و ساعتِ آخرین ذخیره
📱 کاملاً ریسپانسیو — موبایل و دسکتاپ
🧩 خروجی استاندارد base64 — سازگار با v2rayNG / PattNG و سایر اپ‌ها



🛠 معماری
GitHub (کدها) → Vercel (اجرا) ⇄ Supabase (دیتابیس)

```
| فایل | نقش ||---|---|| `public/index.html` | کل رابط کاربری (لاگین + پنل) || `api/auth.js` | ورود / ثبت‌نام / خروج / تغییر رمز || `api/sections.js` | ساخت/ویرایش/حذف بخش‌ها + ساخت/تعویض لینک || `api/admin.js` | مدیریت کاربران (فقط ادمین) || `api/sub/[data].js` | پاسخ به درخواست لینک ساب || `vercel.json` | مسیریابی لینک‌های `/s/` |### جداول دیتابیس (Supabase / Postgres)- `users` — کاربران (username، هش رمز، نقش)- `sections` — بخش‌ها (عنوان، متن، شناسه‌ی لینک)- `sessions` — نشست‌های ورود## 🚀 راه‌اندازی از صفر۱. مخزن را Fork کنید.۲. در [Supabase](https://supabase.com) یک پروژه بسازید و در **SQL Editor** این اسکریپت را اجرا کنید:```sqlcreate table if not exists users (  id uuid primary key default gen_random_uuid(),  username text unique not null,  pass_hash text not null,  salt text not null,  role text not null default 'user',  created_at timestamptz default now());create table if not exists sections (  id uuid primary key default gen_random_uuid(),  user_id uuid not null references users(id) on delete cascade,  title text not null default '',  content text not null default '',  sub_key text unique,  sort_no int not null default 0,  created_at timestamptz default now());create table if not exists sessions (  token text primary key,  user_id uuid not null references users(id) on delete cascade,  expires_at timestamptz not null,  created_at timestamptz default now());insert into users (username, pass_hash, salt, role)values ('admin', 'DEFAULT', 'DEFAULT', 'admin')on conflict (username) do nothing;
```


۳. در Vercel پروژه بسازید و در Environment Variables این دو متغیر را قرار دهید:

NameValueSUPABASE_URLProject URL (از Settings → API)SUPABASE_SERVICE_KEYSecret key (service_role — نه anon)



🔑 ورود اولین بار
نام کاربری: admin
رمز: admin
پنل بلافاصله صفحه‌ی «تعیین رمز مدیر» را باز می‌کند — یک رمز جدید (حداقل ۵ نویسه) بگذارید. رمز پیش‌فرض فقط یک بار قابلاستفاده است و تا عوضش نکنید، پنل هشدار می‌دهد.


.

📱 استفاده
۱. وارد پنل شوید → دکمه‌ی «+» → بخش جدید بسازید.
۲. کانفیگ‌ها را در کادر بنویسید (هر کانفیگ یک خط) — ذخیره‌ی خودکار انجام می‌شود.
۳. «ساخت لینک» → لینک ثابت بخش ساخته شد → «کپی» یا «QR» یا «کوتاه‌سازی».
۴. لینک را در v2rayNG / PattNG بدهید: ＋ → ایجاد اشتراک با آدرس.
۵. بعد از هر تغییرِ شما، طرف مقابل فقط «به‌روزرسانی اشتراک» را می‌زند — آدرس ثابت می‌ماند.
۶. اگر لینکی لو رفت: «تعویض آدرس» — لینک قدیمی همان لحظه از کار می‌افتد.

🔐 نکات امنیتی
لینک ساب = رمز. هر کس لینک را داشته باشد، کانفیگ‌ها را می‌بیند.
توکن‌ها فقط در Environment Variables می‌مانند — هرگز داخل کد یا مخزن قرار نگیرند.
Secret key فقط در صفحه‌ی تنظیمات Vercel وارد شود؛ هیچ سایت دیگری معتبر نیست.
برای اکانت ادمین، رمزی حداقل ۸ نویسه با حروف و عدد بگذارید.


🧰 عیب‌یابی



📄 مجوز
MIT

**نحوه‌ی گذاشتنش در مخزن:** مثل بقیه‌ی فایل‌ها — Add file → Create new file → اسم: `README.md` → این متن Paste → Commit. GitHub خودش این فایل رو به‌صورت زیبا زیرِ لیستِ مخزن نشون می‌ده.تأثیری روی اجرای پروژه نداره — فقط مستندات و راهنماست.قرارش دادی؟ خبر بده — بعدش قدمِ آخر و تنها مانده: **دو متغیر Supabase در Vercel → Redeploy → ورود admin/admin → تست پنل.** 🚀




