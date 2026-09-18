# بات تهران کلاب

## نصب
1. Node.js 20 یا جدیدتر نصب کنید.
2. این پوشه را باز کنید.
3. `npm install`
4. `.env.example` را به `.env` تغییر نام دهید و Token / Client ID / Guild ID را وارد کنید.
5. در Discord Developer Portal، برای Bot این Intentها را روشن کنید:
   - Server Members Intent
   - Message Content Intent
6. `npm run register`
7. `npm start`

## تنظیم
بعد از روشن شدن بات، `/setup` را بزنید. همه تنظیمات اصلی از داخل Discord انجام می‌شود.

## دستورات اصلی
`/setup`
`/giveaway`
`/drop`
`/ticket`
`/staff`
`/rankup`
`/rankdown`
`/clear`
`/kick`
`/ban`
`/timeout`
`/warn`
`/exchange`
`/level`
`/leaderboard`
`/invites`

## نکته
نام فنی Slash Commandها انگلیسی است چون Discord برای نام گزینه‌های Slash محدودیت دارد، اما توضیحات و رابط بات فارسی هستند.
