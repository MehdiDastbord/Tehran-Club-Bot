const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db, getSettings, setSettings } = require('../db');
const { sendLog } = require('./logService');
const { withKeyLock } = require('./lockService');
function logRecoveryFailure(guild,ticketId,operation,error){ db.prepare('INSERT INTO logs(guild_id,type,payload,created_at) VALUES(?,?,?,?)').run(guild.id,'ticket_recovery',JSON.stringify({ticket_id:ticketId,operation,error:String(error?.message||error)}),Date.now()); }

const DEFAULT_TYPES = {
  support: { name:'Support', emoji:'🎫', prefix:'support' },
  exchange: { name:'Exchange', emoji:'💱', prefix:'exchange' },
  staff: { name:'Staff', emoji:'👤', prefix:'staff' },
  event: { name:'Event', emoji:'🎉', prefix:'event' }
};

function getTypes(guildId) {
  const custom = getSettings(guildId).ticket?.types;
  return { ...DEFAULT_TYPES, ...(custom || {}) };
}
async function saveTypes(guildId, types) { return setSettings(guildId, { ticket: { types } }); }
function supportRoleId(guild) { return getSettings(guild.id).ticket?.supportRoleId || null; }
function getByChannel(guildId, channelId) { return db.prepare('SELECT * FROM tickets WHERE guild_id=? AND channel_id=?').get(guildId,channelId)||null; }
function getById(id) { return db.prepare('SELECT * FROM tickets WHERE id=?').get(id)||null; }
function activeParticipants(ticketId) { return db.prepare('SELECT * FROM ticket_participants WHERE ticket_id=? AND active=1 ORDER BY created_at ASC').all(ticketId); }
function isSupport(guild, member) { const role=supportRoleId(guild); return !!role && !!member?.roles?.cache?.has(role); }
function assertSupport(guild, member) { if (!isSupport(guild,member)) throw new Error('TICKET_SUPPORT_REQUIRED'); }

function buildEmbed(ticket,type){
  return new EmbedBuilder()
    .setColor(ticket.status==='open'?0x5865F2:0x95A5A6)
    .setTitle(`${type?.emoji||'🎫'} ${type?.name||ticket.type} Ticket`)
    .setDescription(ticket.status==='open'?'برای رسیدگی به این Ticket از دکمه‌های پایین استفاده کن.':'این Ticket بسته شده است؛ فقط Ticket Support می‌تواند آن را دوباره باز کند.')
    .addFields(
      {name:'👤 صاحب Ticket',value:`<@${ticket.opener_id}>`,inline:true},
      {name:'📌 وضعیت',value:ticket.status,inline:true},
      {name:'👮 Claim',value:ticket.claimed_by?`<@${ticket.claimed_by}>`:'هنوز Claim نشده',inline:true}
    )
    .setFooter({text:`Ticket #${ticket.id}`}).setTimestamp(new Date(ticket.created_at));
}
function buildControls(ticket){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_claim:${ticket.id}`).setLabel('Claim').setEmoji('🛡️').setStyle(ButtonStyle.Primary).setDisabled(ticket.status!=='open'||!!ticket.claimed_by),
    new ButtonBuilder().setCustomId(ticket.status==='open'?`ticket_close:${ticket.id}`:`ticket_reopen:${ticket.id}`).setLabel(ticket.status==='open'?'Close':'Reopen').setEmoji(ticket.status==='open'?'🔒':'🔓').setStyle(ticket.status==='open'?ButtonStyle.Danger:ButtonStyle.Success)
  );
}

async function create(guild,interaction,key){
  return withKeyLock(`ticket-create:${guild.id}:${interaction.user.id}`,async()=>{
    const type=getTypes(guild.id)[key]; if(!type)return {error:'TICKET_TYPE_NOT_FOUND'};
    const settings=getSettings(guild.id); const support=supportRoleId(guild); if(!support)return {error:'TICKET_SUPPORT_ROLE_MISSING'};
    const bot=guild.members.me; if(!bot?.permissions.has(PermissionFlagsBits.ManageChannels))return {error:'Bot دسترسی Manage Channels ندارد.'};
    const supportRole=guild.roles.cache.get(support); if(!supportRole||supportRole.managed||supportRole.position>=bot.roles.highest.position)return {error:'Ticket Support Role باید پایین‌تر از Role بات باشد.'};
    let category=null; const catId=settings.ticket?.categoryId;
    if(catId){category=await guild.channels.fetch(catId).catch(()=>null);if(!category)return {error:'Ticket Category پیدا نشد.'};if(category.type!==ChannelType.GuildCategory)return {error:'Ticket Category معتبر نیست.'};}

    const openKey=`${guild.id}:${interaction.user.id}`;
    const existing=db.prepare('SELECT * FROM tickets WHERE open_key=? AND status="open" LIMIT 1').get(openKey);
    if(existing){const ch=await guild.channels.fetch(existing.channel_id).catch(()=>null);if(ch)return {channel:ch,ticket:existing,existing:true};db.prepare('UPDATE tickets SET status="closed",closed_at=?,open_key=NULL WHERE id=? AND status="open"').run(Date.now(),existing.id);}

    const safeName=`${String(type.prefix||key).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,30)||'ticket'}-${interaction.user.username.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40)||interaction.user.id.slice(-6)}`.slice(0,90);
    const overwrites=[
      {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
      {id:interaction.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},
      {id:support,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}
    ];
    const channel=await guild.channels.create({name:safeName,type:ChannelType.GuildText,parent:category?.id,permissionOverwrites:overwrites,reason:`Ticket opened by ${interaction.user.tag}`});
    let ticket;
    try{
      const inserted=db.prepare('INSERT INTO tickets(guild_id,channel_id,opener_id,type,created_at,status,open_key) VALUES(?,?,?,?,?,?,?)').run(guild.id,channel.id,interaction.user.id,key,Date.now(),'open',openKey);
      ticket=getById(inserted.lastInsertRowid);
      const msg=await channel.send({content:`<@${interaction.user.id}> <@&${support}>`,embeds:[buildEmbed(ticket,type)],components:[buildControls(ticket)],allowedMentions:{users:[interaction.user.id],roles:[support]}});
      const updated=db.prepare('UPDATE tickets SET control_message_id=? WHERE id=?').run(msg.id,ticket.id); if(!updated.changes)throw new Error('TICKET_CONTROL_DB_FAILED');
      await sendLog(guild,'ticket',{action:'created',ticket:ticket.id,channel:channel.name,user:interaction.user.tag,type:key,support_role:support});
      return {channel,ticket:getById(ticket.id),existing:false};
    }catch(error){
      if(ticket)db.prepare('DELETE FROM tickets WHERE id=?').run(ticket.id);
      await channel.delete('Ticket creation rollback').catch(e=>logRecoveryFailure(guild,ticket?.id||0,'ticket_channel_create_rollback',e));
      throw error;
    }
  });
}

async function updateControlMessage(guild,ticketId){
  const t=getById(ticketId);if(!t)return false;
  const ch=await guild.channels.fetch(t.channel_id).catch(()=>null);if(!ch?.isTextBased())return false;
  const type=getTypes(guild.id)[t.type];
  if(t.control_message_id){
    const msg=await ch.messages.fetch(t.control_message_id).catch(()=>null);
    if(msg){
      try{await msg.edit({embeds:[buildEmbed(t,type)],components:[buildControls(t)]});return true;}catch(error){console.error('[TICKET CONTROL EDIT]',error.message);}
    }
  }
  try{
    const msg=await ch.send({embeds:[buildEmbed(t,type)],components:[buildControls(t)]});
    const r=db.prepare('UPDATE tickets SET control_message_id=? WHERE id=?').run(msg.id,t.id);
    return !!r.changes;
  }catch(error){console.error('[TICKET CONTROL RECREATE]',error.message);return false;}
}

async function claim(guild,id,userId,member){
  return withKeyLock(`ticket:${id}`,async()=>{
    const t=getById(id);if(!t||t.guild_id!==guild.id||t.status!=='open')return false;assertSupport(guild,member);
    const result=db.prepare('UPDATE tickets SET claimed_by=? WHERE id=? AND guild_id=? AND status="open" AND (claimed_by IS NULL OR claimed_by="")').run(userId,id,guild.id);
    if(!result.changes)return false;
    const fresh=getById(id);db.prepare('INSERT INTO ticket_claim_events(ticket_id,guild_id,user_id,claimed_at) VALUES(?,?,?,?)').run(id,guild.id,userId,Date.now());await updateControlMessage(guild,id);await sendLog(guild,'ticket',{action:'claimed',ticket:id,by:userId,channel:fresh.channel_id});return true;
  });
}

async function applyParticipantPermissions(guild,ticket,closing){
  const ch=await guild.channels.fetch(ticket.channel_id).catch(()=>null);if(!ch)throw new Error('TICKET_CHANNEL_NOT_FOUND');
  const participants=[...new Set([ticket.opener_id,...activeParticipants(ticket.id).map(x=>x.user_id)])];
  const targets=[...participants];const support=supportRoleId(guild);if(support)targets.push(support);
  const snapshots=new Map(targets.map(id=>{const ow=ch.permissionOverwrites.cache.get(id);return [id,ow?{allow:String(ow.allow.bitfield),deny:String(ow.deny.bitfield)}:null]}));
  if(closing){
    const existing=db.prepare('SELECT COUNT(*) AS c FROM ticket_permission_snapshots WHERE ticket_id=?').get(ticket.id).c;
    // Each close captures a fresh baseline. The snapshot is intentionally retained
    // across reopen/restart so a later reconciliation can still recover the ticket.
    const save=db.transaction(()=>{
      db.prepare('DELETE FROM ticket_permission_snapshots WHERE ticket_id=?').run(ticket.id);
      const stmt=db.prepare('INSERT INTO ticket_permission_snapshots(ticket_id,subject_id,allow,deny,had_overwrite,created_at,subject_type) VALUES(?,?,?,?,?,?,?)');
      for(const [id,old] of snapshots){const subjectType=(id===support?'role':(guild.roles.cache.has(id)?'role':'user'));stmt.run(ticket.id,id,old?.allow||'0',old?.deny||'0',old?1:0,Date.now(),subjectType);}
    });
    save();
  }
  try{
    for(const userId of participants){
      await ch.permissionOverwrites.edit(userId,closing?{ViewChannel:false,SendMessages:false,ReadMessageHistory:false}:{ViewChannel:true,SendMessages:true,ReadMessageHistory:true},'Ticket participant status sync');
    }
    if(support)await ch.permissionOverwrites.edit(support,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true},'Ticket Support sync');
    return {ch,participants};
  }catch(error){
    for(const [id,old] of snapshots){
      try{
        if(old)await ch.permissionOverwrites.edit(id,{allow:old.allow,deny:old.deny},'Ticket permission rollback');
        else await ch.permissionOverwrites.delete(id,'Ticket permission rollback');
      }catch(e){console.error('[TICKET PERMISSION ROLLBACK]',e.message);logRecoveryFailure(guild,ticket.id,'permission_rollback',e)}
    }
    throw error;
  }
}

async function restoreTicketPermissionSnapshot(guild,ticketId){
  const t=getById(ticketId);if(!t)return false;
  const ch=await guild.channels.fetch(t.channel_id).catch(()=>null);if(!ch){logRecoveryFailure(guild,ticketId,'snapshot_restore_channel',new Error('TICKET_CHANNEL_NOT_FOUND'));return false;}
  const rows=db.prepare('SELECT * FROM ticket_permission_snapshots WHERE ticket_id=?').all(ticketId);
  if(!rows.length)return false;
  const currentSupport=supportRoleId(guild);
  for(const row of rows){
    // A historical Support Role must never be resurrected after the server changed it.
    const isRole=row.subject_type==='role' || (row.subject_type==='unknown' && !!guild.roles.cache.has(row.subject_id));
    if(isRole && row.subject_id!==currentSupport){
      try { await ch.permissionOverwrites.delete(row.subject_id,'Obsolete Ticket Support Role cleanup'); } catch(error) { logRecoveryFailure(guild,ticketId,'obsolete_support_cleanup',error); throw error; }
      continue;
    }
    if(row.subject_id===currentSupport){
      await ch.permissionOverwrites.edit(row.subject_id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true},'Current Ticket Support Role restore');
      continue;
    }
    if(row.had_overwrite) await ch.permissionOverwrites.edit(row.subject_id,{allow:row.allow,deny:row.deny},'Ticket snapshot restore');
    else await ch.permissionOverwrites.delete(row.subject_id,'Ticket snapshot restore');
  }
  if(currentSupport) await ch.permissionOverwrites.edit(currentSupport,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true},'Current Ticket Support Role restore');
  return true;
}
async function reconcile(guild){
  const rows=db.prepare('SELECT * FROM tickets WHERE guild_id=?').all(guild.id); let repaired=0; const failures=[];
  for(const t of rows){
    const ch=await guild.channels.fetch(t.channel_id).catch(()=>null);
    if(!ch){ if(t.status==='open') db.prepare('UPDATE tickets SET status="closed",closed_at=?,open_key=NULL WHERE id=? AND status="open"').run(Date.now(),t.id); continue; }
    try{
      const support=supportRoleId(guild);
      if(support) await ch.permissionOverwrites.edit(support,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true},'Ticket startup reconciliation');
      const participants=[...new Set([t.opener_id,...activeParticipants(t.id).map(x=>x.user_id)])];
      for(const uid of participants){ await ch.permissionOverwrites.edit(uid,t.status==='open'?{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}:{ViewChannel:false,SendMessages:false,ReadMessageHistory:false},'Ticket startup participant reconciliation'); }
      if(t.status==='open' && t.open_key===null) db.prepare('UPDATE tickets SET open_key=? WHERE id=? AND status="open"').run(`${guild.id}:${t.opener_id}`,t.id);
      repaired++;
    }catch(error){ failures.push({ticket:t.id,error:error.message}); }
  }
  if(failures.length) console.error('[TICKET RECONCILE]',JSON.stringify(failures));
  return {repaired,failures};
}

async function close(guild,id,member,reason='بدون دلیل'){
  return withKeyLock(`ticket:${id}`,async()=>{
    const t=getById(id);if(!t||t.guild_id!==guild.id||t.status!=='open')return false;assertSupport(guild,member);
    const safeReason=String(reason||'بدون دلیل').slice(0,1000);
    await applyParticipantPermissions(guild,t,true);
    try{
      const r=db.prepare('UPDATE tickets SET status="closed",closed_at=?,close_reason=?,open_key=NULL WHERE id=? AND guild_id=? AND status="open"').run(Date.now(),safeReason,id,guild.id);
      if(!r.changes)throw new Error('TICKET_STATUS_CHANGED');
    }catch(error){try{await restoreTicketPermissionSnapshot(guild,id);}catch(recoveryError){logRecoveryFailure(guild,id,'close_restore',recoveryError);}throw error;}
    await updateControlMessage(guild,id);
    const ch=await guild.channels.fetch(t.channel_id).catch(()=>null);
    if(ch?.isTextBased())await ch.send({embeds:[new EmbedBuilder().setColor(0xED4245).setTitle('🔒 Ticket Closed').setDescription(`بسته شد توسط <@${member.id}>.\n**دلیل:** ${safeReason}`)]}).catch(e=>console.error('[TICKET CLOSE MESSAGE]',e.message));
    try{
      const user=await guild.client.users.fetch(t.opener_id);
      const row=new ActionRowBuilder().addComponents(...[1,2,3,4,5].map(n=>new ButtonBuilder().setCustomId(`ticket_feedback:${id}:${n}`).setLabel(String(n)).setEmoji('⭐').setStyle(n>=4?ButtonStyle.Success:n===3?ButtonStyle.Secondary:ButtonStyle.Danger)));
      await user.send({embeds:[new EmbedBuilder().setColor(0xF1C40F).setTitle(`⭐ امتیاز Ticket #${id}`).setDescription(`Ticket شما بسته شد. اگر دوست داشتی کیفیت رسیدگی را از ۱ تا ۵ امتیاز بده.\n**دلیل بسته‌شدن:** ${safeReason}`)],components:[row]});
    }catch(error){console.error('[TICKET FEEDBACK DM]',error.message);}
    await sendLog(guild,'ticket',{action:'closed',ticket:id,channel:t.channel_id,by:member.user.tag,reason:safeReason});return true;
  });
}

async function reopen(guild,id,member){
  return withKeyLock(`ticket:${id}`,async()=>{
    const t=getById(id);if(!t||t.guild_id!==guild.id||t.status!=='closed')return false;assertSupport(guild,member);
    let restored=false;
    try {
      restored=await restoreTicketPermissionSnapshot(guild,id);
      if(!restored) await applyParticipantPermissions(guild,t,false);
      const r=db.prepare('UPDATE tickets SET status="open",closed_at=NULL,close_reason=NULL,open_key=? WHERE id=? AND guild_id=? AND status="closed"').run(`${guild.id}:${t.opener_id}`,id,guild.id);
      if(!r.changes)throw new Error('TICKET_STATUS_CHANGED');
    }catch(error){
      if(restored) {
        // The snapshot was consumed by restore; recreate a safe closed state.
        try{await applyParticipantPermissions(guild,t,true);}catch(recoveryError){logRecoveryFailure(guild,id,'reopen_close_restore',recoveryError);}
      } else {
        try{await applyParticipantPermissions(guild,t,true);}catch(recoveryError){logRecoveryFailure(guild,id,'reopen_close_restore',recoveryError);}
      }
      throw error;
    }
    await updateControlMessage(guild,id);await sendLog(guild,'ticket',{action:'reopened',ticket:id,channel:t.channel_id,by:member.user.tag});return true;
  });
}

async function addUser(guild,id,userId,member){
  return withKeyLock(`ticket:${id}`,async()=>{
    const t=getById(id);if(!t||t.guild_id!==guild.id||t.status!=='open')return false;assertSupport(guild,member);
    if(userId===t.opener_id||userId===guild.client.user.id)return false;
    const target=await guild.members.fetch(userId).catch(()=>null);if(!target)return false;
    const ch=await guild.channels.fetch(t.channel_id).catch(()=>null);if(!ch)return false;
    if(db.prepare('SELECT 1 FROM ticket_participants WHERE ticket_id=? AND user_id=? AND active=1').get(id,userId))return false;
    const existingOverwrite=ch.permissionOverwrites.cache.get(userId);const previousOverwrite=existingOverwrite?{allow:existingOverwrite.allow.bitfield,deny:existingOverwrite.deny.bitfield}:null;
    try{
      await ch.permissionOverwrites.edit(userId,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
      db.prepare(`INSERT INTO ticket_participants(ticket_id,user_id,added_by,created_at,active,removed_at) VALUES(?,?,?,?,1,NULL)
        ON CONFLICT(ticket_id,user_id) DO UPDATE SET added_by=excluded.added_by,created_at=excluded.created_at,active=1,removed_at=NULL`).run(id,userId,member.id,Date.now());
    }catch(error){
      if(previousOverwrite) await ch.permissionOverwrites.edit(userId,{allow:previousOverwrite.allow.bitfield,deny:previousOverwrite.deny.bitfield},{reason:'Ticket add rollback'}).catch(e=>logRecoveryFailure(guild,id,'add_user_rollback',e));
      else await ch.permissionOverwrites.delete(userId).catch(e=>logRecoveryFailure(guild,id,'add_user_rollback_delete',e));
      return false;
    }
    await sendLog(guild,'ticket',{action:'user_added',ticket:id,user:userId,by:member.user.tag});return true;
  });
}

async function removeUser(guild,id,userId,member){
  return withKeyLock(`ticket:${id}`,async()=>{
    const t=getById(id);if(!t||t.guild_id!==guild.id||t.status!=='open')return false;assertSupport(guild,member);if(userId===t.opener_id)return false;
    const ch=await guild.channels.fetch(t.channel_id).catch(()=>null);if(!ch)return false;
    if(!db.prepare('SELECT 1 FROM ticket_participants WHERE ticket_id=? AND user_id=? AND active=1').get(id,userId))return false;
    const existingOverwrite=ch.permissionOverwrites.cache.get(userId);const previousOverwrite=existingOverwrite?{allow:existingOverwrite.allow.bitfield,deny:existingOverwrite.deny.bitfield}:null;
    try{
      await ch.permissionOverwrites.delete(userId);
      const r=db.prepare('UPDATE ticket_participants SET active=0,removed_at=? WHERE ticket_id=? AND user_id=? AND active=1').run(Date.now(),id,userId);
      if(!r.changes)throw new Error('TICKET_PARTICIPANT_CHANGED');
    }catch(error){
      if(previousOverwrite) await ch.permissionOverwrites.edit(userId,{allow:previousOverwrite.allow.bitfield,deny:previousOverwrite.deny.bitfield},{reason:'Ticket remove rollback'}).catch(e=>logRecoveryFailure(guild,id,'remove_user_rollback',e));
      return false;
    }
    await sendLog(guild,'ticket',{action:'user_removed',ticket:id,user:userId,by:member.user.tag});return true;
  });
}

async function syncSupportRole(guild, oldRoleId, newRoleId){
  return withKeyLock(`ticket-support-role:${guild.id}`, async()=>{
    if(oldRoleId===newRoleId)return [];
    const rows=db.prepare('SELECT * FROM tickets WHERE guild_id=? AND status IN ("open","closed")').all(guild.id);
    const changed=[]; const failures=[];
    for(const t of rows){
      const ch=await guild.channels.fetch(t.channel_id).catch(()=>null);
      if(!ch?.permissionOverwrites){failures.push({ticket:t.id,error:'channel missing or no permissions'});continue;}
      const oldOw=oldRoleId?ch.permissionOverwrites.cache.get(oldRoleId):null;
      const newOw=newRoleId?ch.permissionOverwrites.cache.get(newRoleId):null;
      const snapshot={
        old: oldOw ? {allow:String(oldOw.allow.bitfield),deny:String(oldOw.deny.bitfield)} : null,
        next: newOw ? {allow:String(newOw.allow.bitfield),deny:String(newOw.deny.bitfield)} : null
      };
      try{
        if(oldRoleId && oldOw) await ch.permissionOverwrites.delete(oldRoleId,'Ticket Support Role changed');
        if(newRoleId) await ch.permissionOverwrites.edit(newRoleId,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true},'Ticket Support Role changed');
        changed.push({ch,ticketId:t.id,oldRoleId,newRoleId,snapshot});
      }catch(error){
        try{
          if(newRoleId){
            if(snapshot.next) await ch.permissionOverwrites.edit(newRoleId,{allow:snapshot.next.allow,deny:snapshot.next.deny},'Ticket support role rollback');
            else await ch.permissionOverwrites.delete(newRoleId,'Ticket support role rollback').catch(e=>logRecoveryFailure(guild,t.id,'support_role_local_rollback',e));
          }
          if(oldRoleId){
            if(snapshot.old) await ch.permissionOverwrites.edit(oldRoleId,{allow:snapshot.old.allow,deny:snapshot.old.deny},'Ticket support role rollback');
          }
        }catch(e){failures.push({ticket:t.id,error:`rollback: ${e.message}`});}
        failures.push({ticket:t.id,error:error.message});
        break;
      }
    }
    if(failures.length){
      for(const x of changed.reverse()){
        try{
          if(x.newRoleId){
            if(x.snapshot.next) await x.ch.permissionOverwrites.edit(x.newRoleId,{allow:x.snapshot.next.allow,deny:x.snapshot.next.deny},'Ticket support role global rollback');
            else await x.ch.permissionOverwrites.delete(x.newRoleId,'Ticket support role global rollback').catch(e=>logRecoveryFailure(guild,x.ticketId,'support_role_global_rollback',e));
          }
          if(x.oldRoleId && x.snapshot.old) await x.ch.permissionOverwrites.edit(x.oldRoleId,{allow:x.snapshot.old.allow,deny:x.snapshot.old.deny},'Ticket support role global rollback');
        }catch(e){failures.push({ticket:'rollback',error:e.message});}
      }
    }
    return failures;
  });
}
async function transcript(guild,id,member){
  const t=getById(id);if(!t||t.guild_id!==guild.id)return null;assertSupport(guild,member);
  const ch=await guild.channels.fetch(t.channel_id).catch(()=>null);if(!ch)return null;
  let before;const all=[];for(let page=0;page<100;page++){
    const batch=await ch.messages.fetch({limit:100, ...(before?{before}:{})}).catch(e=>{console.error('[TRANSCRIPT FETCH]',e.message);return null});
    if(!batch||!batch.size)break;
    for(const m of batch.values()){
      const parts=[`[${m.createdAt.toISOString()}] ${m.author?.tag||'unknown'} (${m.author?.id||'unknown'}):`,m.content||'[no text]'];
      const at=[...m.attachments.values()].map(a=>a.url);if(at.length)parts.push(`Attachments: ${at.join(' | ')}`);
      if(m.reference?.messageId)parts.push(`ReplyTo: ${m.reference.messageId}`);
      all.push(parts.join(' '));
    }
    before=batch.last()?.id;if(batch.size<100)break;
  }
  all.reverse();return Buffer.from(all.join('\n'),'utf8');
}

async function recordFeedback(guild,ticketId,userId,rating){
  const t=getById(ticketId);if(!t||!guild||t.guild_id!==guild.id||t.status!=='closed'||t.opener_id!==userId)return {ok:false,message:'این Feedback برای شما معتبر نیست.'};
  const value=Number(rating);if(!Number.isInteger(value)||value<1||value>5)return {ok:false,message:'امتیاز باید بین ۱ تا ۵ باشد.'};
  const r=db.prepare('INSERT OR IGNORE INTO ticket_feedback(ticket_id,guild_id,user_id,rating,created_at) VALUES(?,?,?,?,?)').run(ticketId,guild.id,userId,value,Date.now());
  return r.changes?{ok:true}:{ok:false,message:'امتیاز قبلاً ثبت شده است.'};
}
function claimLeaderboard(guildId){
  return db.prepare(`
    SELECT user_id, COUNT(*) AS claims
    FROM ticket_claim_events
    WHERE guild_id=?
    GROUP BY user_id
    ORDER BY claims DESC, user_id ASC
    LIMIT 20
  `).all(guildId);
}
module.exports={getTypes,saveTypes,getByChannel,getById,supportRoleId,isStaff:isSupport,create,claim,close,reopen,addUser,removeUser,transcript,syncSupportRole,reconcile,activeParticipants,recordFeedback,claimLeaderboard};
