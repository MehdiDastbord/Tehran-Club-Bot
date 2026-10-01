const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { db } = require('../db');
const { sendLog } = require('./logService');
const delivery = require('./discordDeliveryService');
const { withKeyLock } = require('./lockService');
function create(guild,channel,kind,trigger,prize,durationMinutes=60){const mins=Math.max(1,Math.min(1440,Math.floor(Number(durationMinutes)||60)));const now=Date.now();const r=db.prepare('INSERT INTO drops(guild_id,channel_id,kind,trigger_text,prize,created_at,ends_at) VALUES(?,?,?,?,?,?,?)').run(guild.id,channel.id,kind,trigger||null,prize,now,now+mins*60000);return db.prepare('SELECT * FROM drops WHERE id=?').get(r.lastInsertRowid)}
function active(g,k,channelId=null){const now=Date.now();if(channelId)return db.prepare('SELECT * FROM drops WHERE guild_id=? AND kind=? AND ended=0 AND channel_id=? AND ends_at>? ORDER BY id ASC').all(g,k,channelId,now);return db.prepare('SELECT * FROM drops WHERE guild_id=? AND kind=? AND ended=0 AND ends_at>? ORDER BY id ASC').all(g,k,now)}
function getById(id){return db.prepare('SELECT * FROM drops WHERE id=?').get(id)||null}
function row(d,disabled=false){return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`drop:${d.id}`).setLabel('Claim').setEmoji('🎁').setStyle(ButtonStyle.Primary).setDisabled(disabled))}
function embed(d){const text=d.kind==='text'&&d.trigger_text?`\n\n💬 **متن Drop:** ${d.trigger_text}`:'';const e=new EmbedBuilder().setColor(d.ended?0x95A5A6:0xE67E22).setTitle('🎁 Drop').setDescription(`**جایزه:** ${d.prize}${text}\n\n⏳ **پایان:** <t:${Math.floor((d.ends_at||Date.now()+3600000)/1000)}:R>`).setFooter({text:`Drop #${d.id}`}).setTimestamp();if(d.ended)e.addFields({name:'🏆 نتیجه',value:d.winner_id?`برنده: <@${d.winner_id}>`:'بدون برنده'});return e}
async function finishMessage(guild,d,winner=null,reason='ended'){
  if(d.message_id){
    const edit={embeds:[embed(d).toJSON()],components:[row(d,true).toJSON()]};
    delivery.enqueueEditTx(guild.id,d.channel_id,d.message_id,edit,`drop:message:${d.id}`,db);
  }
  if(winner) delivery.enqueueSendTx(guild.id,d.channel_id,{content:`🎁 <@${winner}> برنده Drop شد! جایزه: **${d.prize}**`,allowedMentions:{users:[winner]}},`drop:winner:${d.id}`,db);
  await sendLog(guild,'drop',{action:reason,drop_id:d.id,user:winner?`<@${winner}>`:'none',prize:d.prize,channel:d.channel_id,message:d.message_id||'unknown'});
}
async function win(guild,d,user){
  return withKeyLock(`drop:${d.id}`,async()=>{
    const result=db.transaction(()=>{
      const fresh=db.prepare('SELECT * FROM drops WHERE id=? AND guild_id=? AND ended=0 AND channel_id=? AND ends_at>?').get(d.id,guild.id,d.channel_id,Date.now());
      if(!fresh)return null;
      const r=db.prepare('UPDATE drops SET ended=1,winner_id=? WHERE id=? AND guild_id=? AND ended=0 AND ends_at>?').run(user,d.id,guild.id,Date.now());
      if(!r.changes)return null;
      const ended={...fresh,ended:1,winner_id:user};
      if(ended.message_id)delivery.enqueueEditTx(guild.id,ended.channel_id,ended.message_id,{embeds:[embed(ended).toJSON()],components:[row(ended,true).toJSON()]},`drop:message:${ended.id}`,db);
      delivery.enqueueSendTx(guild.id,ended.channel_id,{content:`🎁 <@${user}> برنده Drop شد! جایزه: **${ended.prize}**`,allowedMentions:{users:[user]}},`drop:winner:${ended.id}`,db);
      return ended;
    })();
    if(!result)return false;
    await sendLog(guild,'drop',{action:'winner',drop_id:result.id,user:`<@${user}>`,prize:result.prize,channel:result.channel_id,message:result.message_id||'unknown'});
    return true;
  });
}

async function endWithMessage(guild,d,reason='ended'){
  return withKeyLock(`drop:${d.id}`,async()=>{
    const result=db.transaction(()=>{
      const fresh=db.prepare('SELECT * FROM drops WHERE id=? AND guild_id=? AND ended=0').get(d.id,guild.id);
      if(!fresh)return null;
      const r=db.prepare('UPDATE drops SET ended=1 WHERE id=? AND guild_id=? AND ended=0').run(d.id,guild.id);
      if(!r.changes)return null;
      const ended={...fresh,ended:1};
      if(ended.message_id)delivery.enqueueEditTx(guild.id,ended.channel_id,ended.message_id,{embeds:[embed(ended).toJSON()],components:[row(ended,true).toJSON()]},`drop:message:${ended.id}`,db);
      return ended;
    })();
    if(!result)return false;
    await sendLog(guild,'drop',{action:reason,drop_id:result.id,user:'none',prize:result.prize,channel:result.channel_id,message:result.message_id||'unknown'});
    return true;
  });
}
async function expire(guild){const rows=db.prepare('SELECT * FROM drops WHERE guild_id=? AND ended=0 AND ends_at<=?').all(guild.id,Date.now());for(const d of rows)await endWithMessage(guild,d,'expired');return rows.length;}
module.exports={create,active,getById,row,embed,win,endWithMessage,expire};
