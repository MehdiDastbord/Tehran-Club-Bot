const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const crypto = require('crypto');
const { db } = require('../db');
const { sendLog } = require('./logService');
const delivery = require('./discordDeliveryService');

function create(guild,channel,prize,minutes,link){
  const mins=Math.max(1,Math.floor(Number(minutes)||0));
  const ends=Date.now()+mins*60000;
  const r=db.prepare('INSERT INTO giveaways(guild_id,channel_id,prize,ends_at,link) VALUES(?,?,?,?,?)').run(guild.id,channel.id,prize,ends,link||null);
  return db.prepare('SELECT * FROM giveaways WHERE id=?').get(r.lastInsertRowid);
}
function embed(g){
  const e=new EmbedBuilder().setColor(g.ended?0x95A5A6:0xF1C40F).setTitle('🎉 Giveaway')
    .setDescription(`**جایزه:** ${g.prize}\n\n⏳ **پایان:** <t:${Math.floor(g.ends_at/1000)}:R>\n📅 **زمان دقیق:** <t:${Math.floor(g.ends_at/1000)}:F>`)
    .setFooter({text:`Giveaway #${g.id}`}).setTimestamp();
  if(g.link)e.addFields({name:'🔗 لینک',value:g.link.slice(0,1024)});
  if(g.ended)e.addFields({name:'🏆 نتیجه',value:g.winner_id?`برنده: <@${g.winner_id}>`:'بدون شرکت‌کننده'});
  return e;
}
function row(g,ended=false,page=0,pages=1){
  const p=Math.max(1,pages);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw_join:${g.id}`).setLabel('Join Giveaway').setEmoji('🎉').setStyle(ButtonStyle.Success).setDisabled(ended),
    new ButtonBuilder().setCustomId(`gw_list:${g.id}:${page}`).setLabel('Participants').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`gw_prev:${g.id}:${page}`).setLabel('Prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page<=0),
    new ButtonBuilder().setCustomId(`gw_next:${g.id}:${page}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page>=p-1)
  );
}
function join(id,u){
  const now=Date.now();
  try{
    const r=db.prepare(`INSERT OR IGNORE INTO giveaway_entries(giveaway_id,user_id,joined_at)
      SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM giveaways WHERE id=? AND ended=0 AND ends_at>?)`).run(id,u,now,id,now);
    return r.changes>0;
  }catch(e){console.error('[GIVEAWAY JOIN]',e.message);return false;}
}
function participantCount(id){return Number(db.prepare('SELECT COUNT(*) AS c FROM giveaway_entries WHERE giveaway_id=?').get(id)?.c||0)}
function participants(id){return db.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id=? ORDER BY joined_at ASC,user_id ASC').all(id)}
function page(id,page=0,size=15){const safeSize=Math.max(1,Math.min(50,Math.floor(size)||15));const totalCount=participantCount(id);const total=Math.max(1,Math.ceil(totalCount/safeSize));const index=Math.min(Math.max(0,Math.floor(page)||0),total-1);const items=db.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id=? ORDER BY joined_at ASC,user_id ASC LIMIT ? OFFSET ?').all(id,safeSize,index*safeSize);return {items,page:index,pages:total,total:totalCount}}
async function finish(guild,g,force=false){
  const claimed=db.transaction((id)=>{
    const r=force?db.prepare('UPDATE giveaways SET ended=1 WHERE id=? AND ended=0').run(id):db.prepare('UPDATE giveaways SET ended=1 WHERE id=? AND ended=0 AND ends_at<=?').run(id,Date.now());
    if(!r.changes)return null;
    const count=participantCount(id); let winner=null;
    if(count){const offset=crypto.randomInt(0,count);winner=db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id=? ORDER BY joined_at ASC,user_id ASC LIMIT 1 OFFSET ?').get(id,offset)?.user_id||null;if(winner)db.prepare('UPDATE giveaways SET winner_id=? WHERE id=? AND ended=1').run(winner,id);}
    const fresh=db.prepare('SELECT * FROM giveaways WHERE id=?').get(id); const data=page(id,0,15);
    if(fresh.message_id){
      delivery.enqueueEditTx(guild.id,fresh.channel_id,fresh.message_id,{embeds:[embed(fresh).toJSON()],components:[row(fresh,true,0,data.pages).toJSON()]},`giveaway:message:${fresh.id}`,db);
    }
    const content=fresh.winner_id?`🎉 تبریک <@${fresh.winner_id}>! شما برنده **${fresh.prize}** شدید!`:`❌ Giveaway **${fresh.prize}** بدون شرکت‌کننده به پایان رسید.`;
    delivery.enqueueSendTx(guild.id,fresh.channel_id,{content,allowedMentions:{users:fresh.winner_id?[fresh.winner_id]:[]}},`giveaway:end:${fresh.id}`,db);
    return {fresh,data};
  });
  const result=claimed(g.id); if(!result)return null;
  await sendLog(guild,'giveaway',{action:'ended',id:result.fresh.id,prize:result.fresh.prize,participants:result.data.total,winner:result.fresh.winner_id?`<@${result.fresh.winner_id}>`:'none',forced:force});
  return result.fresh.winner_id||null;
}
async function reroll(guild, g) {
  const result = db.transaction(() => {
    const current = db.prepare('SELECT * FROM giveaways WHERE id=? AND guild_id=? AND ended=1').get(g.id,guild.id);
    if (!current) return {error:'GIVEAWAY_NOT_ENDED'};
    const entries = db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id=? AND user_id<>? ORDER BY joined_at ASC,user_id ASC').all(current.id,current.winner_id||'');
    if (!entries.length) return {error:'GIVEAWAY_NOT_ENOUGH_PARTICIPANTS'};
    const winner = entries[crypto.randomInt(0,entries.length)].user_id;
    db.prepare('UPDATE giveaways SET winner_id=? WHERE id=? AND ended=1').run(winner,current.id);
    return {fresh:db.prepare('SELECT * FROM giveaways WHERE id=?').get(current.id)};
  })();
  if (result.error) return result;
  const fresh=result.fresh;
  const data=page(fresh.id,0,15);
  if(fresh.message_id) {
    const ch=await guild.channels.fetch(fresh.channel_id).catch(()=>null);
    const m=await ch?.messages.fetch(fresh.message_id).catch(()=>null);
    if(m) await m.edit({embeds:[embed(fresh)],components:[row(fresh,true,0,data.pages)]}).catch(e=>console.error('[GIVEAWAY REROLL EDIT]',e.message));
  }
  const ch=await guild.channels.fetch(fresh.channel_id).catch(()=>null);
  if(ch?.isTextBased()) await ch.send({content:`🔄 Giveaway **${fresh.prize}** دوباره قرعه‌کشی شد! برنده جدید: <@${fresh.winner_id}>`,allowedMentions:{users:[fresh.winner_id]}}).catch(e=>console.error('[GIVEAWAY REROLL SEND]',e.message));
  await sendLog(guild,'giveaway',{action:'rerolled',id:fresh.id,prize:fresh.prize,winner:`<@${fresh.winner_id}>`});
  return {winner:fresh.winner_id,fresh};
}
async function finishDue(client){const gs=db.prepare('SELECT * FROM giveaways WHERE ended=0 AND ends_at<=? ORDER BY ends_at ASC').all(Date.now());for(const g of gs){const guild=client.guilds.cache.get(g.guild_id);if(guild)await finish(guild,g,false);}}
module.exports={create,embed,row,join,participants,page,finish,finishDue,reroll};
