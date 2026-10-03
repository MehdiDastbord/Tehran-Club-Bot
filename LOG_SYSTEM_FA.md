# سیستم Log تجمیعی

## دو دستور جدید

### `/setlogchannel channel`
کانال اصلی گزارش لاگ‌ها را انتخاب می‌کند.

اولین گزارش خودکار **۳ ساعت بعد** ارسال می‌شود و بعد از آن هر **۶ ساعت** یک گزارش ارسال می‌شود.

### `/sendlogs`
گزارش لاگ‌های جمع‌شده را **همین الان** ارسال می‌کند و زمان گزارش بعدی را ۶ ساعت بعد تنظیم می‌کند.

## بخش‌های گزارش

گزارش در یک Discord message ارسال می‌شود و بخش‌ها جدا هستند:

- 🎉 Giveaway / Drop
- 🎫 Ticket Logs
- ⭐ Feedback
- 💬 Message Logs
- 🔨 Ban / Kick Logs
- ⏱️ Timeout Logs
- 🔊 Voice / Stage Logs
- 📩 DM Logs
- 🛠️ Server Logs
- ⚠️ Member Warn Logs
- 👋 Welcome
- 📨 Invite Logs
- ⬆️ Level Up

## Supabase

فایل `logs_migration.sql` را یک بار در Supabase SQL Editor اجرا کنید.

برای Giveaway نیز `giveaway_migration.sql` را یک بار اجرا کنید، مخصوصاً اگر قبلاً جدول‌های Giveaway را نساخته‌اید.

## نکته

دستورهای قدیمی پروژه حذف نشده‌اند. دو دستور بالا فقط سیستم جدید Log تجمیعی را کنترل می‌کنند.
