# Tehran Club Bot V5 - VPS + Supabase

این نسخه همه قابلیت‌های درخواستی را در یک پروژه جمع می‌کند و داده‌های دائمی را در Supabase نگه می‌دارد.

## Variables
```env
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=
OWNER_ID=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## نصب روی VPS
1. Node.js 22+ پیشنهاد می‌شود؛ package.json حداقل Node 22 را مشخص کرده است.
اگر Railway نسخه دیگری نشان داد، Deployment Logs را بررسی کن.
2. `npm install`
3. فایل `.env` را از روی `.env.example` بساز و مقادیر را وارد کن.
4. محتوای `supabase/schema.sql` را یک بار در Supabase SQL Editor اجرا کن.
5. `node src/deploy-commands.js`
6. `node src/index.js`

## Access Roleها
بات در شروع خودش می‌سازد:
- `Giveway Acces`
- `Ticket Acces`
- `Ban/Kick Acces`
- `Logs`
- `Exchange`
- `Staff Acces`

## نکته مهم درباره setch
تمام دستورهایی که با `setch` شروع می‌شوند **Prefix/Text Command** هستند و با `/` نیستند. فقط Administrator می‌تواند آن‌ها را اجرا کند و بعد از موفقیت پیام دستور حذف می‌شود.

نمونه:
`setcht #ticket-logs`
`setchm #message-logs`
`setchg #giveaway-create #giveaway-winner #drop-create #drop-winner`

## Slash Commands
Giveaway/Drop: `/giveaway` `/giveawaysv` `/dropmatn` `/dropclick`

Ticket: `/panel` `/menu` `/claim` `/claimchange` `/add` `/remove` `/close` `/reopen` `/stats`

Staff: `/hire` `/setrole` `/rankup` `/rankdown` `/demote` `/setrolee` `/warnstaff`

Moderation: `/setfosh` `/deletefosh` `/whiteuser` `/kick` `/ban` `/timeout` `/warn`

Welcome/Invite: `/settextwel` `/settextinc`

Exchange: `/setex` `/exchange` `/setbanner` `/banner`

XP: `/setrolexp` `/leaderboard` `/level` `/settextxp` `/setxp` (و `setchlevel` به صورت text command)

Owner: `/textowner` `/createcmd`

### Staff role setup
`/setrole` را با mention رول‌ها اجرا کن، مثلاً: `/setrole roles:@Staff1 @Staff2 @Staff3`.
`/setrolee` هم Rank را با `/setrole` انتخاب می‌کند و رول‌های اضافه را با mention دریافت می‌کند.
Staffهای hired شده رول `Staff Acces` را نیز دریافت می‌کنند.

### Discord command naming
Discord slash command names باید lowercase باشند؛ بنابراین چیزی که در متن شما `/Giveawaysv` یا `/Menu` نوشته شده بود، در Discord به صورت `/giveawaysv` و `/menu` ثبت می‌شود.
