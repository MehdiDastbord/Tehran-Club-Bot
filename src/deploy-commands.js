require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const cmds = [
  new SlashCommandBuilder().setName('giveaway').setDescription('Create a giveaway').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Duration in minutes').setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName('giveawaysv').setDescription('Create a giveaway with a link').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Duration in minutes').setMinValue(1).setRequired(true)).addStringOption(o=>o.setName('link').setDescription('Link').setRequired(true)),
  new SlashCommandBuilder().setName('dropmatn').setDescription('Create a text drop').addStringOption(o=>o.setName('text').setDescription('Winning text').setRequired(true)),
  new SlashCommandBuilder().setName('dropclick').setDescription('Create a click drop'),
  new SlashCommandBuilder().setName('panel').setDescription('Create a ticket panel').addStringOption(o=>o.setName('name').setDescription('Panel name').setRequired(true)).addStringOption(o=>o.setName('welcome').setDescription('Welcome text')).addChannelOption(o=>o.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory)).addRoleOption(o=>o.setName('role').setDescription('Role to mention in tickets')),
  new SlashCommandBuilder().setName('menu').setDescription('Show the ticket menu'),
  new SlashCommandBuilder().setName('claim').setDescription('Claim the current ticket'),
  new SlashCommandBuilder().setName('claimchange').setDescription('Change ticket claimant').addUserOption(o=>o.setName('user').setDescription('New claimant').setRequired(true)),
  new SlashCommandBuilder().setName('add').setDescription('Add a user to the current ticket').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('close').setDescription('Close the current ticket'),
  new SlashCommandBuilder().setName('reopen').setDescription('Reopen the current ticket'),
  new SlashCommandBuilder().setName('stats').setDescription('Set this channel as the hourly claim stats channel'),
  ...['kick','ban','timeout','warn'].map(n=>new SlashCommandBuilder().setName(n).setDescription(n).addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason'))),
  new SlashCommandBuilder().setName('level').setDescription('Show your level'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show XP leaderboard'),
  new SlashCommandBuilder().setName('setrolexp').setDescription('Set a role reward for an XP level').addIntegerOption(o=>o.setName('level').setDescription('Level').setMinValue(1).setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('setxp').setDescription('Give XP to a user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('XP amount').setRequired(true)),
  new SlashCommandBuilder().setName('exchange').setDescription('Open the exchange form'),
  new SlashCommandBuilder().setName('banner').setDescription('Show the server banner text'),
  new SlashCommandBuilder().setName('textowner').setDescription('Set this channel as the owner relay channel'),
  new SlashCommandBuilder().setName('createcmd').setDescription('Create a custom text command').addStringOption(o=>o.setName('keyword').setDescription('Keyword without /').setRequired(true)).addStringOption(o=>o.setName('text').setDescription('Response text').setRequired(true))
];

(async()=>{
  if(!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) throw new Error('DISCORD_TOKEN, CLIENT_ID and GUILD_ID are required.');
  const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:cmds.map(x=>x.toJSON())});
  console.log(`Commands deployed: ${cmds.length}`);
})().catch(err=>{ console.error(err); process.exit(1); });
