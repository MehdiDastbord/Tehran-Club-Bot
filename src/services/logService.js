const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getSettings, log: dbLog, db } = require('../db');
const { stripMentions, clamp } = require('../utils');

const colors={message:0x95a5a6,member:0x3498db,moderation:0xe74c3c,ticket:0x9b59b6,giveaway:0xf1c40f,drop:0xe67e22,exchange:0x1abc9c,xp:0x2ecc71,invite:0x3498db,voice:0x5865f2,server:0x607d8b,staff:0x8e44ad,ai:0x7289da,music:0x1abc9c,emote:0xe91e63,guess:0xf39c12,warning:0xe74c3c};
const types=Object.keys(colors);
function safeJson(value){try{return JSON.stringify(value);}catch{return String(value);}}
async function sendLog(guild,type,payload){
  try{
    if(!types.includes(type))type='server';
    const clean={};for(const [k,v] of Object.entries(payload||{}))clean[k]=typeof v==='string'?stripMentions(v):v;
    dbLog(guild.id,type,clean);
    const chId=getSettings(guild.id).logs?.[type];if(!chId)return;
    const ch=await guild.channels.fetch(chId).catch(()=>null);
    if(!ch?.isTextBased())return;
    const me=guild.members.me;
    if(me&&!ch.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))return;
    const fields=Object.entries(clean).slice(0,25).map(([k,v])=>({name:clamp(k,256)||'Event',value:clamp(typeof v==='string'?v:safeJson(v),1024)||'—',inline:false}));
    const action=String(clean.action||type).replaceAll('_',' ');
    await ch.send({embeds:[new EmbedBuilder().setColor(colors[type]).setTitle(`📋 ${type.toUpperCase()} LOG`).setDescription(`**${action}**`).addFields(fields.length?fields:[{name:'Event',value:'—'}]).setTimestamp()]});
  }catch(e){console.error('[LOG]',e.message)}
}
function cleanup(retentionDays=30){const days=Math.max(1,Number(retentionDays)||30);return db.prepare('DELETE FROM logs WHERE created_at<?').run(Date.now()-days*86400000).changes;}
module.exports={sendLog,cleanup,types,colors};
