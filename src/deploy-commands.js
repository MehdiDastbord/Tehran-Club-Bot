require("dotenv").config();
const {REST,Routes,SlashCommandBuilder,PermissionFlagsBits}=require("discord.js");
const commands=[
 new SlashCommandBuilder().setName("setup").setDescription("تنظیم کامل بات از داخل سرور").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
 new SlashCommandBuilder().setName("giveaway").setDescription("ساخت گیووای کامل").addStringOption(o=>o.setName("title").setDescription("عنوان").setRequired(true)).addStringOption(o=>o.setName("prize").setDescription("جایزه").setRequired(true)).addIntegerOption(o=>o.setName("winners").setDescription("تعداد برنده").setMinValue(1).setMaxValue(50).setRequired(true)).addIntegerOption(o=>o.setName("minutes").setDescription("مدت به دقیقه").setMinValue(1).setRequired(true)),
 new SlashCommandBuilder().setName("drop").setDescription("ساخت دراپ").addStringOption(o=>o.setName("mode").setDescription("button یا text").setRequired(true).addChoices({name:"دکمه",value:"button"},{name:"متن",value:"text"})).addStringOption(o=>o.setName("prize").setDescription("جایزه").setRequired(true)).addStringOption(o=>o.setName("answer").setDescription("متن برنده در حالت متنی").setRequired(false)),
 new SlashCommandBuilder().setName("ticket").setDescription("پنل تیکت"),
 new SlashCommandBuilder().setName("staff").setDescription("مدیریت استاف").addSubcommand(s=>s.setName("join").setDescription("عضو کردن در استاف").addUserOption(o=>o.setName("user").setDescription("عضو").setRequired(true))).addSubcommand(s=>s.setName("remove").setDescription("خارج کردن از استاف").addUserOption(o=>o.setName("user").setDescription("عضو").setRequired(true))).addSubcommand(s=>s.setName("stats").setDescription("آمار کلیم")),
 new SlashCommandBuilder().setName("rankup").setDescription("رنک اپ استاف").addUserOption(o=>o.setName("user").setDescription("عضو").setRequired(true)),
 new SlashCommandBuilder().setName("rankdown").setDescription("دیموت استاف").addUserOption(o=>o.setName("user").setDescription("عضو").setRequired(true)),
 new SlashCommandBuilder().setName("clear").setDescription("پاک کردن پیام‌ها").addIntegerOption(o=>o.setName("amount").setDescription("تعداد").setMinValue(1).setMaxValue(100).setRequired(true)),
 new SlashCommandBuilder().setName("kick").setDescription("کیک").addUserOption(o=>o.setName("user").setDescription("عضو").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("دلیل")),
 new SlashCommandBuilder().setName("ban").setDescription("بن").addUserOption(o=>o.setName("user").setDescription("عضو").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("دلیل")),
 new SlashCommandBuilder().setName("timeout").setDescription("تایم اوت").addUserOption(o=>o.setName("user").setDescription("عضو").setRequired(true)).addIntegerOption(o=>o.setName("minutes").setDescription("دقیقه").setMinValue(1).setMaxValue(40320).setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("دلیل")),
 new SlashCommandBuilder().setName("warn").setDescription("وارن").addUserOption(o=>o.setName("user").setDescription("عضو").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("دلیل")),
 new SlashCommandBuilder().setName("exchange").setDescription("فرم اکسچنج"),
 new SlashCommandBuilder().setName("level").setDescription("نمایش لول").addUserOption(o=>o.setName("user").setDescription("عضو")),
 new SlashCommandBuilder().setName("leaderboard").setDescription("لیدربورد XP"),
 new SlashCommandBuilder().setName("invites").setDescription("اطلاعات دعوت")
].map(x=>x.toJSON());
(async()=>{const rest=new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:commands});console.log("Commands registered");})();