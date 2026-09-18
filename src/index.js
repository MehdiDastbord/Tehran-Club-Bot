
require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, PermissionsBitField,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { supabase, getSettings, setSettings } = require('./db');
const { isAdmin, replacePlaceholders } = require('./utils');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],
  partials:[Partials.Channel]
});

function isOwner(userId) {
  return String(process.env.OWNER_ID || '').split(',').map(x => x.trim()).filter(Boolean).includes(String(userId));
}

function replyError(interaction, error, fallback='عملیات انجام نشد.') {
  console.error(error);
  const payload={content:`❌ ${fallback}`,ephemeral:true};
  return interaction.replied || interaction.deferred ? interaction.followUp(payload).catch(()=>{}) : interaction.reply(payload).catch(()=>{});
}

const ACCESS = {
  giveaway:'Giveaway Access',
  ticket:'Ticket Access',
  mod:'Ban/Kick Access',
  logs:'Logs',
  exchange:'Exchange'
};

async function ensureRole(guild,name) {
  let role = guild.roles.cache.find(r=>r.name===name);
  if (!role) role = await guild.roles.create({name,reason:'Tehran Club bot access role'});
  return role;
}
async function ensureAccessRoles(guild) {
  for (const name of Object.values(ACCESS)) await ensureRole(guild,name);
}
function hasAccess(member,roleName) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.roles.cache.some(r=>r.name===roleName);
}
async function logTo(guild,key,content) {
  const s=await getSettings(guild.id);
  const ch=s[key] && guild.channels.cache.get(s[key]);
  if(ch) await ch.send({content}).catch(()=>{});
}
async function adminTextConfig(message,key,value) {
  if(!isAdmin(message.member)) return;
  await setSettings(message.guild.id,{[key]:value});
  await message.delete().catch(()=>{});
}
async function parseSetCh(message, parts) {
  if(!message.guild || !isAdmin(message.member)) return false;
  const cmd=parts[0].toLowerCase();
  const map={
    setcht:'ticket_log_channel', setchfead:'ticket_feedback_channel',
    setchru:'staff_rank_channel', setchhi:'staff_hire_channel',
    setchstw:'staff_warn_channel', setchm:'message_log_channel',
    setchb:'ban_kick_log_channel', setchto:'timeout_log_channel',
    setchv:'voice_log_channel', setchdm:'dm_log_channel',
    setchdv:'server_update_log_channel', setchwa:'member_warn_log_channel',
    setchwel:'welcome_channel', setchinv:'invite_log_channel',
    setchlevel:'level_channel', setex:'exchange_channel'
  };
  if(!(cmd in map)) return false;
  const channel = message.mentions.channels.first();
  const id=channel?.id || parts[1];
  if(!id) return true;
  await setSettings(message.guild.id,{[map[cmd]]:id});
  await message.delete().catch(()=>{});
  return true;
}

client.on('ready',async()=>{
  console.log(`Logged in as ${client.user.tag}`);
  for(const g of client.guilds.cache.values()) await ensureAccessRoles(g).catch(console.error);
  setInterval(endGiveaways,15000);
  setInterval(showStats,3600000);
});

client.on('guildCreate',g=>ensureAccessRoles(g).catch(console.error));

client.on('messageCreate',async message=>{
  if(message.author.bot) return;
  if(message.guild && await parseSetCh(message,message.content.trim().split(/\s+/))) return;

  const p=message.content.trim().split(/\s+/);
  const cmd=p[0]?.toLowerCase();

  if(message.guild && ['setrole','setrolee','setfosh','deletefosh','whiteuser','settextwel','settextinc','setbanner','setxp','setex'].includes(cmd)) {
    if(!isAdmin(message.member)) return;
    if(cmd==='setrole') {
      const roles=message.mentions.roles.map(r=>r.id);
      await setSettings(message.guild.id,{staff_rank_roles:roles});
    } else if(cmd==='setrolee') {
      const roles=message.mentions.roles.map(r=>r.id);
      await setSettings(message.guild.id,{staff_auto_roles:roles});
    } else if(cmd==='setfosh') {
      const words=p.slice(1).join(' ').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
      for(const word of words) await supabase.from('profanity_words').upsert({guild_id:message.guild.id,word});
    } else if(cmd==='deletefosh') {
      const words=p.slice(1).join(' ').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
      for(const word of words) await supabase.from('profanity_words').delete().eq('guild_id',message.guild.id).eq('word',word);
    } else if(cmd==='whiteuser') {
      const u=message.mentions.users.first(); if(u) await supabase.from('profanity_whitelist').upsert({guild_id:message.guild.id,user_id:u.id});
    } else if(cmd==='settextwel') {
      await setSettings(message.guild.id,{welcome_text:p.slice(1).join(' ')});
    } else if(cmd==='settextinc') {
      await setSettings(message.guild.id,{invite_text:p.slice(1).join(' ')});
    }
    await message.delete().catch(()=>{});
    return;
  }

  if(message.guild) {
    const s=await getSettings(message.guild.id);
    const wl=await supabase.from('profanity_whitelist').select('user_id').eq('guild_id',message.guild.id).eq('user_id',message.author.id).maybeSingle();
    if(!wl.data) {
      const words=(await supabase.from('profanity_words').select('word').eq('guild_id',message.guild.id)).data||[];
      if(words.some(x=>x.word && message.content.toLowerCase().includes(x.word))) {
        await message.delete().catch(()=>{});
        await supabase.from('member_warns').insert({guild_id:message.guild.id,user_id:message.author.id,reason:'Profanity filter'});
      }
    }
  }

  // owner text relay/custom commands
  if(message.guild && isOwner(message.author.id)) {
    const s=await getSettings(message.guild.id);
    if(s.owner_relay_channel===message.channel.id) {
      await message.delete().catch(()=>{});
      await message.channel.send(message.content);
    }
    if(s.custom_commands && s.custom_commands[cmd]) await message.channel.send(s.custom_commands[cmd]);
  }

  // active text drops
  if(message.guild) {
    const {data:drops}=await supabase.from('drops').select('*').eq('guild_id',message.guild.id).eq('ended',false).eq('kind','text');
    for(const d of drops||[]) if(d.target_text && message.content.trim()===d.target_text) {
      await supabase.from('drops').update({ended:true,winner_id:message.author.id}).eq('id',d.id);
      await message.channel.send(`🏆 <@${message.author.id}> برنده Drop شد!`);
      await logTo(message.guild,'drop_winner_log_channel',`🏆 Drop winner: ${message.author.tag}`);
      break;
    }
  }
});

async function endGiveaways() {
  const {data:rows}=await supabase.from('giveaways').select('*').eq('ended',false).lte('end_at',new Date().toISOString());
  for(const g of rows||[]) {
    const {data:entries}=await supabase.from('giveaway_entries').select('user_id').eq('giveaway_id',g.id);
    const winner=entries?.length ? entries[Math.floor(Math.random()*entries.length)].user_id : null;
    await supabase.from('giveaways').update({ended:true,winner_id:winner}).eq('id',g.id);
    const guild=client.guilds.cache.get(g.guild_id), ch=guild?.channels.cache.get(g.channel_id);
    if(ch) await ch.send(`🎉 Giveaway تمام شد!\n🎁 ${g.prize}\n🏆 ${winner?`برنده: <@${winner}>`:'شرکت‌کننده‌ای نبود.'}`);
    if(guild) await logTo(guild,'giveaway_winner_log_channel',`Giveaway winner: ${winner||'none'}`);
  }
}

async function showStats() {
  const {data:rows}=await supabase.from('tickets').select('claimed_by,guild_id').not('claimed_by','is',null);
  const by={};
  for(const r of rows||[]) { by[r.guild_id]??={}; by[r.guild_id][r.claimed_by]=(by[r.guild_id][r.claimed_by]||0)+1; }
  for(const [gid,counts] of Object.entries(by)) {
    const s=await getSettings(gid), ch=client.channels.cache.get(s.stats_channel);
    if(!ch) continue;
    const text=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map((x,i)=>`${i+1}. <@${x[0]}> — ${x[1]} claim`).join('\n');
    await ch.send(`📊 آمار Claim ساعتی\n${text||'آماری نیست.'}`).catch(()=>{});
  }
}

client.on('interactionCreate',async interaction=>{
  if(interaction.isButton()) {
    const [type,id]=interaction.customId.split(':');
    if(type==='gw') {
      const {error}=await supabase.from('giveaway_entries').upsert({giveaway_id:id,user_id:interaction.user.id});
      if(error) return interaction.reply({content:'خطا در ثبت ورود.',ephemeral:true});
      return interaction.reply({content:'وارد Giveaway شدی ✅',ephemeral:true});
    }
    if(type==='drop') {
      const {data:d}=await supabase.from('drops').select('*').eq('id',id).eq('ended',false).maybeSingle();
      if(!d) return interaction.reply({content:'این Drop قبلاً برنده شده.',ephemeral:true});
      await supabase.from('drops').update({ended:true,winner_id:interaction.user.id}).eq('id',id);
      await interaction.update({content:`🏆 <@${interaction.user.id}> اولین نفر بود و برنده شد!`,components:[]});
      return;
    }
    if(type==='claim') {
      if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
      const {data:t}=await supabase.from('tickets').select('*').eq('channel_id',interaction.channel.id).eq('status','open').maybeSingle();
      if(!t) return interaction.reply({content:'Ticket پیدا نشد.',ephemeral:true});
      await supabase.from('tickets').update({claimed_by:interaction.user.id}).eq('id',t.id);
      await interaction.channel.permissionOverwrites.edit(interaction.user.id,{ViewChannel:true,SendMessages:true});
      await interaction.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:true,SendMessages:true});
      return interaction.reply({content:`Ticket توسط <@${interaction.user.id}> Claim شد.`,ephemeral:false});
    }
    if(type==='close') {
      if(!hasAccess(interaction.member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket نداری.',ephemeral:true});
      const {data:t}=await supabase.from('tickets').select('*').eq('channel_id',interaction.channel.id).maybeSingle();
      if(!t) return interaction.reply({content:'Ticket نیست.',ephemeral:true});
      await supabase.from('tickets').update({status:'closed',closed_at:new Date().toISOString()}).eq('id',t.id);
      await interaction.channel.setArchived?.(true).catch?.(()=>{});
      await interaction.reply('🔒 Ticket بسته شد.');
      const s=await getSettings(interaction.guild.id);
      const ch=s.ticket_feedback_channel && interaction.guild.channels.cache.get(s.ticket_feedback_channel);
      if(ch) await ch.send(`برای <@${t.opener_id}> امتیاز ۱ تا ۵ ارسال شد. (پیاده‌سازی DM در نسخه بعدی قابل تکمیل است)`);
    }
  }

  if(interaction.isStringSelectMenu() && interaction.customId.startsWith('ticketmenu:')) {
    if(!hasAccess(interaction.member,ACCESS.ticket) && interaction.member.user.id!==interaction.user.id) {}
    const panelId=interaction.customId.split(':')[1];
    const category=interaction.values[0];
    const {data:p}=await supabase.from('ticket_panels').select('*').eq('id',panelId).maybeSingle();
    if(!p) return interaction.reply({content:'Panel پیدا نشد.',ephemeral:true});
    const channel=await interaction.guild.channels.create({
      name:`ticket-${interaction.user.username}`.slice(0,90),
      type:0,
      parent:p.category_id || undefined,
      permissionOverwrites:[
        {id:interaction.guild.roles.everyone.id,deny:['ViewChannel']},
        {id:interaction.user.id,allow:['ViewChannel','SendMessages','ReadMessageHistory']},
        ...(p.mention_roles||[]).map(id=>({id,allow:['ViewChannel','SendMessages','ReadMessageHistory']}))
      ]
    });
    const {data:t}=await supabase.from('tickets').insert({
      guild_id:interaction.guild.id,panel_id:panelId,channel_id:channel.id,
      opener_id:interaction.user.id,category_id:category
    }).select().single();
    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`claim:${t.id}`).setLabel('Claim').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`close:${t.id}`).setLabel('Close').setStyle(ButtonStyle.Danger)
    );
    await channel.send({content:replacePlaceholders(p.welcome_text,interaction.member,interaction.guild),components:[row]});
    return interaction.reply({content:`Ticket ساخته شد: ${channel}`,ephemeral:true});
  }

  if(interaction.isModalSubmit() && interaction.customId==='exchange') {
    const banner=interaction.fields.getTextInputValue('banner');
    const {data:e}=await supabase.from('exchange_requests').insert({guild_id:interaction.guild.id,user_id:interaction.user.id,banner}).select().single();
    const s=await getSettings(interaction.guild.id), ch=s.exchange_channel && interaction.guild.channels.cache.get(s.exchange_channel);
    if(ch) {
      const row=new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`exapprove:${e.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`exreject:${e.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
      );
      await ch.send({content:`📦 Exchange\n👤 <@${interaction.user.id}>\n🖼️ ${banner}`,components:[row]});
    }
    return interaction.reply({content:'فرم Exchange ارسال شد.',ephemeral:true});
  }

  if(interaction.isChatInputCommand()) {
    const c=interaction.commandName, member=interaction.member, guild=interaction.guild;
    if(c==='giveaway' || c==='giveawaysv') {
      if(!hasAccess(member,ACCESS.giveaway)) return interaction.reply({content:'Giveaway Access لازم است.',ephemeral:true});
      const prize=interaction.options.getString('prize'), minutes=interaction.options.getInteger('minutes');
      const link=c==='giveawaysv'?interaction.options.getString('link'):null;
      const end=new Date(Date.now()+minutes*60000);
      const {data:g}=await supabase.from('giveaways').insert({guild_id:guild.id,channel_id:interaction.channel.id,prize,duration_minutes:minutes,end_at:end.toISOString(),link}).select().single();
      const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gw:${g.id}`).setLabel('🎉 شرکت در Giveaway').setStyle(ButtonStyle.Success));
      if(link) row.addComponents(new ButtonBuilder().setLabel('🔗 لینک').setStyle(ButtonStyle.Link).setURL(link));
      const msg=await interaction.reply({content:`🎁 **Giveaway**\nجایزه: ${prize}\n⏱️ مدت: ${minutes} دقیقه`,components:[row],fetchReply:true});
      await supabase.from('giveaways').update({message_id:msg.id}).eq('id',g.id);
      await logTo(guild,'giveaway_creation_log_channel',`Giveaway ساخته شد: ${prize}`);
      return;
    }
    if(c==='dropmatn' || c==='dropclick') {
      if(!hasAccess(member,ACCESS.giveaway)) return interaction.reply({content:'Giveaway Access لازم است.',ephemeral:true});
      const target=c==='dropmatn'?interaction.options.getString('text'):null;
      const {data:d}=await supabase.from('drops').insert({guild_id:guild.id,channel_id:interaction.channel.id,kind:c==='dropmatn'?'text':'click',target_text:target}).select().single();
      const components=c==='dropclick'?[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`drop:${d.id}`).setLabel('⚡ اولین نفر').setStyle(ButtonStyle.Danger))]:[];
      const msg=await interaction.reply({content:`⚡ **Drop**\n${target?`متن برنده: ${target}`:'اولین کلیک برنده است.'}`,components,fetchReply:true});
      await supabase.from('drops').update({message_id:msg.id}).eq('id',d.id);
      await logTo(guild,'drop_creation_log_channel','Drop ساخته شد.');
      return;
    }
    if(c==='panel') {
      if(!hasAccess(member,ACCESS.ticket)) return interaction.reply({content:'Ticket Access لازم است.',ephemeral:true});
      const name=interaction.options.getString('name'), welcome=interaction.options.getString('welcome');
      const category=interaction.options.getChannel('category');
      const roles=interaction.options.getRole('role');
      const {data:p}=await supabase.from('ticket_panels').insert({
        guild_id:guild.id,name,welcome_text:welcome||'سلام [user]، تیکت شما ایجاد شد.',
        category_id:category?.id||null,mention_roles:roles?[roles.id]:[]
      }).select().single();
      const menu=new StringSelectMenuBuilder().setCustomId(`ticketmenu:${p.id}`).setPlaceholder('انتخاب دسته تیکت').addOptions(
        {label:name,value:category?.id||'general',description:'ایجاد Ticket در این دسته'}
      );
      await interaction.reply({content:`🎫 ${name}\nانتخاب کتگوری و ساخت Ticket:`,components:[new ActionRowBuilder().addComponents(menu)]});
      return;
    }
    if(c==='menu') {
      if(!hasAccess(member,ACCESS.ticket)) return interaction.reply({content:'Ticket Access لازم است.',ephemeral:true});
      const {data:panels}=await supabase.from('ticket_panels').select('*').eq('guild_id',guild.id);
      if(!panels?.length) return interaction.reply({content:'اول /panel بساز.',ephemeral:true});
      const menu=new StringSelectMenuBuilder().setCustomId(`ticketmenu:${panels[0].id}`).setPlaceholder('انتخاب کتگوری');
      for(const p of panels.slice(0,25)) menu.addOptions({label:p.name,value:p.category_id||p.id,description:'باز کردن این Ticket Panel'});
      return interaction.reply({content:'🎫 دسته‌بندی تیکت را انتخاب کن:',components:[new ActionRowBuilder().addComponents(menu)]});
    }
    if(c==='claim' || c==='close' || c==='reopen' || c==='add' || c==='claimchange') {
      if(!hasAccess(member,ACCESS.ticket)) return interaction.reply({content:'Ticket Access لازم است.',ephemeral:true});
      const {data:t}=await supabase.from('tickets').select('*').eq('channel_id',interaction.channel.id).maybeSingle();
      if(!t) return interaction.reply({content:'این کانال Ticket نیست.',ephemeral:true});
      if(c==='claim' || c==='claimchange') {
        const u=c==='claim'?interaction.user:interaction.options.getUser('user');
        await supabase.from('tickets').update({claimed_by:u.id}).eq('id',t.id);
        await interaction.reply(`👤 Claim به <@${u.id}> منتقل شد.`);
      } else if(c==='add') {
        const u=interaction.options.getUser('user');
        await supabase.from('ticket_members').upsert({ticket_id:t.id,user_id:u.id,added_by:interaction.user.id});
        await interaction.channel.permissionOverwrites.edit(u.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
        await interaction.reply(`➕ <@${u.id}> به Ticket اضافه شد.`);
      } else if(c==='close') {
        await supabase.from('tickets').update({status:'closed',closed_at:new Date().toISOString()}).eq('id',t.id);
        await interaction.reply('🔒 Ticket بسته شد.');
      } else if(c==='reopen') {
        await supabase.from('tickets').update({status:'open',closed_at:null}).eq('id',t.id);
        await interaction.reply('🔓 Ticket دوباره باز شد.');
      }
      return;
    }
    if(['kick','ban','timeout','warn'].includes(c)) {
      if(!hasAccess(member,ACCESS.mod)) return interaction.reply({content:'Ban/Kick Access لازم است.',ephemeral:true});
      const u=interaction.options.getMember('user'), reason=interaction.options.getString('reason')||'بدون دلیل';
      if(c==='kick') await u.kick(reason);
      if(c==='ban') await u.ban({reason});
      if(c==='timeout') await u.timeout(2*60*60*1000,reason);
      if(c==='warn') {
        await supabase.from('member_warns').insert({guild_id:guild.id,user_id:u.id,reason});
        const {count}=await supabase.from('member_warns').select('*',{count:'exact',head:true}).eq('guild_id',guild.id).eq('user_id',u.id);
        if(count>=3) await u.timeout(2*60*60*1000,'3 warnings');
      }
      await interaction.reply(`✅ ${c} انجام شد.`);
      return;
    }
    if(c==='stats') {
      if(!hasAccess(member,ACCESS.ticket)) return interaction.reply({content:'دسترسی Ticket لازم است.',ephemeral:true});
      await setSettings(guild.id,{stats_channel:interaction.channel.id});
      return interaction.reply({content:'✅ این کانال برای آمار Claim ساعتی تنظیم شد.',ephemeral:true});
    }
    if(c==='setrolexp') {
      if(!isAdmin(member)) return interaction.reply({content:'فقط Administrator می‌تواند این تنظیم را تغییر دهد.',ephemeral:true});
      const level=interaction.options.getInteger('level'), role=interaction.options.getRole('role');
      const {error}=await supabase.from('xp_roles').upsert({guild_id:guild.id,level,role_id:role.id});
      if(error) return replyError(interaction,error,'ثبت نقش XP انجام نشد.');
      return interaction.reply({content:`✅ نقش ${role} برای Level ${level} تنظیم شد.`,ephemeral:true});
    }
    if(c==='setxp') {
      if(!isAdmin(member)) return interaction.reply({content:'فقط Administrator می‌تواند XP را تغییر دهد.',ephemeral:true});
      const u=interaction.options.getUser('user'), amount=interaction.options.getInteger('amount');
      const {data:old,error:readError}=await supabase.from('xp_users').select('*').eq('guild_id',guild.id).eq('user_id',u.id).maybeSingle();
      if(readError) return replyError(interaction,readError,'خواندن XP انجام نشد.');
      const xp=Math.max(0,(old?.xp||0)+amount), level=Math.floor(xp/100);
      const {error}=await supabase.from('xp_users').upsert({guild_id:guild.id,user_id:u.id,xp,level});
      if(error) return replyError(interaction,error,'ثبت XP انجام نشد.');
      return interaction.reply({content:`✅ ${amount >= 0 ? '+' : ''}${amount} XP برای <@${u.id}> ثبت شد. اکنون Level ${level} و XP ${xp} است.`,ephemeral:true});
    }
    if(c==='level') {
      const {data:x}=await supabase.from('xp_users').select('*').eq('guild_id',guild.id).eq('user_id',interaction.user.id).maybeSingle();
      return interaction.reply(`⭐ Level: ${x?.level||0}\nXP: ${x?.xp||0}`);
    }
    if(c==='leaderboard') {
      const {data:xs}=await supabase.from('xp_users').select('*').eq('guild_id',guild.id).order('xp',{ascending:false}).limit(10);
      return interaction.reply(`🏆 Leaderboard\n${(xs||[]).map((x,i)=>`${i+1}. <@${x.user_id}> — Lv.${x.level} (${x.xp} XP)`).join('\n')||'خالی است.'}`);
    }
    if(c==='exchange') {
      if(!hasAccess(member,ACCESS.exchange)) return interaction.reply({content:'Exchange Access لازم است.',ephemeral:true});
      const modal=new ModalBuilder().setCustomId('exchange').setTitle('Exchange');
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('banner').setLabel('Banner').setStyle(TextInputStyle.Paragraph).setRequired(true)));
      return interaction.showModal(modal);
    }
    if(c==='textowner') {
      if(!isOwner(interaction.user.id)) return interaction.reply({content:'فقط Owner می‌تواند Owner Relay را تنظیم کند.',ephemeral:true});
      await setSettings(guild.id,{owner_relay_channel:interaction.channel.id});
      return interaction.reply({content:'✅ این کانال برای Owner Relay تنظیم شد.',ephemeral:true});
    }
    if(c==='createcmd') {
      if(!isAdmin(member)) return interaction.reply({content:'فقط Administrator می‌تواند Custom Command بسازد.',ephemeral:true});
      const keyword=interaction.options.getString('keyword').trim().toLowerCase().replace(/^\//,'');
      const text=interaction.options.getString('text');
      if(!keyword || keyword.length>50 || keyword.includes(' ')) return interaction.reply({content:'❌ Keyword باید یک کلمه و حداکثر 50 کاراکتر باشد.',ephemeral:true});
      const settings=await getSettings(guild.id);
      const custom_commands={...(settings.custom_commands||{}),[keyword]:text};
      await setSettings(guild.id,{custom_commands});
      return interaction.reply({content:`✅ Custom command ساخته شد: \`${keyword}\``,ephemeral:true});
    }
    if(c==='banner') {
      const s=await getSettings(guild.id);
      return interaction.reply(s.banner||'Banner تنظیم نشده.');
    }
  }
});

client.on('messageCreate',async message=>{
  if(!message.guild || message.author.bot) return;
  const s=await getSettings(message.guild.id);
  let xp=await supabase.from('xp_users').select('*').eq('guild_id',message.guild.id).eq('user_id',message.author.id).maybeSingle();
  let row=xp.data;
  if(!row) row={guild_id:message.guild.id,user_id:message.author.id,xp:0,level:0};
  row.xp += 5;
  const newLevel=Math.floor(row.xp/100);
  if(newLevel>row.level) {
    row.level=newLevel;
    if(s.level_channel) message.guild.channels.cache.get(s.level_channel)?.send((s.level_text||'🎉 [user] به Level [level] رسید!').replaceAll('[user]',`<@${message.author.id}>`).replaceAll('[level]',String(newLevel)));
    const {data:rewards}=await supabase.from('xp_roles').select('level,role_id').eq('guild_id',message.guild.id).lte('level',newLevel);
    for(const reward of rewards||[]) {
      const role=message.guild.roles.cache.get(reward.role_id);
      if(role && !message.member.roles.cache.has(role.id)) await message.member.roles.add(role).catch(()=>{});
    }
  }
  await supabase.from('xp_users').upsert(row);
});

client.login(process.env.DISCORD_TOKEN);
