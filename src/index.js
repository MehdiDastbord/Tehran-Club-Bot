require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, PermissionsBitField,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  AttachmentBuilder, ChannelType
} = require('discord.js');
const { supabase, getSettings, setSettings } = require('./db');

const ADMIN = PermissionsBitField.Flags.Administrator;
const ACCESS = {
  giveaway: 'Giveway Acces', ticket: 'Tickets Support', mod: 'Ban/Kick Acces', logs: 'Logs', exchange: 'Exchange'
};
const TICKET_SUPPORT_ROLE = 'Tickets Support';
const TICKET_TYPES = {
  support: {label:'Support', emoji:'🛠️', prefix:'support'},
  exchange: {label:'Exchange', emoji:'💱', prefix:'exchange'},
  staffhire: {label:'Staff Hire', emoji:'👔', prefix:'staffhire'},
  eventjoin: {label:'Event Join', emoji:'🎉', prefix:'eventjoin'}
};
const PUBLIC_COMMANDS = new Set(['exchange','banner','level','leaderboard']);
const TICKET_STAFF_COMMANDS = new Set(['claim','claimchange','add','remove','close','reopen']);
const client = new Client({ intents:[
  GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildInvites
], partials:[Partials.Channel] });

const OWNER_IDS = String(process.env.AUTHORIZED_IDS || process.env.OWNER_IDS || process.env.OWNER_ID || '').split(',').map(x=>x.trim()).filter(Boolean);
const isBotOwner = id => OWNER_IDS.includes(String(id));
const isAdmin = m => !!m?.permissions?.has(ADMIN);
const hasAccess = (m, role) => !!m?.roles?.cache?.some(r=>r.name===role);
const hasRoleOnly = (m, role) => !!m?.roles?.cache?.some(r=>r.name===role);
const isTicketStaff = m => hasRoleOnly(m,TICKET_SUPPORT_ROLE) || isBotOwner(m?.id || m?.user?.id);
function safeEmoji(builder, emoji){ if(!emoji) return builder; try{ builder.setEmoji(String(emoji)); }catch{} return builder; }
const clean = s => String(s||'').replace(/`/g,'').trim();
function stripMentions(text){
  return String(text||'')
    .replace(/<@!?(\d+)>/g,'@user')
    .replace(/<@&(\d+)>/g,'@role')
    .replace(/<#(\d+)>/g,'#channel')
    .replace(/@everyone/gi,'[everyone]')
    .replace(/@here/gi,'[here]');
}
function displayUser(memberOrUser){
  return memberOrUser?.user?.tag || memberOrUser?.tag || memberOrUser?.username || memberOrUser?.id || 'Unknown';
}
const EXACT_EXCHANGE_MENTION_USERNAMES = ['amir_gholizadeh22', 'itskingpubgyt'];
const EXCHANGE_LOG_CHANNEL_ID = String(process.env.EXCHANGE_LOG_CHANNEL_ID || '').trim();

async function resolveExchangeLogMentions(guild){
  // These are the exact accounts requested for the Exchange Log. IDs may be
  // supplied for extra reliability, but the username defaults remain fixed.
  const configured=String(process.env.EXCHANGE_LOG_MENTION_USERS || EXACT_EXCHANGE_MENTION_USERNAMES.join(','))
    .split(',').map(x=>x.trim()).filter(Boolean);
  const ids=[];
  for(const target of configured){
    if(/^\d{15,25}$/.test(target)) { ids.push(target); continue; }
    const username=target.toLowerCase();
    let member=guild.members.cache.find(m=>m.user.username.toLowerCase()===username);
    if(!member) {
      const fetched=await guild.members.fetch({query:target,limit:10}).catch(()=>null);
      member=fetched?.find(m=>m.user.username.toLowerCase()===username) || null;
    }
    if(member) ids.push(member.user.id);
  }
  return [...new Set(ids)];
}
function duration(minutes){ const n=Number(minutes); return Number.isFinite(n)&&n>0 ? n : null; }
function fmt(ms){ const m=Math.max(1,Math.ceil(ms/60000)); return `${m} دقیقه`; }
function placeholders(text, member, guild, inv, invnum){
  return String(text||'').replaceAll('[user]', `<@${member.id}>`).replaceAll('[Number]', String(guild.memberCount))
    .replaceAll('[inv]', inv||'').replaceAll('[invnum]', String(invnum??0));
}
async function ensureRole(guild,name){
  let r=guild.roles.cache.find(x=>x.name===name);
  if(!r) r=await guild.roles.create({name,reason:'Tehran Club bot access role'});
  return r;
}
async function ensureRoles(guild){
  await ensureRole(guild,TICKET_SUPPORT_ROLE).catch(()=>{});
  await ensureRole(guild,ACCESS.logs).catch(()=>{});
  await ensureRole(guild,ACCESS.giveaway).catch(()=>{});
}
const AGG_LOGS = {
  giveaway_create_log_channel: '🎉 Giveaway / Drop',
  giveaway_winner_log_channel: '🎉 Giveaway / Drop',
  drop_create_log_channel: '🎉 Giveaway / Drop',
  drop_winner_log_channel: '🎉 Giveaway / Drop',
  ticket_log_channel: '🎫 Ticket Logs',
  ticket_feedback_channel: '⭐ Feedback',
  message_log_channel: '💬 Message Logs',
  ban_kick_log_channel: '🔨 Ban / Kick Logs',
  timeout_log_channel: '⏱️ Timeout Logs',
  voice_log_channel: '🔊 Voice / Stage Logs',
  dm_log_channel: '📩 DM Logs',
  server_update_log_channel: '🛠️ Server Logs',
  member_warn_log_channel: '⚠️ Member Warn Logs',
  welcome_channel: '👋 Welcome',
  invite_log_channel: '📨 Invite Logs',
  level_channel: '⬆️ Level Up'
};
const AGG_LOG_ORDER = [...new Set(Object.values(AGG_LOGS))];
const LOG_FLUSH_FIRST_MS = 3 * 60 * 60 * 1000;
const LOG_FLUSH_INTERVAL_MS = 6 * 60 * 60 * 1000;
let logFlushRunning = false;

async function logTo(guild,key,text){
  const section=AGG_LOGS[key];
  if(!guild || !section || !String(text||'').trim()) return;
  const content=String(text).slice(0,1900);
  const {error}=await supabase.from('log_queue').insert({guild_id:guild.id,section,content});
  if(error) console.error('log queue error:',error.message);
}

function formatLogSection(section, rows, total){
  const shown=rows.slice(-8);
  const lines=shown.map(r=>{
    const stamp=r.created_at ? new Date(r.created_at).toLocaleString('en-GB',{timeZone:'Asia/Dubai',hour12:false}) : '';
    return `• ${stamp} — ${String(r.content||'').replace(/\n/g,'\n  ')}`;
  });
  let value=`**تعداد کل: ${total}**`;
  if(shown.length) value+=`\n${lines.join('\n')}`;
  else value+='\n—';
  if(value.length>1000) value=value.slice(0,997)+'...';
  return value;
}

async function fetchAllLogRows(guildId){
  const all=[];
  const pageSize=1000;
  for(let from=0;;from+=pageSize){
    const {data,error}=await supabase.from('log_queue')
      .select('id,section,content,created_at')
      .eq('guild_id',guildId)
      .order('created_at',{ascending:true})
      .range(from,from+pageSize-1);
    if(error) return {rows:null,error};
    if(data?.length) all.push(...data);
    if(!data || data.length<pageSize) break;
  }
  return {rows:all,error:null};
}

async function fetchTicketPerformance(guildId){
  const {data:tickets,error:ticketError}=await supabase.from('tickets')
    .select('id,claimed_by,opener_id,status')
    .eq('guild_id',guildId);
  if(ticketError) return {error:ticketError};
  const staff=new Map();
  let totalTickets=0, claimedTickets=0, unclaimedTickets=0;
  const claimHistoryResult=await supabase.from('ticket_claim_history').select('ticket_id,user_id,action').eq('guild_id',guildId);
  const claimHistory=claimHistoryResult.error ? [] : (claimHistoryResult.data||[]);
  const historyTicketIds=new Set(claimHistory.map(h=>String(h.ticket_id)));
  for(const t of tickets||[]){
    totalTickets++;
    if(t.claimed_by){
      claimedTickets++;
      // Backfill old tickets that were claimed before claim history existed.
      if(!historyTicketIds.has(String(t.id))){
        const id=String(t.claimed_by);
        const row=staff.get(id)||{claims:0,ratings:0,stars:0,counts:{1:0,2:0,3:0,4:0,5:0}};
        row.claims++;
        staff.set(id,row);
      }
    }else unclaimedTickets++;
  }

  for(const h of claimHistory){
    if(!h.user_id) continue;
    const id=String(h.user_id);
    const row=staff.get(id)||{claims:0,ratings:0,stars:0,counts:{1:0,2:0,3:0,4:0,5:0}};
    row.claims++;
    staff.set(id,row);
  }

  const ticketIds=(tickets||[]).map(t=>t.id).filter(Boolean);
  const feedback=[];
  for(let i=0;i<ticketIds.length;i+=100){
    const ids=ticketIds.slice(i,i+100);
    if(!ids.length) continue;
    const {data,error}=await supabase.from('ticket_feedback')
      .select('ticket_id,user_id,claimed_by,stars,text')
      .in('ticket_id',ids);
    if(error) return {error};
    if(data?.length) feedback.push(...data);
  }
  const ticketMap=new Map((tickets||[]).map(t=>[String(t.id),t]));
  for(const f of feedback){
    const t=ticketMap.get(String(f.ticket_id));
    const claimer=f.claimed_by || t?.claimed_by;
    if(!claimer) continue;
    const id=String(claimer);
    const row=staff.get(id)||{claims:0,ratings:0,stars:0,counts:{1:0,2:0,3:0,4:0,5:0}};
    const stars=Number(f.stars);
    if(!Number.isInteger(stars) || stars<1 || stars>5) continue;
    row.ratings++; row.stars+=stars; row.counts[stars]=(row.counts[stars]||0)+1;
    staff.set(id,row);
  }
  return {tickets:totalTickets,claimedTickets,unclaimedTickets,staff,feedbackCount:feedback.length,error:null};
}

async function buildTicketPerformanceFields(guildId){
  const perf=await fetchTicketPerformance(guildId);
  if(perf.error){
    console.error('ticket performance error:',perf.error.message||perf.error);
    return [{name:'👤 Ticket Staff Performance',value:'❌ آمار Claim/Rating خوانده نشد.\n'+String(perf.error.message||perf.error).slice(0,900)}];
  }
  const fields=[];
  fields.push({name:'🎫 Ticket Summary',value:`**کل Ticket:** ${perf.tickets}\n**Claim شده:** ${perf.claimedTickets}\n**بدون Claim:** ${perf.unclaimedTickets}\n**Rating ثبت‌شده:** ${perf.feedbackCount}`});
  const entries=[...perf.staff.entries()].sort((a,b)=>{
    if(b[1].claims!==a[1].claims) return b[1].claims-a[1].claims;
    return (b[1].ratings?b[1].stars/b[1].ratings:0)-(a[1].ratings?a[1].stars/a[1].ratings:0);
  });
  if(!entries.length){ fields.push({name:'👤 Ticket Staff Performance',value:'هنوز هیچ Ticket توسط Staff Claim نشده است.'}); return fields; }
  for(const [id,row] of entries){
    const avg=row.ratings ? (row.stars/row.ratings).toFixed(2) : '—';
    const dist=`1⭐:${row.counts[1]||0} 2⭐:${row.counts[2]||0} 3⭐:${row.counts[3]||0} 4⭐:${row.counts[4]||0} 5⭐:${row.counts[5]||0}`;
    fields.push({name:`👤 <@${id}>`,value:`**Claims:** ${row.claims}\n**Ratings:** ${row.ratings}\n**Average:** ${avg}/5 ⭐\n${dist}`.slice(0,1000)});
    if(fields.length>=24) break;
  }
  return fields;
}

async function flushGuildLogs(guild,force=false){
  if(!guild || logFlushRunning) return {sent:false,reason:'busy'};
  const settings=await getSettings(guild.id);
  const channelId=settings.aggregated_log_channel;
  if(!channelId) return {sent:false,reason:'not-configured'};
  const channel=guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(()=>null);
  if(!channel?.isTextBased()) return {sent:false,reason:'invalid-channel'};
  const {rows,error}=await fetchAllLogRows(guild.id);
  if(error){ console.error('log queue read error:',error.message); return {sent:false,reason:'database',error:error.message}; }
  if(!rows?.length && !force){
    await setSettings(guild.id,{next_log_flush_at:new Date(Date.now()+LOG_FLUSH_INTERVAL_MS).toISOString()});
    return {sent:false,reason:'empty'};
  }

  logFlushRunning=true;
  try{
    const grouped=new Map();
    for(const section of AGG_LOG_ORDER) grouped.set(section,[]);
    for(const row of rows||[]){ if(!grouped.has(row.section)) grouped.set(row.section,[]); grouped.get(row.section).push(row); }
    const embeds=[];
    let embed=new EmbedBuilder().setTitle('📋 Tehran Club Logs').setDescription(`گزارش تجمعی لاگ‌ها • ${new Date().toLocaleString('en-GB',{timeZone:'Asia/Dubai',hour12:false})} (Dubai)\n⚠️ لاگ‌ها دائمی هستند و با ارسال گزارش حذف یا Reset نمی‌شوند.`).setTimestamp();
    let fields=0;
    for(const [section,items] of grouped){
      if(!items.length) continue;
      if(fields>=25){ embeds.push(embed); embed=new EmbedBuilder().setTitle('📋 Tehran Club Logs (ادامه)').setTimestamp(); fields=0; }
      embed.addFields({name:section,value:formatLogSection(section,items,items.length)}); fields++;
    }
    const performanceFields=await buildTicketPerformanceFields(guild.id);
    for(const f of performanceFields){
      if(fields>=25){ embeds.push(embed); embed=new EmbedBuilder().setTitle('📋 Tehran Club Logs (ادامه)').setTimestamp(); fields=0; }
      embed.addFields(f); fields++;
    }
    if(fields===0) embed.addFields({name:'📭 Logs',value:'در این بازه لاگی ثبت نشده است.'});
    embeds.push(embed);

    await channel.send({embeds:embeds.slice(0,10)});
    // IMPORTANT: log_queue is an immutable history. Never delete rows after /sendlogs
    // or after the automatic 6-hour report. This keeps all historical logs and counts.
    await setSettings(guild.id,{next_log_flush_at:new Date(Date.now()+LOG_FLUSH_INTERVAL_MS).toISOString(),last_log_report_at:new Date().toISOString()});
    return {sent:true,count:rows.length};
  }catch(error){
    console.error('log flush error:',error?.message||error);
    return {sent:false,reason:'send-failed',error:error?.message||String(error)};
  }finally{ logFlushRunning=false; }
}

async function checkScheduledLogFlush(){
  for(const guild of client.guilds.cache.values()){
    try{
      const s=await getSettings(guild.id);
      const configured=s.aggregated_log_channel;
      if(!configured) continue;
      let next=s.next_log_flush_at ? new Date(s.next_log_flush_at).getTime() : Date.now()+LOG_FLUSH_FIRST_MS;
      if(!Number.isFinite(next)){ next=Date.now()+LOG_FLUSH_FIRST_MS; }
      if(!s.next_log_flush_at){ await setSettings(guild.id,{next_log_flush_at:new Date(next).toISOString()}); continue; }
      if(Date.now()>=next) await flushGuildLogs(guild,false);
    }catch(error){ console.error('scheduled log check error:',error?.message||error); }
  }
}
async function deleteInvocation(message){ await message.delete().catch(()=>{}); }
async function setTextSetting(message,key,value){ if(!isAdmin(message.member)) return; await setSettings(message.guild.id,{[key]:value}); await deleteInvocation(message); }

const SETCH = {
  setcht:'ticket_log_channel', setchfead:'ticket_feedback_channel',
  setchm:'message_log_channel', setchb:'ban_kick_log_channel', setchto:'timeout_log_channel',
  setchv:'voice_log_channel', setchdm:'dm_log_channel', setchdv:'server_update_log_channel', setchwa:'member_warn_log_channel',
  setchwel:'welcome_channel', setchinv:'invite_log_channel', setchlevel:'level_channel'
};

async function protectLogChannel(guild, channelId){
  const ch=guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(()=>null);
  if(!ch?.permissionOverwrites) return;
  const role=await ensureRole(guild,ACCESS.logs);
  await ch.permissionOverwrites.edit(guild.roles.everyone.id,{
    ViewChannel:false, SendMessages:false, EmbedLinks:false, ReadMessageHistory:false
  }).catch(()=>{});
  await ch.permissionOverwrites.edit(role.id,{
    ViewChannel:true, ReadMessageHistory:true, SendMessages:false
  }).catch(()=>{});
  const botMember=guild.members.me || await guild.members.fetch(client.user.id).catch(()=>null);
  if(botMember){
    await ch.permissionOverwrites.edit(botMember.id,{
      ViewChannel:true, ReadMessageHistory:true, SendMessages:true, EmbedLinks:true, AttachFiles:true
    }).catch(err=>console.error('log channel bot permission error:',err?.message||err));
  }
}
async function handleSetCh(message, parts){
  if(!message.guild || !isBotOwner(message.author.id)) return false;
  const cmd=parts[0].toLowerCase();
  if(cmd==='setchg'){
    const ch=message.mentions.channels.map(c=>c.id).concat(parts.slice(1).filter(x=>/^\d+$/.test(x))).slice(0,4);
    if(ch.length<4) return true;
    await setSettings(message.guild.id,{giveaway_create_log_channel:ch[0],giveaway_winner_log_channel:ch[1],drop_create_log_channel:ch[2],drop_winner_log_channel:ch[3]});
    for(const x of ch) await protectLogChannel(message.guild,x);
    await deleteInvocation(message); return true;
  }
  const key=SETCH[cmd]; if(!key) return false;
  const ch=message.mentions.channels.first()?.id || parts[1]; if(ch) { await setSettings(message.guild.id,{[key]:ch}); if(key.includes('log_channel')) await protectLogChannel(message.guild,ch); }
  await deleteInvocation(message); return true;
}

client.once('ready',async()=>{
  console.log(`Logged in as ${client.user.tag}`);
  for(const g of client.guilds.cache.values()) await ensureRoles(g);
  setInterval(endGiveaways,10000); setInterval(showStats,21600000);
  // First automatic log report is 3 hours after setup, then every 6 hours.
  setInterval(checkScheduledLogFlush,60000);
  await checkScheduledLogFlush();
});
client.on('guildCreate',g=>ensureRoles(g));

client.on('messageCreate',async message=>{
  if(message.author.bot) return;
  if(!message.guild){
    for(const g of client.guilds.cache.values()) await logTo(g,'dm_log_channel',`📩 DM از ${message.author.tag} (${message.author.id})\n${message.content}`).catch(()=>{});
    return;
  }
  const parts=message.content.trim().split(/\s+/), cmd=(parts[0]||'').toLowerCase();
  if(await handleSetCh(message,parts)) return;

  // Admin text commands that were explicitly requested without slash.
  if(['setfosh','deletefosh','whiteuser'].includes(cmd)){
    if(!isBotOwner(message.author.id)) return;
    if(cmd==='setfosh') for(const word of parts.slice(1).join(' ').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)) await supabase.from('profanity_words').upsert({guild_id:message.guild.id,word});
    if(cmd==='deletefosh') for(const word of parts.slice(1).join(' ').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)) await supabase.from('profanity_words').delete().eq('guild_id',message.guild.id).eq('word',word);
    if(cmd==='whiteuser'){ const u=message.mentions.users.first(); if(u) await supabase.from('profanity_whitelist').upsert({guild_id:message.guild.id,user_id:u.id}); }
    await deleteInvocation(message); return;
  }

  const s=await getSettings(message.guild.id);
  const wl=await supabase.from('profanity_whitelist').select('user_id').eq('guild_id',message.guild.id).eq('user_id',message.author.id).maybeSingle();
  if(!wl.data){
    const {data:words}=await supabase.from('profanity_words').select('word').eq('guild_id',message.guild.id);
    const normalized=message.content.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const hit=(words||[]).find(x=>x.word && normalized.split(/\s+/).includes(String(x.word).toLowerCase().trim()));
    if(hit){
      await message.delete().catch(()=>{}); const {count}=await supabase.from('member_warns').select('*',{count:'exact',head:true}).eq('guild_id',message.guild.id).eq('user_id',message.author.id);
      await supabase.from('member_warns').insert({guild_id:message.guild.id,user_id:message.author.id,reason:'Profanity filter'});
      await logTo(message.guild,'member_warn_log_channel',`⚠️ وارن فحش | <@${message.author.id}> | ${hit.word}`);
      if((count||0)+1>=3) await message.member.timeout(2*60*60*1000,'3 warnings').catch(()=>{});
      return;
    }
  }

  // Simple persistent XP: 1 XP per non-bot message, with automatic level roles/messages.
  const xpRow=(await supabase.from('xp_users').select('*').eq('guild_id',message.guild.id).eq('user_id',message.author.id).maybeSingle()).data||{xp:0,level:0};
  const newXp=xpRow.xp+1, newLevel=Math.floor(newXp/10);
  if(newXp!==xpRow.xp) await supabase.from('xp_users').upsert({guild_id:message.guild.id,user_id:message.author.id,xp:newXp,level:newLevel});
  if(newLevel>xpRow.level){
    const {data:roleRows}=await supabase.from('xp_roles').select('*').eq('guild_id',message.guild.id).order('level',{ascending:true});
    for(const er of roleRows||[]) await message.member.roles.remove(er.role_id).catch(()=>{});
    const er=(roleRows||[]).find(x=>x.level===newLevel);
    if(er) await message.member.roles.add(er.role_id).catch(()=>{});
    const es=await getSettings(message.guild.id), levelText=placeholders((es.xp_level_text||'🎉 [user] رسید به Level '+newLevel).replace('[level]',String(newLevel)), message.member,message.guild);
    const ech=es.level_channel&&message.guild.channels.cache.get(es.level_channel);
    if(ech) await ech.send(levelText).catch(()=>{});
    await logTo(message.guild,'level_channel',`⬆️ Level Up | ${message.author.tag} | Level ${newLevel}`);
  }

  if(isBotOwner(message.author.id) && s.owner_relay_channel===message.channel.id){
    await deleteInvocation(message); await message.channel.send(message.content);
  }
  // Custom commands are intentionally public: anyone can invoke a configured keyword.
  if(s.custom_commands?.[cmd]) await message.channel.send(String(s.custom_commands[cmd]), {allowedMentions:{parse:[]}}).catch(()=>{});

  const {data:drops}=await supabase.from('drops').select('*').eq('guild_id',message.guild.id).eq('ended',false).eq('kind','text');
  for(const d of drops||[]) if(d.target_text && message.content.trim()===d.target_text){
    const {data:updated}=await supabase.from('drops').update({ended:true,winner_id:message.author.id}).eq('id',d.id).eq('ended',false).select().maybeSingle();
    if(updated){ await message.channel.send(`🏆 <@${message.author.id}> برنده Drop شد! متن برنده: **${d.target_text}**`); await logTo(message.guild,'drop_winner_log_channel',`🏆 Drop winner: ${message.author.tag}`); }
    break;
  }
});

async function endGiveaways(){
  const {data:rows,error}=await supabase.from('giveaways').select('*').eq('ended',false).lte('end_at',new Date().toISOString());
  if(error){ console.error('giveaway expiry query error:',error.message); return; }
  for(const g of rows||[]){
    try{
      const {data:entries, error:entryError}=await supabase.from('giveaway_entries').select('user_id').eq('giveaway_id',g.id);
      if(entryError){ console.error('giveaway entries read error:',entryError.message); continue; }
      const winner=entries?.length?entries[Math.floor(Math.random()*entries.length)].user_id:null;
      const {data:endedRow,error:updateError}=await supabase.from('giveaways').update({ended:true,winner_id:winner}).eq('id',g.id).eq('ended',false).select('id').maybeSingle();
      if(updateError || !endedRow) continue;
      const guild=client.guilds.cache.get(g.guild_id), ch=guild?.channels.cache.get(g.channel_id);
      if(ch) await ch.send({content:`🎉 Giveaway تمام شد!\n🎁 جایزه: **${g.prize}**\n🏆 ${winner?`برنده: <@${winner}>`:'شرکت‌کننده‌ای نبود.'}`,allowedMentions:{users:winner?[winner]:[],parse:[]}}).catch(err=>console.error('giveaway finish send error:',err.message));
      if(guild) await logTo(guild,'giveaway_winner_log_channel',`🎉 Giveaway پایان یافت | prize=${g.prize} | winner=${winner||'none'}`);
      if(ch && g.message_id){
        const original=await ch.messages.fetch(g.message_id).catch(()=>null);
        if(original){
          const disabled=original.components.map(row=>new ActionRowBuilder().addComponents(row.components.map(component=>ButtonBuilder.from(component).setDisabled(true))));
          await original.edit({components:disabled}).catch(()=>{});
        }
      }
    }catch(err){ console.error('giveaway expiry error:',err?.message||err); }
  }
}
async function showStats(){
  const {data:rows}=await supabase.from('tickets').select('claimed_by,guild_id').not('claimed_by','is',null);
  const all={}; for(const r of rows||[]) { all[r.guild_id]??={}; all[r.guild_id][r.claimed_by]=(all[r.guild_id][r.claimed_by]||0)+1; }
  for(const [gid,c] of Object.entries(all)){ const s=await getSettings(gid), ch=client.channels.cache.get(s.stats_channel); if(!ch) continue;
    const body=Object.entries(c).sort((a,b)=>b[1]-a[1]).map((x,i)=>`${i+1}. <@${x[0]}> — ${x[1]} claim`).join('\n')||'آماری نیست.';
    await ch.send(`📊 **آمار Claim**\n${body}`).catch(()=>{});
  }
}
function ticketRows(ticketId, panel){
  const row=new ActionRowBuilder();
  const claim=new ButtonBuilder().setCustomId(`claim:${ticketId}`).setLabel('Claim').setStyle(ButtonStyle.Primary);
  safeEmoji(claim,panel.claim_emoji||'🎫');
  const close=new ButtonBuilder().setCustomId(`close:${ticketId}`).setLabel('Close').setStyle(ButtonStyle.Danger);
  safeEmoji(close,panel.close_emoji||'🔒');
  row.addComponents(claim,close);
  return [row];
}
function closedTicketRows(ticketId){
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticketdelete:${ticketId}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`transcript:${ticketId}`).setLabel('Transcript').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticketreopen:${ticketId}`).setLabel('Reopen').setStyle(ButtonStyle.Success)
  )];
}
function defaultPanelTypes(panel){
  const meta=TICKET_TYPES[panel.panel_type];
  return [{
    name: meta?.label || String(panel.name || 'Ticket').slice(0,80),
    emoji: meta?.emoji || panel.button_emoji || '🎫',
    prefix: meta?.prefix || slugifyTicketType(panel.name || 'ticket')
  }];
}
function slugifyTicketType(value){
  const slug=String(value||'ticket').toLowerCase().trim()
    .replace(/[^a-z0-9\s_-]/g,'')
    .replace(/[\s_]+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'')
    .slice(0,50);
  return slug || 'ticket';
}
function getPanelTypes(panel){
  let raw=panel?.ticket_types;
  // Supabase normally returns JSONB as an array, but older rows/migrations may
  // contain it as a JSON string. Normalize both forms so list/edit/delete work.
  if(typeof raw==='string'){
    try{ raw=JSON.parse(raw); }catch{ raw=null; }
  }
  if(Array.isArray(raw) && raw.length){
    return raw.map((t,i)=>({
      name:clean(t?.name || `Ticket ${i+1}`).slice(0,80),
      emoji:typeof t?.emoji==='string'?t.emoji:'🎫',
      prefix:slugifyTicketType(t?.prefix || t?.name || `ticket-${i+1}`)
    }));
  }
  return defaultPanelTypes(panel);
}
async function loadPanelByNumber(guildId,num){
  const n=Number(num);
  if(!Number.isInteger(n) || n<1) return {data:null,error:new Error('Invalid panel number')};
  return await supabase.from('ticket_panels').select('*').eq('guild_id',guildId).eq('panel_number',n).maybeSingle();
}
async function savePanelTypes(panel,types){
  const normalized=types.map((t,i)=>({
    name:clean(t?.name || `Ticket ${i+1}`).slice(0,80),
    emoji:typeof t?.emoji==='string'?t.emoji:'🎫',
    prefix:slugifyTicketType(t?.prefix || t?.name || `ticket-${i+1}`)
  }));
  return await supabase.from('ticket_panels').update({ticket_types:normalized}).eq('id',panel.id).eq('guild_id',panel.guild_id).select('*').single();
}
function selectedPanelType(panel,index){
  const types=getPanelTypes(panel);
  return types[Number(index)] || types[0] || {name:'Ticket',emoji:'🎫',prefix:'ticket'};
}
function panelLabel(p){
  const types=getPanelTypes(p);
  const first=types[0];
  return first ? `${first.emoji || '🎫'} ${first.name}` : String(p.name||'Ticket Panel').slice(0,100);
}
function panelTicketName(panel,user,index=0){
  const type=selectedPanelType(panel,index);
  const safeUser=String(user.username||'user').toLowerCase().replace(/[^a-z0-9-_]/g,'-').replace(/-+/g,'-').slice(0,70)||'user';
  return `${slugifyTicketType(type.prefix || type.name)}-${safeUser}`.slice(0,100);
}
function buildPanelComponents(panel){
  const types=getPanelTypes(panel).slice(0,25);
  if(types.length<=5){
    const row=new ActionRowBuilder();
    types.forEach((t,i)=>{
      const b=new ButtonBuilder().setCustomId(`openpanel:${panel.id}:${i}`).setLabel(String(t.name||`Ticket ${i+1}`).slice(0,80)).setStyle(ButtonStyle.Primary);
      safeEmoji(b,t.emoji);
      row.addComponents(b);
    });
    return [row];
  }
  const menu=new StringSelectMenuBuilder().setCustomId(`ticketmenu:${panel.id}`).setPlaceholder('نوع تیکت را انتخاب کنید').addOptions(types.map((t,i)=>({
    label:String(t.name||`Ticket ${i+1}`).slice(0,100),
    value:`${panel.id}:${i}`,
    description:`باز کردن تیکت ${String(t.name||'').slice(0,90)}`,
    ...(t.emoji ? {emoji:t.emoji} : {})
  })));
  return [new ActionRowBuilder().addComponents(menu)];
}
async function refreshTicketPanelMessage(guild,panel){
  if(!panel?.channel_id || !panel?.message_id) return false;
  const ch=guild.channels.cache.get(panel.channel_id) || await guild.channels.fetch(panel.channel_id).catch(()=>null);
  const msg=ch ? await ch.messages.fetch(panel.message_id).catch(()=>null) : null;
  if(!msg) return false;
  const types=getPanelTypes(panel);
  const first=types[0] || {emoji:'🎫',name:panel.name||'Ticket'};
  const embed=new EmbedBuilder().setTitle(`${first.emoji || '🎫'} ${panel.name || first.name}`.slice(0,256)).setDescription(String(panel.description||'برای باز کردن تیکت، نوع موردنظر را انتخاب کنید.').slice(0,4096)).setFooter({text:`Panel #${panel.panel_number} • ${types.length} نوع تیکت`});
  await msg.edit({embeds:[embed],components:buildPanelComponents(panel)});
  return true;
}
async function createTicket(interaction,panel,answers={}){
  // Multiple users (and multiple tickets) may open tickets at the same time.
  // There is intentionally NO global/per-user "one open ticket" lock here.
  // Discord channel creation + the Supabase ticket row are independent per ticket.
  const cat=panel.category_id && interaction.guild.channels.cache.get(panel.category_id)?.type===ChannelType.GuildCategory ? panel.category_id : undefined;
  const ticketRole=interaction.guild.roles.cache.find(r=>r.name===TICKET_SUPPORT_ROLE) || await ensureRole(interaction.guild,TICKET_SUPPORT_ROLE).catch(()=>null);
  if(!ticketRole) return interaction.reply({content:'❌ Role `Tickets Support` پیدا نشد و بات اجازه ساخت آن را ندارد. Role/Manage Roles permission را بررسی کنید.',ephemeral:true});
  const overwrites=[
    {id:interaction.guild.roles.everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},
    {id:ticketRole.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]},
    {id:interaction.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]}
  ];
  let channel;
  try{
    channel=await interaction.guild.channels.create({name:panelTicketName(panel,interaction.user,panel._typeIndex||0),type:ChannelType.GuildText,parent:cat,permissionOverwrites:overwrites,reason:`Ticket ${selectedPanelType(panel,panel._typeIndex||0).name||panel.panel_type||'custom'} opened by ${interaction.user.tag}`});
  }catch(error){
    console.error('ticket channel create error:',error);
    return interaction.reply({content:`❌ ساخت کانال Ticket انجام نشد: ${error?.message||error}`,ephemeral:true});
  }
  const {data:t,error}=await supabase.from('tickets').insert({guild_id:interaction.guild.id,panel_id:panel.id,channel_id:channel.id,opener_id:interaction.user.id,category_id:cat||null,status:'open',claimed_by:null}).select().single();
  if(error){ console.error('ticket insert error:',error); await channel.delete().catch(()=>{}); return interaction.reply({content:`❌ ذخیره Ticket در Supabase انجام نشد: ${error.message}`,ephemeral:true}); }
  if(Object.keys(answers).length) { const {error:aerr}=await supabase.from('ticket_answers').insert({ticket_id:t.id,answers}); if(aerr) console.error('ticket answers insert error:',aerr); }
  const welcome=placeholders(panel.welcome_text||'سلام [user]، تیکت شما ایجاد شد.',interaction.member,interaction.guild);
  await channel.send({content:`<@&${ticketRole.id}> <@${interaction.user.id}>\n${welcome}`,components:ticketRows(t.id,panel),allowedMentions:{users:[interaction.user.id],roles:[ticketRole.id]}});
  await logTo(interaction.guild,'ticket_log_channel',`🎫 Ticket ایجاد شد | ${panelTicketName(panel,interaction.user,panel._typeIndex||0)} | ${interaction.user.tag}`);
  return interaction.reply({content:`تیکت ساخته شد: ${channel}`,ephemeral:true});
}
async function getTicket(ch){ return (await supabase.from('tickets').select('*').eq('channel_id',ch.id).maybeSingle()).data; }
async function claimTicket(interaction,t){
  if(!t) return interaction.reply({content:'Ticket پیدا نشد.',ephemeral:true});
  if(!isTicketStaff(interaction.member)) return interaction.reply({content:'فقط Tickets Support می‌تواند این کار را انجام دهد.',ephemeral:true});
  if(t.status!=='open') return interaction.reply({content:'این Ticket بسته است.',ephemeral:true});
  if(t.claimed_by) return interaction.reply({content:`این Ticket قبلاً توسط <@${t.claimed_by}> Claim شده است.`,ephemeral:true});
  const {data:claimed,error}=await supabase.from('tickets').update({claimed_by:interaction.user.id}).eq('id',t.id).eq('status','open').is('claimed_by',null).select('id,claimed_by').maybeSingle();
  if(error || !claimed) return interaction.reply({content:'❌ این Ticket همین الان توسط شخص دیگری Claim شد.',ephemeral:true});
  const {error:claimHistoryError}=await supabase.from('ticket_claim_history').insert({ticket_id:t.id,guild_id:interaction.guild.id,user_id:interaction.user.id,action:'claim'});
  if(claimHistoryError) console.error('ticket claim history error:',claimHistoryError?.message||claimHistoryError);
  const claimText=`🎫 Ticket Claim شد | ${interaction.channel.name} | توسط ${interaction.user.tag} (<@${interaction.user.id}>)`;
  await logTo(interaction.guild,'ticket_log_channel',claimText);
  const settings=await getSettings(interaction.guild.id);
  const logId=settings.ticket_log_channel;
  const logChannel=logId ? (interaction.guild.channels.cache.get(logId)||await interaction.guild.channels.fetch(logId).catch(()=>null)) : null;
  if(logChannel?.isTextBased()) await logChannel.send({content:claimText,allowedMentions:{users:[]}}).catch(err=>console.error('ticket claim discord log error:',err?.message||err));
  return interaction.reply({content:`🎫 Ticket توسط <@${interaction.user.id}> Claim شد.`,allowedMentions:{users:[interaction.user.id]}});
}
async function buildTranscript(interaction,t){
  const msgs=[];
  let before;
  for(let page=0;page<10;page++){
    const opts={limit:100}; if(before) opts.before=before;
    const fetched=await interaction.channel.messages.fetch(opts).catch(()=>null); if(!fetched?.size) break;
    for(const m of fetched.values()){
      const attachments=[...m.attachments.values()].map(a=>a.url).join(' ');
      msgs.push(`[${m.createdAt.toISOString()}] ${displayUser(m.author)}: ${m.content||''}${attachments?` [Attachments: ${attachments}]`:''}`.trim());
    }
    before=fetched.last()?.id; if(fetched.size<100) break;
  }
  msgs.reverse();
  return `Tehran Club Ticket Transcript\nTicket ID: ${t.id}\nChannel: ${interaction.channel.name}\nOpened By: ${t.opener_id}\nClaimed By: ${t.claimed_by||'none'}\nStatus: ${t.status}\n\n--- Messages ---\n${msgs.join('\n')||'(no messages)'}`;
}
async function sendTranscript(interaction,t){
  const text=await buildTranscript(interaction,t);
  const {error:transcriptSaveError}=await supabase.from('tickets').update({transcript:text}).eq('id',t.id);
  if(transcriptSaveError) console.error('ticket transcript save error:',transcriptSaveError?.message||transcriptSaveError);
  const s=await getSettings(interaction.guild.id), logId=s.ticket_transcript_log_channel || s.ticket_log_channel;
  const ch=logId ? (interaction.guild.channels.cache.get(logId)||await interaction.guild.channels.fetch(logId).catch(()=>null)) : null;
  if(!ch?.isTextBased()) return interaction.reply({content:'❌ Transcript Log تنظیم نشده. از /setticketlog استفاده کنید.',ephemeral:true});
  const safeName=String(interaction.channel.name||'ticket').replace(/[^a-z0-9-_]/gi,'-').slice(0,60);
  const file=new AttachmentBuilder(Buffer.from(text,'utf8'),{name:`${safeName}-${t.id}.txt`});

  // Transcript header: transcript | ticket owner | claimed by
  // Use usernames (not the channel name). If nobody claimed the ticket, show "no one".
  const opener=await interaction.guild.members.fetch(t.opener_id).catch(()=>null);
  const claimer=t.claimed_by ? await interaction.guild.members.fetch(t.claimed_by).catch(()=>null) : null;
  const openerName=opener?.user?.username || opener?.user?.globalName || String(t.opener_id);
  const claimerName=claimer?.user?.username || claimer?.user?.globalName || (t.claimed_by ? String(t.claimed_by) : 'no one');
  await ch.send({content:`📄 Transcript | ${openerName} | ${claimerName}`,files:[file],allowedMentions:{parse:[]}});
  return interaction.reply({content:`✅ Transcript به ${ch} ارسال شد.`,ephemeral:true});
}
async function closeTicket(interaction,t,reason){
  if(!isTicketStaff(interaction.member)) return interaction.reply({content:'فقط Tickets Support می‌تواند Ticket را ببندد.',ephemeral:true});
  if(!t || t.status!=='open') return interaction.reply({content:'این Ticket قبلاً بسته شده یا پیدا نشد.',ephemeral:true});
  await interaction.deferReply({ephemeral:true});
  const closedAt=new Date().toISOString();
  const {data:closed,error:closeError}=await supabase.from('tickets').update({status:'closed',closed_at:closedAt}).eq('id',t.id).eq('status','open').select('id,status,opener_id,claimed_by').maybeSingle();
  if(closeError || !closed) return interaction.editReply({content:`❌ بستن Ticket انجام نشد: ${closeError?.message||'already closed'}`});
  // User loses access; Tickets Support keeps full access.
  await interaction.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:false,SendMessages:false,ReadMessageHistory:false}).catch(()=>{});
  const ticketRole=interaction.guild.roles.cache.find(r=>r.name===TICKET_SUPPORT_ROLE);
  if(ticketRole) await interaction.channel.permissionOverwrites.edit(ticketRole.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}).catch(()=>{});
  const feedbackRow=new ActionRowBuilder().addComponents([1,2,3,4,5].map(n=>new ButtonBuilder().setCustomId(`feedback:${t.id}:${n}`).setLabel(`${n} ⭐`).setStyle(ButtonStyle.Secondary)));
  let dmSent=false;
  try{
    const user=await interaction.client.users.fetch(t.opener_id);
    await user.send({content:`🎫 Your ticket **${interaction.channel.name}** was closed.\nReason: ${reason||'No reason provided'}\n\n⭐ Please rate your support experience:`,components:[feedbackRow],allowedMentions:{parse:[]}});
    dmSent=true;
  }catch(err){ console.warn('ticket rating DM failed:',err?.message||err); }
  // Staff control panel stays in the ticket and only Tickets Support can see it.
  await interaction.channel.send({content:`🔒 **Ticket Closed**\nReason: ${reason||'No reason provided'}\nTickets Support can use the buttons below.`,components:closedTicketRows(t.id),allowedMentions:{parse:[]}});
  await logTo(interaction.guild,'ticket_log_channel',`🔒 Ticket بسته شد | ${interaction.channel.name} | توسط ${interaction.user.tag}`);
  return interaction.editReply({content:dmSent?'Ticket بسته شد و Rating برای کاربر ارسال شد.':'Ticket بسته شد؛ DM کاربر ارسال نشد چون DM او بسته است.'});
}

client.on('interactionCreate',async interaction=>{
  try{
    if(interaction.isButton()){
      const [type,id,extra]=interaction.customId.split(':');
      if(type==='gw'){
        const {data:gw}=await supabase.from('giveaways').select('id,ended,end_at').eq('id',id).maybeSingle();
        if(!gw || gw.ended || new Date(gw.end_at)<=new Date()) return interaction.reply({content:'این Giveaway تمام شده است.',ephemeral:true});
        const {data:already}=await supabase.from('giveaway_entries').select('id').eq('giveaway_id',id).eq('user_id',interaction.user.id).maybeSingle();
        if(already) return interaction.reply({content:'قبلاً در این Giveaway شرکت کرده‌ای ✅',ephemeral:true});
        const {error}=await supabase.from('giveaway_entries').insert({giveaway_id:id,user_id:interaction.user.id});
        return interaction.reply({content:error?'❌ خطا در ثبت ورود Giveaway.':'وارد Giveaway شدی ✅',ephemeral:true});
      }
      if(type==='drop'){
        const {data:d}=await supabase.from('drops').select('*').eq('id',id).eq('ended',false).maybeSingle();
        if(!d) return interaction.reply({content:'این Drop قبلاً برنده شده.',ephemeral:true});
        const {data:u}=await supabase.from('drops').update({ended:true,winner_id:interaction.user.id}).eq('id',id).eq('ended',false).select().maybeSingle();
        if(!u) return interaction.reply({content:'همزمان یک نفر دیگر برنده شد.',ephemeral:true});
        await interaction.update({content:`🏆 <@${interaction.user.id}> اولین نفر بود و برنده شد!`,components:[]});
        return logTo(interaction.guild,'drop_winner_log_channel',`🏆 Drop winner | ${interaction.user.tag}`);
      }
      if(type==='openpanel'){
        const panel=(await supabase.from('ticket_panels').select('*').eq('id',id).maybeSingle()).data;
        if(!panel) return interaction.reply({content:'Panel پیدا نشد.',ephemeral:true});
        const typeIndex=Number.isInteger(Number(extra)) ? Number(extra) : 0;
        panel._typeIndex=typeIndex;
        if(panel.form_enabled && panel.form_questions?.length){
          const modal=new ModalBuilder().setCustomId(`ticketform:${panel.id}:${typeIndex}`).setTitle(`فرم ${String(selectedPanelType(panel,typeIndex).name||panel.name).slice(0,40)}`);
          for(let i=0;i<Math.min(5,panel.form_questions.length);i++) modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`q${i}`).setLabel(String(panel.form_questions[i]).slice(0,45)).setStyle(TextInputStyle.Paragraph).setRequired(false)));
          return interaction.showModal(modal);
        }
        return createTicket(interaction,panel);
      }
      if(type==='exapprove'||type==='exreject'){
        if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'⛔ فقط افراد مجاز می‌توانند Exchange را تأیید یا رد کنند.',ephemeral:true});
        await interaction.deferReply({ephemeral:true});
        const {data:e,error:fetchError}=await supabase.from('exchange_requests').select('*').eq('id',id).maybeSingle();
        if(fetchError){ console.error('exchange fetch error:',fetchError); return interaction.editReply({content:'❌ خطا در خواندن درخواست Exchange از Supabase.'}); }
        if(!e) return interaction.editReply({content:'این درخواست دیگر وجود ندارد.'});
        if(e.status && e.status!=='pending') return interaction.editReply({content:'این درخواست قبلاً بررسی شده است.'});

        if(type==='exreject'){
          const {error:deleteError}=await supabase.from('exchange_requests').delete().eq('id',id);
          if(deleteError){ console.error('exchange decline delete error:',deleteError); return interaction.editReply({content:'❌ درخواست رد شد اما حذف آن از Supabase انجام نشد.'}); }
          try{
            const user=await interaction.client.users.fetch(e.user_id);
            await user.send({content:'Banner declined',allowedMentions:{parse:[]}});
          }catch(err){ console.error('exchange decline DM error:',err); }
          await interaction.message.delete().catch(()=>interaction.message.edit({content:'❌ Banner declined',components:[],allowedMentions:{parse:[]}}));
          return interaction.editReply({content:'Banner declined. پیام به کاربر ارسال شد و درخواست از Supabase حذف شد.'});
        }

        const guild=interaction.guild;
        const settings=await getSettings(guild.id);
        const chId=settings.exchange_channel;
        const ch=chId ? (guild.channels.cache.get(chId) || await guild.channels.fetch(chId).catch(()=>null)) : null;
        if(!ch?.isTextBased()){
          return interaction.editReply({content:'❌ /setex تنظیم نشده یا کانال Exchange مقصد معتبر نیست.'});
        }
        const safeBanner=stripMentions(e.banner);
        try{
          await ch.send({content:safeBanner,allowedMentions:{parse:[],users:[],roles:[],repliedUser:false}});
        }catch(err){
          console.error('exchange final send error:',err);
          return interaction.editReply({content:`❌ ارسال به Exchange انجام نشد: ${err?.message || err}`});
        }
        const {error:deleteError}=await supabase.from('exchange_requests').delete().eq('id',id);
        if(deleteError){
          console.error('exchange accept delete error:',deleteError);
          return interaction.editReply({content:'⚠️ Banner به Exchange ارسال شد، اما حذف درخواست از Supabase انجام نشد. بررسی کنید.'});
        }
        await interaction.message.delete().catch(()=>interaction.message.edit({content:'✅ Exchange accepted.',components:[],allowedMentions:{parse:[]}}));
        return interaction.editReply({content:'Exchange accepted, sent, and removed from Supabase.'});
      }
      if(type==='ticketdelete'){
        if(!isTicketStaff(interaction.member)) return interaction.reply({content:'فقط Tickets Support می‌تواند Ticket را حذف کند.',ephemeral:true});
        const t=await getTicket(interaction.channel); if(!t || t.id!==id) return interaction.reply({content:'Ticket پیدا نشد.',ephemeral:true});

        // Prevent two staff members from triggering the same deletion at once.
        if(interaction.channel.__ticketDeleteScheduled) {
          return interaction.reply({content:'🗑️ حذف این Ticket قبلاً زمان‌بندی شده است.',ephemeral:true});
        }
        interaction.channel.__ticketDeleteScheduled=true;

        await interaction.reply({content:'🗑️ Ticket در 3 ثانیه حذف می‌شود...',ephemeral:true});

        // Keep the channel alive for exactly 3 seconds after the delete action.
        await new Promise(resolve=>setTimeout(resolve,3000));

        // IMPORTANT: keep the ticket row and feedback forever. The Discord channel
        // can be deleted, but claim/rating history must remain available for the
        // cumulative log report. Only transient ticket members/answers are removed.
        const cleanupResults=await Promise.all([
          supabase.from('ticket_answers').delete().eq('ticket_id',t.id),
          supabase.from('ticket_members').delete().eq('ticket_id',t.id)
        ]);
        for(const result of cleanupResults){
          if(result?.error) console.error('ticket delete cleanup error:',result);
        }

        try{
          await interaction.channel.delete(`Ticket deleted by ${interaction.user.tag}`);
        }catch(err){
          console.error('ticket channel delete error:',err);
          // If Discord temporarily failed, allow another click/retry instead of leaving the handler locked.
          interaction.channel.__ticketDeleteScheduled=false;
        }
        return;
      }
      if(type==='transcript'){
        if(!isTicketStaff(interaction.member)) return interaction.reply({content:'فقط Tickets Support می‌تواند Transcript بگیرد.',ephemeral:true});
        const t=await getTicket(interaction.channel); if(!t || t.id!==id) return interaction.reply({content:'Ticket پیدا نشد.',ephemeral:true});
        return sendTranscript(interaction,t);
      }
      if(type==='ticketreopen'){
        if(!isTicketStaff(interaction.member)) return interaction.reply({content:'فقط Tickets Support می‌تواند Ticket را باز کند.',ephemeral:true});
        const t=await getTicket(interaction.channel); if(!t || t.id!==id) return interaction.reply({content:'Ticket پیدا نشد.',ephemeral:true});
        if(t.status!=='closed') return interaction.reply({content:'این Ticket باز است.',ephemeral:true});
        const {error}=await supabase.from('tickets').update({status:'open',closed_at:null}).eq('id',t.id).eq('status','closed');
        if(error) return interaction.reply({content:`❌ باز کردن Ticket انجام نشد: ${error.message}`,ephemeral:true});
        const ticketRole=interaction.guild.roles.cache.find(r=>r.name===TICKET_SUPPORT_ROLE);
        if(ticketRole) await interaction.channel.permissionOverwrites.edit(ticketRole.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}).catch(()=>{});
        await interaction.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}).catch(()=>{});
        await interaction.channel.send({content:`🔓 <@&${ticketRole?.id}> <@${t.opener_id}> Ticket دوباره باز شد.`,allowedMentions:{users:[t.opener_id],roles:ticketRole?[ticketRole.id]:[]}});
        return interaction.reply({content:'Ticket دوباره باز شد.',ephemeral:true});
      }
      if(type==='claim') return claimTicket(interaction,await getTicket(interaction.channel));
      if(type==='close'){
        if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
        const t=await getTicket(interaction.channel); if(!t) return interaction.reply({content:'Ticket نیست.',ephemeral:true});
        if(t.status!=='open') return interaction.reply({content:'این Ticket قبلاً بسته شده.',ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`closemodal:${t.id}`).setTitle('بستن تیکت').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('دلیل بستن').setStyle(TextInputStyle.Paragraph).setRequired(false)));
        return interaction.showModal(modal);
      }
      if(type==='feedback'){
        const stars=Number(extra); const {data:t}=await supabase.from('tickets').select('*').eq('id',id).maybeSingle();
        if(!t) return interaction.reply({content:'Ticket پیدا نشد.',ephemeral:true});
        if(t.status!=='closed' || interaction.user.id!==t.opener_id) return interaction.reply({content:'این Feedback فقط برای صاحب تیکت بسته‌شده قابل ثبت است.',ephemeral:true});
        const {data:existingFeedback}=await supabase.from('ticket_feedback').select('id').eq('ticket_id',id).eq('user_id',interaction.user.id).maybeSingle();
        if(existingFeedback) return interaction.reply({content:'این Ticket قبلاً Rating شده است.',ephemeral:true});
        const {error:feedbackInsertError}=await supabase.from('ticket_feedback').insert({ticket_id:id,user_id:interaction.user.id,claimed_by:t.claimed_by||null,stars});
        if(feedbackInsertError){ console.error('feedback insert error:',feedbackInsertError); return interaction.reply({content:'❌ ذخیره Rating انجام نشد. دوباره تلاش کنید.',ephemeral:true}); }
        await logTo(interaction.guild,'ticket_feedback_channel',`⭐ Ticket Feedback | ${interaction.user.tag} | ${stars}/5 | Ticket ${id}`);
        const modal=new ModalBuilder().setCustomId(`feedbackmodal:${id}:${stars}`).setTitle(`${stars} ستاره`).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('feedback').setLabel('نظر شما').setStyle(TextInputStyle.Paragraph).setRequired(false)));
        return interaction.showModal(modal);
      }
    }
    if(interaction.isStringSelectMenu()){
      if(interaction.customId==='ticketmenu' || interaction.customId.startsWith('ticketmenu:')){
        const [panelId,typeIndexRaw]=String(interaction.values[0]||'').split(':');
        const panel=(await supabase.from('ticket_panels').select('*').eq('id',panelId).maybeSingle()).data;
        if(!panel) return interaction.reply({content:'Panel پیدا نشد.',ephemeral:true});
        const typeIndex=Number(typeIndexRaw)||0; panel._typeIndex=typeIndex;
        if(panel.form_enabled && panel.form_questions?.length){
          const modal=new ModalBuilder().setCustomId(`ticketform:${panel.id}:${typeIndex}`).setTitle(`فرم ${String(selectedPanelType(panel,typeIndex).name||panel.name).slice(0,40)}`);
          for(let i=0;i<Math.min(5,panel.form_questions.length);i++) modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`q${i}`).setLabel(String(panel.form_questions[i]).slice(0,45)).setStyle(TextInputStyle.Paragraph).setRequired(false)));
          return interaction.showModal(modal);
        }
        return createTicket(interaction,panel);
      }
    }
    if(interaction.isModalSubmit()){
      if(interaction.customId.startsWith('closemodal:')){ const t=await getTicket(interaction.channel); return closeTicket(interaction,t,interaction.fields.getTextInputValue('reason')); }
      if(interaction.customId.startsWith('feedbackmodal:')){
        const [,id,stars]=interaction.customId.split(':'); const text=interaction.fields.getTextInputValue('feedback')||'';
        await interaction.deferReply({ephemeral:true});
        const t=(await supabase.from('tickets').select('guild_id,opener_id,claimed_by,status').eq('id',id).maybeSingle()).data;
        if(!t || t.status!=='closed' || interaction.user.id!==t.opener_id) return interaction.editReply({content:'این Feedback معتبر نیست.'});
        const {error:feedbackError}=await supabase.from('ticket_feedback').update({text}).eq('ticket_id',id).eq('user_id',interaction.user.id).eq('stars',Number(stars));
        if(feedbackError) console.error('feedback save error:',feedbackError);
        const g=client.guilds.cache.get(t.guild_id);
        if(g){
          await logTo(g,'ticket_feedback_channel',`⭐ Feedback | ${interaction.user.tag} | ${stars}/5 | ${text||'بدون متن'}`);
          const s=await getSettings(g.id), fb=s.ticket_feedback_channel && g.channels.cache.get(s.ticket_feedback_channel);
          if(fb?.isTextBased()){
            const owner=await g.members.fetch(t.opener_id).catch(()=>null);
            const claimer=t.claimed_by ? await g.members.fetch(t.claimed_by).catch(()=>null) : null;
            const embed=new EmbedBuilder().setTitle('⭐ Ticket Rating').addFields(
              {name:'Rating',value:`${stars}/5 ⭐`,inline:true},
              {name:'Ticket Owner',value:owner?`${owner} (${displayUser(owner)})`:`<@${t.opener_id}>`,inline:true},
              {name:'Claimed By',value:claimer?`${claimer} (${displayUser(claimer)})`:t.claimed_by?`<@${t.claimed_by}>`:'Not claimed',inline:true},
              {name:'Feedback',value:text||'No comment',inline:false}
            ).setTimestamp();
            await fb.send({embeds:[embed],allowedMentions:{parse:[]}}).catch(err=>console.error('rating log error:',err));
          }
        }
        return interaction.editReply({content:'ممنون بابت Feedback ❤️'});
      }
      if(interaction.customId.startsWith('ticketform:')){
        const parts=interaction.customId.split(':');
        const panel=(await supabase.from('ticket_panels').select('*').eq('id',parts[1]).maybeSingle()).data;
        if(!panel) return interaction.reply({content:'Panel پیدا نشد.',ephemeral:true});
        panel._typeIndex=Number(parts[2])||0;
        const answers={}; for(let i=0;i<5;i++){ try{answers[`q${i}`]=interaction.fields.getTextInputValue(`q${i}`);}catch{} }
        return createTicket(interaction,panel,answers);
      }
      if(interaction.customId==='exchange'){
        const banner=interaction.fields.getTextInputValue('banner');
        await interaction.deferReply({ephemeral:true});
        const settings=await getSettings(interaction.guild.id);
        const logChannelId=String(settings.exchange_log_channel || EXCHANGE_LOG_CHANNEL_ID || '').trim();
        if(!logChannelId) return interaction.editReply({content:'❌ Exchange Log تنظیم نشده. /setexlog را تنظیم کنید یا EXCHANGE_LOG_CHANNEL_ID را در Railway قرار دهید.'});
        const logChannel=interaction.guild.channels.cache.get(logChannelId) || await interaction.guild.channels.fetch(logChannelId).catch(()=>null);
        if(!logChannel?.isTextBased()) return interaction.editReply({content:'❌ کانال Exchange Log معتبر نیست. ID کانال را بررسی کنید.'});
        const {data:e,error:eError}=await supabase.from('exchange_requests').insert({guild_id:interaction.guild.id,user_id:interaction.user.id,banner,status:'pending'}).select().single();
        if(eError || !e) { console.error('exchange insert error:',eError); return interaction.editReply({content:'❌ درخواست Exchange ذخیره نشد. تنظیمات Supabase را بررسی کنید.'}); }
        const logMentionUsers=await resolveExchangeLogMentions(interaction.guild);
        if(logMentionUsers.length < 2){
          await supabase.from('exchange_requests').delete().eq('id',e.id);
          return interaction.editReply({content:'❌ هر دو اکانت Exchange Log پیدا نشدند. باید دقیقاً amir_gholizadeh22 و itskingpubgyt در همین سرور باشند (یا ID آن‌ها در EXCHANGE_LOG_MENTION_USERS تنظیم شود).'});
        }
        const mentions=logMentionUsers.map(id=>`<@${id}>`).join(' ');
        const row=new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`exapprove:${e.id}`).setLabel('ACCEPT').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`exreject:${e.id}`).setLabel('DECLINE').setStyle(ButtonStyle.Danger)
        );
        try{
          await logChannel.send({content:`${mentions}\n📥 **Exchange Request**\nUser: <@${interaction.user.id}>\n\n${banner}`,components:[row],allowedMentions:{users:[...new Set([...logMentionUsers, interaction.user.id])],parse:[]}});
        }catch(err){
          console.error('exchange log send error:',err);
          await supabase.from('exchange_requests').delete().eq('id',e.id);
          return interaction.editReply({content:`❌ ارسال فرم به Exchange Log انجام نشد: ${err?.message || err}`});
        }
        return interaction.editReply({content:'فرم Exchange به Exchange Log ارسال شد و منتظر تایید است.'});
      }
    }
    if(!interaction.isChatInputCommand()) return;
    const {commandName}=interaction;
    const guild=interaction.guild; if(guild) await ensureRoles(guild);
    if(!PUBLIC_COMMANDS.has(commandName) && !isBotOwner(interaction.user.id) && !TICKET_STAFF_COMMANDS.has(commandName)){
      return interaction.reply({content:'⛔ You are not authorized to use this bot command.',ephemeral:true});
    }
    if(['giveaway','giveawaysv','dropmatn','dropclick'].includes(commandName)){
      // Authorized IDs/owners may use giveaway management directly; otherwise
      // the dedicated giveaway access role is required. This keeps the command
      // protected without locking out configured bot owners.
      if(!isBotOwner(interaction.user.id) && !hasAccess(interaction.member,ACCESS.giveaway)) {
        return interaction.reply({content:'⛔ شما دسترسی ساخت Giveaway را ندارید.',ephemeral:true});
      }
      if(commandName==='giveaway'||commandName==='giveawaysv'){
        const prize=interaction.options.getString('prize'), minutes=duration(interaction.options.getInteger('minutes'));
        if(!minutes) return interaction.reply({content:'❌ مدت زمان باید بیشتر از صفر دقیقه باشد.',ephemeral:true});
        const link=commandName==='giveawaysv'?interaction.options.getString('link'):null;
        if(link){ try{ new URL(link); }catch{ return interaction.reply({content:'❌ لینک واردشده معتبر نیست.',ephemeral:true}); } }
        if(!interaction.channel?.isTextBased()) return interaction.reply({content:'❌ این دستور باید داخل یک کانال متنی اجرا شود.',ephemeral:true});

        const payload={guild_id:guild.id,channel_id:interaction.channel.id,prize,duration_minutes:minutes,end_at:new Date(Date.now()+minutes*60000).toISOString(),link};
        const {data:g,error:gError}=await supabase.from('giveaways').insert(payload).select().single();
        if(gError || !g) {
          console.error('giveaway insert error:',gError);
          const detail=gError?.message ? `\n${gError.message}` : '';
          return interaction.reply({content:`❌ ساخت Giveaway در دیتابیس انجام نشد.${detail}`,ephemeral:true});
        }
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gw:${g.id}`).setLabel('شرکت در Giveaway').setStyle(ButtonStyle.Success));
        if(link) row.addComponents(new ButtonBuilder().setLabel('باز کردن لینک').setStyle(ButtonStyle.Link).setURL(link));
        let msg;
        try{
          msg=await interaction.channel.send({content:`🎉 **Giveaway**\n🎁 جایزه: **${prize}**\n⏱️ زمان: **${fmt(minutes*60000)}**`,components:[row]});
        }catch(sendError){
          console.error('giveaway channel send error:',sendError);
          await supabase.from('giveaways').delete().eq('id',g.id).catch(()=>{});
          return interaction.reply({content:`❌ ارسال Giveaway به کانال انجام نشد. دسترسی Send Messages را بررسی کنید.\n${sendError?.message||''}`,ephemeral:true});
        }
        const {error:updateError}=await supabase.from('giveaways').update({message_id:msg.id}).eq('id',g.id);
        if(updateError) console.error('giveaway message update error:',updateError);
        await logTo(guild,'giveaway_create_log_channel',`🎉 Giveaway ساخته شد | ${interaction.user.tag} | ${prize}`);
        return interaction.reply({content:'✅ Giveaway با موفقیت ساخته شد.',ephemeral:true});
      }
      if(commandName==='dropmatn'||commandName==='dropclick'){
        const target=commandName==='dropmatn'?interaction.options.getString('text'):null;
         const prize=interaction.options.getString('prize');
         const {data:d,error:dError}=await supabase.from('drops').insert({guild_id:guild.id,channel_id:interaction.channel.id,kind:commandName==='dropmatn'?'text':'click',target_text:target,prize}).select().single();
         if(dError || !d) { console.error('drop insert error:', dError); return interaction.reply({content:'❌ ساخت Drop در دیتابیس انجام نشد.',ephemeral:true}); }
         const embed=new EmbedBuilder().setTitle('⚡ DROP').setDescription(commandName==='dropmatn'?`اولین کسی که دقیقاً بنویسد:
**${target}**
برنده می‌شود!`:'اولین نفری که دکمه را بزند برنده می‌شود!').addFields({name:'🏆 جایزه',value:`**${prize}**`});
         const row=commandName==='dropclick'?new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`drop:${d.id}`).setLabel('کلیک کن و برنده شو').setStyle(ButtonStyle.Success)):undefined;
         const msg=await interaction.channel.send({embeds:[embed],components:row?[row]:[]});
         const {error:dropMsgError}=await supabase.from('drops').update({message_id:msg.id}).eq('id',d.id); if(dropMsgError) console.error('drop message update error:',dropMsgError);
         await logTo(guild,'drop_create_log_channel',`⚡ Drop ساخته شد | ${interaction.user.tag} | prize=${prize}`); return interaction.reply({content:'Drop ساخته شد.',ephemeral:true});
      }
    }
    if(commandName==='panel'){
      const type=interaction.options.getString('type',true);
      const meta=TICKET_TYPES[type];
      const name=interaction.options.getString('name') || meta.label;
      const welcome=interaction.options.getString('welcome') || `سلام [user]، تیکت **${meta.label}** شما ایجاد شد.`;
      const text=interaction.options.getString('text') || `${meta.emoji} **${meta.label}**\nبرای باز کردن تیکت روی دکمه زیر بزنید.`;
      const roles=interaction.options.getRole('mention_role');
      const qs=[1,2,3,4,5].map(i=>interaction.options.getString(`q${i}`)).filter(Boolean);
      const {data:last}=await supabase.from('ticket_panels').select('panel_number').eq('guild_id',guild.id).order('panel_number',{ascending:false}).limit(1).maybeSingle();
      const number=Number(last?.panel_number||0)+1;
      const {data:p,error:pError}=await supabase.from('ticket_panels').insert({guild_id:guild.id,panel_number:number,panel_type:type,name,welcome_text:welcome,description:text,category_id:interaction.options.getChannel('category')?.id||null,mention_roles:roles?[roles.id]:[],claim_enabled:true,close_enabled:true,button_name:'Open Ticket',button_emoji:meta.emoji,claim_emoji:'🎫',close_emoji:'🔒',form_enabled:qs.length>0,form_questions:qs,ticket_types:[{name:meta.label,emoji:meta.emoji,prefix:meta.prefix}]}).select().single();
      if(pError || !p){ console.error('panel insert error:',pError); return interaction.reply({content:`❌ ساخت Panel انجام نشد: ${pError?.message||'database error'}`,ephemeral:true}); }
      const embed=new EmbedBuilder().setTitle(`${meta.emoji} ${name}`.slice(0,256)).setDescription(text.slice(0,4096)).setFooter({text:`Panel #${number} • ${meta.label}`});
      const msg=await interaction.channel.send({embeds:[embed],components:buildPanelComponents(p)});
      await supabase.from('ticket_panels').update({channel_id:interaction.channel.id,message_id:msg.id}).eq('id',p.id);
      return interaction.reply({content:`✅ Panel #${number} (${meta.label}) ساخته شد.`,ephemeral:true});
    }
    if(commandName==='addtype'){
      const num=interaction.options.getInteger('num',true);
      const name=clean(interaction.options.getString('name',true)).slice(0,80);
      const emoji=interaction.options.getString('emoji') || '🎫';
      const prefix=slugifyTicketType(interaction.options.getString('prefix') || name);
      const {data:p,error:pLoadError}=await loadPanelByNumber(guild.id,num);
      if(pLoadError) return interaction.reply({content:`❌ خواندن Panel انجام نشد: ${pLoadError.message}`,ephemeral:true});
      if(!p) return interaction.reply({content:`❌ Panel #${num} پیدا نشد. ابتدا /panels را اجرا کنید.`,ephemeral:true});
      const types=getPanelTypes(p);
      if(types.length>=25) return interaction.reply({content:'❌ حداکثر 25 نوع تیکت برای هر پنل است.',ephemeral:true});
      if(types.some(t=>String(t.name).toLowerCase()===name.toLowerCase())) return interaction.reply({content:'❌ این نوع تیکت قبلاً در پنل وجود دارد.',ephemeral:true});
      types.push({name,emoji,prefix});
      const {data:updated,error}=await savePanelTypes(p,types);
      if(error) return interaction.reply({content:`❌ افزودن نوع تیکت انجام نشد: ${error.message}`,ephemeral:true});
      await refreshTicketPanelMessage(guild,updated);
      return interaction.reply({content:`✅ «${name}» به Panel #${num} اضافه شد.`,ephemeral:true});
    }
    if(commandName==='edittype'){
      const num=interaction.options.getInteger('num',true), index=interaction.options.getInteger('index',true)-1;
      const {data:p,error:pLoadError}=await loadPanelByNumber(guild.id,num);
      if(pLoadError) return interaction.reply({content:`❌ خواندن Panel انجام نشد: ${pLoadError.message}`,ephemeral:true});
      if(!p) return interaction.reply({content:`❌ Panel #${num} پیدا نشد. ابتدا /panels را اجرا کنید.`,ephemeral:true});
      const types=getPanelTypes(p); if(index<0 || index>=types.length) return interaction.reply({content:'❌ شماره نوع تیکت معتبر نیست.',ephemeral:true});
      const old={...types[index]}; const name=interaction.options.getString('name'); const emoji=interaction.options.getString('emoji'); const removeEmoji=interaction.options.getBoolean('remove_emoji')||false; const prefixInput=interaction.options.getString('prefix');
      if(name!==null) old.name=clean(name).slice(0,80);
      if(emoji!==null) old.emoji=emoji;
      if(removeEmoji) old.emoji='';
      if(prefixInput!==null) old.prefix=slugifyTicketType(prefixInput);
      else if(name!==null) old.prefix=slugifyTicketType(name);
      if(!old.name) return interaction.reply({content:'❌ نام نوع تیکت نمی‌تواند خالی باشد.',ephemeral:true});
      types[index]=old;
      if(types.some((t,i)=>i!==index && String(t.name).toLowerCase()===String(old.name).toLowerCase())) return interaction.reply({content:'❌ این نام تیکت قبلاً وجود دارد.',ephemeral:true});
      const {data:updated,error}=await savePanelTypes(p,types);
      if(error) return interaction.reply({content:`❌ ویرایش نوع تیکت انجام نشد: ${error.message}`,ephemeral:true});
      await refreshTicketPanelMessage(guild,updated);
      return interaction.reply({content:`✅ نوع تیکت شماره ${index+1} در Panel #${num} ویرایش شد.`,ephemeral:true});
    }
    if(commandName==='listtypes'){
      const num=interaction.options.getInteger('num',true);
      const {data:p,error:pLoadError}=await loadPanelByNumber(guild.id,num);
      if(pLoadError) return interaction.reply({content:`❌ خواندن Panel انجام نشد: ${pLoadError.message}`,ephemeral:true});
      if(!p) return interaction.reply({content:`❌ Panel #${num} پیدا نشد. ابتدا /panels را اجرا کنید.`,ephemeral:true});
      const types=getPanelTypes(p);
      const lines=types.map((t,i)=>`${i+1}. ${t.emoji||'▫️'} **${t.name}** — prefix: \`${slugifyTicketType(t.prefix||t.name)}\``);
      return interaction.reply({content:`🎫 **Panel #${num} — Ticket Types**\n${lines.join('\n')}\n\nتعداد: ${types.length}`,ephemeral:true});
    }
    if(commandName==='deltype'){
      const num=interaction.options.getInteger('num',true), index=interaction.options.getInteger('index',true)-1;
      const {data:p,error:pLoadError}=await loadPanelByNumber(guild.id,num);
      if(pLoadError) return interaction.reply({content:`❌ خواندن Panel انجام نشد: ${pLoadError.message}`,ephemeral:true});
      if(!p) return interaction.reply({content:`❌ Panel #${num} پیدا نشد. ابتدا /panels را اجرا کنید.`,ephemeral:true});
      const types=getPanelTypes(p); if(index<0 || index>=types.length) return interaction.reply({content:'❌ شماره نوع تیکت معتبر نیست.',ephemeral:true});
      if(types.length===1) return interaction.reply({content:'❌ نمی‌توان آخرین نوع تیکت پنل را حذف کرد. ابتدا نوع دیگری اضافه کنید.',ephemeral:true});
      const removed=types.splice(index,1)[0];
      const {data:updated,error}=await savePanelTypes(p,types);
      if(error) return interaction.reply({content:`❌ حذف نوع تیکت انجام نشد: ${error.message}`,ephemeral:true});
      await refreshTicketPanelMessage(guild,updated);
      return interaction.reply({content:`✅ «${removed.name}» از Panel #${num} حذف شد.`,ephemeral:true});
    }
    if(commandName==='reordertypes'){
      const num=interaction.options.getInteger('num',true); const order=interaction.options.getString('order',true).split(',').map(x=>Number(x.trim()));
      const {data:p,error:pLoadError}=await loadPanelByNumber(guild.id,num);
      if(pLoadError) return interaction.reply({content:`❌ خواندن Panel انجام نشد: ${pLoadError.message}`,ephemeral:true});
      if(!p) return interaction.reply({content:`❌ Panel #${num} پیدا نشد. ابتدا /panels را اجرا کنید.`,ephemeral:true});
      const types=getPanelTypes(p);
      if(order.length!==types.length || new Set(order).size!==types.length || order.some(n=>n<1||n>types.length)) return interaction.reply({content:`❌ ترتیب باید دقیقاً شامل شماره‌های 1 تا ${types.length} باشد؛ مثال: ${types.map((_,i)=>i+1).join(',')}`,ephemeral:true});
      const reordered=order.map(n=>types[n-1]);
      const {data:updated,error}=await savePanelTypes(p,reordered);
      if(error) return interaction.reply({content:`❌ تغییر ترتیب انجام نشد: ${error.message}`,ephemeral:true});
      await refreshTicketPanelMessage(guild,updated);
      return interaction.reply({content:`✅ ترتیب انواع Panel #${num} تغییر کرد.`,ephemeral:true});
    }
    if(commandName==='delpanel'){
      const num=interaction.options.getInteger('num',true);
      const {data:p,error:pLoadError}=await loadPanelByNumber(guild.id,num);
      if(pLoadError) return interaction.reply({content:`❌ خواندن Panel انجام نشد: ${pLoadError.message}`,ephemeral:true});
      if(!p) return interaction.reply({content:`❌ Panel #${num} پیدا نشد. ابتدا /panels را اجرا کنید.`,ephemeral:true});
      if(p.channel_id && p.message_id){ const ch=guild.channels.cache.get(p.channel_id); const msg=ch?await ch.messages.fetch(p.message_id).catch(()=>null):null; if(msg) await msg.delete().catch(()=>{}); }
      const {error}=await supabase.from('ticket_panels').delete().eq('id',p.id).eq('guild_id',guild.id); if(error) return interaction.reply({content:`❌ حذف Panel انجام نشد: ${error.message}`,ephemeral:true});
      return interaction.reply({content:`✅ Panel #${num} کاملاً حذف شد.`,ephemeral:true});
    }
    if(commandName==='editpanel'){
      const num=interaction.options.getInteger('num',true);
      const {data:p,error:pLoadError}=await loadPanelByNumber(guild.id,num);
      if(pLoadError) return interaction.reply({content:`❌ خواندن Panel انجام نشد: ${pLoadError.message}`,ephemeral:true});
      if(!p) return interaction.reply({content:`❌ Panel #${num} پیدا نشد. ابتدا /panels را اجرا کنید.`,ephemeral:true});
      const patch={};
      for(const k of ['name','text','welcome']){
        const v=interaction.options.getString(k); if(v!==null) patch[k==='text'?'description':k==='welcome'?'welcome_text':'name']=v;
      }
      const type=interaction.options.getString('type'); if(type) { patch.panel_type=type; patch.ticket_types=[{name:TICKET_TYPES[type].label,emoji:TICKET_TYPES[type].emoji,prefix:TICKET_TYPES[type].prefix}]; }
      const cat=interaction.options.getChannel('category'); if(cat) patch.category_id=cat.id;
      const role=interaction.options.getRole('mention_role'); if(role) patch.mention_roles=[role.id];
      if(!Object.keys(patch).length) return interaction.reply({content:'هیچ تغییری وارد نشده است.',ephemeral:true});
      const {data:updated,error}=await supabase.from('ticket_panels').update(patch).eq('id',p.id).select().single();
      if(error) return interaction.reply({content:`❌ ویرایش Panel انجام نشد: ${error.message}`,ephemeral:true});
      if(updated.channel_id && updated.message_id){ const ch=guild.channels.cache.get(updated.channel_id); const msg=ch?await ch.messages.fetch(updated.message_id).catch(()=>null):null; if(msg){ const meta=TICKET_TYPES[updated.panel_type]||{}; const embed=new EmbedBuilder().setTitle(`${meta.emoji||'🎫'} ${updated.name}`.slice(0,256)).setDescription(String(updated.description||'برای باز کردن تیکت روی دکمه زیر بزنید.').slice(0,4096)).setFooter({text:`Panel #${num}`}); await msg.edit({embeds:[embed],components:buildPanelComponents(updated)}).catch(()=>{}); } }
      return interaction.reply({content:`✅ Panel #${num} ویرایش شد.`,ephemeral:true});
    }
    if(commandName==='panels'){
      const {data:panels}=await supabase.from('ticket_panels').select('panel_number,name,panel_type,channel_id').eq('guild_id',guild.id).order('panel_number',{ascending:true});
      return interaction.reply({content:(panels||[]).map(p=>`#${p.panel_number} — ${panelLabel(p)} — ${p.name} — ${p.channel_id?`<#${p.channel_id}>`:'no channel'}`).join('\n')||'هیچ Panelی وجود ندارد.',ephemeral:true});
    }
    if(commandName==='allpanel'){
      const channel=interaction.options.getChannel('channel')||interaction.channel;
      const {data:panels}=await supabase.from('ticket_panels').select('*').eq('guild_id',guild.id).order('panel_number',{ascending:true});
      const entries=[];
      for(const p of panels||[]) for(let i=0;i<getPanelTypes(p).length;i++){
        const t=getPanelTypes(p)[i]; entries.push({label:String(t.name).slice(0,100),value:`${p.id}:${i}`,description:`Panel #${p.panel_number} • ${String(t.name).slice(0,70)}`,...(t.emoji ? {emoji:t.emoji} : {})});
      }
      if(!entries.length) return interaction.reply({content:'❌ ابتدا حداقل یک Panel بسازید.',ephemeral:true});
      if(entries.length>25) return interaction.reply({content:`❌ All-in-one Menu حداکثر 25 گزینه دارد. الان ${entries.length} نوع تیکت دارید.`,ephemeral:true});
      const menu=new StringSelectMenuBuilder().setCustomId('ticketmenu').setPlaceholder(interaction.options.getString('placeholder')||'نوع تیکت را انتخاب کنید').addOptions(entries);
      const embed=new EmbedBuilder().setTitle(interaction.options.getString('name')||'🎫 Ticket Menu').setDescription(interaction.options.getString('text')||'نوع تیکت موردنظر را انتخاب کنید.');
      const msg=await channel.send({embeds:[embed],components:[new ActionRowBuilder().addComponents(menu)]});
      await setSettings(guild.id,{ticket_all_in_one_channel:channel.id,ticket_all_in_one_message:msg.id});
      return interaction.reply({content:`✅ All-in-one Ticket menu ساخته شد: ${channel}`,ephemeral:true});
    }
    if(commandName==='claim'){ const t=await getTicket(interaction.channel); if(!t) return interaction.reply({content:'Ticket نیست.',ephemeral:true}); return claimTicket(interaction,t); }
    if(commandName==='claimchange'){
      const t=await getTicket(interaction.channel); if(!t||!isTicketStaff(interaction.member)) return interaction.reply({content:'دسترسی یا Ticket ندارید.',ephemeral:true}); const u=interaction.options.getUser('user');
      const {error:claimChangeError}=await supabase.from('tickets').update({claimed_by:u.id}).eq('id',t.id);
      if(claimChangeError) return interaction.reply({content:`❌ تغییر Claim انجام نشد: ${claimChangeError.message}`,ephemeral:true});
      const {error:claimHistoryError}=await supabase.from('ticket_claim_history').insert({ticket_id:t.id,guild_id:guild.id,user_id:u.id,action:'claimchange',changed_by:interaction.user.id});
      if(claimHistoryError) console.error('ticket claim history error:',claimHistoryError?.message||claimHistoryError);
      const claimText=`🔄 Claim تغییر کرد | ${interaction.channel.name} | مسئول جدید: ${u.tag||u.username} (<@${u.id}>) | توسط ${interaction.user.tag}`;
      await logTo(guild,'ticket_log_channel',claimText);
      const settings=await getSettings(guild.id);
      const logId=settings.ticket_log_channel;
      const logChannel=logId ? (guild.channels.cache.get(logId)||await guild.channels.fetch(logId).catch(()=>null)) : null;
      if(logChannel?.isTextBased()) await logChannel.send({content:claimText,allowedMentions:{users:[]}}).catch(err=>console.error('ticket claim-change discord log error:',err?.message||err));
      return interaction.reply({content:`Claim به <@${u.id}> منتقل شد.`,allowedMentions:{users:[u.id]}});
    }
    if(commandName==='add'||commandName==='remove'){
      const t=await getTicket(interaction.channel); if(!t||!isTicketStaff(interaction.member)) return interaction.reply({content:'دسترسی یا Ticket ندارید.',ephemeral:true}); const u=interaction.options.getUser('user');
      if(commandName==='add'){ await interaction.channel.permissionOverwrites.edit(u.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); await supabase.from('ticket_members').upsert({ticket_id:t.id,user_id:u.id,added_by:interaction.user.id}); return interaction.reply({content:`<@${u.id}> به Ticket اضافه شد.`,allowedMentions:{users:[u.id]}}); }
      await interaction.channel.permissionOverwrites.delete(u.id).catch(()=>{}); await supabase.from('ticket_members').delete().eq('ticket_id',t.id).eq('user_id',u.id); return interaction.reply({content:`<@${u.id}> از Ticket حذف شد.`,allowedMentions:{users:[u.id]}});
    }
    if(commandName==='close'){ const t=await getTicket(interaction.channel); if(!t) return interaction.reply({content:'Ticket نیست.',ephemeral:true}); if(t.status!=='open') return interaction.reply({content:'این Ticket قبلاً بسته شده.',ephemeral:true}); const modal=new ModalBuilder().setCustomId(`closemodal:${t.id}`).setTitle('بستن تیکت').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('دلیل بستن').setStyle(TextInputStyle.Paragraph).setRequired(false))); return interaction.showModal(modal); }
    if(commandName==='reopen'){
      const t=await getTicket(interaction.channel); if(!t||!isTicketStaff(interaction.member)) return interaction.reply({content:'دسترسی یا Ticket ندارید.',ephemeral:true});
      if(t.status!=='closed') return interaction.reply({content:'این Ticket قبلاً باز است.',ephemeral:true});
      const {error}=await supabase.from('tickets').update({status:'open',closed_at:null}).eq('id',t.id).eq('status','closed'); if(error) return interaction.reply({content:`❌ باز کردن Ticket انجام نشد: ${error.message}`,ephemeral:true});
      const ticketRole=interaction.guild.roles.cache.find(r=>r.name===TICKET_SUPPORT_ROLE); await interaction.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); if(ticketRole) await interaction.channel.permissionOverwrites.edit(ticketRole.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
      await interaction.channel.send({content:`🔓 <@&${ticketRole?.id||'0'}> <@${t.opener_id}> Ticket دوباره باز شد.`,allowedMentions:{users:[t.opener_id],roles:ticketRole?[ticketRole.id]:[]}}); return interaction.reply({content:'Ticket دوباره باز شد.',ephemeral:true});
    }
    if(commandName==='stats'){ if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); await setSettings(guild.id,{stats_channel:interaction.channel.id}); return interaction.reply({content:'این چنل برای گزارش Claim ذخیره شد.',ephemeral:true}); }

    if(['setfosh','deletefosh','whiteuser'].includes(commandName)){
      if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true});
      if(commandName==='setfosh'){ for(const w of interaction.options.getString('words').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)) await supabase.from('profanity_words').upsert({guild_id:guild.id,word:w}); }
      if(commandName==='deletefosh'){ for(const w of interaction.options.getString('words').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)) await supabase.from('profanity_words').delete().eq('guild_id',guild.id).eq('word',w); }
      if(commandName==='whiteuser'){ const u=interaction.options.getUser('user'); await supabase.from('profanity_whitelist').upsert({guild_id:guild.id,user_id:u.id}); }
      return interaction.reply({content:'تنظیمات فحش انجام شد.',ephemeral:true});
    }
    if(['kick','ban','timeout','warn'].includes(commandName)){
      if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); const m=interaction.options.getMember('user'), reason=interaction.options.getString('reason')||'بدون دلیل'; if(!m) return interaction.reply({content:'ممبر پیدا نشد.',ephemeral:true});
      if(commandName==='warn'){ const {count}=await supabase.from('member_warns').select('*',{count:'exact',head:true}).eq('guild_id',guild.id).eq('user_id',m.id); await supabase.from('member_warns').insert({guild_id:guild.id,user_id:m.id,reason}); const n=(count||0)+1; if(n>=3) await m.timeout(2*60*60*1000,'3 warnings').catch(()=>{}); await logTo(guild,'member_warn_log_channel',`⚠️ Warn | ${m.user.tag} | ${n}/3 | ${reason}`); return interaction.reply({content:`Warn ثبت شد (${n}/3).`}); }
      if(commandName==='kick') await m.kick(reason);
      if(commandName==='ban') await m.ban({reason});
      if(commandName==='timeout') await m.timeout(2*60*60*1000,reason);
      const moderationLogKey=commandName==='timeout'?'timeout_log_channel':'ban_kick_log_channel';
      await logTo(guild,moderationLogKey,`🛡️ ${commandName} | ${m.user.tag} | ${reason}`);
      return interaction.reply({content:`${commandName} انجام شد.`});
    }
    if(['unwarn','unban','untimeout'].includes(commandName)){
      if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true});
      if(commandName==='unban'){
        const u=interaction.options.getUser('user'); if(!u) return interaction.reply({content:'کاربر پیدا نشد.',ephemeral:true});
        try{ await guild.members.unban(u.id,'Unban command'); }catch(e){ return interaction.reply({content:'❌ این کاربر بن نیست یا امکان Unban وجود ندارد.',ephemeral:true}); }
        await logTo(guild,'ban_kick_log_channel',`🔓 Unban | ${u.tag} | توسط ${interaction.user.tag}`);
        return interaction.reply({content:`${u} Unban شد.`});
      }
      if(commandName==='untimeout'){
        const m=interaction.options.getMember('user'); if(!m) return interaction.reply({content:'ممبر پیدا نشد.',ephemeral:true});
        const err=await m.timeout(null,'Untimeout command').catch(e=>e); if(err instanceof Error) return interaction.reply({content:'❌ برداشتن Timeout انجام نشد.',ephemeral:true});
        await logTo(guild,'timeout_log_channel',`🔓 Untimeout | ${m.user.tag} | توسط ${interaction.user.tag}`);
        return interaction.reply({content:`${m} از Timeout خارج شد.`});
      }
      const table='member_warns';
      const m=interaction.options.getMember('user'); if(!m) return interaction.reply({content:'ممبر پیدا نشد.',ephemeral:true});
      const {data:last,error:findError}=await supabase.from(table).select('id').eq('guild_id',guild.id).eq('user_id',m.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(findError || !last) return interaction.reply({content:'⚠️ برای این کاربر Warn ثبت‌شده‌ای پیدا نشد.',ephemeral:true});
      const {error:delError}=await supabase.from(table).delete().eq('id',last.id);
      if(delError) return interaction.reply({content:'❌ حذف Warn انجام نشد.',ephemeral:true});
      const {count}=await supabase.from(table).select('*',{count:'exact',head:true}).eq('guild_id',guild.id).eq('user_id',m.id);
      const logKey='member_warn_log_channel';
      await logTo(guild,logKey,`🔓 ${commandName} | ${m.user.tag} | وارن باقی‌مانده: ${count||0} | توسط ${interaction.user.tag}`);
      return interaction.reply({content:`یک Warn از ${m} کم شد. وارن باقی‌مانده: ${count||0}`});
    }
    if(commandName==='setrolexp'){
      if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); await supabase.from('xp_roles').upsert({guild_id:guild.id,level:interaction.options.getInteger('level'),role_id:interaction.options.getRole('role').id}); return interaction.reply({content:'Role XP ذخیره شد.'});
    }
    if(commandName==='setxp'){
      if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); const u=interaction.options.getUser('user'), amount=interaction.options.getInteger('amount'); const old=(await supabase.from('xp_users').select('*').eq('guild_id',guild.id).eq('user_id',u.id).maybeSingle()).data||{xp:0,level:0}; const xp=old.xp+amount, level=Math.floor(xp/10); await supabase.from('xp_users').upsert({guild_id:guild.id,user_id:u.id,xp,level}); return interaction.reply({content:`${amount} پیام به ${u} اضافه شد.`});
    }
    if(commandName==='leaderboard'){
      const {data:users}=await supabase.from('xp_users').select('*').eq('guild_id',guild.id).order('xp',{ascending:false}).limit(10); const e=new EmbedBuilder().setTitle('🏆 XP Leaderboard').setDescription((users||[]).map((x,i)=>`${i+1}. <@${x.user_id}> — Level ${x.level} | ${x.xp} XP`).join('\n')||'خالی'); return interaction.reply({embeds:[e]});
    }
    if(commandName==='textowner'){
      if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); const ch=interaction.options.getChannel('channel'); await setSettings(guild.id,{owner_relay_channel:ch.id}); return interaction.reply({content:`Relay در ${ch} فعال شد.`});
    }
    if(commandName==='untextowner'){
      if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true});
      await setSettings(guild.id,{owner_relay_channel:null});
      return interaction.reply({content:'پیام‌های Owner دیگر توسط بات Relay نمی‌شوند.',ephemeral:true});
    }
    if(commandName==='createcmd'){
      if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); const s=await getSettings(guild.id); const cc=s.custom_commands||{}; cc[interaction.options.getString('keyword').toLowerCase()]=interaction.options.getString('text'); await setSettings(guild.id,{custom_commands:cc}); return interaction.reply({content:'Custom command ذخیره شد.'});
    }
    if(commandName==='exchange'){
      const modal=new ModalBuilder().setCustomId('exchange').setTitle('Exchange Form').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('banner').setLabel('اطلاعات / بنر اکسچنج').setStyle(TextInputStyle.Paragraph).setRequired(true))); return interaction.showModal(modal);
    }
    if(commandName==='banner'){ const s=await getSettings(guild.id); if(!s.server_banner) return interaction.reply({content:'بنر هنوز تنظیم نشده.',ephemeral:true}); return interaction.reply({content:s.server_banner}); }
    if(commandName==='setbanner'){ if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); await setSettings(guild.id,{server_banner:interaction.options.getString('banner')}); return interaction.reply({content:'بنر ذخیره شد.'}); }
    if(commandName==='settextxp'){ if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); await setSettings(guild.id,{xp_level_text:interaction.options.getString('text')}); return interaction.reply({content:'متن Level Up ذخیره شد.'}); }
    if(commandName==='level'){ const u=(await supabase.from('xp_users').select('*').eq('guild_id',guild.id).eq('user_id',interaction.user.id).maybeSingle()).data||{xp:0,level:0}; return interaction.reply({content:`⭐ Level: ${u.level} | تعداد پیام: ${u.xp}`}); }
    if(commandName==='settextwel'){ if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); await setSettings(guild.id,{welcome_text:interaction.options.getString('text')}); return interaction.reply({content:'متن Welcome ذخیره شد.'}); }
    if(commandName==='settextinc'){ if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); await setSettings(guild.id,{invite_text:interaction.options.getString('text')}); return interaction.reply({content:'متن Invite ذخیره شد.'}); }
    if(commandName==='setex'){ if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); await setSettings(guild.id,{exchange_channel:interaction.options.getChannel('channel').id}); return interaction.reply({content:'چنل Exchange ذخیره شد.'}); }
    if(commandName==='setlogchannel'){
      if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true});
      const ch=interaction.options.getChannel('channel');
      await setSettings(guild.id,{aggregated_log_channel:ch.id,next_log_flush_at:new Date(Date.now()+LOG_FLUSH_FIRST_MS).toISOString()});
      await protectLogChannel(guild,ch.id);
      return interaction.reply({content:`✅ کانال گزارش لاگ‌ها روی ${ch} تنظیم شد. اولین گزارش خودکار ۳ ساعت بعد ارسال می‌شود و سپس هر ۶ ساعت یک‌بار.`});
    }
    if(commandName==='sendlogs'){
      if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true});
      await interaction.deferReply({ephemeral:true});
      const result=await flushGuildLogs(guild,true);
      if(result.reason==='not-configured') return interaction.editReply({content:'❌ ابتدا با `/setlogchannel` کانال لاگ را تنظیم کنید.'});
      if(result.reason==='invalid-channel') return interaction.editReply({content:'❌ کانال لاگ معتبر نیست یا دیگر وجود ندارد.'});
      if(!result.sent) return interaction.editReply({content:`❌ ارسال گزارش لاگ انجام نشد.\nدلیل: ${result.error || result.reason || 'خطای نامشخص'}\n\nدسترسی‌های موردنیاز بات: View Channel, Send Messages, Embed Links, Read Message History.`});
      return interaction.editReply({content:`✅ گزارش لاگ ارسال شد (${result.count} مورد) و زمان گزارش بعدی روی ۶ ساعت بعد تنظیم شد.`});
    }
    if(commandName==='setexlog'){ if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); const ch=interaction.options.getChannel('channel'); await setSettings(guild.id,{exchange_log_channel:ch.id}); return interaction.reply({content:`Exchange Log روی ${ch} تنظیم شد.`}); }
    if(commandName==='setrate'){ if(!isBotOwner(interaction.user.id)) return interaction.reply({content:'فقط افراد مجاز.',ephemeral:true}); const ch=interaction.options.getChannel('channel'); await setSettings(guild.id,{ticket_feedback_channel:ch.id}); return interaction.reply({content:`Rating Channel روی ${ch} تنظیم شد.`}); }
    if(commandName==='setticketlog'){ const ch=interaction.options.getChannel('channel'); await setSettings(guild.id,{ticket_transcript_log_channel:ch.id}); return interaction.reply({content:`Transcript Log روی ${ch} تنظیم شد.`}); }
  }catch(e){ console.error(e); if(!interaction.replied&&!interaction.deferred) await interaction.reply({content:'❌ خطایی رخ داد. کنسول VPS را بررسی کنید.',ephemeral:true}).catch(()=>{}); }
});

client.on('guildMemberAdd',async member=>{
  const s=await getSettings(member.guild.id);
  const welcomeText=placeholders(s.welcome_text||'خوش آمدی [user] ❤️\nتعداد اعضا: [Number]',member,member.guild);
  if(s.welcome_channel){ const ch=member.guild.channels.cache.get(s.welcome_channel); if(ch) await ch.send(welcomeText).catch(()=>{}); }
  await logTo(member.guild,'welcome_channel',`👋 Welcome | ${member.user.tag} (${member.id})`);
  const before=inviteCache.get(member.guild.id)||new Map(), after=await member.guild.invites.fetch().catch(()=>new Map());
  let used=null; for(const i of after.values()){ if((i.uses||0)>(before.get(i.code)||0)){used=i;break;} }
  await cacheInvites(member.guild).catch(()=>{});
  if(used){ await supabase.from('invite_stats').upsert({guild_id:member.guild.id,inviter_id:used.inviter?.id||'unknown',invited_id:member.id}); const {count}=await supabase.from('invite_stats').select('*',{count:'exact',head:true}).eq('guild_id',member.guild.id).eq('inviter_id',used.inviter?.id||'unknown'); const inviteText=placeholders(s.invite_text||'👋 [user] با دعوت <inv> وارد شد. تعداد دعوت: [invnum]',member,member.guild,used.inviter?.id||'',count||0).replace('[inv]',used.inviter?.id||''); if(s.invite_log_channel){ const ch=member.guild.channels.cache.get(s.invite_log_channel); if(ch) await ch.send(inviteText).catch(()=>{}); } await logTo(member.guild,'invite_log_channel',`📨 Invite | ${member.user.tag} | inviter=${used.inviter?.tag||used.inviter?.id||'unknown'} | total=${count||0}`); }
});
client.on('voiceStateUpdate',async(oldS,newS)=>{ if(!newS.guild) return; if(!oldS.channelId&&newS.channelId) await logTo(newS.guild,'voice_log_channel',`🔊 <@${newS.id}> وارد ${newS.channel?.name} شد.`); else if(oldS.channelId&&!newS.channelId) await logTo(newS.guild,'voice_log_channel',`🔇 <@${newS.id}> از ${oldS.channel?.name} خارج شد.`); });
client.on('messageDelete',async m=>{ if(m.guild&&!m.author?.bot) await logTo(m.guild,'message_log_channel',`🗑️ پیام حذف شد | ${m.author?.tag||'نامشخص'} | ${m.content||'بدون متن'}`); });
client.on('messageUpdate',async(oldM,newM)=>{ if(oldM.guild&&oldM.content!==newM.content&&!newM.author?.bot) await logTo(oldM.guild,'message_log_channel',`✏️ پیام ویرایش شد | ${newM.author?.tag||'نامشخص'}\nقبل: ${oldM.content||''}\nبعد: ${newM.content||''}`); });
client.on('guildUpdate',async(oldG,newG)=>{
  const changes=[];
  if(oldG.name!==newG.name) changes.push(`نام: ${oldG.name} → ${newG.name}`);
  if(oldG.icon!==newG.icon) changes.push('آیکن سرور تغییر کرد');
  if(changes.length) await logTo(newG,'server_update_log_channel',`🏠 Server Update | ${changes.join(' | ')}`);
});
client.on('roleCreate',r=>logTo(r.guild,'server_update_log_channel',`➕ Role ساخته شد: ${r.name}`));
client.on('roleDelete',r=>logTo(r.guild,'server_update_log_channel',`➖ Role حذف شد: ${r.name}`));
client.on('channelCreate',c=>c.guild&&logTo(c.guild,'server_update_log_channel',`➕ Channel ساخته شد: ${c.name}`));
client.on('channelDelete',c=>c.guild&&logTo(c.guild,'server_update_log_channel',`➖ Channel حذف شد: ${c.name}`));

client.on('roleUpdate',async(oldR,newR)=>{ if(oldR.name!==newR.name) await logTo(newR.guild,'server_update_log_channel',`✏️ Role تغییر نام: ${oldR.name} → ${newR.name}`); });
client.on('channelUpdate',async(oldC,newC)=>{ if(oldC.name!==newC.name) await logTo(newC.guild,'server_update_log_channel',`✏️ Channel تغییر نام: ${oldC.name} → ${newC.name}`); });
const inviteCache=new Map();
async function cacheInvites(g){ const m=new Map(); for(const i of await g.invites.fetch().catch(()=>new Map())) m.set(i.code,i.uses||0); inviteCache.set(g.id,m); }
client.on('ready',async()=>{ for(const g of client.guilds.cache.values()) await cacheInvites(g).catch(()=>{}); });
client.on('inviteCreate',async i=>cacheInvites(i.guild));
client.on('inviteDelete',async i=>cacheInvites(i.guild));
process.on('unhandledRejection', e => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', e => console.error('UNCAUGHT EXCEPTION:', e));

client.login(process.env.DISCORD_TOKEN);
