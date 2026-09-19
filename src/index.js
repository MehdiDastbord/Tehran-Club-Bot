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
  giveaway: 'Giveway Acces', ticket: 'Ticket Acces', mod: 'Ban/Kick Acces', logs: 'Logs', exchange: 'Exchange', staff: 'Staff Manager'
};
const client = new Client({ intents:[
  GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildInvites
], partials:[Partials.Channel] });

const OWNER_IDS = String(process.env.OWNER_IDS || process.env.OWNER_ID || '').split(',').map(x=>x.trim()).filter(Boolean);
const isBotOwner = id => OWNER_IDS.includes(String(id));
const isAdmin = m => !!m?.permissions?.has(ADMIN);
const hasAccess = (m, role) => isAdmin(m) || !!m?.roles?.cache?.some(r=>r.name===role);
const hasRoleOnly = (m, role) => !!m?.roles?.cache?.some(r=>r.name===role);
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
async function ensureRoles(guild){ for(const n of Object.values(ACCESS)) await ensureRole(guild,n).catch(()=>{}); }
async function logTo(guild,key,text){
  const s=await getSettings(guild.id); const id=s[key]; if(!id) return;
  const ch=guild.channels.cache.get(id); if(ch?.isTextBased()) await ch.send({content:text}).catch(()=>{});
}
async function deleteInvocation(message){ await message.delete().catch(()=>{}); }
async function setTextSetting(message,key,value){ if(!isAdmin(message.member)) return; await setSettings(message.guild.id,{[key]:value}); await deleteInvocation(message); }

const SETCH = {
  setcht:'ticket_log_channel', setchfead:'ticket_feedback_channel', setchru:'staff_rank_channel', setchhi:'staff_hire_channel',
  setchstw:'staff_warn_channel', setchm:'message_log_channel', setchb:'ban_kick_log_channel', setchto:'timeout_log_channel',
  setchv:'voice_log_channel', setchdm:'dm_log_channel', setchdv:'server_update_log_channel', setchwa:'member_warn_log_channel',
  setchwel:'welcome_channel', setchinv:'invite_log_channel', setchlevel:'level_channel'
};

async function protectLogChannel(guild, channelId){
  const ch=guild.channels.cache.get(channelId); if(!ch?.permissionOverwrites) return;
  const role=await ensureRole(guild,ACCESS.logs);
  await ch.permissionOverwrites.edit(guild.roles.everyone.id,{ViewChannel:false,SendMessages:false}).catch(()=>{});
  await ch.permissionOverwrites.edit(role.id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false}).catch(()=>{});
}
async function handleSetCh(message, parts){
  if(!message.guild || !isAdmin(message.member)) return false;
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
    if(!isAdmin(message.member)) return;
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
    const es=await getSettings(message.guild.id), ech=es.level_channel&&message.guild.channels.cache.get(es.level_channel);
    if(ech) await ech.send(placeholders((es.xp_level_text||'🎉 [user] رسید به Level '+newLevel).replace('[level]',String(newLevel)), message.member,message.guild));
  }

  if(isBotOwner(message.author.id)){
    if(s.owner_relay_channel===message.channel.id){ await deleteInvocation(message); await message.channel.send(message.content); }
    if(s.custom_commands?.[cmd]) await message.channel.send(s.custom_commands[cmd]);
  }

  const {data:drops}=await supabase.from('drops').select('*').eq('guild_id',message.guild.id).eq('ended',false).eq('kind','text');
  for(const d of drops||[]) if(d.target_text && message.content.trim()===d.target_text){
    const {data:updated}=await supabase.from('drops').update({ended:true,winner_id:message.author.id}).eq('id',d.id).eq('ended',false).select().maybeSingle();
    if(updated){ await message.channel.send(`🏆 <@${message.author.id}> برنده Drop شد! متن برنده: **${d.target_text}**`); await logTo(message.guild,'drop_winner_log_channel',`🏆 Drop winner: ${message.author.tag}`); }
    break;
  }
});

async function endGiveaways(){
  const {data:rows}=await supabase.from('giveaways').select('*').eq('ended',false).lte('end_at',new Date().toISOString());
  for(const g of rows||[]){
    const {data:entries}=await supabase.from('giveaway_entries').select('user_id').eq('giveaway_id',g.id);
    const winner=entries?.length?entries[Math.floor(Math.random()*entries.length)].user_id:null;
    await supabase.from('giveaways').update({ended:true,winner_id:winner}).eq('id',g.id).eq('ended',false);
    const guild=client.guilds.cache.get(g.guild_id), ch=guild?.channels.cache.get(g.channel_id);
    if(ch) await ch.send(`🎉 Giveaway تمام شد!\n🎁 جایزه: **${g.prize}**\n🏆 ${winner?`برنده: <@${winner}>`:'شرکت‌کننده‌ای نبود.'}`);
    if(guild) await logTo(guild,'giveaway_winner_log_channel',`🎉 Giveaway winner | prize=${g.prize} | winner=${winner||'none'}`);
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
  if(panel.claim_enabled){
    const b=new ButtonBuilder().setCustomId(`claim:${ticketId}`).setLabel('Claim').setStyle(ButtonStyle.Primary);
    safeEmoji(b,panel.claim_emoji);
    row.addComponents(b);
  }
  if(panel.close_enabled){
    const b=new ButtonBuilder().setCustomId(`close:${ticketId}`).setLabel('Close').setStyle(ButtonStyle.Danger);
    safeEmoji(b,panel.close_emoji);
    row.addComponents(b);
  }
  return row.components.length?[row]:[];
}
async function createTicket(interaction,panel,answers={}){
  const existing=await supabase.from('tickets').select('id,channel_id').eq('guild_id',interaction.guild.id).eq('opener_id',interaction.user.id).eq('status','open').maybeSingle();
  if(existing.data) return interaction.reply({content:`تیکت فعال داری: <#${existing.data.channel_id}>`,ephemeral:true});
  const cat=panel.category_id && interaction.guild.channels.cache.get(panel.category_id)?.type===ChannelType.GuildCategory ? panel.category_id : undefined;
  const ticketRole=interaction.guild.roles.cache.find(r=>r.name===ACCESS.ticket);
  const overwrites=[
    {id:interaction.guild.roles.everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},
    {id:interaction.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]},
  ];
  if(ticketRole) overwrites.push({id:ticketRole.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.ReadMessageHistory],deny:[PermissionsBitField.Flags.SendMessages]});
  const channel=await interaction.guild.channels.create({name:`ticket-${interaction.user.username}`.slice(0,90),type:ChannelType.GuildText,parent:cat,permissionOverwrites:overwrites});
  const {data:t,error}=await supabase.from('tickets').insert({guild_id:interaction.guild.id,panel_id:panel.id,channel_id:channel.id,opener_id:interaction.user.id,category_id:cat||null,status:'open'}).select().single();
  if(error){ await channel.delete().catch(()=>{}); return interaction.reply({content:'خطا در ساخت Ticket.',ephemeral:true}); }
  if(Object.keys(answers).length) await supabase.from('ticket_answers').insert({ticket_id:t.id,answers});
  const mention=(panel.mention_roles||[]).map(id=>`<@&${id}>`).join(' ');
  await channel.send({content:`${mention}\n${placeholders(panel.welcome_text,interaction.member,interaction.guild)}`,components:ticketRows(t.id,panel)});
  await logTo(interaction.guild,'ticket_log_channel',`🎫 Ticket ایجاد شد | ${interaction.user.tag} | ${channel}`);
  return interaction.reply({content:`تیکت ساخته شد: ${channel}`,ephemeral:true});
}
async function getTicket(ch){ return (await supabase.from('tickets').select('*').eq('channel_id',ch.id).maybeSingle()).data; }
async function claimTicket(interaction,t){
  if(!t) return interaction.reply({content:'Ticket پیدا نشد.',ephemeral:true});
  if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
  if(t.status!=='open') return interaction.reply({content:'این Ticket بسته است.',ephemeral:true});
  if(t.claimed_by) return interaction.reply({content:`این Ticket قبلاً توسط <@${t.claimed_by}> Claim شده است.`,ephemeral:true});
  const {data:claimed,error}=await supabase.from('tickets').update({claimed_by:interaction.user.id}).eq('id',t.id).eq('status','open').is('claimed_by',null).select('id,claimed_by').maybeSingle();
   if(error || !claimed) { console.error('claim error:',error); return interaction.reply({content:'❌ این Ticket همین الان توسط شخص دیگری Claim شد یا Claim انجام نشد.',ephemeral:true}); }
  await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id,{ViewChannel:false});
  await interaction.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
  await interaction.channel.permissionOverwrites.edit(interaction.user.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
  return interaction.reply({content:`🎫 Ticket توسط <@${interaction.user.id}> Claim شد. فقط شما و صاحب تیکت امکان چت دارید.`,ephemeral:false});
}
async function closeTicket(interaction,t,reason){
  if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
  if(!t || t.status!=='open') return interaction.reply({content:'این Ticket قبلاً بسته شده یا پیدا نشد.',ephemeral:true});
  await interaction.deferReply({ephemeral:false});
  const closedAt=new Date().toISOString();
  const {data:closed,error:closeError}=await supabase.from('tickets').update({status:'closed',closed_at:closedAt}).eq('id',t.id).eq('status','open').select('id,status,opener_id,claimed_by').maybeSingle();
  if(closeError || !closed){
    console.error('ticket close error:',closeError);
    return interaction.editReply({content:'❌ بستن Ticket انجام نشد. اگر شخص دیگری همزمان آن را بسته باشد، Ticket دیگر باز نیست.'});
  }
  await interaction.channel.permissionOverwrites.edit(t.opener_id,{SendMessages:false,ViewChannel:true}).catch(()=>{});
  if(t.claimed_by) await interaction.channel.permissionOverwrites.edit(t.claimed_by,{SendMessages:false,ViewChannel:true}).catch(()=>{});
  const msgs=[]; const fetched=await interaction.channel.messages.fetch({limit:100}).catch(()=>null);
  if(fetched) for(const m of fetched.sort((a,b)=>a.createdTimestamp-b.createdTimestamp).values()) msgs.push(`[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content||'[attachment/embed]'}`);
  const transcript=`Ticket #${t.id}\nOpened by: ${t.opener_id}\nClaimed by: ${t.claimed_by||'none'}\nClosed by: ${interaction.user.id}\nReason: ${reason||'بدون دلیل'}\nClosed at: ${closedAt}\n\n--- Messages (latest 100) ---\n${msgs.join('\n')}`;
  await supabase.from('tickets').update({transcript}).eq('id',t.id);
  const feedbackRow=new ActionRowBuilder().addComponents([1,2,3,4,5].map(n=>new ButtonBuilder().setCustomId(`feedback:${t.id}:${n}`).setLabel(`${n} ⭐`).setStyle(ButtonStyle.Secondary)));
  const user=await interaction.guild.members.fetch(t.opener_id).catch(()=>null);
  let dmSent=false;
  if(user){
    dmSent=!!await user.send({content:`🎫 تیکت شما بسته شد. دلیل: ${reason||'بدون دلیل'}\nلطفاً امتیاز بده:`,components:[feedbackRow],allowedMentions:{parse:[]}}).then(()=>true).catch(err=>{ console.warn('ticket rating DM failed:',err?.message||err); return false; });
  }
  await logTo(interaction.guild,'ticket_log_channel',`🔒 Ticket بسته شد | ${interaction.channel.name} | توسط ${interaction.user.tag} | دلیل: ${reason||'بدون دلیل'}`);
  return interaction.editReply({content:dmSent?'تیکت بسته شد و Feedback برای صاحب تیکت ارسال شد.':'تیکت بسته شد، اما DM صاحب تیکت قابل ارسال نبود (احتمالاً DM بسته است).'});
}

client.on('interactionCreate',async interaction=>{
  try{
    if(interaction.isButton()){
      const [type,id,extra]=interaction.customId.split(':');
      if(type==='gw'){
        const {data:gw}=await supabase.from('giveaways').select('id,ended,end_at').eq('id',id).maybeSingle();
        if(!gw || gw.ended || new Date(gw.end_at)<=new Date()) return interaction.reply({content:'این Giveaway تمام شده است.',ephemeral:true});
        const {error}=await supabase.from('giveaway_entries').upsert({giveaway_id:id,user_id:interaction.user.id});
        return interaction.reply({content:error?'خطا در ثبت ورود.':'وارد Giveaway شدی ✅',ephemeral:true});
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
        if(panel.form_enabled && panel.form_questions?.length){
          const modal=new ModalBuilder().setCustomId(`ticketform:${panel.id}`).setTitle(`فرم ${String(panel.name).slice(0,40)}`);
          for(let i=0;i<Math.min(5,panel.form_questions.length);i++) modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`q${i}`).setLabel(String(panel.form_questions[i]).slice(0,45)).setStyle(TextInputStyle.Paragraph).setRequired(false)));
          return interaction.showModal(modal);
        }
        return createTicket(interaction,panel);
      }
      if(type==='exapprove'||type==='exreject'){
        if(!hasAccess(interaction.member,ACCESS.exchange)) return interaction.reply({content:'فقط رول Exchange می‌تواند این دکمه را استفاده کند.',ephemeral:true});
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
        const {error:feedbackInsertError}=await supabase.from('ticket_feedback').insert({ticket_id:id,user_id:interaction.user.id,stars});
        if(feedbackInsertError){ console.error('feedback insert error:',feedbackInsertError); return interaction.reply({content:'❌ ذخیره Rating انجام نشد. دوباره تلاش کنید.',ephemeral:true}); }
        const modal=new ModalBuilder().setCustomId(`feedbackmodal:${id}:${stars}`).setTitle(`${stars} ستاره`).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('feedback').setLabel('نظر شما').setStyle(TextInputStyle.Paragraph).setRequired(false)));
        return interaction.showModal(modal);
      }
    }
    if(interaction.isStringSelectMenu()){
      if(interaction.customId==='ticketmenu'){
        const panel=(await supabase.from('ticket_panels').select('*').eq('id',interaction.values[0]).maybeSingle()).data;
        if(!panel) return interaction.reply({content:'Panel پیدا نشد.',ephemeral:true});
        if(panel.form_enabled && panel.form_questions?.length){
          const modal=new ModalBuilder().setCustomId(`ticketform:${panel.id}`).setTitle(`فرم ${String(panel.name).slice(0,40)}`);
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
        const panel=(await supabase.from('ticket_panels').select('*').eq('id',interaction.customId.split(':')[1]).maybeSingle()).data;
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
          await logChannel.send({content:`${mentions}\n📥 **Exchange Request**\nUser: <@${interaction.user.id}>\n\n${banner}`,components:[row],allowedMentions:{users:[...logMentionUsers,interaction.user.id],parse:[]}});
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
    if(['giveaway','giveawaysv','dropmatn','dropclick'].includes(commandName)){
      if(!hasAccess(interaction.member,ACCESS.giveaway)) return interaction.reply({content:'دسترسی Giveaway نداری.',ephemeral:true});
      if(commandName==='giveaway'||commandName==='giveawaysv'){
        const prize=interaction.options.getString('prize'), minutes=duration(interaction.options.getInteger('minutes')); if(!minutes) return interaction.reply({content:'تایم باید بیشتر از صفر دقیقه باشد.',ephemeral:true});
        const link=commandName==='giveawaysv'?interaction.options.getString('link'):null;
        const {data:g,error:gError}=await supabase.from('giveaways').insert({guild_id:guild.id,channel_id:interaction.channel.id,prize,duration_minutes:minutes,end_at:new Date(Date.now()+minutes*60000).toISOString(),link}).select().single();
        if(gError || !g) { console.error('giveaway insert error:', gError); return interaction.reply({content:'❌ ساخت Giveaway در دیتابیس انجام نشد. تنظیمات Supabase را بررسی کنید.',ephemeral:true}); }
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gw:${g.id}`).setLabel('شرکت در Giveaway').setStyle(ButtonStyle.Success)); if(link) row.addComponents(new ButtonBuilder().setLabel('باز کردن لینک').setStyle(ButtonStyle.Link).setURL(link));
        const msg=await interaction.channel.send({content:`🎉 **Giveaway**\n🎁 جایزه: **${prize}**\n⏱️ زمان: **${fmt(minutes*60000)}**`,components:[row]});
        const {error:updateError}=await supabase.from('giveaways').update({message_id:msg.id}).eq('id',g.id); if(updateError) console.error('giveaway message update error:',updateError);
        await logTo(guild,'giveaway_create_log_channel',`🎉 Giveaway ساخته شد | ${interaction.user.tag} | ${prize}`); return interaction.reply({content:'Giveaway ساخته شد.',ephemeral:true});
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
      if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
      const qs=[0,1,2,3,4].map(i=>interaction.options.getString(`q${i+1}`)).filter(Boolean);
      const roles=interaction.options.getRole('mention_role');
      const {data:p,error:pError}=await supabase.from('ticket_panels').insert({guild_id:guild.id,name:interaction.options.getString('name'),welcome_text:interaction.options.getString('welcome')||'سلام [user]، تیکت شما ایجاد شد.',category_id:interaction.options.getChannel('category')?.id||null,mention_roles:roles?[roles.id]:[],claim_enabled:interaction.options.getBoolean('claim')??true,close_enabled:interaction.options.getBoolean('close')??true,button_name:interaction.options.getString('button_name')||'باز کردن تیکت',button_emoji:interaction.options.getString('button_emoji')||null,claim_emoji:interaction.options.getString('claim_emoji')||'🎫',close_emoji:interaction.options.getString('close_emoji')||'🔒',form_enabled:qs.length>0,form_questions:qs}).select().single();
      if(pError || !p){ console.error('panel insert error:',pError); return interaction.reply({content:'❌ ساخت Panel در دیتابیس انجام نشد.',ephemeral:true}); }
      const embed=new EmbedBuilder().setTitle(String(p.name).slice(0,256)).setDescription(interaction.options.getString('text')||'برای باز کردن تیکت روی دکمه زیر بزنید.');
       const openButton=new ButtonBuilder().setCustomId(`openpanel:${p.id}`).setLabel(interaction.options.getString('button_name')||'باز کردن تیکت').setStyle(ButtonStyle.Primary);
       safeEmoji(openButton,interaction.options.getString('button_emoji'));
       const row=new ActionRowBuilder().addComponents(openButton);
      const msg=await interaction.channel.send({embeds:[embed],components:[row]}); await supabase.from('ticket_panels').update({channel_id:interaction.channel.id,message_id:msg.id}).eq('id',p.id); return interaction.reply({content:'Panel ساخته شد.',ephemeral:true});
    }
    if(commandName==='deletepanel'){
      if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
      const panelId=interaction.options.getString('panel',true).trim();
      const {data:p,error:pError}=await supabase.from('ticket_panels').select('*').eq('id',panelId).eq('guild_id',guild.id).maybeSingle();
      if(pError){ console.error('deletepanel lookup error:',pError); return interaction.reply({content:'❌ خطا در پیدا کردن Panel.',ephemeral:true}); }
      if(!p) return interaction.reply({content:'❌ این Panel پیدا نشد. ID پنل را درست وارد کن.',ephemeral:true});
      if(p.channel_id && p.message_id){
        const ch=guild.channels.cache.get(p.channel_id);
        if(ch){ const msg=await ch.messages.fetch(p.message_id).catch(()=>null); if(msg) await msg.delete().catch(()=>{}); }
      }
      const {error:delError}=await supabase.from('ticket_panels').delete().eq('id',p.id).eq('guild_id',guild.id);
      if(delError){ console.error('deletepanel db error:',delError); return interaction.reply({content:'❌ حذف Panel از دیتابیس انجام نشد.',ephemeral:true}); }
      return interaction.reply({content:`✅ Panel **${String(p.name).slice(0,100)}** کامل حذف شد.`,ephemeral:true});
    }
    if(commandName==='menu'){
      if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
      const {data:panels}=await supabase.from('ticket_panels').select('*').eq('guild_id',guild.id).order('created_at',{ascending:true}).limit(25); if(!panels?.length) return interaction.reply({content:'اول Panel بساز.',ephemeral:true});
      const menu=new StringSelectMenuBuilder().setCustomId('ticketmenu').setPlaceholder(interaction.options.getString('placeholder')||'نوع تیکت را انتخاب کنید').addOptions(panels.map(p=>{ const o={label:String(p.name).slice(0,100),value:p.id,description:'باز کردن این پنل'}; if(p.button_emoji) o.emoji=String(p.button_emoji); return o; }));
       const menuTitle=interaction.options.getString('name')||'🎫 انتخاب نوع تیکت';
       const menuText=interaction.options.getString('text')||'نوع تیکت را انتخاب کنید:';
       return interaction.reply({content:`**${menuTitle}**\n${menuText}`,components:[new ActionRowBuilder().addComponents(menu)]});
    }
    if(commandName==='claim'){ const t=await getTicket(interaction.channel); if(!t) return interaction.reply({content:'Ticket نیست.',ephemeral:true}); return claimTicket(interaction,t); }
    if(commandName==='claimchange'){
      const t=await getTicket(interaction.channel); if(!t||!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی یا Ticket ندارید.',ephemeral:true}); const u=interaction.options.getUser('user');
      await supabase.from('tickets').update({claimed_by:u.id}).eq('id',t.id); await interaction.channel.permissionOverwrites.edit(interaction.user.id,{SendMessages:false}); await interaction.channel.permissionOverwrites.edit(u.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); await logTo(guild,'ticket_log_channel',`🔄 Claim Change | ${interaction.user.tag} → ${u.tag}`); return interaction.reply({content:`Claim به <@${u.id}> منتقل شد.`});
    }
    if(commandName==='add'||commandName==='remove'){
      const t=await getTicket(interaction.channel); if(!t||!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی یا Ticket ندارید.',ephemeral:true}); const u=interaction.options.getUser('user');
      if(commandName==='add'){
        await interaction.channel.permissionOverwrites.edit(u.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
        const {error}=await supabase.from('ticket_members').upsert({ticket_id:t.id,user_id:u.id,added_by:interaction.user.id});
        if(error) console.error('ticket add error:',error);
        return interaction.reply({content:`<@${u.id}> به Ticket اضافه شد.`});
      }
      await interaction.channel.permissionOverwrites.delete(u.id).catch(()=>{});
      await supabase.from('ticket_members').delete().eq('ticket_id',t.id).eq('user_id',u.id);
      return interaction.reply({content:`<@${u.id}> از Ticket حذف شد.`});
    }
    if(commandName==='close'){ if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true}); const t=await getTicket(interaction.channel); if(!t) return interaction.reply({content:'Ticket نیست.',ephemeral:true}); if(t.status!=='open') return interaction.reply({content:'این Ticket قبلاً بسته شده.',ephemeral:true}); const modal=new ModalBuilder().setCustomId(`closemodal:${t.id}`).setTitle('بستن تیکت').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('دلیل بستن').setStyle(TextInputStyle.Paragraph).setRequired(false))); return interaction.showModal(modal); }
    if(commandName==='reopen'){
      const t=await getTicket(interaction.channel); if(!t||!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی یا Ticket ندارید.',ephemeral:true}); await supabase.from('tickets').update({status:'open',closed_at:null}).eq('id',t.id); await interaction.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); if(t.claimed_by) await interaction.channel.permissionOverwrites.edit(t.claimed_by,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); await logTo(guild,'ticket_log_channel',`🔓 Ticket دوباره باز شد | ${interaction.user.tag}`); return interaction.reply({content:'Ticket دوباره باز شد.'});
    }
    if(commandName==='stats'){ if(!hasRoleOnly(interaction.member,ACCESS.staff)) return interaction.reply({content:'فقط رول Staff Manager می‌تواند آمار Claim را تنظیم کند.',ephemeral:true}); await setSettings(guild.id,{stats_channel:interaction.channel.id}); return interaction.reply({content:'این چنل برای گزارش Claim هر ۶ ساعت ذخیره شد.',ephemeral:true}); }

    if(['hire','rankup','rankdown','demote','warnstaff'].includes(commandName)){
      if(!hasRoleOnly(interaction.member,ACCESS.staff)) return interaction.reply({content:'فقط رول Staff Manager می‌تواند از دستورات Staff استفاده کند.',ephemeral:true});
      const target=interaction.options.getMember('user'); if(!target) return interaction.reply({content:'ممبر پیدا نشد.',ephemeral:true});
      const {data:ranks}=await supabase.from('staff_ranks').select('*').eq('guild_id',guild.id).order('position',{ascending:true});
      if(commandName==='hire'){
        const pos=interaction.options.getInteger('rank')||1; const r=(ranks||[]).find(x=>x.position===pos);
        if(!r) return interaction.reply({content:'این رنک تنظیم نشده.',ephemeral:true});
        const rankRole=guild.roles.cache.get(r.role_id), botMe=guild.members.me;
        if(!rankRole) return interaction.reply({content:'Role این رنک در سرور پیدا نشد.',ephemeral:true});
        if(botMe && botMe.roles.highest.position<=rankRole.position) return interaction.reply({content:'❌ رول این رنک بالاتر یا هم‌سطح رول بات است؛ اول رول بات را بالاتر ببر.',ephemeral:true});
        const roleError=await target.roles.add(rankRole).catch(e=>e);
        if(roleError instanceof Error) return interaction.reply({content:'❌ بات نتوانست رول Staff را بدهد؛ Hierarchy رول‌ها را بررسی کن.',ephemeral:true});
        for(const x of r.auto_roles||[]) await target.roles.add(x).catch(()=>{});
        const {error:staffError}=await supabase.from('staff_members').upsert({guild_id:guild.id,user_id:target.id,rank_position:pos,active:true});
        if(staffError){ console.error('staff hire db error:',staffError); await target.roles.remove(rankRole).catch(()=>{}); return interaction.reply({content:'❌ Hire در دیتابیس ثبت نشد؛ Staff فعال نشد.',ephemeral:true}); }
        await logTo(guild,'staff_hire_channel',`🟢 Hire | ${target.user.tag} | rank ${pos}`); return interaction.reply({content:`${target} به Staff اضافه شد.`});
      }
      let row=(await supabase.from('staff_members').select('*').eq('guild_id',guild.id).eq('user_id',target.id).eq('active',true).maybeSingle()).data;
      if(!row){
        const roleRank=(ranks||[]).find(r=>target.roles.cache.has(r.role_id));
        if(roleRank){
          const {data:fixed,error:fixError}=await supabase.from('staff_members').upsert({guild_id:guild.id,user_id:target.id,rank_position:roleRank.position,active:true}).select().maybeSingle();
          if(!fixError) row=fixed||{guild_id:guild.id,user_id:target.id,rank_position:roleRank.position,active:true};
        }
      }
      if(!row) return interaction.reply({content:'این شخص Staff نیست. اول /hire را اجرا کن.',ephemeral:true});
      if(commandName==='warnstaff'){ const {count}=await supabase.from('staff_warns').select('*',{count:'exact',head:true}).eq('guild_id',guild.id).eq('user_id',target.id); await supabase.from('staff_warns').insert({guild_id:guild.id,user_id:target.id,reason:interaction.options.getString('reason')||'بدون دلیل'}); const n=(count||0)+1; await logTo(guild,'staff_warn_channel',`⚠️ Staff Warn | ${target.user.tag} | ${n}/3`); if(n>=3) await removeStaff(guild,target,row,ranks); return interaction.reply({content:`Staff Warn ثبت شد (${n}/3).`}); }
      if(commandName==='demote'){ await removeStaff(guild,target,row,ranks); return interaction.reply({content:`${target} از Staff حذف شد.`}); }
      const delta=commandName==='rankup'? -1:1; const np=row.rank_position+delta; const nr=(ranks||[]).find(x=>x.position===np); if(!nr) return interaction.reply({content:'رنک بعدی وجود ندارد.',ephemeral:true}); const old=(ranks||[]).find(x=>x.position===row.rank_position); if(old) await target.roles.remove(old.role_id).catch(()=>{}); for(const x of old?.auto_roles||[]) await target.roles.remove(x).catch(()=>{}); await target.roles.add(nr.role_id).catch(()=>{}); for(const x of nr.auto_roles||[]) await target.roles.add(x).catch(()=>{}); const {error:rankDbError}=await supabase.from('staff_members').update({rank_position:np,active:true}).eq('guild_id',guild.id).eq('user_id',target.id); if(rankDbError){ console.error('rank update db error:',rankDbError); return interaction.reply({content:'❌ رنک در دیتابیس ذخیره نشد.',ephemeral:true}); } await logTo(guild,'staff_rank_channel',`🔄 ${commandName} | ${target.user.tag} | ${row.rank_position} → ${np}`); return interaction.reply({content:`رنک ${target} تغییر کرد.`});
    }
    if(commandName==='setrole'){
      if(!hasRoleOnly(interaction.member,ACCESS.staff)) return interaction.reply({content:'فقط رول Staff Manager می‌تواند رنک‌های Staff را تنظیم کند.',ephemeral:true});
      const raw=interaction.options.getString('roles')||'';
      const ids=[...raw.matchAll(/<@&?(\d+)>|\b(\d{15,25})\b/g)].map(m=>m[1]||m[2]);
      const roles=[...new Set(ids)].filter(id=>guild.roles.cache.has(id));
      if(!roles.length) return interaction.reply({content:'حداقل یک Role منشن کن.',ephemeral:true});
      const {error}=await supabase.from('staff_ranks').delete().eq('guild_id',guild.id); if(error) console.error(error);
      for(let i=0;i<roles.length;i++) await supabase.from('staff_ranks').insert({guild_id:guild.id,position:i+1,role_id:roles[i]});
      return interaction.reply({content:`${roles.length} رنک Staff ذخیره شد.`});
    }
    if(commandName==='setrolee'){
      if(!hasRoleOnly(interaction.member,ACCESS.staff)) return interaction.reply({content:'فقط رول Staff Manager می‌تواند Roleهای Staff را تنظیم کند.',ephemeral:true});
      const rank=interaction.options.getInteger('rank'), raw=interaction.options.getString('roles')||'';
      const ids=[...raw.matchAll(/<@&?(\d+)>|\b(\d{15,25})\b/g)].map(m=>m[1]||m[2]);
      const roles=[...new Set(ids)].filter(id=>guild.roles.cache.has(id));
      const {error}=await supabase.from('staff_ranks').update({auto_roles:roles}).eq('guild_id',guild.id).eq('position',rank); if(error) console.error(error);
      return interaction.reply({content:'Roleهای اضافه این رنک ذخیره شد.'});
    }
    if(['setfosh','deletefosh','whiteuser'].includes(commandName)){
      if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true});
      if(commandName==='setfosh'){ for(const w of interaction.options.getString('words').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)) await supabase.from('profanity_words').upsert({guild_id:guild.id,word:w}); }
      if(commandName==='deletefosh'){ for(const w of interaction.options.getString('words').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)) await supabase.from('profanity_words').delete().eq('guild_id',guild.id).eq('word',w); }
      if(commandName==='whiteuser'){ const u=interaction.options.getUser('user'); await supabase.from('profanity_whitelist').upsert({guild_id:guild.id,user_id:u.id}); }
      return interaction.reply({content:'تنظیمات فحش انجام شد.',ephemeral:true});
    }
    if(['kick','ban','timeout','warn'].includes(commandName)){
      if(!hasAccess(interaction.member,ACCESS.mod)) return interaction.reply({content:'دسترسی Moderation نداری.',ephemeral:true}); const m=interaction.options.getMember('user'), reason=interaction.options.getString('reason')||'بدون دلیل'; if(!m) return interaction.reply({content:'ممبر پیدا نشد.',ephemeral:true});
      if(commandName==='warn'){ const {count}=await supabase.from('member_warns').select('*',{count:'exact',head:true}).eq('guild_id',guild.id).eq('user_id',m.id); await supabase.from('member_warns').insert({guild_id:guild.id,user_id:m.id,reason}); const n=(count||0)+1; if(n>=3) await m.timeout(2*60*60*1000,'3 warnings').catch(()=>{}); await logTo(guild,'member_warn_log_channel',`⚠️ Warn | ${m.user.tag} | ${n}/3 | ${reason}`); return interaction.reply({content:`Warn ثبت شد (${n}/3).`}); }
      if(commandName==='kick') await m.kick(reason); if(commandName==='ban') await m.ban({reason}); if(commandName==='timeout') await m.timeout(2*60*60*1000,reason); await logTo(guild,'ban_kick_log_channel',`🛡️ ${commandName} | ${m.user.tag} | ${reason}`); return interaction.reply({content:`${commandName} انجام شد.`});
    }
    if(['unwarn','unwarnst','unban','untimeout'].includes(commandName)){
      if(commandName==='unwarnst'){
        if(!hasRoleOnly(interaction.member,ACCESS.staff)) return interaction.reply({content:'فقط رول Staff Manager می‌تواند Warn استف را کم کند.',ephemeral:true});
      } else if(!hasAccess(interaction.member,ACCESS.mod)) return interaction.reply({content:'دسترسی Moderation نداری.',ephemeral:true});
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
      const table=commandName==='unwarn'?'member_warns':'staff_warns';
      const m=interaction.options.getMember('user'); if(!m) return interaction.reply({content:'ممبر پیدا نشد.',ephemeral:true});
      const {data:last,error:findError}=await supabase.from(table).select('id').eq('guild_id',guild.id).eq('user_id',m.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(findError || !last) return interaction.reply({content:'⚠️ برای این کاربر Warn ثبت‌شده‌ای پیدا نشد.',ephemeral:true});
      const {error:delError}=await supabase.from(table).delete().eq('id',last.id);
      if(delError) return interaction.reply({content:'❌ حذف Warn انجام نشد.',ephemeral:true});
      const {count}=await supabase.from(table).select('*',{count:'exact',head:true}).eq('guild_id',guild.id).eq('user_id',m.id);
      const logKey=commandName==='unwarn'?'member_warn_log_channel':'staff_warn_channel';
      await logTo(guild,logKey,`🔓 ${commandName} | ${m.user.tag} | وارن باقی‌مانده: ${count||0} | توسط ${interaction.user.tag}`);
      return interaction.reply({content:`یک Warn از ${m} کم شد. وارن باقی‌مانده: ${count||0}`});
    }
    if(commandName==='setrolexp'){
      if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await supabase.from('xp_roles').upsert({guild_id:guild.id,level:interaction.options.getInteger('level'),role_id:interaction.options.getRole('role').id}); return interaction.reply({content:'Role XP ذخیره شد.'});
    }
    if(commandName==='setxp'){
      if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); const u=interaction.options.getUser('user'), amount=interaction.options.getInteger('amount'); const old=(await supabase.from('xp_users').select('*').eq('guild_id',guild.id).eq('user_id',u.id).maybeSingle()).data||{xp:0,level:0}; const xp=old.xp+amount, level=Math.floor(xp/10); await supabase.from('xp_users').upsert({guild_id:guild.id,user_id:u.id,xp,level}); return interaction.reply({content:`${amount} پیام به ${u} اضافه شد.`});
    }
    if(commandName==='leaderboard'){
      const {data:users}=await supabase.from('xp_users').select('*').eq('guild_id',guild.id).order('xp',{ascending:false}).limit(10); const e=new EmbedBuilder().setTitle('🏆 XP Leaderboard').setDescription((users||[]).map((x,i)=>`${i+1}. <@${x.user_id}> — Level ${x.level} | ${x.xp} XP`).join('\n')||'خالی'); return interaction.reply({embeds:[e]});
    }
    if(commandName==='textowner'){
      if(!isBotOwner(interaction.user.id) && !isAdmin(interaction.member)) return interaction.reply({content:'فقط Owner/Administrator.',ephemeral:true}); const ch=interaction.options.getChannel('channel'); await setSettings(guild.id,{owner_relay_channel:ch.id}); return interaction.reply({content:`Relay در ${ch} فعال شد.`});
    }
    if(commandName==='untextowner'){
      if(!isBotOwner(interaction.user.id) && !isAdmin(interaction.member)) return interaction.reply({content:'فقط Owner/Administrator.',ephemeral:true});
      await setSettings(guild.id,{owner_relay_channel:null});
      return interaction.reply({content:'پیام‌های Owner دیگر توسط بات Relay نمی‌شوند.',ephemeral:true});
    }
    if(commandName==='createcmd'){
      if(!isBotOwner(interaction.user.id) && !isAdmin(interaction.member)) return interaction.reply({content:'فقط Owner/Administrator.',ephemeral:true}); const s=await getSettings(guild.id); const cc=s.custom_commands||{}; cc[interaction.options.getString('keyword').toLowerCase()]=interaction.options.getString('text'); await setSettings(guild.id,{custom_commands:cc}); return interaction.reply({content:'Custom command ذخیره شد.'});
    }
    if(commandName==='exchange'){
      const modal=new ModalBuilder().setCustomId('exchange').setTitle('Exchange Form').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('banner').setLabel('اطلاعات / بنر اکسچنج').setStyle(TextInputStyle.Paragraph).setRequired(true))); return interaction.showModal(modal);
    }
    if(commandName==='banner'){ const s=await getSettings(guild.id); if(!s.server_banner) return interaction.reply({content:'بنر هنوز تنظیم نشده.',ephemeral:true}); return interaction.reply({content:s.server_banner}); }
    if(commandName==='setbanner'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await setSettings(guild.id,{server_banner:interaction.options.getString('banner')}); return interaction.reply({content:'بنر ذخیره شد.'}); }
    if(commandName==='settextxp'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await setSettings(guild.id,{xp_level_text:interaction.options.getString('text')}); return interaction.reply({content:'متن Level Up ذخیره شد.'}); }
    if(commandName==='level'){ const u=(await supabase.from('xp_users').select('*').eq('guild_id',guild.id).eq('user_id',interaction.user.id).maybeSingle()).data||{xp:0,level:0}; return interaction.reply({content:`⭐ Level: ${u.level} | تعداد پیام: ${u.xp}`}); }
    if(commandName==='settextwel'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await setSettings(guild.id,{welcome_text:interaction.options.getString('text')}); return interaction.reply({content:'متن Welcome ذخیره شد.'}); }
    if(commandName==='settextinc'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await setSettings(guild.id,{invite_text:interaction.options.getString('text')}); return interaction.reply({content:'متن Invite ذخیره شد.'}); }
    if(commandName==='setex'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await setSettings(guild.id,{exchange_channel:interaction.options.getChannel('channel').id}); return interaction.reply({content:'چنل Exchange ذخیره شد.'}); }
    if(commandName==='setexlog'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); const ch=interaction.options.getChannel('channel'); await setSettings(guild.id,{exchange_log_channel:ch.id}); return interaction.reply({content:`Exchange Log روی ${ch} تنظیم شد.`}); }
    if(commandName==='setrate'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); const ch=interaction.options.getChannel('channel'); await setSettings(guild.id,{ticket_feedback_channel:ch.id}); return interaction.reply({content:`Rating Channel روی ${ch} تنظیم شد.`}); }
  }catch(e){ console.error(e); if(!interaction.replied&&!interaction.deferred) await interaction.reply({content:'❌ خطایی رخ داد. کنسول VPS را بررسی کنید.',ephemeral:true}).catch(()=>{}); }
});

client.on('guildMemberAdd',async member=>{
  const s=await getSettings(member.guild.id);
  if(s.welcome_channel){ const ch=member.guild.channels.cache.get(s.welcome_channel); if(ch) await ch.send(placeholders(s.welcome_text||'خوش آمدی [user] ❤️\nتعداد اعضا: [Number]',member,member.guild)); }
  const before=inviteCache.get(member.guild.id)||new Map(), after=await member.guild.invites.fetch().catch(()=>new Map());
  let used=null; for(const i of after.values()){ if((i.uses||0)>(before.get(i.code)||0)){used=i;break;} }
  await cacheInvites(member.guild).catch(()=>{});
  if(used){ await supabase.from('invite_stats').upsert({guild_id:member.guild.id,inviter_id:used.inviter?.id||'unknown',invited_id:member.id}); const {count}=await supabase.from('invite_stats').select('*',{count:'exact',head:true}).eq('guild_id',member.guild.id).eq('inviter_id',used.inviter?.id||'unknown'); if(s.invite_log_channel){ const ch=member.guild.channels.cache.get(s.invite_log_channel); if(ch) await ch.send(placeholders(s.invite_text||'👋 [user] با دعوت <inv> وارد شد. تعداد دعوت: [invnum]',member,member.guild,used.inviter?.id||'',count||0).replace('[inv]',used.inviter?.id||'')); } }
});
client.on('voiceStateUpdate',async(oldS,newS)=>{ if(!newS.guild) return; if(!oldS.channelId&&newS.channelId) await logTo(newS.guild,'voice_log_channel',`🔊 <@${newS.id}> وارد ${newS.channel?.name} شد.`); else if(oldS.channelId&&!newS.channelId) await logTo(newS.guild,'voice_log_channel',`🔇 <@${newS.id}> از ${oldS.channel?.name} خارج شد.`); });
client.on('messageDelete',async m=>{ if(m.guild&&!m.author?.bot) await logTo(m.guild,'message_log_channel',`🗑️ پیام حذف شد | ${m.author?.tag||'نامشخص'} | ${m.content||'بدون متن'}`); });
client.on('messageUpdate',async(oldM,newM)=>{ if(oldM.guild&&oldM.content!==newM.content&&!newM.author?.bot) await logTo(oldM.guild,'message_log_channel',`✏️ پیام ویرایش شد | ${newM.author?.tag||'نامشخص'}\nقبل: ${oldM.content||''}\nبعد: ${newM.content||''}`); });
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
async function removeStaff(guild,target,row,ranks){ const r=ranks.find(x=>x.position===row.rank_position); if(r) await target.roles.remove(r.role_id).catch(()=>{}); for(const x of r?.auto_roles||[]) await target.roles.remove(x).catch(()=>{}); await supabase.from('staff_members').update({active:false}).eq('guild_id',guild.id).eq('user_id',target.id); await logTo(guild,'staff_hire_channel',`🔴 Demote خودکار | ${target.user.tag}`); }

process.on('unhandledRejection', e => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', e => console.error('UNCAUGHT EXCEPTION:', e));

client.login(process.env.DISCORD_TOKEN);
