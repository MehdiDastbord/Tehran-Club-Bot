# مدیریت نوع‌های تیکت

بعد از اجرای `ticket_system_migration.sql` و Deploy کردن بات، نوع‌های هر پنل کاملاً قابل مدیریت هستند.

## مشاهده نوع‌ها
```text
/listtypes num:1
```

## اضافه کردن نوع
```text
/addtype num:1 name:Content Creator emoji:🎥 prefix:contentcreator
```

## ویرایش نوع
شماره نوع از خروجی `/listtypes` گرفته می‌شود:

```text
/edittype num:1 index:4 name:Content Creator emoji:🎥 prefix:contentcreator
```

برای حذف ایموجی:

```text
/edittype num:1 index:4 remove_emoji:true
```

## حذف نوع
```text
/deltype num:1 index:4
```

حداقل یک نوع باید در هر پنل باقی بماند.

## تغییر ترتیب
مثلاً برای پنلی با 4 نوع:

```text
/reordertypes num:1 order:3,1,4,2
```

## تعداد نوع‌ها
هر پنل می‌تواند تا 25 نوع تیکت داشته باشد. برای 5 نوع یا کمتر، دکمه‌ها نمایش داده می‌شوند؛ برای بیشتر از 5 نوع، منوی کشویی Discord نمایش داده می‌شود.

نام کانال بر اساس نوع انتخاب‌شده ساخته می‌شود، مثلاً:

```text
contentcreator-mehdi
support-mehdi
exchange-mehdi
```

اگر `prefix` مشخص نشود، از نام نوع به‌صورت خودکار ساخته می‌شود.
