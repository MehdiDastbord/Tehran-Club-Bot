require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
const cmds=[];
const add=c=>cmds.push(c);

// Public
add(new SlashCommandBuilder().setName('exchange').setDescription('Open the public exchange form'));
add(new SlashCommandBuilder().setName('banner').setDescription('Show the server banner'));
add(new SlashCommandBuilder().setName('level').setDescription('Show your XP level'));
add(new SlashCommandBuilder().setName('leaderboard').setDescription('Show the XP leaderboard'));

// Giveaway / drops (authorized IDs only)
add(new SlashCommandBuilder().setName('giveaway').setDescription('Create a giveaway').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1)));
add(new SlashCommandBuilder().setName('giveawaysv').setDescription('Create a giveaway with a link').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1)).addStringOption(o=>o.setName('link').setDescription('URL').setRequired(true)));
add(new SlashCommandBuilder().setName('dropmatn').setDescription('Create a text drop').addStringOption(o=>o.setName('text').setDescription('Winning text').setRequired(true)).addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)));
add(new SlashCommandBuilder().setName('dropclick').setDescription('Create a click drop').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)));

// Ticket panel management
const panel=new SlashCommandBuilder().setName('panel').setDescription('Create one ticket panel')
  .addStringOption(o=>o.setName('type').setDescription('Ticket type').setRequired(true).addChoices(
    {name:'Support',value:'support'},{name:'Exchange',value:'exchange'},{name:'Staff Hire',value:'staffhire'},{name:'Event Join',value:'eventjoin'}))
  .addStringOption(o=>o.setName('name').setDescription('Panel display name'))
  .addStringOption(o=>o.setName('text').setDescription('Panel text'))
  .addStringOption(o=>o.setName('welcome').setDescription('Ticket welcome text'))
  .addRoleOption(o=>o.setName('mention_role').setDescription('Extra role to mention'))
  .addChannelOption(o=>o.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory));
for(let i=1;i<=5;i++) panel.addStringOption(o=>o.setName(`q${i}`).setDescription(`Form question ${i}`));
add(panel);
add(new SlashCommandBuilder().setName('editpanel').setDescription('Edit a ticket panel').addIntegerOption(o=>o.setName('num').setDescription('Panel number').setRequired(true).setMinValue(1)).addStringOption(o=>o.setName('type').setDescription('Ticket type').addChoices({name:'Support',value:'support'},{name:'Exchange',value:'exchange'},{name:'Staff Hire',value:'staffhire'},{name:'Event Join',value:'eventjoin'})).addStringOption(o=>o.setName('name').setDescription('New name')).addStringOption(o=>o.setName('text').setDescription('New panel text')).addStringOption(o=>o.setName('welcome').setDescription('New welcome text')).addRoleOption(o=>o.setName('mention_role').setDescription('Extra role')).addChannelOption(o=>o.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory)));
add(new SlashCommandBuilder().setName('delpanel').setDescription('Delete a ticket panel').addIntegerOption(o=>o.setName('num').setDescription('Panel number').setRequired(true).setMinValue(1)));
add(new SlashCommandBuilder().setName('panels').setDescription('List ticket panels'));
add(new SlashCommandBuilder().setName('allpanel').setDescription('Create the all-in-one four-type ticket menu').addStringOption(o=>o.setName('name').setDescription('Menu title')).addStringOption(o=>o.setName('text').setDescription('Menu text')).addStringOption(o=>o.setName('placeholder').setDescription('Dropdown placeholder')).addChannelOption(o=>o.setName('channel').setDescription('Menu channel').addChannelTypes(ChannelType.GuildText)));

// Ticket staff controls
add(new SlashCommandBuilder().setName('claim').setDescription('Claim the current ticket'));
add(new SlashCommandBuilder().setName('claimchange').setDescription('Change ticket claimant').addUserOption(o=>o.setName('user').setDescription('New claimant').setRequired(true)));
add(new SlashCommandBuilder().setName('add').setDescription('Add a user to the ticket').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)));
add(new SlashCommandBuilder().setName('remove').setDescription('Remove a user from the ticket').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)));
add(new SlashCommandBuilder().setName('close').setDescription('Close the current ticket'));
add(new SlashCommandBuilder().setName('reopen').setDescription('Reopen the current ticket'));
add(new SlashCommandBuilder().setName('stats').setDescription('Set the claim stats channel'));

// Moderation / configuration (authorized IDs only)
add(new SlashCommandBuilder().setName('setfosh').setDescription('Add profanity words').addStringOption(o=>o.setName('words').setDescription('Comma separated').setRequired(true)));
add(new SlashCommandBuilder().setName('deletefosh').setDescription('Delete profanity words').addStringOption(o=>o.setName('words').setDescription('Comma separated').setRequired(true)));
add(new SlashCommandBuilder().setName('whiteuser').setDescription('Whitelist user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)));
for(const n of ['kick','ban','timeout','warn']) add(new SlashCommandBuilder().setName(n).setDescription(n).addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')));
add(new SlashCommandBuilder().setName('unwarn').setDescription('Remove one warning').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)));
add(new SlashCommandBuilder().setName('unban').setDescription('Unban a user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)));
add(new SlashCommandBuilder().setName('untimeout').setDescription('Remove timeout').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)));
add(new SlashCommandBuilder().setName('setrolexp').setDescription('Set XP role').addIntegerOption(o=>o.setName('level').setDescription('Level').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)));
add(new SlashCommandBuilder().setName('setxp').setDescription('Add XP').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('XP amount').setRequired(true).setMinValue(1)));
add(new SlashCommandBuilder().setName('settextwel').setDescription('Set welcome text').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)));
add(new SlashCommandBuilder().setName('settextinc').setDescription('Set invite text').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)));
add(new SlashCommandBuilder().setName('settextxp').setDescription('Set level-up text').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)));
add(new SlashCommandBuilder().setName('setbanner').setDescription('Set server banner').addStringOption(o=>o.setName('banner').setDescription('Banner text').setRequired(true)));
add(new SlashCommandBuilder().setName('setex').setDescription('Set final Exchange channel').addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('setexlog').setDescription('Set Exchange Log channel').addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('setrate').setDescription('Set ticket rating channel').addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('setticketlog').setDescription('Set ticket transcript log channel').addChannelOption(o=>o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true)));
add(new SlashCommandBuilder().setName('textowner').setDescription('Set owner relay channel').addChannelOption(o=>o.setName('channel').setDescription('Channel').setRequired(true)));
add(new SlashCommandBuilder().setName('untextowner').setDescription('Disable owner relay'));
add(new SlashCommandBuilder().setName('createcmd').setDescription('Create a public custom text command').addStringOption(o=>o.setName('keyword').setDescription('Keyword').setRequired(true)).addStringOption(o=>o.setName('text').setDescription('Response').setRequired(true)));

(async()=>{
  const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:cmds.map(x=>x.toJSON())});
  console.log(`Deployed ${cmds.length} commands.`);
})().catch(e=>{console.error(e);process.exit(1)});
