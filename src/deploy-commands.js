require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
const cmds=[];
const add=c=>cmds.push(c);

// Public
add(new SlashCommandBuilder().setName('exchange').setDescription('باز کردن فرم عمومی تبادل'));
add(new SlashCommandBuilder().setName('banner').setDescription('نمایش بنر سرور'));
add(new SlashCommandBuilder().setName('level').setDescription('نمایش سطح تجربه شما'));
add(new SlashCommandBuilder().setName('leaderboard').setDescription('نمایش جدول رتبه‌بندی تجربه'));

// Giveaway / drops (authorized IDs only)
add(new SlashCommandBuilder().setName('giveaway').setDescription('ایجاد یک قرعه‌کشی').addStringOption(o=>o.setName('prize').setDescription('جایزه').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('مدت زمان به دقیقه').setRequired(true).setMinValue(1)));
add(new SlashCommandBuilder().setName('giveawaysv').setDescription('ایجاد یک قرعه‌کشی with a link').addStringOption(o=>o.setName('prize').setDescription('جایزه').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('مدت زمان به دقیقه').setRequired(true).setMinValue(1)).addStringOption(o=>o.setName('link').setDescription('لینک').setRequired(true)));
add(new SlashCommandBuilder().setName('dropmatn').setDescription('ایجاد دراپ متنی').addStringOption(o=>o.setName('text').setDescription('متن برنده').setRequired(true)).addStringOption(o=>o.setName('prize').setDescription('جایزه').setRequired(true)));
add(new SlashCommandBuilder().setName('dropclick').setDescription('ایجاد دراپ کلیکی').addStringOption(o=>o.setName('prize').setDescription('جایزه').setRequired(true)));

// Ticket panel management
const panel=new SlashCommandBuilder().setName('panel').setDescription('ایجاد یک پنل تیکت')
  .addStringOption(o=>o.setName('type').setDescription('نوع اولیه تیکت').setRequired(true).addChoices(
    {name:'Support',value:'support'},{name:'Exchange',value:'exchange'},{name:'Staff Hire',value:'staffhire'},{name:'Event Join',value:'eventjoin'}))
  .addStringOption(o=>o.setName('name').setDescription('نام نمایشی پنل'))
  .addStringOption(o=>o.setName('text').setDescription('متن پنل'))
  .addStringOption(o=>o.setName('welcome').setDescription('متن خوشامدگویی تیکت'))
  .addRoleOption(o=>o.setName('mention_role').setDescription('نقش اضافی برای منشن'))
  .addChannelOption(o=>o.setName('category').setDescription('دسته‌بندی تیکت').addChannelTypes(ChannelType.GuildCategory));
for(let i=1;i<=5;i++) panel.addStringOption(o=>o.setName(`q${i}`).setDescription(`سؤال فرم ${i}`));
add(panel);
add(new SlashCommandBuilder().setName('editpanel').setDescription('ویرایش پنل تیکت').addIntegerOption(o=>o.setName('num').setDescription('شماره پنل').setRequired(true).setMinValue(1)).addStringOption(o=>o.setName('type').setDescription('تغییر نوع اولیه').addChoices({name:'Support',value:'support'},{name:'Exchange',value:'exchange'},{name:'Staff Hire',value:'staffhire'},{name:'Event Join',value:'eventjoin'})).addStringOption(o=>o.setName('name').setDescription('نام جدید')).addStringOption(o=>o.setName('text').setDescription('متن جدید پنل')).addStringOption(o=>o.setName('welcome').setDescription('متن خوشامدگویی جدید')).addRoleOption(o=>o.setName('mention_role').setDescription('نقش اضافی')).addChannelOption(o=>o.setName('category').setDescription('دسته‌بندی تیکت').addChannelTypes(ChannelType.GuildCategory)));
add(new SlashCommandBuilder().setName('delpanel').setDescription('حذف کامل پنل تیکت').addIntegerOption(o=>o.setName('num').setDescription('شماره پنل').setRequired(true).setMinValue(1)));
add(new SlashCommandBuilder().setName('panels').setDescription('نمایش فهرست پنل‌های تیکت'));
add(new SlashCommandBuilder().setName('allpanel').setDescription('ساخت منوی یکپارچه از همه انواع تیکت').addStringOption(o=>o.setName('name').setDescription('عنوان منو')).addStringOption(o=>o.setName('text').setDescription('متن منو')).addStringOption(o=>o.setName('placeholder').setDescription('متن راهنمای منوی کشویی')).addChannelOption(o=>o.setName('channel').setDescription('کانال منو').addChannelTypes(ChannelType.GuildText)));
add(new SlashCommandBuilder().setName('addtype').setDescription('افزودن نوع تیکت به پنل').addIntegerOption(o=>o.setName('num').setDescription('شماره پنل').setRequired(true).setMinValue(1)).addStringOption(o=>o.setName('name').setDescription('نام نوع تیکت').setRequired(true)).addStringOption(o=>o.setName('emoji').setDescription('ایموجی نوع تیکت')).addStringOption(o=>o.setName('prefix').setDescription('پیشوند نام کانال، اختیاری')));
add(new SlashCommandBuilder().setName('edittype').setDescription('ویرایش نوع تیکت و ایموجی').addIntegerOption(o=>o.setName('num').setDescription('شماره پنل').setRequired(true).setMinValue(1)).addIntegerOption(o=>o.setName('index').setDescription('شماره نوع تیکت').setRequired(true).setMinValue(1).setMaxValue(25)).addStringOption(o=>o.setName('name').setDescription('نام جدید')).addStringOption(o=>o.setName('emoji').setDescription('ایموجی جدید')).addBooleanOption(o=>o.setName('remove_emoji').setDescription('حذف ایموجی')).addStringOption(o=>o.setName('prefix').setDescription('پیشوند جدید نام کانال')));
add(new SlashCommandBuilder().setName('deltype').setDescription('حذف نوع تیکت از پنل').addIntegerOption(o=>o.setName('num').setDescription('شماره پنل').setRequired(true).setMinValue(1)).addIntegerOption(o=>o.setName('index').setDescription('شماره نوع تیکت').setRequired(true).setMinValue(1).setMaxValue(25)));
add(new SlashCommandBuilder().setName('reordertypes').setDescription('تغییر ترتیب انواع تیکت').addIntegerOption(o=>o.setName('num').setDescription('شماره پنل').setRequired(true).setMinValue(1)).addStringOption(o=>o.setName('order').setDescription('ترتیب شماره‌ها، مثال 3,1,2,4').setRequired(true)));
add(new SlashCommandBuilder().setName('listtypes').setDescription('نمایش انواع تیکت یک پنل').addIntegerOption(o=>o.setName('num').setDescription('شماره پنل').setRequired(true).setMinValue(1)));

// Ticket staff controls
add(new SlashCommandBuilder().setName('claim').setDescription('دریافت مسئولیت تیکت فعلی'));
add(new SlashCommandBuilder().setName('claimchange').setDescription('تغییر مسئول تیکت').addUserOption(o=>o.setName('user').setDescription('مسئول جدید').setRequired(true)));
add(new SlashCommandBuilder().setName('add').setDescription('افزودن کاربر به تیکت').addUserOption(o=>o.setName('user').setDescription('کاربر').setRequired(true)));
add(new SlashCommandBuilder().setName('remove').setDescription('حذف کاربر از تیکت').addUserOption(o=>o.setName('user').setDescription('کاربر').setRequired(true)));
add(new SlashCommandBuilder().setName('close').setDescription('بستن تیکت فعلی'));
add(new SlashCommandBuilder().setName('reopen').setDescription('باز کردن دوباره تیکت فعلی'));
add(new SlashCommandBuilder().setName('stats').setDescription('تنظیم کانال آمار مسئولیت تیکت'));

// Moderation / configuration (authorized IDs only)
add(new SlashCommandBuilder().setName('setfosh').setDescription('افزودن کلمات ممنوع').addStringOption(o=>o.setName('words').setDescription('با کاما جدا کنید').setRequired(true)));
add(new SlashCommandBuilder().setName('deletefosh').setDescription('حذف کلمات ممنوع').addStringOption(o=>o.setName('words').setDescription('با کاما جدا کنید').setRequired(true)));
add(new SlashCommandBuilder().setName('whiteuser').setDescription('قرار دادن کاربر در لیست سفید').addUserOption(o=>o.setName('user').setDescription('کاربر').setRequired(true)));
for(const n of ['kick','ban','timeout','warn']) { const b=new SlashCommandBuilder().setName(n).setDescription(n).addUserOption(o=>o.setName('user').setDescription('عضو').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('دلیل')); if(n==='timeout') b.addIntegerOption(o=>o.setName('minutes').setDescription('مدت تایم‌اوت به دقیقه').setMinValue(1).setMaxValue(40320)); add(b); }
add(new SlashCommandBuilder().setName('unwarn').setDescription('حذف یک اخطار').addUserOption(o=>o.setName('user').setDescription('عضو').setRequired(true)));
add(new SlashCommandBuilder().setName('unban').setDescription('رفع بن کاربر').addUserOption(o=>o.setName('user').setDescription('کاربر').setRequired(true)));
add(new SlashCommandBuilder().setName('untimeout').setDescription('حذف تایم‌اوت کاربر').addUserOption(o=>o.setName('user').setDescription('عضو').setRequired(true)));
add(new SlashCommandBuilder().setName('setrolexp').setDescription('تنظیم نقش تجربه').addIntegerOption(o=>o.setName('level').setDescription('سطح').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('نقش').setRequired(true)));
add(new SlashCommandBuilder().setName('setxp').setDescription('افزودن تجربه').addUserOption(o=>o.setName('user').setDescription('کاربر').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('مقدار تجربه').setRequired(true).setMinValue(1)));
add(new SlashCommandBuilder().setName('settextwel').setDescription('تنظیم متن خوشامدگویی').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)));
add(new SlashCommandBuilder().setName('setwelcomechannel').setDescription('تنظیم کانال خوشامدگویی').addChannelOption(o=>o.setName('channel').setDescription('کانال Welcome').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('setinvitelog').setDescription('تنظیم کانال لاگ دعوت‌ها').addChannelOption(o=>o.setName('channel').setDescription('کانال Invite Logs').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('settextinc').setDescription('تنظیم متن دعوت').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)));
add(new SlashCommandBuilder().setName('settextxp').setDescription('تنظیم متن ارتقای سطح').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)));
add(new SlashCommandBuilder().setName('setbanner').setDescription('تنظیم بنر سرور').addStringOption(o=>o.setName('banner').setDescription('متن بنر').setRequired(true)));
add(new SlashCommandBuilder().setName('setex').setDescription('تنظیم کانال نهایی تبادل').addChannelOption(o=>o.setName('channel').setDescription('کانال').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('setexlog').setDescription('تنظیم کانال لاگ تبادل').addChannelOption(o=>o.setName('channel').setDescription('کانال').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('setrate').setDescription('تنظیم کانال امتیازدهی تیکت').addChannelOption(o=>o.setName('channel').setDescription('کانال').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('setticketlog').setDescription('تنظیم کانال لاگ ترنسکریپت تیکت').addChannelOption(o=>o.setName('channel').setDescription('کانال').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('textowner').setDescription('تنظیم کانال ارسال پیام مالک').addChannelOption(o=>o.setName('channel').setDescription('کانال').setRequired(true)));
add(new SlashCommandBuilder().setName('untextowner').setDescription('غیرفعال کردن ارسال پیام مالک'));
add(new SlashCommandBuilder().setName('createcmd').setDescription('ایجاد یک دستور متنی عمومی سفارشی').addStringOption(o=>o.setName('keyword').setDescription('کلمه کلیدی').setRequired(true)).addStringOption(o=>o.setName('text').setDescription('پاسخ').setRequired(true)));
add(new SlashCommandBuilder().setName('setlogchannel').setDescription('تنظیم کانال اصلی گزارش لاگ‌ها').addChannelOption(o=>o.setName('channel').setDescription('کانال ارسال گزارش‌های تجمیعی').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('sendlogs').setDescription('ارسال فوری گزارش لاگ‌های جمع‌شده'));

(async()=>{
  const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:cmds.map(x=>x.toJSON())});
  console.log(`Deployed ${cmds.length} commands.`);
})().catch(e=>{console.error(e);process.exit(1)});
