# Tehran Club Bot V20

نسخه V20 با تمرکز روی Recovery، Reconciliation، Invite Lifecycle، Ticket Snapshot و Discord Role Sync ساخته شده است.

## تغییرات مهم V20
- نسخه پروژه و Static Audit هر دو روی 20.0.0 هماهنگ شده‌اند.
- Discord Role Sync برای XP و Staff دارای Outbox پایدار، retry و backoff است.
- Outbox بعد از Restart دوباره jobهای processing را به pending برمی‌گرداند.
- Ticket Permission Snapshot نوع Subject را به‌صورت صریح نگه می‌دارد.
- Invited Member دارای original_inviter_id است تا Rejoin، Inviter اصلی را از Inviter فعلی جدا کند.
- Leaderboard Invite از Event History برای مرتب‌سازی استفاده می‌کند و به Counter تاریخی وابسته نیست.
- Migration نسخه 6 برای تغییرات V20 اضافه شده است.
- تمام setSettingsهای Command Handler به‌صورت await استفاده می‌شوند.

## تست‌های انجام‌شده در محیط فعلی
- Node syntax check برای 19 فایل JavaScript: PASS
- Static check: PASS
- Production audit: PASS
- Targeted V20 hardening checks: PASS
- ZIP integrity: باید بعد از ساخت Release بررسی شود.

## مواردی که بدون محیط واقعی قابل اثبات نیستند
- Discord Live API
- Voice / Discord Player
- OpenAI API
- Rate Limit واقعی Discord
- Crash واقعی وسط یک API call

برای این موارد ادعای تست Live نشده است.
