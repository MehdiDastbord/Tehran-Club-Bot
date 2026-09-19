# Tehran Club Discord Bot — V6

نسخه 6 با تمرکز روی پایداری، Supabase persistence و قابلیت‌های درخواستی Tehran Club.

## قبل از اجرا
1. Node.js 20 یا بالاتر نصب باشد.
2. `npm install`
3. فایل `.env` را از روی `.env.example` بسازید و این موارد را وارد کنید:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID`
   - `OWNER_ID`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. کل فایل `supabase/schema.sql` را در Supabase SQL Editor اجرا کنید. این فایل شامل migrationهای V6 برای دیتابیس‌های V5 هم هست.
5. `npm run deploy`
6. `npm start`

## نقش‌هایی که بات خودش می‌سازد
- `Giveway Acces`
- `Ticket Acces`
- `Ban/Kick Acces`
- `Logs`
- `Exchange`
- `Staff Manager`

## Giveaway / Drop
- `/giveaway`: جایزه + زمان بر حسب دقیقه.
- `/giveawaysv`: جایزه + زمان + لینک.
- `/dropmatn`: متن برنده + جایزه.
- `/dropclick`: جایزه + دکمه.
- Dropها به صورت Embed ارسال می‌شوند.
- متن Drop فقط وقتی برنده می‌شود که متن دقیق تنظیم‌شده ارسال شود.
- ورود Giveaway بعد از پایان مسدود می‌شود.
- ثبت Drop برنده به صورت شرطی انجام می‌شود تا دو نفر همزمان برنده نشوند.

## Ticket
- `/panel`: ساخت Panel با نام، متن، پیام خوشامد، Category، Mention Role، Claim/Close، حداکثر 5 سؤال فرم.
- نام و Emoji دکمه بازکردن قابل تنظیم است.
- Emoji دکمه Claim و Close هم قابل تنظیم است.
- `/menu`: ساخت منوی انتخاب Panel با عنوان، متن و Placeholder قابل تنظیم؛ Emoji هر گزینه از Panel همان گزینه گرفته می‌شود.
- Claim فقط برای دسترسی Ticket است.
- بعد از Claim، صاحب Ticket و Claimant امکان چت دارند.
- `/claimchange`: انتقال Claim به کاربر دارای دسترسی Ticket و حذف SendMessages از Claimant قبلی.
- `/add` و `/remove`.
- `/close` و `/reopen`.
- Transcript ذخیره می‌شود و در حال حاضر 100 پیام آخر را نگه می‌دارد.
- Feedback پنج‌ستاره و متن Feedback.
- `/stats` کانال آمار را تنظیم می‌کند و گزارش هر 6 ساعت ارسال می‌شود.

## Staff
دستورات Staff فقط با رول `Staff Manager`:
- `/hire`
- `/setrole`
- `/setrolee`
- `/rankup`
- `/rankdown`
- `/demote`
- `/warnstaff`
- `/unwarnst`
- `/stats`

Hire قبل از ثبت Staff، امکان اضافه‌کردن Role را بررسی می‌کند و خطای دیتابیس را پنهان نمی‌کند. اگر عضوی Role رنک Staff را داشته باشد ولی رکورد Staff او ناقص باشد، هنگام دستورات Staff قابل بازیابی است.

## Moderation
- `/kick`
- `/ban`
- `/timeout`
- `/warn`
- `/unwarn`
- `/unban`
- `/untimeout`
- `setfosh`
- `deletefosh`
- `whiteuser`

`setfosh` می‌تواند چند کلمه را با کاما بگیرد. پیام دارای کلمه تنظیم‌شده حذف می‌شود و یک Warn در همان جدول Warn ممبر ثبت می‌شود. در 3 Warn، Timeout دو ساعته اعمال می‌شود.

`/unwarn` آخرین Warn ممبر را حذف می‌کند.
`/unwarnst` آخرین Warn Staff را حذف می‌کند.

## Logs
`setch...`ها طبق نسخه قبلی Text Command هستند و بعد از اجرای موفق، پیام دستور حذف می‌شود:
- `setcht`
- `setchfead`
- `setchru`
- `setchhi`
- `setchstw`
- `setchm`
- `setchb`
- `setchto`
- `setchv`
- `setchdm`
- `setchdv`
- `setchwa`
- `setchwel`
- `setchinv`
- `setchlevel`
- `setchg`

## XP
- هر پیام عادی = 1 پیام XP.
- 10 پیام = Level 1.
- 20 پیام = Level 2.
- 30 پیام = Level 3.
- و به همین ترتیب.
- `/setrolexp` برای اتصال Level به Role.
- `/setxp` برای اضافه‌کردن تعداد پیام.
- `/leaderboard`
- `/level`
- `/settextxp`
- `setchlevel`

## Exchange
- `/exchange` یک فرم برای بنر/اطلاعات Exchange باز می‌کند.
- بعد از ارسال فرم، درخواست در همان چتی که دستور اجرا شده با دو دکمه `تایید` و `رد` نمایش داده می‌شود.
- فقط رول `Exchange` می‌تواند این دکمه‌ها را استفاده کند.
- بعد از تأیید، درخواست به کانالی که با `/setex` تنظیم شده ارسال می‌شود.
- `/setbanner` و `/banner` نیز برای بنر سرور وجود دارند.

## Owner
- `/textowner` کانال Relay Owner را تنظیم می‌کند.
- وقتی Owner در آن کانال پیام بدهد، پیام توسط بات Relay می‌شود.
- `/untextowner` Relay را خاموش می‌کند.
- `/createcmd` برای پاسخ خودکار به Keywordهای Owner است.

## محدودیت‌های واقعی
- اتصال واقعی به Discord و Supabase فقط روی VPS و با Secretهای واقعی قابل تست است.
- Transcript فعلی 100 پیام آخر است؛ برای Transcript نامحدود باید pagination پیام‌ها پیاده‌سازی شود.
- Invite attribution در شرایطی مثل استفاده همزمان چند Invite یا Vanity URL ممکن است محدودیت ذاتی Discord داشته باشد.
- XP برای هر پیام یک عملیات Supabase انجام می‌دهد؛ برای سرورهای بسیار شلوغ بهتر است بعداً batching/caching اضافه شود.
- رتبه Staff و Roleهای Staff باید پایین‌تر از بالاترین Role بات باشند تا Discord اجازه مدیریت آن‌ها را بدهد.

- `/deletepanel` — حذف کامل یک Ticket Panel از Discord و Supabase با Panel ID. این دستور فقط برای دسترسی Ticket است.


## تنظیمات جدید Rating و Exchange

- `/setrate #channel` — کانال دریافت Rating تیکت‌ها. بعد از بسته شدن تیکت، صاحب تیکت Rating را در DM دریافت می‌کند و بعد از ثبت امتیاز، پیام Rating شامل امتیاز، صاحب تیکت و Claim کننده در این کانال ثبت می‌شود.
- `/setexlog #channel` — کانال Exchange Log. بعد از تکمیل `/exchange`، درخواست با دو دکمه `ACCEPT` و `DECLINE` در این کانال قرار می‌گیرد.
- `/setex #channel` — کانال نهایی Exchange. فقط درخواست‌های Accept شده به این کانال ارسال می‌شوند. قبل از ارسال، تمام User/Role/Channel/Everyone/Here mentions از متن Exchange حذف و ارسال بدون ping انجام می‌شود.

برای استفاده از Exchange، هر دو `/setexlog` و `/setex` را تنظیم کنید. رول `Exchange` موجود در سیستم برای بررسی درخواست استفاده می‌شود.
