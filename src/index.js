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
  giveaway: 'Giveway Acces', ticket: 'Ticket Acces', staff: 'Staff Acces', mod: 'Ban/Kick Acces', logs: 'Logs', exchange: 'Exchange'
};
const ownerIds = () => String(process.env.OWNER_ID || '').split(',').map(x => x.trim()).filter(Boolean);
const isOwner = userId => ownerIds().includes(String(userId));
const client = new Client({ intents:[
  GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildInvites
], partials:[Partials.Channel] });

const isAdmin = m => !!m?.permissions?.has(ADMIN);
const hasAccess = (m, role) => isAdmin(m) || !!m?.roles?.cache?.some(r=>r.name===role);
const clean = s => String(s||'').replace(/`/g,'').trim();
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
  setInterval(endGiveaways,10000); setInterval(showStats,3600000);
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
    const hit=(words||[]).find(x=>x.word && message.content.toLowerCase().includes(x.word));
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
  const newXp=xpRow.xp+1, newLevel=Math.floor(newXp/100);
  if(newXp!==xpRow.xp) await supabase.from('xp_users').upsert({guild_id:message.guild.id,user_id:message.author.id,xp:newXp,level:newLevel});
  if(newLevel>xpRow.level){
    const {data:er}=await supabase.from('xp_roles').select('*').eq('guild_id',message.guild.id).eq('level',newLevel).maybeSingle();
    if(er) await message.member.roles.add(er.role_id).catch(()=>{});
    const es=await getSettings(message.guild.id), ech=es.level_channel&&message.guild.channels.cache.get(es.level_channel);
    if(ech) await ech.send(placeholders(es.xp_level_text||'🎉 [user] رسید به Level '+newLevel, message.member,message.guild));
  }

  if(isOwner(message.author.id)){
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
  if(panel.claim_enabled) row.addComponents(new ButtonBuilder().setCustomId(`claim:${ticketId}`).setLabel('Claim').setStyle(ButtonStyle.Primary));
  if(panel.close_enabled) row.addComponents(new ButtonBuilder().setCustomId(`close:${ticketId}`).setLabel('Close').setStyle(ButtonStyle.Danger));
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
  if(t.status!=='open') return interaction.reply({content:'این Ticket بسته است.',ephemeral:true});
  if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
  if(t.claimed_by && t.claimed_by!==interaction.user.id) return interaction.reply({content:`این Ticket قبلاً توسط <@${t.claimed_by}> Claim شده است.`,ephemeral:true});
  const {error}=await supabase.from('tickets').update({claimed_by:interaction.user.id}).eq('id',t.id); if(error) throw error;
  await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id,{ViewChannel:false});
  await interaction.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
  await interaction.channel.permissionOverwrites.edit(interaction.user.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
  return interaction.reply({content:`🎫 Ticket توسط <@${interaction.user.id}> Claim شد. فقط شما و صاحب تیکت امکان چت دارید.`,ephemeral:false});
}
async function closeTicket(interaction,t,reason){
  if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
  await supabase.from('tickets').update({status:'closed',closed_at:new Date().toISOString()}).eq('id',t.id);
  await interaction.channel.permissionOverwrites.edit(t.opener_id,{SendMessages:false,ViewChannel:true});
  if(t.claimed_by) await interaction.channel.permissionOverwrites.edit(t.claimed_by,{SendMessages:false,ViewChannel:true});
  const msgs=[]; const fetched=await interaction.channel.messages.fetch({limit:100}).catch(()=>null); if(fetched) for(const m of fetched.sort((a,b)=>a.createdTimestamp-b.createdTimestamp).values()) msgs.push(`[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content||'[attachment/embed]'}`);
  const transcript=`Ticket #${t.id}\nOpened by: ${t.opener_id}\nClaimed by: ${t.claimed_by||'none'}\nClosed by: ${interaction.user.id}\nReason: ${reason||'بدون دلیل'}\nClosed at: ${new Date().toISOString()}\n\n--- Messages (latest 100) ---\n${msgs.join('\n')}`;
  await supabase.from('tickets').update({transcript}).eq('id',t.id);
  const file=new AttachmentBuilder(Buffer.from(transcript,'utf8'),{name:`ticket-${t.id}.txt`});
  const s=await getSettings(interaction.guild.id), fb=s.ticket_feedback_channel && interaction.guild.channels.cache.get(s.ticket_feedback_channel);
  const feedbackRow=new ActionRowBuilder().addComponents([1,2,3,4,5].map(n=>new ButtonBuilder().setCustomId(`feedback:${t.id}:${n}`).setLabel(`${n} ⭐`).setStyle(ButtonStyle.Secondary)));
  if(fb) await fb.send({content:`📝 Feedback برای Ticket ${t.id} — <@${t.opener_id}>`,files:[file]}).catch(()=>{});
  const user=await interaction.guild.members.fetch(t.opener_id).catch(()=>null);
  if(user) await user.send({content:`🎫 تیکت شما بسته شد. دلیل: ${reason||'بدون دلیل'}\nلطفاً امتیاز بده:`,components:[feedbackRow]}).catch(()=>{});
  await logTo(interaction.guild,'ticket_log_channel',`🔒 Ticket بسته شد | ${interaction.channel.name} | توسط ${interaction.user.tag} | دلیل: ${reason||'بدون دلیل'}`);
  return interaction.reply({content:'تیکت بسته شد و Feedback برای صاحب تیکت ارسال شد.',ephemeral:false});
}

client.on('interactionCreate',async interaction=>{
  try{
    if(interaction.isButton()){
      const [type,id,extra]=interaction.customId.split(':');
      if(type==='gw'){
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
          const modal=new ModalBuilder().setCustomId(`ticketform:${panel.id}`).setTitle(`فرم ${panel.name}`);
          for(let i=0;i<Math.min(5,panel.form_questions.length);i++) modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`q${i}`).setLabel(String(panel.form_questions[i]).slice(0,45)).setStyle(TextInputStyle.Paragraph).setRequired(false)));
          return interaction.showModal(modal);
        }
        return createTicket(interaction,panel);
      }
      if(type==='exapprove'||type==='exreject'){
        if(!hasAccess(interaction.member,ACCESS.exchange)) return interaction.reply({content:'فقط رول Exchange دسترسی دارد.',ephemeral:true});
        const status=type==='exapprove'?'approved':'rejected';
        const {data:e}=await supabase.from('exchange_requests').update({status,reviewer_id:interaction.user.id}).eq('id',id).eq('status','pending').select().maybeSingle();
        if(!e) return interaction.reply({content:'این درخواست قبلاً بررسی شده.',ephemeral:true});
        await interaction.message.edit({content:`${interaction.message.content}

${status==='approved'?'✅ تایید شد':'❌ رد شد'} توسط <@${interaction.user.id}>`,components:[]});
        if(status==='approved'){ const s=await getSettings(interaction.guild.id), ch=s.exchange_channel && interaction.guild.channels.cache.get(s.exchange_channel); if(ch) await ch.send(`✅ Exchange تایید شد
کاربر: <@${e.user_id}>

${e.banner}`); }
        return interaction.reply({content:status==='approved'?'تایید شد.':'رد شد.',ephemeral:true});
      }
      if(type==='claim') return claimTicket(interaction,await getTicket(interaction.channel));
      if(type==='close'){
        const t=await getTicket(interaction.channel); if(!t) return interaction.reply({content:'Ticket نیست.',ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`closemodal:${t.id}`).setTitle('بستن تیکت').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('دلیل بستن').setStyle(TextInputStyle.Paragraph).setRequired(false)));
        return interaction.showModal(modal);
      }
      if(type==='feedback'){
        const stars=Number(extra); const t=await supabase.from('tickets').select('*').eq('id',id).maybeSingle();
        if(!t.data) return interaction.reply({content:'Ticket پیدا نشد.',ephemeral:true});
        await supabase.from('ticket_feedback').upsert({ticket_id:id,user_id:interaction.user.id,stars},{onConflict:'ticket_id,user_id'});
        const modal=new ModalBuilder().setCustomId(`feedbackmodal:${id}:${stars}`).setTitle(`${stars} ستاره`).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('feedback').setLabel('نظر شما').setStyle(TextInputStyle.Paragraph).setRequired(false)));
        return interaction.showModal(modal);
      }
    }
    if(interaction.isStringSelectMenu()){
      if(interaction.customId==='ticketmenu'){
        const panel=(await supabase.from('ticket_panels').select('*').eq('id',interaction.values[0]).maybeSingle()).data;
        if(!panel) return interaction.reply({content:'Panel پیدا نشد.',ephemeral:true});
        if(panel.form_enabled && panel.form_questions?.length){
          const modal=new ModalBuilder().setCustomId(`ticketform:${panel.id}`).setTitle(`فرم ${panel.name}`);
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
        await supabase.from('ticket_feedback').update({text}).eq('ticket_id',id).eq('user_id',interaction.user.id).eq('stars',Number(stars));
        const t=(await supabase.from('tickets').select('guild_id,claimed_by').eq('id',id).maybeSingle()).data;
        if(t){ const feedbackGuild=client.guilds.cache.get(t.guild_id); if(feedbackGuild) await logTo(feedbackGuild,'ticket_feedback_channel',`⭐ Feedback ${stars}/5 | ${interaction.user.tag}\n${text||'بدون متن'}`); }
        return interaction.reply({content:'ممنون بابت Feedback ❤️',ephemeral:true});
      }
      if(interaction.customId.startsWith('ticketform:')){
        const panel=(await supabase.from('ticket_panels').select('*').eq('id',interaction.customId.split(':')[1]).maybeSingle()).data;
        const answers={}; for(let i=0;i<5;i++){ try{answers[`q${i}`]=interaction.fields.getTextInputValue(`q${i}`);}catch{} }
        return createTicket(interaction,panel,answers);
      }
      if(interaction.customId==='exchange'){
        const banner=interaction.fields.getTextInputValue('banner');
        const {data:e}=await supabase.from('exchange_requests').insert({guild_id:interaction.guild.id,user_id:interaction.user.id,banner}).select().single();
        const s=await getSettings(interaction.guild.id), ch=s.exchange_channel && interaction.guild.channels.cache.get(s.exchange_channel);
        if(ch) await ch.send({content:`📥 Exchange #${e.id}\nمن: <@${interaction.user.id}>\n\n${banner}`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`exapprove:${e.id}`).setLabel('تایید').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`exreject:${e.id}`).setLabel('رد').setStyle(ButtonStyle.Danger))]});
        return interaction.reply({content:'فرم ارسال شد.',ephemeral:true});
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
        const {data:g}=await supabase.from('giveaways').insert({guild_id:guild.id,channel_id:interaction.channel.id,prize,duration_minutes:minutes,end_at:new Date(Date.now()+minutes*60000).toISOString(),link}).select().single();
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gw:${g.id}`).setLabel('شرکت در Giveaway').setStyle(ButtonStyle.Success)); if(link) row.addComponents(new ButtonBuilder().setLabel('باز کردن لینک').setStyle(ButtonStyle.Link).setURL(link));
        const msg=await interaction.channel.send({content:`🎉 **Giveaway**\n🎁 جایزه: **${prize}**\n⏱️ زمان: **${fmt(minutes*60000)}**`,components:[row]}); await supabase.from('giveaways').update({message_id:msg.id}).eq('id',g.id);
        await logTo(guild,'giveaway_create_log_channel',`🎉 Giveaway ساخته شد | ${interaction.user.tag} | ${prize}`); return interaction.reply({content:'Giveaway ساخته شد.',ephemeral:true});
      }
      if(commandName==='dropmatn'||commandName==='dropclick'){
        const target=commandName==='dropmatn'?interaction.options.getString('text'):null;
        const {data:d}=await supabase.from('drops').insert({guild_id:guild.id,channel_id:interaction.channel.id,kind:commandName==='dropmatn'?'text':'click',target_text:target}).select().single();
        const row=commandName==='dropclick'?new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`drop:${d.id}`).setLabel('کلیک کن و برنده شو').setStyle(ButtonStyle.Success)):undefined;
        const msg=await interaction.channel.send({content:commandName==='dropmatn'?`⚡ **Drop شروع شد!**\n🏆 اولین کسی که بگه: **${target}** برنده میشه!`:`⚡ **Drop شروع شد!**\n🏆 اولین نفری که دکمه رو بزنه برنده میشه!`,components:row?[row]:[]}); await supabase.from('drops').update({message_id:msg.id}).eq('id',d.id); await logTo(guild,'drop_create_log_channel',`⚡ Drop ساخته شد | ${interaction.user.tag}`); return interaction.reply({content:'Drop ساخته شد.',ephemeral:true});
      }
    }
    if(commandName==='panel'){
      if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
      const qs=[0,1,2,3,4].map(i=>interaction.options.getString(`q${i+1}`)).filter(Boolean);
      const roles=interaction.options.getRole('mention_role');
      const {data:p}=await supabase.from('ticket_panels').insert({guild_id:guild.id,name:interaction.options.getString('name'),welcome_text:interaction.options.getString('welcome')||'سلام [user]، تیکت شما ایجاد شد.',category_id:interaction.options.getChannel('category')?.id||null,mention_roles:roles?[roles.id]:[],claim_enabled:interaction.options.getBoolean('claim')??true,close_enabled:interaction.options.getBoolean('close')??true,form_enabled:qs.length>0,form_questions:qs}).select().single();
      const embed=new EmbedBuilder().setTitle(p.name).setDescription(interaction.options.getString('text')||'برای باز کردن تیکت روی دکمه زیر بزنید.'); const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`openpanel:${p.id}`).setLabel('باز کردن تیکت').setStyle(ButtonStyle.Primary));
      const msg=await interaction.channel.send({embeds:[embed],components:[row]}); await supabase.from('ticket_panels').update({channel_id:interaction.channel.id,message_id:msg.id}).eq('id',p.id); return interaction.reply({content:'Panel ساخته شد.',ephemeral:true});
    }
    if(commandName==='menu'){
      if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
      const {data:panels}=await supabase.from('ticket_panels').select('*').eq('guild_id',guild.id).order('created_at',{ascending:true}).limit(25); if(!panels?.length) return interaction.reply({content:'اول Panel بساز.',ephemeral:true});
      const menu=new StringSelectMenuBuilder().setCustomId('ticketmenu').setPlaceholder('نوع تیکت را انتخاب کنید').addOptions(panels.map(p=>({label:p.name.slice(0,100),value:p.id,description:'باز کردن این پنل'}))); return interaction.reply({content:'🎫 نوع تیکت را انتخاب کنید:',components:[new ActionRowBuilder().addComponents(menu)]});
    }
    if(commandName==='claim'){ const t=await getTicket(interaction.channel); if(!t) return interaction.reply({content:'Ticket نیست.',ephemeral:true}); return claimTicket(interaction,t); }
    if(commandName==='claimchange'){
      const t=await getTicket(interaction.channel); if(!t||!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی یا Ticket ندارید.',ephemeral:true}); const u=interaction.options.getUser('user');
      const staff=(await supabase.from('staff_members').select('user_id').eq('guild_id',guild.id).eq('user_id',u.id).eq('active',true).maybeSingle()).data;
      if(!staff && !isAdmin(interaction.member)) return interaction.reply({content:'کاربر مقصد Staff فعال نیست.',ephemeral:true});
      const oldClaim=t.claimed_by;
      const {error}=await supabase.from('tickets').update({claimed_by:u.id}).eq('id',t.id); if(error) throw error;
      if(oldClaim && oldClaim!==u.id) await interaction.channel.permissionOverwrites.edit(oldClaim,{SendMessages:false,ViewChannel:true,ReadMessageHistory:true});
      await interaction.channel.permissionOverwrites.edit(u.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); await logTo(guild,'ticket_log_channel',`🔄 Claim Change | ${interaction.user.tag} → ${u.tag}`); return interaction.reply({content:`Claim به <@${u.id}> منتقل شد.`});
    }
    if(commandName==='add'||commandName==='remove'){
      const t=await getTicket(interaction.channel); if(!t||!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی یا Ticket ندارید.',ephemeral:true}); const u=interaction.options.getUser('user');
      if(commandName==='add'){
        await interaction.channel.permissionOverwrites.edit(u.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
        const {error}=await supabase.from('ticket_members').upsert({ticket_id:t.id,user_id:u.id,added_by:interaction.user.id});
        if(error) throw error;
        return interaction.reply({content:`<@${u.id}> به Ticket اضافه شد.`});
      }
      await interaction.channel.permissionOverwrites.delete(u.id).catch(()=>{});
      const {error}=await supabase.from('ticket_members').delete().eq('ticket_id',t.id).eq('user_id',u.id); if(error) throw error;
      return interaction.reply({content:`<@${u.id}> از Ticket حذف شد.`});
    }
    if(commandName==='close'){ const t=await getTicket(interaction.channel); if(!t) return interaction.reply({content:'Ticket نیست.',ephemeral:true}); const modal=new ModalBuilder().setCustomId(`closemodal:${t.id}`).setTitle('بستن تیکت').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('دلیل بستن').setStyle(TextInputStyle.Paragraph).setRequired(false))); return interaction.showModal(modal); }
    if(commandName==='reopen'){
      const t=await getTicket(interaction.channel); if(!t||!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی یا Ticket ندارید.',ephemeral:true}); await supabase.from('tickets').update({status:'open',closed_at:null}).eq('id',t.id); await interaction.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); if(t.claimed_by) await interaction.channel.permissionOverwrites.edit(t.claimed_by,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); await logTo(guild,'ticket_log_channel',`🔓 Ticket دوباره باز شد | ${interaction.user.tag}`); return interaction.reply({content:'Ticket دوباره باز شد.'});
    }
    if(commandName==='stats'){ if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true}); await setSettings(guild.id,{stats_channel:interaction.channel.id}); return interaction.reply({content:'این چنل برای آمار ساعتی Claim ذخیره شد.',ephemeral:true}); }

    if(['hire','rankup','rankdown','demote','warnstaff'].includes(commandName)){
      if(!hasAccess(interaction.member,ACCESS.staff)) return interaction.reply({content:'دسترسی Staff نداری.',ephemeral:true});
      const target=interaction.options.getMember('user'); if(!target) return interaction.reply({content:'ممبر پیدا نشد.',ephemeral:true});
      const {data:ranks}=await supabase.from('staff_ranks').select('*').eq('guild_id',guild.id).order('position',{ascending:true});
      if(commandName==='hire'){ const pos=interaction.options.getInteger('rank')||1; const r=(ranks||[]).find(x=>x.position===pos); if(!r) return interaction.reply({content:'این رنک تنظیم نشده.',ephemeral:true}); const staffRole=await ensureRole(guild,ACCESS.staff); await target.roles.add(staffRole.id).catch(()=>{}); await target.roles.add(r.role_id).catch(()=>{}); for(const x of r.auto_roles||[]) await target.roles.add(x).catch(()=>{}); await supabase.from('staff_members').upsert({guild_id:guild.id,user_id:target.id,rank_position:pos,active:true}); await logTo(guild,'staff_hire_channel',`🟢 Hire | ${target.user.tag} | rank ${pos}`); return interaction.reply({content:`${target} به Staff اضافه شد.`}); }
      const row=(await supabase.from('staff_members').select('*').eq('guild_id',guild.id).eq('user_id',target.id).eq('active',true).maybeSingle()).data; if(!row) return interaction.reply({content:'این شخص Staff نیست.',ephemeral:true});
      if(commandName==='warnstaff'){ const {count}=await supabase.from('staff_warns').select('*',{count:'exact',head:true}).eq('guild_id',guild.id).eq('user_id',target.id); await supabase.from('staff_warns').insert({guild_id:guild.id,user_id:target.id,reason:interaction.options.getString('reason')||'بدون دلیل'}); const n=(count||0)+1; await logTo(guild,'staff_warn_channel',`⚠️ Staff Warn | ${target.user.tag} | ${n}/3`); if(n>=3) await removeStaff(guild,target,row,ranks); return interaction.reply({content:`Staff Warn ثبت شد (${n}/3).`}); }
      if(commandName==='demote'){ await removeStaff(guild,target,row,ranks); return interaction.reply({content:`${target} از Staff حذف شد.`}); }
      const delta=commandName==='rankup'? -1:1; const np=row.rank_position+delta; const nr=(ranks||[]).find(x=>x.position===np); if(!nr) return interaction.reply({content:'رنک بعدی وجود ندارد.',ephemeral:true}); const old=(ranks||[]).find(x=>x.position===row.rank_position); if(old) await target.roles.remove(old.role_id).catch(()=>{}); for(const x of old?.auto_roles||[]) await target.roles.remove(x).catch(()=>{}); await target.roles.add(nr.role_id).catch(()=>{}); for(const x of nr.auto_roles||[]) await target.roles.add(x).catch(()=>{}); await supabase.from('staff_members').update({rank_position:np}).eq('guild_id',guild.id).eq('user_id',target.id); await logTo(guild,'staff_rank_channel',`🔄 ${commandName} | ${target.user.tag} | ${row.rank_position} → ${np}`); return interaction.reply({content:`رنک ${target} تغییر کرد.`});
    }
    if(commandName==='setrole'){
      if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true});
      const raw=interaction.options.getString('roles')||''; const roles=[...raw.matchAll(/<@&(\d+)>/g)].map(m=>m[1]).filter((id,i,a)=>a.indexOf(id)===i).slice(0,25);
      if(!roles.length) return interaction.reply({content:'حداقل یک Role را با @mention وارد کن.',ephemeral:true});
      const {error:delError}=await supabase.from('staff_ranks').delete().eq('guild_id',guild.id); if(delError) throw delError;
      for(let i=0;i<roles.length;i++){ const {error}=await supabase.from('staff_ranks').insert({guild_id:guild.id,position:i+1,role_id:roles[i]}); if(error) throw error; }
      return interaction.reply({content:`${roles.length} رنک Staff ذخیره شد.`});
    }
    if(commandName==='setrolee'){
      if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); const rank=interaction.options.getInteger('rank');
      const raw=interaction.options.getString('roles')||''; const roles=[...raw.matchAll(/<@&(\d+)>/g)].map(m=>m[1]).filter((id,i,a)=>a.indexOf(id)===i).slice(0,24);
      const {data:rankRow}=await supabase.from('staff_ranks').select('id').eq('guild_id',guild.id).eq('position',rank).maybeSingle(); if(!rankRow) return interaction.reply({content:'این Rank هنوز با /setrole ساخته نشده.',ephemeral:true});
      const {error}=await supabase.from('staff_ranks').update({auto_roles:roles}).eq('guild_id',guild.id).eq('position',rank); if(error) throw error; return interaction.reply({content:'Roleهای اضافه این رنک ذخیره شد.'});
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
    if(commandName==='setrolexp'){
      if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await supabase.from('xp_roles').upsert({guild_id:guild.id,level:interaction.options.getInteger('level'),role_id:interaction.options.getRole('role').id}); return interaction.reply({content:'Role XP ذخیره شد.'});
    }
    if(commandName==='setxp'){
      if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); const u=interaction.options.getUser('user'), amount=interaction.options.getInteger('amount'); const old=(await supabase.from('xp_users').select('*').eq('guild_id',guild.id).eq('user_id',u.id).maybeSingle()).data||{xp:0,level:0}; const xp=Math.max(0,Number(old.xp||0)+amount), level=Math.floor(xp/100); await supabase.from('xp_users').upsert({guild_id:guild.id,user_id:u.id,xp,level}); return interaction.reply({content:`${amount} XP به ${u} داده شد.`});
    }
    if(commandName==='leaderboard'){
      const {data:users}=await supabase.from('xp_users').select('*').eq('guild_id',guild.id).order('xp',{ascending:false}).limit(10); const e=new EmbedBuilder().setTitle('🏆 XP Leaderboard').setDescription((users||[]).map((x,i)=>`${i+1}. <@${x.user_id}> — Level ${x.level} | ${x.xp} XP`).join('\n')||'خالی'); return interaction.reply({embeds:[e]});
    }
    if(commandName==='textowner'){
      if(!isOwner(interaction.user.id) && !isAdmin(interaction.member)) return interaction.reply({content:'فقط Owner/Administrator.',ephemeral:true}); const ch=interaction.options.getChannel('channel'); await setSettings(guild.id,{owner_relay_channel:ch.id}); return interaction.reply({content:`Relay در ${ch} فعال شد.`});
    }
    if(commandName==='createcmd'){
      if(!isOwner(interaction.user.id) && !isAdmin(interaction.member)) return interaction.reply({content:'فقط Owner/Administrator.',ephemeral:true}); const s=await getSettings(guild.id); const cc=s.custom_commands||{}; cc[interaction.options.getString('keyword').toLowerCase()]=interaction.options.getString('text'); await setSettings(guild.id,{custom_commands:cc}); return interaction.reply({content:'Custom command ذخیره شد.'});
    }
    if(commandName==='exchange'){
      const modal=new ModalBuilder().setCustomId('exchange').setTitle('Exchange Form').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('banner').setLabel('اطلاعات / بنر اکسچنج').setStyle(TextInputStyle.Paragraph).setRequired(true))); return interaction.showModal(modal);
    }
    if(commandName==='banner'){ const s=await getSettings(guild.id); if(!s.server_banner) return interaction.reply({content:'بنر هنوز تنظیم نشده.',ephemeral:true}); return interaction.reply({content:s.server_banner}); }
    if(commandName==='setbanner'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await setSettings(guild.id,{server_banner:interaction.options.getString('banner')}); return interaction.reply({content:'بنر ذخیره شد.'}); }
    if(commandName==='settextxp'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await setSettings(guild.id,{xp_level_text:interaction.options.getString('text')}); return interaction.reply({content:'متن Level Up ذخیره شد.'}); }
    if(commandName==='level'){ const u=(await supabase.from('xp_users').select('*').eq('guild_id',guild.id).eq('user_id',interaction.user.id).maybeSingle()).data||{xp:0,level:0}; return interaction.reply({content:`⭐ Level: ${u.level} | XP: ${u.xp}`}); }
    if(commandName==='settextwel'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await setSettings(guild.id,{welcome_text:interaction.options.getString('text')}); return interaction.reply({content:'متن Welcome ذخیره شد.'}); }
    if(commandName==='settextinc'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await setSettings(guild.id,{invite_text:interaction.options.getString('text')}); return interaction.reply({content:'متن Invite ذخیره شد.'}); }
    if(commandName==='setex'){ if(!isAdmin(interaction.member)) return interaction.reply({content:'فقط Administrator.',ephemeral:true}); await setSettings(guild.id,{exchange_channel:interaction.options.getChannel('channel').id}); return interaction.reply({content:'چنل Exchange ذخیره شد.'}); }
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
async function removeStaff(guild,target,row,ranks){ const r=ranks.find(x=>x.position===row.rank_position); if(r) await target.roles.remove(r.role_id).catch(()=>{}); for(const x of r?.auto_roles||[]) await target.roles.remove(x).catch(()=>{}); const staffRole=guild.roles.cache.find(x=>x.name===ACCESS.staff); if(staffRole) await target.roles.remove(staffRole.id).catch(()=>{}); await supabase.from('staff_members').update({active:false}).eq('guild_id',guild.id).eq('user_id',target.id); await logTo(guild,'staff_hire_channel',`🔴 Demote خودکار | ${target.user.tag}`); }

for (const key of ['DISCORD_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) { if(!process.env[key]) { console.error(`Missing required environment variable: ${key}`); process.exit(1); } }
client.on('error', err=>console.error('Discord client error:',err));
process.on('unhandledRejection', err=>console.error('Unhandled rejection:',err));
process.on('uncaughtException', err=>console.error('Uncaught exception:',err));
client.login(process.env.DISCORD_TOKEN).catch(err=>{ console.error('Discord login failed:',err); process.exit(1); });
