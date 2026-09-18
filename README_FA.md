
# Tehran Club Bot V5 — Supabase

این نسخه سایت و Dashboard ندارد. فقط Discord Bot + Supabase Database است.

## نصب روی VPS

1. Node.js 20 یا جدیدتر نصب باشد.
2. `npm install`
3. فایل `.env.example` را به `.env` تبدیل کن و مقدارها را وارد کن.
4. داخل Supabase بخش SQL Editor، فایل `supabase/schema.sql` را کامل اجرا کن.
5. `npm run deploy`
6. `npm start`

## متغیرها

- DISCORD_TOKEN
- CLIENT_ID
- GUILD_ID
- OWNER_ID
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

`SUPABASE_SERVICE_ROLE_KEY` فقط روی VPS باشد و هرگز داخل کد فرانت‌اند یا جای عمومی قرار نگیرد.

## نقش‌های خودکار

بات در هر سرور این نقش‌ها را در صورت نبودن می‌سازد:

- Giveaway Access
- Ticket Access
- Ban/Kick Access
- Logs
- Exchange

Administrator همیشه دسترسی مدیریتی دارد.

## تنظیم کانال‌ها

تمام `setch...` ها Text Command هستند و بعد از موفقیت، پیام تنظیمات حذف می‌شود؛ مثال:

`setcht #ticket-logs`

`setchm #message-logs`

`setchwel #welcome`

`setchinv #invites`

## Ticket

ساخت Panel با `/panel`، انتخاب دسته با `/Menu`، Claim، Claim Change، Add، Close و Reopen در معماری Supabase ذخیره می‌شوند. Ticketها در DB باقی می‌مانند تا بعداً قابل بازگشایی/گزارش‌گیری باشند.

## نکته

این اسکلت V5 است و ساختار Supabase و هسته قابلیت‌ها را آماده می‌کند؛ برای استفاده production باید قبل از انتشار نهایی، همه permission overwriteها، transcript، DM feedback، invite cache و تمام فرم‌های Ticket Tool-style تست شوند.
