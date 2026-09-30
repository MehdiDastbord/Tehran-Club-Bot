require('./config');
const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');

const commands = [];
function register(builder) {
  if (typeof builder.setDMPermission === 'function') builder.setDMPermission(false);
  commands.push(builder);
}

register(new SlashCommandBuilder().setName('level').setDescription('نمایش XP و Level'));
register(new SlashCommandBuilder().setName('leaderboard').setDescription('XP Leaderboard'));
register(new SlashCommandBuilder().setName('banner').setDescription('نمایش بنر سرور'));

const xp = new SlashCommandBuilder().setName('xp').setDescription('مدیریت کامل XP');
xp.addSubcommand(s => s.setName('setchannel').setDescription('کانال دریافت XP پیام')
  .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
xp.addSubcommand(s => s.setName('setlevelup').setDescription('کانال پیام Level Up')
  .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
xp.addSubcommand(s => s.setName('settings').setDescription('تنظیم Curve/XP/Cooldown')
  .addIntegerOption(o => o.setName('min').setDescription('حداقل XP').setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName('max').setDescription('حداکثر XP').setMinValue(0).setRequired(true))
  .addIntegerOption(o => o.setName('cooldown').setDescription('Cooldown ثانیه').setMinValue(0).setMaxValue(86400).setRequired(true))
  .addStringOption(o => o.setName('curve').setDescription('مدل Leveling')
    .addChoices({ name: 'linear', value: 'linear' }, { name: 'exponential', value: 'exponential' }, { name: 'flat', value: 'flat' }))
  .addNumberOption(o => o.setName('multiplier').setDescription('ضریب XP').setMinValue(0.1).setMaxValue(100))
  .addIntegerOption(o => o.setName('maxlevel').setDescription('0 = نامحدود').setMinValue(0).setMaxValue(10000)));
xp.addSubcommand(s => s.setName('add').setDescription('افزودن XP')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
  .addIntegerOption(o => o.setName('amount').setDescription('XP').setMinValue(1).setRequired(true)));
xp.addSubcommand(s => s.setName('remove').setDescription('حذف XP')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
  .addIntegerOption(o => o.setName('amount').setDescription('XP').setMinValue(1).setRequired(true)));
xp.addSubcommand(s => s.setName('reset').setDescription('ریست XP یک کاربر')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)));
xp.addSubcommand(s => s.setName('resetall').setDescription('ریست کل XP'));
xp.addSubcommand(s => s.setName('setrole').setDescription('اتصال Level به Role')
  .addIntegerOption(o => o.setName('level').setDescription('Level').setMinValue(1).setRequired(true))
  .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)));
xp.addSubcommand(s => s.setName('removerole').setDescription('حذف Role از Level')
  .addIntegerOption(o => o.setName('level').setDescription('Level').setMinValue(1).setRequired(true)));
xp.addSubcommand(s => s.setName('roles').setDescription('لیست Level Roleها'));
register(xp);

const logTypes = ['message','member','moderation','ticket','giveaway','drop','exchange','xp','invite','voice','server','staff','ai','music','emote','guess','warning'];
const logs = new SlashCommandBuilder().setName('logs').setDescription('مدیریت Logها');
logs.addSubcommand(s => s.setName('set').setDescription('تنظیم یک Log Channel')
  .addStringOption(o => o.setName('type').setDescription('نوع Log').setRequired(true)
    .addChoices(...logTypes.map(x => ({ name: x, value: x }))))
  .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
logs.addSubcommand(s => s.setName('reset').setDescription('حذف تنظیم یک Log')
  .addStringOption(o => o.setName('type').setDescription('نوع Log').setRequired(true)
    .addChoices(...logTypes.map(x => ({ name: x, value: x })))));
logs.addSubcommand(s => s.setName('resetall').setDescription('حذف تمام Log Channelها'));
logs.addSubcommand(s => s.setName('status').setDescription('نمایش وضعیت Logها'));
logs.addSubcommand(s => s.setName('test').setDescription('تست ارسال Log'));
logs.addSubcommand(s => {
  s.setName('setup').setDescription('تنظیم چند Log Channel با یک دستور');
  for (const type of logTypes) {
    s.addChannelOption(o => o.setName(type).setDescription(`${type} log`).addChannelTypes(ChannelType.GuildText));
  }
  return s;
});
register(logs);

// Legacy/shortcut command: configure all log channels in one command.
const setticketlog = new SlashCommandBuilder().setName('setticketlog').setDescription('تنظیم همه Log Channelها در یک دستور');
for (const type of logTypes) {
  setticketlog.addChannelOption(o => o.setName(type).setDescription(`${type} log`).addChannelTypes(ChannelType.GuildText));
}
register(setticketlog);

const inv = new SlashCommandBuilder().setName('invite').setDescription('Invite Tracker');
inv.addSubcommand(s => s.setName('stats').setDescription('آمار Invite').addUserOption(o => o.setName('user').setDescription('User')));
inv.addSubcommand(s => s.setName('leaderboard').setDescription('Invite Leaderboard'));
inv.addSubcommand(s => s.setName('invited').setDescription('لیست Memberهای آورده‌شده توسط Inviter')
  .addUserOption(o => o.setName('user').setDescription('Inviter').setRequired(true)));
inv.addSubcommand(s => s.setName('joins').setDescription('همه Joinهای ثبت‌شده')
  .addUserOption(o => o.setName('user').setDescription('فقط Joinهای این Inviter')));
inv.addSubcommand(s => s.setName('alljoins').setDescription('نمایش تمام Joinهای ثبت‌شده بدون محدودیت Inviter'));
inv.addSubcommand(s => s.setName('fake').setDescription('لیست Fake Joinها')
  .addUserOption(o => o.setName('user').setDescription('Inviter')));
inv.addSubcommand(s => s.setName('left').setDescription('لیست تمام Memberهای Leave کرده')
  .addUserOption(o => o.setName('user').setDescription('Inviter')));
inv.addSubcommand(s => s.setName('leave').setDescription('Alias برای نمایش Leaveها')
  .addUserOption(o => o.setName('user').setDescription('Inviter')));
inv.addSubcommand(s => s.setName('events').setDescription('تاریخچه Invite Events')
  .addStringOption(o => o.setName('type').setDescription('نوع Event').addChoices(
    { name: 'all', value: 'all' }, { name: 'join', value: 'join' }, { name: 'left', value: 'left' },
    { name: 'fake', value: 'fake' }, { name: 'rejoin', value: 'rejoin' }
  ))
  .addUserOption(o => o.setName('user').setDescription('Inviter')));
for (const [name, desc] of [['add','افزودن Bonus Invite'],['remove','حذف Bonus Invite'],['addfake','افزودن Fake Invite'],['removefake','حذف Fake Invite']]) {
  inv.addSubcommand(s => s.setName(name).setDescription(desc)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setMinValue(1).setRequired(true)));
}
inv.addSubcommand(s => s.setName('reset').setDescription('ریست Invite یک کاربر یا کل سرور').addUserOption(o => o.setName('user').setDescription('User')));
inv.addSubcommand(s => s.setName('setchannel').setDescription('تنظیم Invite Log Channel')
  .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
inv.addSubcommand(s => s.setName('config').setDescription('Fake و Rejoin')
  .addIntegerOption(o => o.setName('fake_days').setDescription('کمتر از این روز = Fake').setMinValue(0).setMaxValue(300).setRequired(true))
  .addBooleanOption(o => o.setName('count_rejoins').setDescription('Rejoinها دوباره Regular حساب شوند').setRequired(true)));
register(inv);

const staff = new SlashCommandBuilder().setName('staff').setDescription('Staff Manager');
staff.addSubcommand(s => s.setName('add').setDescription('افزودن عضو به Staff در Rank مشخص')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
  .addIntegerOption(o => o.setName('level').setDescription('Rank').setMinValue(1).setMaxValue(10000).setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason')));
staff.addSubcommand(s => s.setName('remove').setDescription('خارج کردن عضو از Staff')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason')));
staff.addSubcommand(s => s.setName('rankup').setDescription('Rank Up')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')));
staff.addSubcommand(s => s.setName('rankdown').setDescription('Rank Down / Demote')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')));
staff.addSubcommand(s => s.setName('setlevel').setDescription('تنظیم مستقیم Level')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
  .addIntegerOption(o => o.setName('level').setDescription('Level').setMinValue(0).setMaxValue(10000).setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason')));
staff.addSubcommand(s => s.setName('setrole').setDescription('Role Mapping')
  .addIntegerOption(o => o.setName('level').setDescription('Level').setMinValue(1).setRequired(true))
  .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)));
staff.addSubcommand(s => s.setName('removerole').setDescription('حذف Role Mapping')
  .addIntegerOption(o => o.setName('level').setDescription('Level').setMinValue(1).setRequired(true)));
staff.addSubcommand(s => s.setName('info').setDescription('Staff Info').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)));
staff.addSubcommand(s => s.setName('list').setDescription('Staff List'));
staff.addSubcommand(s => s.setName('roles').setDescription('Staff Role Mapping'));
staff.addSubcommand(s => s.setName('history').setDescription('Staff History').addUserOption(o => o.setName('user').setDescription('User')));
register(staff);

const ai = new SlashCommandBuilder().setName('ai').setDescription('AI Chat');
ai.addSubcommand(s => s.setName('setchannel').setDescription('AI Channel').addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
ai.addSubcommand(s => s.setName('disable').setDescription('خاموش کردن AI'));
ai.addSubcommand(s => s.setName('clear').setDescription('پاک کردن حافظه AI'));
register(ai);

const music = new SlashCommandBuilder().setName('music').setDescription('Music Player');
for (const [name, description] of [['play','Play'],['skip','Skip'],['pause','Pause'],['resume','Resume'],['stop','Stop'],['leave','Leave'],['queue','Queue'],['nowplaying','Now Playing'],['shuffle','Shuffle']]) {
  music.addSubcommand(s => {
    s.setName(name).setDescription(description);
    if (name === 'play') s.addStringOption(o => o.setName('query').setDescription('Song title or supported URL').setRequired(true));
    return s;
  });
}
music.addSubcommand(s => s.setName('volume').setDescription('Volume').addIntegerOption(o => o.setName('value').setDescription('0-100').setMinValue(0).setMaxValue(100).setRequired(true)));
music.addSubcommand(s => s.setName('loop').setDescription('0 off, 1 track, 2 queue, 3 autoplay').addIntegerOption(o => o.setName('mode').setDescription('Mode').setMinValue(0).setMaxValue(3).setRequired(true)));
music.addSubcommand(s => s.setName('247').setDescription('ماندن در Voice حتی بدون Track').addBooleanOption(o => o.setName('enabled').setDescription('Enabled').setRequired(true)));
register(music);

const ticket = new SlashCommandBuilder().setName('ticket').setDescription('Ticket System');
ticket.addSubcommand(s => s.setName('panel').setDescription('Create panel')
  .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
  .addStringOption(o => o.setName('text').setDescription('Text').setRequired(true))
  .addStringOption(o => o.setName('types').setDescription('Comma separated type keys').setRequired(true))
  .addRoleOption(o => o.setName('supportrole').setDescription('Ticket Support Role').setRequired(true))
  .addChannelOption(o => o.setName('category').setDescription('Category')));
ticket.addSubcommand(s => s.setName('addtype').setDescription('Add ticket type')
  .addStringOption(o => o.setName('key').setDescription('Key').setRequired(true))
  .addStringOption(o => o.setName('name').setDescription('Name').setRequired(true))
  .addStringOption(o => o.setName('emoji').setDescription('Emoji'))
  .addStringOption(o => o.setName('prefix').setDescription('Prefix')));
ticket.addSubcommand(s => s.setName('setrole').setDescription('Set Ticket Support Role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)));
ticket.addSubcommand(s => s.setName('settings').setDescription('Ticket settings'));
ticket.addSubcommand(s => s.setName('claim').setDescription('Claim Ticket'));
ticket.addSubcommand(s => s.setName('close').setDescription('Close Ticket').addStringOption(o => o.setName('reason').setDescription('Close reason')));
ticket.addSubcommand(s => s.setName('reopen').setDescription('Reopen Ticket'));
ticket.addSubcommand(s => s.setName('transcript').setDescription('Transcript'));
ticket.addSubcommand(s => s.setName('leaderboard').setDescription('Set Claim Leaderboard channel').addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
ticket.addSubcommand(s => s.setName('add').setDescription('Add user').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)));
ticket.addSubcommand(s => s.setName('remove').setDescription('Remove user').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)));
register(ticket);

const giveaway = new SlashCommandBuilder().setName('giveaway').setDescription('Giveaway');
giveaway.addSubcommand(s => s.setName('start').setDescription('Start')
  .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
  .addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setMinValue(1).setMaxValue(10080).setRequired(true))
  .addStringOption(o => o.setName('link').setDescription('Optional link')));
giveaway.addSubcommand(s => s.setName('end').setDescription('End active giveaway').addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setMinValue(1)));
register(giveaway);

const drop = new SlashCommandBuilder().setName('drop').setDescription('Drop');
drop.addSubcommand(s => s.setName('text').setDescription('Text trigger')
  .addStringOption(o => o.setName('trigger').setDescription('Trigger').setRequired(true))
  .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
  .addIntegerOption(o => o.setName('minutes').setDescription('Duration').setMinValue(1).setMaxValue(1440).setRequired(true)));
drop.addSubcommand(s => s.setName('button').setDescription('Button drop')
  .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
  .addIntegerOption(o => o.setName('minutes').setDescription('Duration').setMinValue(1).setMaxValue(1440).setRequired(true)));
drop.addSubcommand(s => s.setName('end').setDescription('End active drop').addIntegerOption(o => o.setName('id').setDescription('Drop ID').setMinValue(1)));
drop.addSubcommand(s => s.setName('list').setDescription('List active drops in this channel'));
register(drop);

register(new SlashCommandBuilder().setName('exchange').setDescription('Create Exchange request')
  .addStringOption(o => o.setName('text').setDescription('Request').setRequired(true)));
register(new SlashCommandBuilder().setName('exchange-config').setDescription('Exchange settings')
  .addChannelOption(o => o.setName('channel').setDescription('Request channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
  .addRoleOption(o => o.setName('role').setDescription('Exchange Access Role').setRequired(true)));
register(new SlashCommandBuilder().setName('setex').setDescription('تنظیم کانال خروجی Exchange تأییدشده')
  .addChannelOption(o => o.setName('channel').setDescription('Approved Exchange channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
register(new SlashCommandBuilder().setName('exchange-manage').setDescription('Accept/Reject Exchange')
  .addStringOption(o => o.setName('action').setDescription('Action').setRequired(true).addChoices({ name: 'accept', value: 'accept' }, { name: 'reject', value: 'reject' }))
  .addIntegerOption(o => o.setName('request').setDescription('Request ID').setMinValue(1).setRequired(true)));
register(new SlashCommandBuilder().setName('addemote').setDescription('Add Emoji')
  .addStringOption(o => o.setName('emoji').setDescription('<:name:id> or URL').setRequired(true))
  .addStringOption(o => o.setName('name').setDescription('Optional name')));

const guess = new SlashCommandBuilder().setName('guess').setDescription('Guess Number');
guess.addSubcommand(s => s.setName('start').setDescription('Start')
  .addIntegerOption(o => o.setName('min').setDescription('Min').setRequired(true))
  .addIntegerOption(o => o.setName('max').setDescription('Max').setRequired(true)));
guess.addSubcommand(s => s.setName('stop').setDescription('Stop'));
guess.addSubcommand(s => s.setName('status').setDescription('Status'));
register(guess);

const mod = new SlashCommandBuilder().setName('mod').setDescription('Moderation');
mod.addSubcommand(s => s.setName('ban').setDescription('Ban').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')));
mod.addSubcommand(s => s.setName('kick').setDescription('Kick').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')));
mod.addSubcommand(s => s.setName('warn').setDescription('Warn').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')));
mod.addSubcommand(s => s.setName('untimeout').setDescription('Remove Timeout').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')));
mod.addSubcommand(s => s.setName('unwarn').setDescription('Remove latest warn').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')));
mod.addSubcommand(s => s.setName('warnings').setDescription('List warnings').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Unused')));
mod.addSubcommand(s => s.setName('unban').setDescription('Unban').addStringOption(o => o.setName('user').setDescription('User ID').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')));
mod.addSubcommand(s => s.setName('timeout').setDescription('Timeout')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
  .addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setMinValue(1).setMaxValue(40320).setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason')));
register(mod);

const welcome = new SlashCommandBuilder().setName('welcome').setDescription('Welcome');
welcome.addSubcommand(s => s.setName('set').setDescription('Set Welcome')
  .addChannelOption(o => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
  .addStringOption(o => o.setName('text').setDescription('Message').setRequired(true)));
welcome.addSubcommand(s => s.setName('disable').setDescription('Disable Welcome'));
register(welcome);

const custom = new SlashCommandBuilder().setName('customcmd').setDescription('Custom commands');
custom.addSubcommand(s => s.setName('set').setDescription('Set')
  .addStringOption(o => o.setName('name').setDescription('Name').setRequired(true))
  .addStringOption(o => o.setName('response').setDescription('Response').setRequired(true)));
custom.addSubcommand(s => s.setName('delete').setDescription('Delete').addStringOption(o => o.setName('name').setDescription('Name').setRequired(true)));
register(custom);

register(new SlashCommandBuilder().setName('setaccessrole').setDescription('Set an Access Role')
  .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true)
    .addChoices(...['giveaway','exchange','logs','ticket','moderation','staff','music','xp','invite','ai','drop','emote','guess'].map(x => ({ name: x, value: x }))))
  .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)));
// Owner-only utility commands. Discord supports at most 25 buttons per message;
// the embed command accepts 1-25 and is intentionally documented for 10+ buttons.
register(new SlashCommandBuilder().setName('banch').setDescription('دادن Role مخصوص Banch به یک کاربر')
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)));

register(new SlashCommandBuilder().setName('rerole').setDescription('قرعه‌کشی دوباره آخرین Giveaway تمام‌شده همین Channel'));

register(new SlashCommandBuilder().setName('embed').setDescription('ساخت Embed با دکمه‌های متن‌مخفی')
  .addStringOption(o => o.setName('title').setDescription('عنوان Embed').setMaxLength(256).setRequired(true))
  .addStringOption(o => o.setName('text').setDescription('متن Embed').setMaxLength(4000).setRequired(true))
  .addStringOption(o => o.setName('buttons').setDescription('دکمه‌ها: نام=متن مخفی || نام=متن مخفی ... (حداکثر 25)؛ 10+ دکمه پشتیبانی می‌شود').setMaxLength(5900).setRequired(true)));

register(new SlashCommandBuilder().setName('health').setDescription('Bot/DB configuration health check'));

(async () => {
  const { token, clientId, guildId } = require('./config');
  if (!token || !clientId || !guildId) throw new Error('DISCORD_TOKEN, CLIENT_ID and GUILD_ID are required');
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands.map(x => x.toJSON()) });
  console.log(`Deployed ${commands.length} commands.`);
})().catch(error => {
  console.error('[DEPLOY]', error);
  process.exit(1);
});
