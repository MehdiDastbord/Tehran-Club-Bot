
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const cmds = [
 new SlashCommandBuilder().setName('giveaway').setDescription('Giveaway').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Minutes').setRequired(true)),
 new SlashCommandBuilder().setName('Giveawaysv').setDescription('Giveaway with link').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Minutes').setRequired(true)).addStringOption(o=>o.setName('link').setDescription('Link').setRequired(true)),
 new SlashCommandBuilder().setName('dropmatn').setDescription('Text drop').addStringOption(o=>o.setName('text').setDescription('Winning text').setRequired(true)),
 new SlashCommandBuilder().setName('dropclick').setDescription('Click drop'),
 new SlashCommandBuilder().setName('panel').setDescription('Create ticket panel').addStringOption(o=>o.setName('name').setDescription('Panel name').setRequired(true)).addStringOption(o=>o.setName('welcome').setDescription('Welcome text')).addChannelOption(o=>o.setName('category').setDescription('Ticket category')).addRoleOption(o=>o.setName('role').setDescription('Mention role')),
 new SlashCommandBuilder().setName('Menu').setDescription('Ticket menu'),
 new SlashCommandBuilder().setName('claim').setDescription('Claim ticket'),
 new SlashCommandBuilder().setName('claimchange').setDescription('Change claim').addUserOption(o=>o.setName('user').setDescription('New claimant').setRequired(true)),
 new SlashCommandBuilder().setName('add').setDescription('Add user to ticket').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)),
 new SlashCommandBuilder().setName('close').setDescription('Close ticket'),
 new SlashCommandBuilder().setName('reopen').setDescription('Reopen ticket'),
 new SlashCommandBuilder().setName('stats').setDescription('Save this channel for hourly claim stats'),
 ...['kick','ban','timeout','warn'].map(n=>new SlashCommandBuilder().setName(n).setDescription(n).addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason'))),
 new SlashCommandBuilder().setName('level').setDescription('Your level'),
 new SlashCommandBuilder().setName('leaderboard').setDescription('XP leaderboard'),
 new SlashCommandBuilder().setName('setrolexp').setDescription('Set XP role').addIntegerOption(o=>o.setName('level').setDescription('Level').setRequired(true)).addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)),
 new SlashCommandBuilder().setName('setxp').setDescription('Give XP').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('XP').setRequired(true)),
 new SlashCommandBuilder().setName('Exchange').setDescription('Exchange form'),
 new SlashCommandBuilder().setName('banner').setDescription('Show banner'),
 new SlashCommandBuilder().setName('textowner').setDescription('Set owner relay channel'),
 new SlashCommandBuilder().setName('createcmd').setDescription('Create custom command').addStringOption(o=>o.setName('keyword').setDescription('Keyword').setRequired(true)).addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true))
].map(x=>x.setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON());

(async()=>{
 const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
 await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:cmds});
 console.log('Commands deployed.');
})();
