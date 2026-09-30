const {
  Client, GatewayIntentBits, Partials, MessageFlags, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AttachmentBuilder,
  AuditLogEvent, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const crypto = require('crypto');
const { token, owners, botName, guildId, aiRetentionDays, logRetentionDays, backupDir, backupRetention, banchRoleId, banchAccessRoleId } = require('./config');
const { getSettings, setSettings, getXp, db, backupNow, integrityCheck } = require('./db');
const { safeReply, ok, err, info, warn, isOwner, isAdmin, hasRole, placeholders, stripMentions, safeEmoji, clamp } = require('./utils');
const { sendLog, cleanup: cleanupLogs, types: LOG_TYPES } = require('./services/logService');
const xp = require('./services/xpService');
const staff = require('./services/staffService');
const invites = require('./services/inviteService');
const tickets = require('./services/ticketService');
const giveaways = require('./services/giveawayService');
const drops = require('./services/dropService');
const ai = require('./services/aiService');
const music = require('./services/musicService');
const music247 = require('./services/music247');
const outbox = require('./services/discordOutboxService');
const delivery = require('./services/discordDeliveryService');
const guess = require('./services/guessService');
const { hasAccess, hasStrictRole, canManageTarget, botHas } = require('./services/permissionService');
const { sleep } = require('./utils');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

const inviteQueues = new Map();
const inviteSnapshots = new Map();
const timers = new Set();
let shuttingDown = false;
let intervalsStarted = false;
const owner = id => isOwner(id, owners);

function access(interaction, key, options={}) {
  return hasAccess(interaction.member, key, options);
}
async function need(interaction, key, options={}) {
  if (access(interaction,key,options)) return true;
  await safeReply(interaction,{embeds:[err('برای این بخش دسترسی لازم را نداری.')],flags:MessageFlags.Ephemeral});
  return false;
}
async function needAdmin(interaction) {
  if(owner(interaction.user.id)||isAdmin(interaction.member))return true;
  await safeReply(interaction,{embeds:[err('فقط Owner یا Administrator اجازه این تنظیم را دارد.')],flags:MessageFlags.Ephemeral});
  return false;
}
function hierarchyMessage(interaction,target){const r=canManageTarget(interaction,target);return r.ok?null:r.message;}
async function getMember(guild,user){return guild.members.fetch(user.id).catch(()=>null)}
function textChannel(channel){return !!channel?.isTextBased?.() && channel.type!==ChannelType.GuildVoice && channel.type!==ChannelType.GuildStageVoice;}
function botPermissionMessage(guild,permission,label){return botHas(guild,permission)?null:`Bot دسترسی ${label} را ندارد.`;}
function buttonWithEmoji(button,value){const e=safeEmoji(value);if(!e)return button;if(typeof e==='string')return button.setEmoji(e);return button.setEmoji({id:e.id,name:e.name,animated:e.animated});}
async function deferEphemeral(interaction){if(!interaction.deferred&&!interaction.replied)await interaction.deferReply({flags:MessageFlags.Ephemeral});}

function invitePageData(guildId, mode, inviterId, page=0){
  const perPage=12; const safePage=Math.max(0,Math.floor(Number(page)||0)); const offset=safePage*perPage;
  let rows=[];
  if(mode==='invited'||mode==='active'||mode==='left_members'||mode==='fake_members'){
    const memberMode=mode==='active'?'active':mode==='left_members'?'left':mode==='fake_members'?'fake':'all';
    rows=invites.listMembers(guildId,{inviterId,mode:memberMode,limit:perPage+1,offset});
  }else{
    const eventMode=mode==='alljoins'?'join':mode;
    rows=invites.eventList(guildId,{inviterId,type:eventMode,limit:perPage+1,offset});
  }
  const hasNext=rows.length>perPage; rows=rows.slice(0,perPage);
  let lines=[];
  if(mode==='invited'||mode==='active'||mode==='left_members'||mode==='fake_members'){
    lines=rows.map((r,n)=>`${offset+n+1}. <@${r.member_id}> — ${r.fake?'🟠 Fake':'🟢 Regular'} — ${r.active?'Joined':'Left'} — Rejoins: ${Math.max(0,(r.join_count||1)-1)} — <t:${Math.floor((r.last_joined_at||r.joined_at)/1000)}:R>`);
  }else if(eventMode==='left'){
    lines=rows.map((r,n)=>`${offset+n+1}. <@${r.member_id}> — ${r.inviter_id?`invited by <@${r.inviter_id}>`:'inviter Unknown'} — ${r.fake?'Fake leave':'Leave'} — <t:${Math.floor(r.created_at/1000)}:R>`);
  }else{
    lines=rows.map((r,n)=>`${offset+n+1}. <@${r.member_id}> ${r.fake?'🟠 Fake ':''}${r.rejoin?'🔁 Rejoin ':''}— ${r.invite_code||'unknown'} — ${r.inviter_id?`inviter: <@${r.inviter_id}>`:'inviter: Unknown'} — <t:${Math.floor(r.created_at/1000)}:R>`);
  }
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`invpage:${mode}:${inviterId||'all'}:${Math.max(0,safePage-1)}`).setLabel('Prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(safePage<=0),
    new ButtonBuilder().setCustomId(`invpage:${mode}:${inviterId||'all'}:${safePage+1}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(!hasNext)
  );
  return {embed:info(`${lines.length?lines.join('\n'):'هیچ موردی ثبت نشده.'}\n\nصفحه: **${safePage+1}**`),row};
}

function xpDefaults(existing={}){return {enabled:true,min:10,max:20,cooldownMs:60000,curve:'linear',multiplier:1,maxLevel:0,channelId:null,levelUpChannelId:null,...existing};}
function inviteDefaults(existing={}){return {fakeDays:3,countRejoins:false,...existing};}

async function handleXp(i,s){
  const gid=i.guild.id;
  const settings=getSettings(gid);
  const cfg=xpDefaults(settings.xp||{});
  if(!await need(i,'xp'))return;
  await deferEphemeral(i);

  if(s==='setchannel'||s==='setlevelup'){
    if(!await needAdmin(i))return;
    const ch=i.options.getChannel('channel');
    if(!textChannel(ch))return safeReply(i,{embeds:[err('Channel معتبر نیست.')],flags:MessageFlags.Ephemeral});
    if(!i.guild.members.me?.permissionsFor(ch)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))return safeReply(i,{embeds:[err('Bot در این Channel دسترسی ارسال ندارد.')],flags:MessageFlags.Ephemeral});
    await setSettings(gid,{xp:{[s==='setchannel'?'channelId':'levelUpChannelId']:ch.id}});
    return safeReply(i,{embeds:[ok(s==='setchannel'?`XP فقط در <#${ch.id}> محاسبه می‌شود.`:`پیام Level Up در <#${ch.id}> ارسال می‌شود.`)],flags:MessageFlags.Ephemeral});
  }

  if(s==='settings'){
    const min=i.options.getInteger('min'),max=i.options.getInteger('max'),cd=i.options.getInteger('cooldown');
    if(max<min)return safeReply(i,{embeds:[err('Max باید بزرگ‌تر یا مساوی Min باشد.')],flags:MessageFlags.Ephemeral});
    const curve=i.options.getString('curve')||cfg.curve,mult=i.options.getNumber('multiplier')??cfg.multiplier,maxLevel=i.options.getInteger('maxlevel')??cfg.maxLevel;
    await setSettings(gid,{xp:{...cfg,min,max,cooldownMs:cd*1000,curve,multiplier:mult,maxLevel,enabled:true}});
    return safeReply(i,{embeds:[ok(`XP تنظیم شد. ${min}-${max} | Cooldown: ${cd}s | Curve: ${curve} | Multiplier: ${mult} | Max Level: ${maxLevel||'نامحدود'}`)],flags:MessageFlags.Ephemeral});
  }

  if(s==='setrole'||s==='removerole'){
    const level=i.options.getInteger('level');
    if(s==='setrole'){
      const role=i.options.getRole('role'),me=i.guild.members.me;
      if(!role||role.managed||!me||role.id===i.guild.id||role.position>=me.roles.highest.position)return safeReply(i,{embeds:[err('این Role قابل مدیریت توسط Bot نیست.')],flags:MessageFlags.Ephemeral});
      const result=await xp.changeRoleMapping(i.guild,level,role.id,false,i.user.tag);
      return safeReply(i,{embeds:[result.ok?ok(`Level ${level} → <@&${role.id}> تنظیم شد.`):err(result.message)],flags:MessageFlags.Ephemeral});
    }
    const result=await xp.changeRoleMapping(i.guild,level,null,true,i.user.tag);
    return safeReply(i,{embeds:[result.ok?ok(`Mapping Level ${level} حذف شد.`):err(result.message)],flags:MessageFlags.Ephemeral});
  }

  if(s==='roles'){
    const rows=xp.rolesFor(gid);return safeReply(i,{embeds:[info([`Curve: **${cfg.curve}**`,`Multiplier: **${cfg.multiplier}**`,`Max Level: **${cfg.maxLevel||'نامحدود'}**`,rows.length?rows.map(r=>`Level ${r.level} → <@&${r.role_id}>`).join('\n'):'هیچ Roleای تنظیم نشده.'].join('\n'))],flags:MessageFlags.Ephemeral});
  }
  if(s==='resetall'){
    const result=await xp.resetAll(i.guild,i.user.tag);return safeReply(i,{embeds:[result.ok?ok(`XP کل سرور ریست شد (${result.users} کاربر).`):err(result.message)],flags:MessageFlags.Ephemeral});
  }
  const user=i.options.getUser('user'); const member=user?await getMember(i.guild,user):null;
  if(!member)return safeReply(i,{embeds:[err('Member پیدا نشد.')],flags:MessageFlags.Ephemeral});
  const hm=hierarchyMessage(i,member);if(hm&&!owner(i.user.id))return safeReply(i,{embeds:[err(hm)],flags:MessageFlags.Ephemeral});
  if(s==='reset'){const result=await xp.resetUser(i.guild,member,i.user.tag);return safeReply(i,{embeds:[result.ok?ok('XP کاربر ریست شد.'):err(result.message)],flags:MessageFlags.Ephemeral});}
  const amount=i.options.getInteger('amount');const result=await xp.manualChange(i.guild,member,s==='add'?amount:-amount,i.user.tag,s);
  return safeReply(i,{embeds:[result.ok?ok(`<@${member.id}> → XP **${result.next.xp}** | Level **${result.next.level}**`):err(result.message)],flags:MessageFlags.Ephemeral});
}
async function handleLogs(i,s){
  if(['set','reset','resetall','setup'].includes(s)){if(!await needAdmin(i))return;}else if(!await need(i,'logs'))return;

  await deferEphemeral(i);
  const gid=i.guild.id;const cur={...(getSettings(gid).logs||{})};
  if(s==='set'||s==='reset'){
    const type=i.options.getString('type');
    if(s==='set'){
      const ch=i.options.getChannel('channel'),me=i.guild.members.me;
      if(!textChannel(ch)||!me||!ch.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))return safeReply(i,{embeds:[err('Log Channel معتبر نیست یا Bot دسترسی ارسال Log ندارد.')],flags:MessageFlags.Ephemeral});
      cur[type]=ch.id;
    }else delete cur[type];
    await setSettings(gid,{logs:cur});
    return safeReply(i,{embeds:[ok(s==='set'?`Log ${type} → <#${cur[type]}>`:`Log ${type} حذف شد.`)],flags:MessageFlags.Ephemeral});
  }
  if(s==='resetall'){await setSettings(gid,{logs:{}});return safeReply(i,{embeds:[ok('تمام Log Channelها پاک شدند.')],flags:MessageFlags.Ephemeral});}
  if(s==='setup'){
    const invalid=[];const me=i.guild.members.me;
    for(const type of LOG_TYPES){const ch=i.options.getChannel(type);if(!ch)continue;if(!textChannel(ch)||!me||!ch.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks])){invalid.push(type);continue;}cur[type]=ch.id;}
    await setSettings(gid,{logs:cur});return safeReply(i,{embeds:[invalid.length?warn(`این Logها ذخیره نشدند: ${invalid.join(', ')}`):ok('تمام Log Channelهای انتخاب‌شده تنظیم شدند.')],flags:MessageFlags.Ephemeral});
  }
  if(s==='test'){
    let success=0,failed=0;
    for(const [type,id] of Object.entries(cur)){
      const ch=await i.guild.channels.fetch(id).catch(()=>null);
      if(!ch?.isTextBased()){failed++;continue;}
      try{await ch.send({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Log Test').setDescription(`Log **${type}** به‌درستی ارسال شد.`).setTimestamp()]}).then(()=>success++).catch(()=>{failed++});}catch{failed++}
    }
    return safeReply(i,{embeds:[failed?warn(`Test تمام شد: ${success} موفق، ${failed} ناموفق.`):ok(`Test با موفقیت روی ${success} Log Channel انجام شد.`)],flags:MessageFlags.Ephemeral});
  }
  return safeReply(i,{embeds:[info(LOG_TYPES.map(t=>`**${t}** → ${cur[t]?`<#${cur[t]}>`:'تنظیم نشده'}`).join('\n'))],flags:MessageFlags.Ephemeral});
}
async function handleSetTicketLog(i){
  if(!await needAdmin(i))return;
  await deferEphemeral(i);
  const gid=i.guild.id; const cur={...(getSettings(gid).logs||{})}; const invalid=[]; const me=i.guild.members.me;
  for(const type of LOG_TYPES){
    const ch=i.options.getChannel(type); if(!ch) continue;
    if(!textChannel(ch)||!me||!ch.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks])){invalid.push(type);continue;}
    cur[type]=ch.id;
  }
  await setSettings(gid,{logs:cur});
  return safeReply(i,{embeds:[invalid.length?warn(`این Logها ذخیره نشدند: ${invalid.join(', ')}`):ok('همه Log Channelهای انتخاب‌شده تنظیم شدند.')],flags:MessageFlags.Ephemeral});
}

async function handleInvite(i,s){
  const gid=i.guild.id;
  const managed=['add','remove','addfake','removefake','reset'];
  if(managed.includes(s)&&!await need(i,'invite'))return;
  if(['setchannel','config'].includes(s)&&!await needAdmin(i))return;
  await deferEphemeral(i);
  if(s==='add'||s==='remove'||s==='addfake'||s==='removefake'){
    const u=i.options.getUser('user'),amount=i.options.getInteger('amount');
    const result=s==='add'?invites.add(gid,u.id,amount):s==='remove'?invites.remove(gid,u.id,amount):s==='addfake'?invites.addFake(gid,u.id,amount):invites.removeFake(gid,u.id,amount);
    await sendLog(i.guild,'invite',{action:s,user:u.tag,amount,by:i.user.tag});
    return safeReply(i,{embeds:[ok(`${s==='add'?'Bonus Invite اضافه شد':s==='remove'?'Bonus Invite حذف شد':s==='addfake'?'Fake Invite اضافه شد':'Fake Invite حذف شد'}: **${amount}**`)],flags:MessageFlags.Ephemeral});
  }
  if(s==='reset'){
    const u=i.options.getUser('user');invites.reset(gid,u?.id||null);await sendLog(i.guild,'invite',{action:u?'reset_user':'reset_all',user:u?.tag||'all',by:i.user.tag});
    return safeReply(i,{embeds:[ok(u?`Inviteهای <@${u.id}> ریست شد.`:'تمام Inviteها ریست شدند.')],flags:MessageFlags.Ephemeral});
  }
  if(s==='setchannel'){
    const ch=i.options.getChannel('channel');const me=i.guild.members.me;
    if(!textChannel(ch)||!me||!ch.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))return safeReply(i,{embeds:[err('Invite Log Channel معتبر نیست یا Bot دسترسی ندارد.')],flags:MessageFlags.Ephemeral});
    await setSettings(gid,{logs:{invite:ch.id}});return safeReply(i,{embeds:[ok(`Invite Log → <#${ch.id}>`)],flags:MessageFlags.Ephemeral});
  }
  if(s==='config'){
    const fakeDays=i.options.getInteger('fake_days'),count=i.options.getBoolean('count_rejoins');await setSettings(gid,{invite:{fakeDays,countRejoins:count}});
    return safeReply(i,{embeds:[ok(`Fake Delay: ${fakeDays} روز | Count Rejoins: ${count?'فعال':'غیرفعال'}`)],flags:MessageFlags.Ephemeral});
  }
  if(s==='leaderboard'){
    const rows=invites.leaderboard(gid);return safeReply(i,{embeds:[info(rows.length?rows.slice(0,20).map((r,n)=>`${n+1}. <@${r.user_id}> — **${r.valid}** | Regular ${r.uses} | Left ${r.leaves} | Fake ${r.fake} | Bonus ${r.added} | Active ${r.active_members}`).join('\n'):'داده‌ای ثبت نشده.')],flags:MessageFlags.Ephemeral});
  }
  if(s==='stats'){
    const u=i.options.getUser('user')||i.user,r=invites.stats(gid,u.id);return safeReply(i,{embeds:[info(`<@${u.id}>\nRegular: **${r.uses}**\nLeft: **${r.leaves}**\nFake: **${r.fake}**\nBonus: **${r.added}**\nTotal Joins: **${r.total_joins}**\nActive: **${r.active_members}**\nValid: **${r.valid}**`)],flags:MessageFlags.Ephemeral});
  }
  if(s==='invited'){
    const u=i.options.getUser('user');const data=invitePageData(gid,'invited',u.id,0);return safeReply(i,{embeds:[data.embed],components:[data.row],flags:MessageFlags.Ephemeral});
  }
  if(s==='joins'||s==='alljoins'){
    const u=i.options.getUser('user');const data=invitePageData(gid,'alljoins',u?.id||null,0);return safeReply(i,{embeds:[data.embed],components:[data.row],flags:MessageFlags.Ephemeral});
  }
  if(s==='fake'){
    const u=i.options.getUser('user');const data=invitePageData(gid,'fake',u?.id||null,0);return safeReply(i,{embeds:[data.embed],components:[data.row],flags:MessageFlags.Ephemeral});
  }
  if(s==='left'||s==='leave'){
    const u=i.options.getUser('user');const data=invitePageData(gid,'left',u?.id||null,0);return safeReply(i,{embeds:[data.embed],components:[data.row],flags:MessageFlags.Ephemeral});
  }
  if(s==='events'){
    const u=i.options.getUser('user'),type=i.options.getString('type')||'all',rows=invites.eventList(gid,{inviterId:u?.id||null,type,limit:50});return safeReply(i,{embeds:[info(rows.length?rows.map((r,n)=>`${n+1}. **${r.type}** <@${r.member_id}> ${r.fake?'Fake ':''}${r.rejoin?'Rejoin ':''}${r.invite_code?`[${r.invite_code}] `:''}<t:${Math.floor(r.created_at/1000)}:R>`).join('\n'):'Eventی ثبت نشده.')],flags:MessageFlags.Ephemeral});
  }
  return safeReply(i,{embeds:[err('Invite subcommand نامعتبر است.')],flags:MessageFlags.Ephemeral});
}
async function handleStaff(i,s){
  const gid=i.guild.id;if(!await need(i,'staff'))return;
  if(s==='setrole'||s==='removerole'){
    const level=i.options.getInteger('level');
    if(s==='setrole'){
      const role=i.options.getRole('role'),me=i.guild.members.me;
      if(!role||role.managed||!me||role.id===i.guild.id||role.position>=me.roles.highest.position)return safeReply(i,{embeds:[err('Staff Role باید قابل مدیریت و پایین‌تر از Role بات باشد.')],flags:MessageFlags.Ephemeral});
      const result=await staff.changeRoleMapping(i.guild,level,role.id,false,i.user.tag);
      return safeReply(i,{embeds:[result.ok?ok(`Staff Level ${level} → <@&${role.id}>`):err(result.message)],flags:MessageFlags.Ephemeral});
    }
    const result=await staff.changeRoleMapping(i.guild,level,null,true,i.user.tag);
    return safeReply(i,{embeds:[result.ok?ok('Staff Role Mapping حذف شد.'):err(result.message)],flags:MessageFlags.Ephemeral});
  }
  if(s==='roles'){
    const rows=staff.listRoles(gid);
    return safeReply(i,{embeds:[info(rows.length?rows.sort((a,b)=>b.level-a.level).map(r=>`**Rank ${r.level}** → <@&${r.role_id}>`).join('\n'):'هیچ Staff Role تنظیم نشده.')],flags:MessageFlags.Ephemeral});
  }
  if(s==='list'){
    const rows=staff.listMembers(gid,50);
    if(!rows.groups.length&&!rows.unmapped.length)return safeReply(i,{embeds:[info('هیچ Staffی ثبت نشده.')],flags:MessageFlags.Ephemeral});
    const lines=[];
    for(const group of rows.groups){
      lines.push(`**Rank ${group.level}${group.role_id?` — <@&${group.role_id}>`:''}**`);
      for(const member of group.members) lines.push(`• <@${member.user_id}> — Points **${member.points}**`);
      lines.push('');
    }
    let description=lines.join('\n').trim();
    if(description.length>3900)description=description.slice(0,3880)+'\n…';
    return safeReply(i,{embeds:[info(`**Staff List — مرتب‌شده بر اساس Rank**\n\n${description}`)],flags:MessageFlags.Ephemeral});
  }
  if(s==='add'){
    const u=await getMember(i.guild,i.options.getUser('user'));if(!u)return safeReply(i,{embeds:[err('Member پیدا نشد.')],flags:MessageFlags.Ephemeral});
    const level=i.options.getInteger('level');if(level<1)return safeReply(i,{embeds:[err('Rank باید حداقل 1 باشد.')],flags:MessageFlags.Ephemeral});
    const hm=hierarchyMessage(i,u);if(hm&&!owner(i.user.id))return safeReply(i,{embeds:[err(hm)],flags:MessageFlags.Ephemeral});
    const reason=stripMentions(i.options.getString('reason')||'staff add');
    const result=await staff.changeLevel(i.guild,u,i.member,level,'STAFF_ADD',reason);
    return safeReply(i,{embeds:[result.ok?ok(`<@${u.id}> به Staff در Rank **${result.next}** اضافه شد.`):err(result.message)],flags:MessageFlags.Ephemeral});
  }
  if(s==='remove'){
    const u=await getMember(i.guild,i.options.getUser('user'));if(!u)return safeReply(i,{embeds:[err('Member پیدا نشد.')],flags:MessageFlags.Ephemeral});
    const current=staff.getStaff(gid,u.id);if(!current||current.level<=0)return safeReply(i,{embeds:[err('این کاربر Staff نیست.')],flags:MessageFlags.Ephemeral});
    const hm=hierarchyMessage(i,u);if(hm&&!owner(i.user.id))return safeReply(i,{embeds:[err(hm)],flags:MessageFlags.Ephemeral});
    const reason=stripMentions(i.options.getString('reason')||'staff remove');
    const result=await staff.removeStaff(i.guild,u,i.member,reason);
    return safeReply(i,{embeds:[result.ok?ok(`<@${u.id}> از Staff خارج شد.`):err(result.message)],flags:MessageFlags.Ephemeral});
  }
  if(s==='history'){const user=i.options.getUser('user');const rows=user?db.prepare('SELECT * FROM staff_history WHERE guild_id=? AND target_id=? ORDER BY id DESC LIMIT 30').all(gid,user.id):db.prepare('SELECT * FROM staff_history WHERE guild_id=? ORDER BY id DESC LIMIT 30').all(gid);return safeReply(i,{embeds:[info(rows.length?rows.map(r=>`<t:${Math.floor(r.created_at/1000)}:f> — <@${r.target_id}> — ${r.action} ${r.old_level}→${r.new_level} — by <@${r.actor_id}>${r.reason?` — ${clamp(r.reason,200)}`:''}`).join('\n'):'Historyی ثبت نشده.')],flags:MessageFlags.Ephemeral});}
  const u=await getMember(i.guild,i.options.getUser('user'));if(!u)return safeReply(i,{embeds:[err('Member پیدا نشد.')],flags:MessageFlags.Ephemeral});
  if(s==='info'){const r=staff.getStaff(gid,u.id);return safeReply(i,{embeds:[info(r?`<@${u.id}> — Level **${r.level}** | Points **${r.points}**`:'Staff نیست.')],flags:MessageFlags.Ephemeral});}
  const hm=hierarchyMessage(i,u);if(hm&&!owner(i.user.id))return safeReply(i,{embeds:[err(hm)],flags:MessageFlags.Ephemeral});
  if(s==='setlevel'){const level=i.options.getInteger('level'),reason=stripMentions(i.options.getString('reason')||'manual set'),result=await staff.changeLevel(i.guild,u,i.member,level,'SET_LEVEL',reason);return safeReply(i,{embeds:[result.ok?ok(`Staff Level: ${result.old} → ${result.next}`):err(result.message)],flags:MessageFlags.Ephemeral});}
  const result=await staff.changeRank(i.guild,u,i.member,s==='rankup'?1:-1,stripMentions(i.options.getString('reason')||'بدون دلیل'));return safeReply(i,{embeds:[result.ok?ok(`${result.action}: ${result.old} → ${result.next}`):err(result.message)],flags:MessageFlags.Ephemeral});
}

async function handleTicket(i,s){
  const gid=i.guild.id;
  // Ticket actions may perform multiple Discord API calls; defer up front.
  await deferEphemeral(i);
  if(s==='panel'){
    if(!await need(i,'staff'))return;
    const title=i.options.getString('title'),text=i.options.getString('text'),keys=[...new Set(i.options.getString('types').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean))].slice(0,25);const cat=i.options.getChannel('category'),role=i.options.getRole('supportrole');if(!role)return safeReply(i,{embeds:[err('Ticket Support Role الزامی است.')],flags:MessageFlags.Ephemeral});const me=i.guild.members.me;if(role.managed||!me||role.position>=me.roles.highest.position)return safeReply(i,{embeds:[err('Ticket Support Role باید پایین‌تر از Role بات باشد.')],flags:MessageFlags.Ephemeral});if(cat&&cat.type!==ChannelType.GuildCategory)return safeReply(i,{embeds:[err('Category نامعتبر است.')],flags:MessageFlags.Ephemeral});
    const all=tickets.getTypes(gid);const rows=[];for(const k of keys){if(!all[k])continue;let b=new ButtonBuilder().setCustomId(`ticket_open:${k}`).setLabel(String(all[k].name).slice(0,80)).setStyle(ButtonStyle.Primary);b=buttonWithEmoji(b,all[k].emoji||'🎫');let row=rows[rows.length-1];if(!row||row.components.length>=5){row=new ActionRowBuilder();rows.push(row);}row.addComponents(b);}if(!rows.length)return safeReply(i,{embeds:[err('هیچ Ticket Type معتبری انتخاب نشده.')],flags:MessageFlags.Ephemeral});
    const oldRole=tickets.supportRoleId(i.guild);
    const panelMessage=await i.channel.send({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle(title).setDescription(text)],components:rows});
    const syncFailures=await tickets.syncSupportRole(i.guild,oldRole,role.id);
    if(syncFailures.length){await panelMessage.delete().catch(()=>{});return safeReply(i,{embeds:[err(`Support Role تنظیم نشد؛ ${syncFailures.length} Ticket قدیمی Sync نشد.`)],flags:MessageFlags.Ephemeral});}
    try{await setSettings(gid,{ticket:{categoryId:cat?.id||null,supportRoleId:role.id}});}catch(error){await tickets.syncSupportRole(i.guild,role.id,oldRole).catch(()=>{});await panelMessage.delete().catch(()=>{});return safeReply(i,{embeds:[err(`تنظیمات Ticket ذخیره نشد: ${clamp(error.message,500)}`)],flags:MessageFlags.Ephemeral});}
    await sendLog(i.guild,'ticket',{action:'panel_created',support_role:role.id,by:i.user.tag});return safeReply(i,{embeds:[ok('Ticket Panel ساخته شد و Ticket Support Role اعمال شد.')],flags:MessageFlags.Ephemeral});
  }
  if(s==='setrole'){
    if(!await need(i,'staff'))return;
    const role=i.options.getRole('role'),me=i.guild.members.me;
    if(!role||role.managed||!me||role.id===i.guild.id||role.position>=me.roles.highest.position)return safeReply(i,{embeds:[err('Ticket Support Role باید قابل مدیریت و پایین‌تر از Role بات باشد.')],flags:MessageFlags.Ephemeral});
    const old=tickets.supportRoleId(i.guild),failures=await tickets.syncSupportRole(i.guild,old,role.id);
    if(failures.length)return safeReply(i,{embeds:[err(`Support Role تغییر نکرد؛ ${failures.length} مورد Sync نشد.`)],flags:MessageFlags.Ephemeral});
    try{await setSettings(gid,{ticket:{supportRoleId:role.id}});}catch(error){const rollback=await tickets.syncSupportRole(i.guild,role.id,old).catch(e=>[{ticket:'rollback',error:e.message}]);return safeReply(i,{embeds:[err(`تنظیمات ذخیره نشد و Roleها rollback شدند.${rollback.length?' وضعیت Ticketها را بررسی کن.':''}`)],flags:MessageFlags.Ephemeral});}
    await sendLog(i.guild,'ticket',{action:'support_role_set',old_role:old||'none',role:role.id,by:i.user.tag});
    return safeReply(i,{embeds:[ok(`Ticket Support Role → <@&${role.id}>`)],flags:MessageFlags.Ephemeral});
  }
  if(s==='addtype'){if(!await need(i,'staff'))return;const t=tickets.getTypes(gid),key=i.options.getString('key').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,30);if(!key)return safeReply(i,{embeds:[err('Key نامعتبر است.')],flags:MessageFlags.Ephemeral});t[key]={name:clamp(i.options.getString('name'),80),emoji:safeEmoji(i.options.getString('emoji')||'🎫')||'🎫',prefix:(i.options.getString('prefix')||key).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,30)};await tickets.saveTypes(gid,t);return safeReply(i,{embeds:[ok(`Ticket Type **${key}** اضافه شد.`)],flags:MessageFlags.Ephemeral});}
  if(s==='leaderboard'){if(!await need(i,'staff'))return;const ch=i.options.getChannel('channel');if(!textChannel(ch))return safeReply(i,{embeds:[err('Channel معتبر نیست.')],flags:MessageFlags.Ephemeral});const me=i.guild.members.me;if(!me||!ch.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))return safeReply(i,{embeds:[err('Bot در این Channel دسترسی ارسال ندارد.')],flags:MessageFlags.Ephemeral});await setSettings(gid,{ticket:{claimLeaderboardChannelId:ch.id,claimLeaderboardMessageId:null}});return safeReply(i,{embeds:[ok(`Claim Leaderboard هر ۶ ساعت در <#${ch.id}> ارسال می‌شود.`)],flags:MessageFlags.Ephemeral});}
  if(s==='settings'){const cfg=getSettings(gid).ticket||{};return safeReply(i,{embeds:[info(`Support Role: ${cfg.supportRoleId?`<@&${cfg.supportRoleId}>`:'تنظیم نشده'}\nCategory: ${cfg.categoryId?`<#${cfg.categoryId}>`:'تنظیم نشده'}\nTypes: ${Object.keys(tickets.getTypes(gid)).join(', ')}`)],flags:MessageFlags.Ephemeral});}
  const ticket=tickets.getByChannel(gid,i.channel.id);if(!ticket)return safeReply(i,{embeds:[err('این Channel یک Ticket ثبت‌شده نیست.')],flags:MessageFlags.Ephemeral});
  if(s==='claim')return safeReply(i,{embeds:[await tickets.claim(i.guild,ticket.id,i.user.id,i.member)?ok('Ticket Claim شد.'):err('Claim ناموفق بود؛ فقط Ticket Support Role دسترسی دارد یا Ticket قبلاً Claim شده.')],flags:MessageFlags.Ephemeral});
  if(s==='close'){const reason=stripMentions(i.options.getString('reason')||'بدون دلیل');return safeReply(i,{embeds:[await tickets.close(i.guild,ticket.id,i.member,reason)?ok('Ticket بسته شد.'):err('بستن Ticket ناموفق بود.')],flags:MessageFlags.Ephemeral});}
  if(s==='reopen')return safeReply(i,{embeds:[await tickets.reopen(i.guild,ticket.id,i.member)?ok('Ticket دوباره باز شد.'):err('Reopen ناموفق بود.')],flags:MessageFlags.Ephemeral});
  if(s==='transcript'){const buf=await tickets.transcript(i.guild,ticket.id,i.member).catch(e=>{console.error('[TRANSCRIPT]',e.message);return null});if(!buf)return safeReply(i,{embeds:[err('ساخت Transcript ناموفق بود.')],flags:MessageFlags.Ephemeral});return safeReply(i,{embeds:[ok('Transcript آماده شد.')],files:[new AttachmentBuilder(buf,{name:`ticket-${ticket.id}.txt`})],flags:MessageFlags.Ephemeral});}
  const u=i.options.getUser('user');const done=s==='add'?await tickets.addUser(i.guild,ticket.id,u.id,i.member):await tickets.removeUser(i.guild,ticket.id,u.id,i.member);return safeReply(i,{embeds:[done?ok(`${s==='add'?'کاربر اضافه':'کاربر حذف'} شد.`):err('عملیات ناموفق بود.')],flags:MessageFlags.Ephemeral});
}

async function handleGiveaway(i,s){
  const giveawayRole=getSettings(i.guild.id).accessRoles?.giveaway;
  if(!giveawayRole || !hasStrictRole(i.member,giveawayRole)) { await safeReply(i,{embeds:[err('فقط GiveAway Access Role می‌تواند Giveaway را مدیریت کند.')],flags:MessageFlags.Ephemeral}); return; }
  await deferEphemeral(i);
  if(s==='start'){
    const g=giveaways.create(i.guild,i.channel,stripMentions(i.options.getString('prize')),i.options.getInteger('minutes'),i.options.getString('link'));
    let sentMessage=null;try{sentMessage=await i.channel.send({embeds:[giveaways.embed(g)],components:[giveaways.row(g,false,0,1)]});const r=db.prepare('UPDATE giveaways SET message_id=? WHERE id=? AND message_id IS NULL').run(sentMessage.id,g.id);if(!r.changes)throw new Error('GIVEAWAY_MESSAGE_DB_FAILED');}
    catch(error){if(sentMessage)await sentMessage.delete().catch(()=>{});db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id=?').run(g.id);db.prepare('DELETE FROM giveaways WHERE id=? AND ended=0').run(g.id);throw error;}
    await sendLog(i.guild,'giveaway',{action:'created',id:g.id,prize:g.prize,ends_at:g.ends_at,by:i.user.tag});return safeReply(i,{embeds:[ok(`Giveaway #${g.id} ساخته شد.`)],flags:MessageFlags.Ephemeral});
  }
  const requestedId=i.options.getInteger('id');const g=requestedId?db.prepare('SELECT * FROM giveaways WHERE guild_id=? AND channel_id=? AND id=? AND ended=0').get(i.guild.id,i.channel.id,requestedId):db.prepare('SELECT * FROM giveaways WHERE guild_id=? AND channel_id=? AND ended=0 ORDER BY id DESC LIMIT 1').get(i.guild.id,i.channel.id);if(!g)return safeReply(i,{embeds:[err('Giveaway فعالی در این Channel نیست.')],flags:MessageFlags.Ephemeral});await giveaways.finish(i.guild,g,true);return safeReply(i,{embeds:[ok('Giveaway پایان یافت و Winner کاملاً تصادفی انتخاب شد.')],flags:MessageFlags.Ephemeral});
}

async function handleDrop(i,s){
  const giveawayRole=getSettings(i.guild.id).accessRoles?.giveaway;
  if(!giveawayRole || !hasStrictRole(i.member,giveawayRole)) { await safeReply(i,{embeds:[err('فقط GiveAway Access Role می‌تواند Drop را مدیریت کند.')],flags:MessageFlags.Ephemeral}); return; }
  await deferEphemeral(i);
  if(s==='text'||s==='button'){
    const d=drops.create(i.guild,i.channel,s==='text'?'text':'button',s==='text'?i.options.getString('trigger'):null,stripMentions(i.options.getString('prize')),i.options.getInteger('minutes'));
    let sentMessage=null;try{sentMessage=await i.channel.send({embeds:[drops.embed(d)],components:s==='button'?[drops.row(d)]:[]});const r=db.prepare('UPDATE drops SET message_id=? WHERE id=? AND message_id IS NULL').run(sentMessage.id,d.id);if(!r.changes)throw new Error('DROP_MESSAGE_DB_FAILED');}
    catch(error){if(sentMessage)await sentMessage.delete().catch(()=>{});db.prepare('DELETE FROM drops WHERE id=? AND ended=0').run(d.id);throw error;}
    await sendLog(i.guild,'drop',{action:'created',drop_id:d.id,channel:i.channel.id,by:i.user.tag,ends_at:d.ends_at});return safeReply(i,{embeds:[ok(`Drop #${d.id} ساخته شد.`)],flags:MessageFlags.Ephemeral});
  }
  const ds=drops.active(i.guild.id,'text',i.channel.id).concat(drops.active(i.guild.id,'button',i.channel.id));
  if(s==='end'){const requestedId=i.options.getInteger('id');const targets=requestedId?ds.filter(d=>d.id===requestedId):ds;for(const d of targets)await drops.endWithMessage(i.guild,d,'ended_manual');return safeReply(i,{embeds:[ok('Dropهای همین Channel پایان داده شدند.')],flags:MessageFlags.Ephemeral});}
  return safeReply(i,{embeds:[info(ds.length?ds.map(d=>`#${d.id} — ${d.prize} — ${d.kind} — <t:${Math.floor(d.ends_at/1000)}:R>`).join('\n'):'Drop فعالی نیست.')],flags:MessageFlags.Ephemeral});
}

async function exchangeManage(i,action,requestId){
  const ex=getSettings(i.guild.id).exchange||{};
  if(!ex.accessRoleId||!hasStrictRole(i.member,ex.accessRoleId))return safeReply(i,{embeds:[err('فقط Exchange Access Role می‌تواند Exchange را تأیید یا رد کند.')],flags:MessageFlags.Ephemeral});
  const req=db.prepare('SELECT * FROM exchange_requests WHERE guild_id=? AND id=?').get(i.guild.id,requestId);if(!req||req.status!=='pending')return safeReply(i,{embeds:[err('درخواست Exchange پیدا نشد یا قبلاً بررسی شده.')],flags:MessageFlags.Ephemeral});
  const r=db.prepare('UPDATE exchange_requests SET status=?,decided_by=?,decided_at=? WHERE guild_id=? AND id=? AND status="pending"').run(action,i.user.id,Date.now(),i.guild.id,req.id);if(!r.changes)return safeReply(i,{embeds:[err('این درخواست همزمان توسط فرد دیگری بررسی شد.')],flags:MessageFlags.Ephemeral});
  const ch=await i.guild.channels.fetch(req.channel_id).catch(()=>null);const m=await ch?.messages.fetch(req.message_id).catch(()=>null);const color=action==='accept'?0x57F287:0xED4245;const title=action==='accept'?'✅ Exchange Accepted':'❌ Exchange Rejected';
  if(m)await m.edit({embeds:[new EmbedBuilder().setColor(color).setTitle(title).setDescription(req.text).addFields({name:'درخواست‌دهنده',value:`<@${req.requester_id}>`,inline:true},{name:'بررسی‌کننده',value:`<@${i.user.id}>`,inline:true})],components:[]}).catch(e=>{console.error('[EXCHANGE MESSAGE]',e.message);ch?.send({content:`Exchange #${req.id} ${action==='accept'?'تأیید':'رد'} شد توسط <@${i.user.id}>.`,allowedMentions:{users:[i.user.id]}}).catch(()=>{})});
  if(action==='accept'){const outId=getSettings(i.guild.id).exchange?.approvedChannelId;const out=outId?await i.guild.channels.fetch(outId).catch(()=>null):null;if(out?.isTextBased()){await out.send({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('💱 Exchange Approved').setDescription(req.text).addFields({name:'درخواست‌دهنده',value:`<@${req.requester_id}>`,inline:true},{name:'تأییدکننده',value:`<@${i.user.id}>`,inline:true},{name:'Request ID',value:String(req.id),inline:true})],allowedMentions:{users:[req.requester_id,i.user.id]}}).catch(e=>console.error('[EXCHANGE OUTPUT]',e.message));}}
  await sendLog(i.guild,'exchange',{action,request:req.id,requester:req.requester_id,by:i.user.tag});return safeReply(i,{embeds:[ok('Exchange به‌روزرسانی شد.')],flags:MessageFlags.Ephemeral});
}

async function handleMusic(i,s){
  if(!await need(i,'music'))return;
  await deferEphemeral(i);
  const voice=i.member?.voice?.channel;
  if(s==='play'||['skip','pause','resume','stop','leave','volume','loop','shuffle'].includes(s)){if(!voice)return safeReply(i,{embeds:[err('اول وارد Voice شو.')],flags:MessageFlags.Ephemeral});const me=i.guild.members.me;if(!me||!voice.permissionsFor(me).has([PermissionFlagsBits.Connect,PermissionFlagsBits.Speak]))return safeReply(i,{embeds:[err('Bot به Connect/Speak در Voice دسترسی ندارد.')],flags:MessageFlags.Ephemeral});const q=music.queue(i.guild.id);if(q&&q.channel?.id&&q.channel.id!==voice.id)return safeReply(i,{embeds:[err(`بات الان در <#${q.channel.id}> است.`)],flags:MessageFlags.Ephemeral});if(q&&['skip','pause','resume','stop','leave','volume','loop','shuffle'].includes(s)){const inSame=q.channel?.id===voice.id;if(!inSame)return safeReply(i,{embeds:[err('باید داخل همان Voice بات باشی.')],flags:MessageFlags.Ephemeral});}
  }
  try{
    if(s==='play'){const stay=!!music247.get(i.guild.id);const track=await music.play(i.guild,voice,i.options.getString('query'),i.user,stay,i.channel);await sendLog(i.guild,'music',{action:'play',track:track.title,by:i.user.tag,channel:voice.id});return safeReply(i,{embeds:[ok(`🎵 **${clamp(track.title,250)}** به Queue اضافه شد.`)],flags:MessageFlags.Ephemeral});}
    if(s==='queue'){const q=music.queue(i.guild.id);if(!q)return safeReply(i,{embeds:[info('Queue فعالی نیست.')],flags:MessageFlags.Ephemeral});const rows=q.tracks.toArray();return safeReply(i,{embeds:[info(`${q.currentTrack?`Now: **${clamp(q.currentTrack.title,250)}**\n`:''}${rows.length?rows.slice(0,20).map((t,n)=>`${n+1}. ${clamp(t.title,150)}`).join('\n'):'Queue خالی است.'}`)],flags:MessageFlags.Ephemeral});}
    if(s==='nowplaying'){const st=music.status(i.guild.id);return safeReply(i,{embeds:[st?.track?info(`🎵 **${clamp(st.track.title,250)}**\nVoice: <#${st.channelId}>\nPaused: ${st.paused?'Yes':'No'}\nVolume: ${st.volume??'?'}\nLoop: ${st.repeatMode}`):info('هیچ آهنگی در حال پخش نیست.')],flags:MessageFlags.Ephemeral});}
    if(s==='shuffle'){const q=music.queue(i.guild.id);if(!q)return safeReply(i,{embeds:[err('Queue فعال نیست.')],flags:MessageFlags.Ephemeral});q.tracks.shuffle();return safeReply(i,{embeds:[ok('Queue Shuffle شد.')],flags:MessageFlags.Ephemeral});}
    if(s==='247'){
      const enabled=i.options.getBoolean('enabled');if(enabled){if(!voice)return safeReply(i,{embeds:[err('برای 24/7 باید داخل Voice باشی.')],flags:MessageFlags.Ephemeral});music247.set(i.guild.id,voice.id,i.channel.id);await music.ensure247(i.guild,voice,i.channel);await sendLog(i.guild,'music',{action:'247_enable',voice:voice.id,by:i.user.tag});return safeReply(i,{embeds:[ok(`24/7 فعال شد در <#${voice.id}>.`)],flags:MessageFlags.Ephemeral});}
      music247.disable(i.guild.id);const q=music.queue(i.guild.id);if(q){q.options.leaveOnEnd=true;q.options.leaveOnStop=true;q.options.leaveOnEmpty=true;if(!q.currentTrack&&q.tracks?.size===0)await q.delete().catch(()=>{});}await sendLog(i.guild,'music',{action:'247_disable',by:i.user.tag});return safeReply(i,{embeds:[ok('24/7 خاموش شد و اتصال آزاد شد.')],flags:MessageFlags.Ephemeral});
    }
    await music.control(i.guild.id,s,i.options.getInteger('value')??i.options.getInteger('mode'));await sendLog(i.guild,'music',{action:s,by:i.user.tag});return safeReply(i,{embeds:[ok(`Music: ${s}`)],flags:MessageFlags.Ephemeral});
  }catch(e){const msg=e.message==='MUSIC_ALREADY_IN_ANOTHER_VOICE'?'بات در Voice دیگری است.':e.message;await sendLog(i.guild,'music',{action:'error',by:i.user.tag,error:msg}).catch(()=>{});return safeReply(i,{embeds:[err(msg||'خطای Music رخ داد.')],flags:MessageFlags.Ephemeral});}
}

async function handleEmbedCommand(i){
  if(!owner(i.user.id)) return safeReply(i,{embeds:[err('فقط Owner اجازه استفاده از /embed را دارد.')],flags:MessageFlags.Ephemeral});
  await deferEphemeral(i);
  const title=stripMentions(i.options.getString('title')||'').slice(0,256);
  const text=stripMentions(i.options.getString('text')||'').slice(0,4000);
  const raw=i.options.getString('buttons')||'';
  const pairs=raw.split('||').map(x=>x.trim()).filter(Boolean);
  if(pairs.length<1||pairs.length>25)return safeReply(i,{embeds:[err('تعداد دکمه‌ها باید بین 1 تا 25 باشد. برای 10+ دکمه هم پشتیبانی می‌شود.')],flags:MessageFlags.Ephemeral});
  const buttons=[];
  for(const pair of pairs){
    const idx=pair.indexOf('=');
    if(idx<1)return safeReply(i,{embeds:[err('فرمت دکمه‌ها اشتباه است. نمونه: دکمه اول=متن مخفی || دکمه دوم=متن مخفی')],flags:MessageFlags.Ephemeral});
    const label=pair.slice(0,idx).trim().slice(0,80); const response=stripMentions(pair.slice(idx+1).trim()).slice(0,2000);
    if(!label||!response)return safeReply(i,{embeds:[err('نام و متن مخفی هر دکمه نباید خالی باشد.')],flags:MessageFlags.Ephemeral});
    buttons.push({label,response});
  }
  const message=await i.channel.send({embeds:[new EmbedBuilder().setTitle(title).setDescription(text)]});
  const rows=[];
  for(let n=0;n<buttons.length;n++){let row=rows[rows.length-1];if(!row||row.components.length>=5){row=new ActionRowBuilder();rows.push(row);}row.addComponents(new ButtonBuilder().setCustomId(`emb:${message.id}:${n}`).setLabel(buttons[n].label).setStyle(ButtonStyle.Secondary));}
  try{
    await message.edit({components:rows});
    const insert=db.prepare('INSERT INTO embed_buttons(message_id,button_index,label,response) VALUES(?,?,?,?)');
    const tx=db.transaction(()=>{db.prepare('DELETE FROM embed_buttons WHERE message_id=?').run(message.id);for(let n=0;n<buttons.length;n++)insert.run(message.id,n,buttons[n].label,buttons[n].response);}); tx();
  }catch(error){await message.delete().catch(()=>{});throw error;}
  return safeReply(i,{embeds:[ok(`Embed ساخته شد با **${buttons.length}** دکمه.
متن مخفی هر دکمه با کلیک به‌صورت خصوصی نمایش داده می‌شود.`)],flags:MessageFlags.Ephemeral});
}

async function handleSlash(i){
  const n=i.commandName,s=i.options.getSubcommand(false);
  if(n==='setticketlog')return handleSetTicketLog(i);
  if(n==='embed')return handleEmbedCommand(i);
  if(n==='rerole'){
    if(!owner(i.user.id))return safeReply(i,{embeds:[err('فقط Owner اجازه استفاده از /rerole را دارد.')],flags:MessageFlags.Ephemeral});
    await deferEphemeral(i);
    const g=db.prepare('SELECT * FROM giveaways WHERE guild_id=? AND channel_id=? AND ended=1 ORDER BY id DESC LIMIT 1').get(i.guild.id,i.channel.id);
    if(!g)return safeReply(i,{embeds:[err('Giveaway تمام‌شده‌ای در این Channel پیدا نشد.')],flags:MessageFlags.Ephemeral});
    const r=await giveaways.reroll(i.guild,g);
    if(r.error==='GIVEAWAY_NOT_ENOUGH_PARTICIPANTS')return safeReply(i,{embeds:[err('برای Reroll حداقل دو شرکت‌کننده لازم است.')],flags:MessageFlags.Ephemeral});
    if(r.error)return safeReply(i,{embeds:[err('Reroll ناموفق بود.')],flags:MessageFlags.Ephemeral});
    return safeReply(i,{embeds:[ok(`Giveaway #${g.id} دوباره قرعه‌کشی شد. برنده جدید: <@${r.winner}>`)],flags:MessageFlags.Ephemeral});
  }
  if(n==='banch'){
    if(!hasStrictRole(i.member,banchAccessRoleId))return safeReply(i,{embeds:[err('برای /banch دسترسی لازم را نداری.')],flags:MessageFlags.Ephemeral});
    await deferEphemeral(i);
    const target=await getMember(i.guild,i.options.getUser('user')); if(!target)return safeReply(i,{embeds:[err('Member پیدا نشد.')],flags:MessageFlags.Ephemeral});
    const role=await i.guild.roles.fetch(banchRoleId).catch(()=>null); const me=i.guild.members.me;
    if(!role||role.managed||!me||role.position>=me.roles.highest.position)return safeReply(i,{embeds:[err('Role مخصوص Banch پیدا نشد یا توسط Bot قابل مدیریت نیست.')],flags:MessageFlags.Ephemeral});
    if(target.roles.highest.position>=me.roles.highest.position)return safeReply(i,{embeds:[err('Role کاربر بالاتر یا هم‌سطح Role بات است.')],flags:MessageFlags.Ephemeral});
    if(target.roles.cache.has(role.id))return safeReply(i,{embeds:[info(`<@${target.id}> این Role را از قبل دارد.`)],flags:MessageFlags.Ephemeral});
    await target.roles.add(role,`Banch by ${i.user.tag}`); await sendLog(i.guild,'moderation',{action:'banch',target:target.user.tag,role:role.id,by:i.user.tag});
    return safeReply(i,{embeds:[ok(`Role <@&${role.id}> به <@${target.id}> داده شد.`)],flags:MessageFlags.Ephemeral});
  }
  if(n==='xp')return handleXp(i,s);if(n==='logs')return handleLogs(i,s);if(n==='invite')return handleInvite(i,s);if(n==='staff')return handleStaff(i,s);if(n==='ticket')return handleTicket(i,s);if(n==='giveaway')return handleGiveaway(i,s);if(n==='drop')return handleDrop(i,s);if(n==='music')return handleMusic(i,s);
  if(n==='exchange'){
    await deferEphemeral(i);
    const ex=getSettings(i.guild.id).exchange||{};if(!ex.channelId||!ex.accessRoleId)return safeReply(i,{embeds:[err('Exchange Channel و Exchange Access Role را ابتدا تنظیم کن.')],flags:MessageFlags.Ephemeral});const ch=await i.guild.channels.fetch(ex.channelId).catch(()=>null);if(!textChannel(ch))return safeReply(i,{embeds:[err('Exchange Channel معتبر نیست.')],flags:MessageFlags.Ephemeral});const text=stripMentions(i.options.getString('text')).slice(0,4000);const reqId=db.prepare('INSERT INTO exchange_requests(guild_id,channel_id,requester_id,text,status) VALUES(?,?,?,?,"pending")').run(i.guild.id,ch.id,i.user.id,text).lastInsertRowid;let msg;try{msg=await ch.send({embeds:[new EmbedBuilder().setColor(0x1ABC9C).setTitle('💱 Exchange Request').setDescription(text).addFields({name:'درخواست‌دهنده',value:`<@${i.user.id}>`,inline:true},{name:'Request ID',value:String(reqId),inline:true})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`exchange:accept:${reqId}`).setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`exchange:reject:${reqId}`).setLabel('Reject').setEmoji('❌').setStyle(ButtonStyle.Danger))],allowedMentions:{users:[i.user.id]}});const updated=db.prepare('UPDATE exchange_requests SET message_id=? WHERE id=? AND status="pending"').run(msg.id,reqId);if(!updated.changes){await msg.delete().catch(()=>{});throw new Error('EXCHANGE_REQUEST_DB_FAILED');}}catch(e){db.prepare('DELETE FROM exchange_requests WHERE id=?').run(reqId);throw e;}await sendLog(i.guild,'exchange',{action:'created',request:reqId,requester:i.user.tag});return safeReply(i,{embeds:[ok(`درخواست Exchange ساخته شد. ID: ${reqId}`)],flags:MessageFlags.Ephemeral});
  }
  if(n==='setex'){if(!await needAdmin(i))return;await deferEphemeral(i);const channel=i.options.getChannel('channel'),me=i.guild.members.me;if(!textChannel(channel)||!me||!channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))return safeReply(i,{embeds:[err('Exchange Output Channel معتبر نیست یا Bot دسترسی ارسال ندارد.')],flags:MessageFlags.Ephemeral});await setSettings(i.guild.id,{exchange:{approvedChannelId:channel.id}});return safeReply(i,{embeds:[ok(`Exchangeهای تأییدشده → <#${channel.id}>`)],flags:MessageFlags.Ephemeral});}
  if(n==='exchange-config'){if(!await needAdmin(i))return;await deferEphemeral(i);const role=i.options.getRole('role'),channel=i.options.getChannel('channel'),me=i.guild.members.me;if(!textChannel(channel)||role.managed||!me||!channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))return safeReply(i,{embeds:[err('Channel یا Exchange Role نامعتبر است یا Bot دسترسی ارسال ندارد.')],flags:MessageFlags.Ephemeral});await setSettings(i.guild.id,{exchange:{channelId:channel.id,accessRoleId:role.id}});await sendLog(i.guild,'exchange',{action:'config',channel:channel.id,role:role.id,by:i.user.tag});return safeReply(i,{embeds:[ok(`Exchange Channel: <#${channel.id}>\nExchange Access Role: <@&${role.id}>`)],flags:MessageFlags.Ephemeral});}
  if(n==='exchange-manage')return exchangeManage(i,i.options.getString('action'),i.options.getInteger('request'));
  if(n==='addemote'){
    if(!await need(i,'emote'))return;await deferEphemeral(i);const perm=botPermissionMessage(i.guild,PermissionFlagsBits.ManageGuildExpressions,'Manage Expressions');if(perm)return safeReply(i,{embeds:[err(perm)],flags:MessageFlags.Ephemeral});const raw=i.options.getString('emoji').trim();const match=raw.match(/^<a?:([\w~]+):(\d{17,20})>$/);const animated=!!match&&raw.startsWith('<a:');const limit=animated?(i.guild.maximumEmojis?.animated||0):(i.guild.maximumEmojis?.static||0);const count=i.guild.emojis.cache.filter(e=>!!e.animated===animated).size;if(limit&&count>=limit)return safeReply(i,{embeds:[err(`ظرفیت ${animated?'Animated':'Static'} Emojiهای سرور پر است.`)],flags:MessageFlags.Ephemeral});const name=(i.options.getString('name')||match?.[1]||'emoji').replace(/[^a-zA-Z0-9_]/g,'').slice(0,32);if(!name)return safeReply(i,{embeds:[err('نام Emoji نامعتبر است.')],flags:MessageFlags.Ephemeral});const url=match?`https://cdn.discordapp.com/emojis/${match[2]}.${animated?'gif':'png'}?size=4096`:raw;if(!/^https?:\/\//i.test(url))return safeReply(i,{embeds:[err('Emoji باید URL یا Custom Emoji معتبر باشد.')],flags:MessageFlags.Ephemeral});try{const created=await i.guild.emojis.create({attachment:url,name});await sendLog(i.guild,'emote',{action:'created',name:created.name,id:created.id,by:i.user.tag});return safeReply(i,{embeds:[ok(`Emoji اضافه شد: ${created}`)],flags:MessageFlags.Ephemeral});}catch(e){return safeReply(i,{embeds:[err(`افزودن Emoji ناموفق بود: ${clamp(e.message,1000)}`)],flags:MessageFlags.Ephemeral});}
  }
  if(n==='guess'){
    if(!await need(i,'guess'))return;await deferEphemeral(i);const gid=i.guild.id;
    if(s==='start'){const r=await guess.start(gid,i.channel.id,i.user.id,i.options.getInteger('min'),i.options.getInteger('max'));if(r.error)return safeReply(i,{embeds:[err(r.error)],flags:MessageFlags.Ephemeral});let dmSent=true;try{const u=await client.users.fetch(r.starter_id);await u.send({embeds:[new EmbedBuilder().setColor(0xF39C12).setTitle('🔐 Guess Number Secret').setDescription(`عدد مخفی بازی Channel <#${r.channel_id}> انتخاب شد.
بازه: **${r.min} تا ${r.max}**`) .addFields({name:'عدد مخفی',value:`**${r.number}**`})]});}catch{dmSent=false;}await sendLog(i.guild,'guess',{action:'start',by:i.user.tag,channel:i.channel.id,min:r.min,max:r.max,secret_dm:dmSent});return safeReply(i,{embeds:[ok(`بازی شروع شد: **${r.min} تا ${r.max}**${dmSent?'':'\n⚠️ ارسال DM عدد مخفی ممکن نشد.'}`)],flags:MessageFlags.Ephemeral});}
    if(s==='stop'){if(!guess.stop(gid,i.channel.id))return safeReply(i,{embeds:[err('بازی فعالی در این Channel نیست.')],flags:MessageFlags.Ephemeral});await sendLog(i.guild,'guess',{action:'stop',by:i.user.tag,channel:i.channel.id});return safeReply(i,{embeds:[ok('بازی متوقف شد.')],flags:MessageFlags.Ephemeral});}
    const r=guess.get(gid,i.channel.id);return safeReply(i,{embeds:[info(r?`بازی فعال: **${r.min} تا ${r.max}**`: 'بازی فعالی نیست.')],flags:MessageFlags.Ephemeral});
  }
  if(n==='mod'){
    if(['warn','unwarn','untimeout','unban'].includes(s)&&!owner(i.user.id))return safeReply(i,{embeds:[err('این دستور فقط برای Owner است.')],flags:MessageFlags.Ephemeral});
    if(!await need(i,'moderation'))return;await deferEphemeral(i);const reason=stripMentions(i.options.getString('reason')||'بدون دلیل');
    try{
      if(s==='unban'){const id=i.options.getString('user');if(!/^\d{17,20}$/.test(id))return safeReply(i,{embeds:[err('User ID نامعتبر است.')],flags:MessageFlags.Ephemeral});const perm=botPermissionMessage(i.guild,PermissionFlagsBits.BanMembers,'Ban Members');if(perm)return safeReply(i,{embeds:[err(perm)],flags:MessageFlags.Ephemeral});await i.guild.members.unban(id,reason);await sendLog(i.guild,'moderation',{action:'unban',user:id,by:i.user.tag,reason});return safeReply(i,{embeds:[ok('Unban انجام شد.')],flags:MessageFlags.Ephemeral});}
      const u=await getMember(i.guild,i.options.getUser('user'));if(!u)return safeReply(i,{embeds:[err('Member پیدا نشد.')],flags:MessageFlags.Ephemeral});const hm=hierarchyMessage(i,u);if(hm&&!owner(i.user.id))return safeReply(i,{embeds:[err(hm)],flags:MessageFlags.Ephemeral});
      if(s==='ban'){const p=botPermissionMessage(i.guild,PermissionFlagsBits.BanMembers,'Ban Members');if(p)return safeReply(i,{embeds:[err(p)],flags:MessageFlags.Ephemeral});await u.ban({reason});}
      if(s==='kick'){const p=botPermissionMessage(i.guild,PermissionFlagsBits.KickMembers,'Kick Members');if(p)return safeReply(i,{embeds:[err(p)],flags:MessageFlags.Ephemeral});await u.kick(reason);}
      if(s==='timeout'){const p=botPermissionMessage(i.guild,PermissionFlagsBits.ModerateMembers,'Moderate Members');if(p)return safeReply(i,{embeds:[err(p)],flags:MessageFlags.Ephemeral});await u.timeout(i.options.getInteger('minutes')*60000,reason);}
      if(s==='untimeout'){const p=botPermissionMessage(i.guild,PermissionFlagsBits.ModerateMembers,'Moderate Members');if(p)return safeReply(i,{embeds:[err(p)],flags:MessageFlags.Ephemeral});await u.timeout(null,reason);}
      if(s==='warn'){
        db.prepare('INSERT INTO warnings(guild_id,user_id,moderator_id,reason,created_at) VALUES(?,?,?,?,?)').run(i.guild.id,u.id,i.user.id,reason,Date.now());
        const count=db.prepare('SELECT COUNT(*) AS c FROM warnings WHERE guild_id=? AND user_id=?').get(i.guild.id,u.id).c;
        if(count>=3){
          const p=botPermissionMessage(i.guild,PermissionFlagsBits.ModerateMembers,'Moderate Members');
          if(p)return safeReply(i,{embeds:[err(`Warning سوم ثبت شد، اما Timeout نشد: ${p}`)],flags:MessageFlags.Ephemeral});
          await u.timeout(120*60000,'۳ Warning — Timeout خودکار ۲ ساعته');
          let resetOk=true;
          try { db.prepare('DELETE FROM warnings WHERE guild_id=? AND user_id=?').run(i.guild.id,u.id); } catch(error) { resetOk=false; await sendLog(i.guild,'warning',{action:'auto_timeout_warning_reset_failed',target:u.user.tag,by:i.user.tag,error:error.message}).catch(()=>{}); }
          await sendLog(i.guild,'warning',{action:'auto_timeout_3_warnings',target:u.user.tag,by:i.user.tag,reason,timeout_minutes:120,warning_reset:resetOk});
          return safeReply(i,{embeds:[resetOk?ok('Warning سوم ثبت شد؛ کاربر به‌صورت خودکار ۲ ساعت Timeout شد و Warningها به صفر برگشت.'):warn('کاربر ۲ ساعت Timeout شد، اما Reset Warningها در دیتابیس ناموفق بود و در Log ثبت شد.')],flags:MessageFlags.Ephemeral});
        }
        await sendLog(i.guild,'warning',{action:'warn',target:u.user.tag,by:i.user.tag,reason,count});return safeReply(i,{embeds:[ok(`Warning ثبت شد. تعداد فعلی: **${count}/3**`)],flags:MessageFlags.Ephemeral});
      }
      if(s==='unwarn'){const r=db.prepare('DELETE FROM warnings WHERE id=(SELECT id FROM warnings WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 1)').run(i.guild.id,u.id);if(!r.changes)return safeReply(i,{embeds:[err('Warningی برای این کاربر وجود ندارد.')],flags:MessageFlags.Ephemeral});await sendLog(i.guild,'warning',{action:'unwarn',target:u.user.tag,by:i.user.tag});return safeReply(i,{embeds:[ok('آخرین Warning حذف شد.')],flags:MessageFlags.Ephemeral});}
      if(s==='warnings'){const rows=db.prepare('SELECT * FROM warnings WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 20').all(i.guild.id,u.id);return safeReply(i,{embeds:[info(rows.length?rows.map((r,n)=>`${n+1}. <@${r.moderator_id}> — <t:${Math.floor(r.created_at/1000)}:R> — ${clamp(r.reason,200)}`).join('\n'):'هشداری ثبت نشده.')],flags:MessageFlags.Ephemeral});}
      await sendLog(i.guild,'moderation',{action:s,target:u.user.tag,by:i.user.tag,reason});return safeReply(i,{embeds:[ok('عملیات انجام شد.')],flags:MessageFlags.Ephemeral});
    }catch(e){await sendLog(i.guild,'moderation',{action:'error',error:e.message,by:i.user.tag}).catch(()=>{});return safeReply(i,{embeds:[err(`عملیات ناموفق بود: ${clamp(e.message,1000)}`)],flags:MessageFlags.Ephemeral});}
  }
  if(n==='welcome'){
    if(!await need(i,'staff'))return;const cfg={...(getSettings(i.guild.id).welcome||{})};if(s==='set'){const ch=i.options.getChannel('channel');const me=i.guild.members.me;if(!textChannel(ch))return safeReply(i,{embeds:[err('Channel معتبر نیست.')],flags:MessageFlags.Ephemeral});if(!me||!ch.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))return safeReply(i,{embeds:[err('Bot در این Channel دسترسی ارسال/Embed ندارد.')],flags:MessageFlags.Ephemeral});cfg.channelId=ch.id;cfg.text=stripMentions(i.options.getString('text')).slice(0,4000);await setSettings(i.guild.id,{welcome:cfg});return safeReply(i,{embeds:[ok(`Welcome → <#${ch.id}>`)],flags:MessageFlags.Ephemeral});}await setSettings(i.guild.id,{welcome:{}});return safeReply(i,{embeds:[ok('Welcome خاموش شد.')],flags:MessageFlags.Ephemeral});
  }
  if(n==='customcmd'){
    if(!await need(i,'staff'))return;const name=i.options.getString('name').toLowerCase().trim().slice(0,32);if(!/^[a-z0-9_-]+$/.test(name))return safeReply(i,{embeds:[err('نام Custom Command باید فقط شامل a-z، 0-9، _ یا - باشد.')],flags:MessageFlags.Ephemeral});if(s==='set')db.prepare('INSERT INTO custom_commands(guild_id,name,response) VALUES(?,?,?) ON CONFLICT(guild_id,name) DO UPDATE SET response=excluded.response').run(i.guild.id,name,stripMentions(i.options.getString('response')));else db.prepare('DELETE FROM custom_commands WHERE guild_id=? AND name=?').run(i.guild.id,name);return safeReply(i,{embeds:[ok('Custom Command به‌روزرسانی شد.')],flags:MessageFlags.Ephemeral});
  }
  if(n==='setaccessrole'){
    if(!await needAdmin(i))return;const role=i.options.getRole('role'),key=i.options.getString('type'),me=i.guild.members.me;if(!role||role.managed||role.id===i.guild.id)return safeReply(i,{embeds:[err('Role نامعتبر است.')],flags:MessageFlags.Ephemeral});const a={...(getSettings(i.guild.id).accessRoles||{})};a[key]=role.id;await setSettings(i.guild.id,{accessRoles:a});return safeReply(i,{embeds:[ok(`Access Role برای **${key}** → <@&${role.id}>`)],flags:MessageFlags.Ephemeral});
  }
  if(n==='ai'){
    if(!await need(i,'staff'))return;if(s==='setchannel'){const ch=i.options.getChannel('channel');const me=i.guild.members.me;if(!textChannel(ch))return safeReply(i,{embeds:[err('Channel معتبر نیست.')],flags:MessageFlags.Ephemeral});if(!me||!ch.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))return safeReply(i,{embeds:[err('Bot در این Channel دسترسی ارسال ندارد.')],flags:MessageFlags.Ephemeral});await setSettings(i.guild.id,{ai:{channelId:ch.id}});return safeReply(i,{embeds:[ok(`AI Channel → <#${ch.id}>`)],flags:MessageFlags.Ephemeral});}if(s==='disable'){await setSettings(i.guild.id,{ai:{}});return safeReply(i,{embeds:[ok('AI خاموش شد.')],flags:MessageFlags.Ephemeral});}ai.clear(i.guild.id);return safeReply(i,{embeds:[ok('حافظه AI پاک شد.')],flags:MessageFlags.Ephemeral});
  }
  if(n==='level'){const r=getXp(i.guild.id,i.user.id);return safeReply(i,{embeds:[info(`<@${i.user.id}>\nXP: **${r.xp}**\nLevel: **${r.level}**\nMessages: **${r.messages}**`)],flags:MessageFlags.Ephemeral});}
  if(n==='leaderboard'){const rows=db.prepare('SELECT * FROM xp_users WHERE guild_id=? ORDER BY xp DESC,level DESC LIMIT 20').all(i.guild.id);return safeReply(i,{embeds:[info(rows.length?rows.map((r,n)=>`${n+1}. <@${r.user_id}> — XP **${r.xp}** | L${r.level}`).join('\n'):'داده‌ای نیست.')],flags:MessageFlags.Ephemeral});}
  if(n==='banner'){const url=i.guild.bannerURL({size:2048});return safeReply(i,{embeds:[url?new EmbedBuilder().setColor(0x5865F2).setTitle(i.guild.name).setImage(url):info('این سرور Banner ندارد.') ]});}
  if(n==='health'){
    const s=getSettings(i.guild.id),me=i.guild.members.me, checks=[];
    const inviteReady=!!me?.permissions.has(PermissionFlagsBits.ManageGuild);const dbIntegrity=integrityCheck();
    const auditReady=!!me?.permissions.has(PermissionFlagsBits.ViewAuditLog);
    const voiceReady=!!me?.permissions.has(PermissionFlagsBits.Connect)&&!!me?.permissions.has(PermissionFlagsBits.Speak);
    checks.push(`DB: ${dbIntegrity==='ok'?'✅':'❌ '+dbIntegrity}`);checks.push(`Bot Manage Roles: ${me?.permissions.has(PermissionFlagsBits.ManageRoles)?'✅':'❌'}`);checks.push(`Bot Manage Channels: ${me?.permissions.has(PermissionFlagsBits.ManageChannels)?'✅':'❌'}`);checks.push(`Audit Log: ${auditReady?'✅':'❌'}`);checks.push(`Invite Tracking: ${inviteReady?'✅':'❌ Manage Guild'}`);checks.push(`Voice: ${voiceReady?'✅':'❌ Connect/Speak'}`);checks.push(`OpenAI Key: ${process.env.OPENAI_API_KEY?'✅':'❌'}`);checks.push(`AI Channel: ${s.ai?.channelId?`<#${s.ai.channelId}>`:'—'}`);checks.push(`Ticket Support: ${s.ticket?.supportRoleId?`<@&${s.ticket.supportRoleId}>`:'—'}`);checks.push(`Exchange: ${s.exchange?.accessRoleId?`<@&${s.exchange.accessRoleId}>`:'—'}`);return safeReply(i,{embeds:[info(checks.join('\n'))],flags:MessageFlags.Ephemeral});
  }
}

async function onInteraction(i){
  try{
    if(i.isChatInputCommand())return await handleSlash(i);
    if(i.isModalSubmit()) {
      const [kind,a]=i.customId.split(':');
      if(kind==='ticket_close_modal'){
        await deferEphemeral(i);
        const ticket=tickets.getById(Number(a));
        if(!ticket||ticket.guild_id!==i.guild?.id||ticket.channel_id!==i.channel?.id)return safeReply(i,{embeds:[err('Ticket معتبر نیست.')],flags:MessageFlags.Ephemeral});
        const reason=stripMentions(i.fields.getTextInputValue('reason')||'بدون دلیل');
        return safeReply(i,{embeds:[await tickets.close(i.guild,ticket.id,i.member,reason)?ok('Ticket بسته شد.'):err('بستن Ticket ناموفق بود.')],flags:MessageFlags.Ephemeral});
      }
    }
    if(!i.isButton())return;
    const [kind,a,b,c]=i.customId.split(':');
    if(kind==='ticket_open'){
      await deferEphemeral(i);const r=await tickets.create(i.guild,i,a);if(!r)return safeReply(i,{embeds:[err('Ticket Type یا تنظیمات Ticket معتبر نیست.')],flags:MessageFlags.Ephemeral});if(r.error)return safeReply(i,{embeds:[err(r.error)],flags:MessageFlags.Ephemeral});return safeReply(i,{embeds:[ok(`Ticket آماده شد: <#${r.channel.id}>`)],flags:MessageFlags.Ephemeral});
    }
    if(kind==='ticket_feedback'){const ticketId=Number(a),rating=Number(b);const ticket=tickets.getById(ticketId);if(!ticket||ticket.opener_id!==i.user.id)return i.update({content:'این Feedback برای شما معتبر نیست.',components:[]});const feedbackGuild=client.guilds.cache.get(ticket.guild_id)||await client.guilds.fetch(ticket.guild_id).catch(()=>null);const r=await tickets.recordFeedback(feedbackGuild,ticketId,i.user.id,rating);return i.update({content:r.ok?`⭐ امتیاز ${rating}/5 ثبت شد، ممنون ❤️`:`❌ ${r.message||'ثبت امتیاز ناموفق بود.'}`,components:[]});}
    if(kind==='ticket_claim'||kind==='ticket_close'||kind==='ticket_reopen'){
      const ticket=tickets.getById(Number(a));
      if(!ticket||ticket.guild_id!==i.guild.id||ticket.channel_id!==i.channel.id)return safeReply(i,{embeds:[err('Ticket معتبر نیست.')],flags:MessageFlags.Ephemeral});
      if(kind==='ticket_close'){
        const modal=new ModalBuilder().setCustomId(`ticket_close_modal:${ticket.id}`).setTitle('بستن Ticket');
        const input=new TextInputBuilder().setCustomId('reason').setLabel('دلیل بسته شدن').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder('دلیل را وارد کنید...');
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      }
      await deferEphemeral(i);
      if(kind==='ticket_claim')return safeReply(i,{embeds:[await tickets.claim(i.guild,ticket.id,i.user.id,i.member)?ok('Ticket Claim شد.'):err('فقط Ticket Support Role می‌تواند Claim کند یا Ticket قبلاً Claim شده.')],flags:MessageFlags.Ephemeral});
      return safeReply(i,{embeds:[await tickets.reopen(i.guild,ticket.id,i.member)?ok('Ticket دوباره باز شد.'):err('Reopen ناموفق بود.')],flags:MessageFlags.Ephemeral});
    }
    if(kind==='invpage'){
      const mode=a, inviterId=b==='all'?null:b, page=Number(c||0);
      if(!['invited','alljoins','join','fake','left','active','left_members','fake_members'].includes(mode))return safeReply(i,{embeds:[err('Invite page نامعتبر است.')],flags:MessageFlags.Ephemeral});
      const data=invitePageData(i.guild.id,mode,inviterId,page);
      return i.update({embeds:[data.embed],components:[data.row]});
    }
    if(kind==='gw_join'||kind==='gw_list'||kind==='gw_prev'||kind==='gw_next'){
      await deferEphemeral(i);const id=Number(a);const g=db.prepare('SELECT * FROM giveaways WHERE id=?').get(id);if(!g||g.guild_id!==i.guild.id||g.channel_id!==i.channel.id)return safeReply(i,{embeds:[err('Giveaway معتبر نیست.')],flags:MessageFlags.Ephemeral});
      if(kind==='gw_join')return safeReply(i,{embeds:[giveaways.join(id,i.user.id)?ok('در Giveaway با موفقیت Join شدی.'):err('این Giveaway تمام شده، Join تکراری است یا دیگر فعال نیست.')],flags:MessageFlags.Ephemeral});
      const requestedPage=kind==='gw_prev'?Math.max(0,Number(b||0)-1):kind==='gw_next'?Number(b||0)+1:0;const data=giveaways.page(id,requestedPage,15);const lines=data.items.map((p,n)=>`${data.page*15+n+1}. <@${p.user_id}> — <t:${Math.floor(p.joined_at/1000)}:R>`);const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gw_prev:${id}:${data.page}`).setLabel('Prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(data.page<=0),new ButtonBuilder().setCustomId(`gw_next:${id}:${data.page}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(data.page>=data.pages-1));return safeReply(i,{embeds:[info(`**Participants — صفحه ${data.page+1}/${data.pages}**\n\n${lines.length?lines.join('\n'):'هیچ‌کس Join نشده.'}\n\nTotal: **${data.total}**`)],components:[row],flags:MessageFlags.Ephemeral});
    }
    if(kind==='drop'){
      await deferEphemeral(i);const d=drops.getById(Number(a));if(!d||d.guild_id!==i.guild.id||d.channel_id!==i.channel.id)return safeReply(i,{embeds:[err('Drop معتبر نیست.')],flags:MessageFlags.Ephemeral});return safeReply(i,{embeds:[await drops.win(i.guild,d,i.user.id)?ok('تو برنده Drop شدی!'):err('این Drop تمام شده یا زمانش گذشته.')],flags:MessageFlags.Ephemeral});
    }
    if(kind==='emb'){
      const row=db.prepare('SELECT * FROM embed_buttons WHERE message_id=? AND button_index=?').get(a,Number(b));
      if(!row)return safeReply(i,{embeds:[err('این دکمه دیگر معتبر نیست.')],flags:MessageFlags.Ephemeral});
      return safeReply(i,{content:row.response,flags:MessageFlags.Ephemeral});
    }
    if(kind==='exchange'){await deferEphemeral(i);return exchangeManage(i,a,Number(b));}
  }catch(e){
    console.error('[INTERACTION]',e);
    const messages={
      TICKET_SUPPORT_REQUIRED:'برای این عملیات باید Ticket Support Role را داشته باشی.',
      TICKET_CHANNEL_NOT_FOUND:'Channel این Ticket پیدا نشد.',
      TICKET_STATUS_CHANGED:'وضعیت Ticket همزمان تغییر کرده است؛ دوباره تلاش کن.',
      TICKET_PARTICIPANT_CHANGED:'لیست اعضای Ticket همزمان تغییر کرده است؛ دوباره تلاش کن.',
      MUSIC_ALREADY_IN_ANOTHER_VOICE:'بات در Voice دیگری است.',
      MUSIC_MOVE_FAILED:'جابجایی اتصال Voice ناموفق بود.',
      OPENAI_API_KEY:'کلید OpenAI تنظیم نشده است.'
    };
    return safeReply(i,{embeds:[err(messages[e?.message]||`خطای داخلی: ${clamp(e?.message||'Unknown error',1000)}`)],flags:MessageFlags.Ephemeral});
  }
}
client.on('interactionCreate',onInteraction);

async function queueInviteTask(guild,task){const key=guild.id;const prev=inviteQueues.get(key)||Promise.resolve();const next=prev.catch(()=>{}).then(task);inviteQueues.set(key,next);try{return await next}finally{if(inviteQueues.get(key)===next)inviteQueues.delete(key)}}
async function refreshInvites(guild){
  if(!guild.members.me?.permissions?.has(PermissionFlagsBits.ManageGuild))return false;
  const col=await guild.invites.fetch().catch(e=>{console.error('[INVITES FETCH]',e.message);return null});if(!col)return false;const map=new Map();for(const x of col.values())map.set(x.code,x.uses||0);inviteSnapshots.set(guild.id,map);const tx=db.transaction(()=>{db.prepare('DELETE FROM invite_codes WHERE guild_id=?').run(guild.id);for(const x of col.values())db.prepare('INSERT INTO invite_codes(guild_id,code,uses,updated_at) VALUES(?,?,?,?)').run(guild.id,x.code,x.uses||0,Date.now())});tx();return true;
}
async function processMemberAdd(member){
  await queueInviteTask(member.guild,async()=>{
    const settings=inviteDefaults(getSettings(member.guild.id).invite||{});
    const oldMembership=invites.membership(member.guild.id,member.id);
    const oldSnapshot=inviteSnapshots.get(member.guild.id)||new Map();
    let inviter=null,code=null,ambiguous=false;
    const nowCol=await member.guild.invites.fetch().catch(e=>{console.error('[INVITES FETCH JOIN]',e.message);return null});
    if(nowCol){
      const increased=[...nowCol.values()].map(inv=>({inv,delta:(inv.uses||0)-(oldSnapshot.get(inv.code)||0)})).filter(x=>oldSnapshot.has(x.inv.code)&&x.delta>0);
      if(increased.length===1&&increased[0].delta===1){inviter=increased[0].inv.inviter;code=increased[0].inv.code;}
      else if(increased.length>0){ambiguous=true;}
      const map=new Map();for(const inv of nowCol.values())map.set(inv.code,inv.uses||0);inviteSnapshots.set(member.guild.id,map);
      const tx=db.transaction(()=>{db.prepare('DELETE FROM invite_codes WHERE guild_id=?').run(member.guild.id);for(const inv of nowCol.values())db.prepare('INSERT INTO invite_codes(guild_id,code,uses,updated_at) VALUES(?,?,?,?)').run(member.guild.id,inv.code,inv.uses||0,Date.now())});tx();
    }
    const accountAgeDays=(Date.now()-member.user.createdTimestamp)/86400000;
    const rejoin=!!oldMembership&&!oldMembership.active;
    const fakeByAge=accountAgeDays<settings.fakeDays;
    const fakeByRejoin=rejoin&&!settings.countRejoins;
    const fake=fakeByAge||fakeByRejoin;
    if(rejoin&&!settings.countRejoins){
      if(!inviter&&oldMembership?.inviter_id){const u=await client.users.fetch(oldMembership.inviter_id).catch(()=>null);if(u)inviter=u;}
      code=code||oldMembership?.last_invite_code||null;
    }
    if(ambiguous&&!rejoin){inviter=null;}
    try{
      invites.recordJoin(member.guild.id,{memberId:member.id,inviterId:inviter?.id||null,code,fake,rejoin,countRejoin:settings.countRejoins,accountAgeDays});
    }catch(error){console.error('[INVITE RECORD JOIN]',error);throw error;}
    await sendLog(member.guild,'invite',{action:'join',member:member.user.tag,inviter:inviter?.tag||'unknown',invite_code:code||'unknown',fake,rejoin,account_age_days:Number(accountAgeDays.toFixed(2)),ambiguous,total_joins:inviter?invites.totalJoins(member.guild.id,inviter.id):0});
    if(fake)await sendLog(member.guild,'invite',{action:'fake_join',member:member.user.tag,inviter:inviter?.tag||'unknown',reason:fakeByAge?'account_age':'rejoin'});
    if(rejoin)await sendLog(member.guild,'invite',{action:'rejoin',member:member.user.tag,inviter:inviter?.tag||'unknown',counted:settings.countRejoins});

    const w=getSettings(member.guild.id).welcome;
    if(w?.channelId){const ch=await member.guild.channels.fetch(w.channelId).catch(()=>null);if(textChannel(ch))await ch.send({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('👋 خوش آمدید').setDescription(placeholders(w.text||'خوش آمدی [user] به [server]!',member,member.guild))],allowedMentions:{users:[member.id]}}).catch(e=>console.error('[WELCOME]',e.message));}
    await sendLog(member.guild,'member',{action:'join',user:member.user.tag,user_id:member.id});
  });
}
client.once('ready',async()=>{
  console.log(`${botName} ready as ${client.user.tag}`);outbox.recoverFailed();delivery.recover();if(!guildId)throw new Error('GUILD_ID missing');
  for(const g of [...client.guilds.cache.values()]){if(g.id!==guildId){await g.leave().catch(()=>{});continue;}await refreshInvites(g);await tickets.reconcile(g).catch(e=>console.error('[TICKET RECONCILE]',e.message));await xp.reconcileGuild(g).then(r=>{if(r.length)console.error('[XP RECONCILE]',JSON.stringify(r.slice(0,3)))}).catch(e=>console.error('[XP RECONCILE]',e.message));await staff.reconcileGuild(g).then(r=>{if(r.length)console.error('[STAFF RECONCILE]',JSON.stringify(r.slice(0,3)))}).catch(e=>console.error('[STAFF RECONCILE]',e.message));const q=music247.get(g.id);if(q){const vc=await g.channels.fetch(q.voice_channel_id).catch(()=>null);if(vc?.isVoiceBased())await music.ensure247(g,vc,null).catch(e=>console.error('[247 STARTUP]',e.message));}}
  if(intervalsStarted)return;intervalsStarted=true;
  const addTimer=(fn,ms)=>{const t=setInterval(fn,ms);timers.add(t);return t;};
  addTimer(()=>outbox.drain(client).catch(e=>console.error('[OUTBOX]',e.message)),5000);
  addTimer(()=>delivery.drain(client).catch(e=>console.error('[DELIVERY OUTBOX]',e.message)),5000);
  addTimer(()=>giveaways.finishDue(client).catch(e=>console.error('[GIVEAWAY TIMER]',e.message)),5000);
  addTimer(()=>{const g=client.guilds.cache.get(guildId);if(g)drops.expire(g).catch(e=>console.error('[DROP TIMER]',e.message));},30000);
  const updateTicketClaimLeaderboard=async()=>{
    const g=client.guilds.cache.get(guildId);if(!g)return;
    const settings=getSettings(g.id);const ticketSettings=settings.ticket||{};const chId=ticketSettings.claimLeaderboardChannelId;if(!chId)return;
    const now=Date.now();const interval=6*60*60*1000;
    const last=Number(ticketSettings.claimLeaderboardLastUpdatedAt||0);
    if(last>0 && now-last<interval)return;
    const ch=await g.channels.fetch(chId).catch(()=>null);if(!textChannel(ch))return;
    const rows=tickets.claimLeaderboard(g.id);
    const body=rows.length?rows.map((r,n)=>`${n+1}. <@${r.user_id}> — **${r.claims}** Claim`).join('\n'):'هنوز هیچ Claimی ثبت نشده.';
    const embed=new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🏆 Ticket Claim Leaderboard')
      .setDescription(`آمار تجمعی همه Claimها\n\n${body}`)
      .setFooter({text:'به‌روزرسانی هر ۶ ساعت'})
      .setTimestamp(new Date(now));
    let message=null;
    if(ticketSettings.claimLeaderboardMessageId) message=await ch.messages.fetch(ticketSettings.claimLeaderboardMessageId).catch(()=>null);
    if(message){
      try{
        await message.edit({embeds:[embed],components:[]});
      }catch(e){
        console.error('[TICKET LEADERBOARD EDIT]',e.message);
        return;
      }
    }else{
      message=await ch.send({embeds:[embed]}).catch(e=>{console.error('[TICKET LEADERBOARD SEND]',e.message);return null});
      if(!message)return;
    }
    await setSettings(g.id,{ticket:{claimLeaderboardMessageId:message.id,claimLeaderboardLastUpdatedAt:now}})
      .catch(e=>console.error('[TICKET LEADERBOARD SAVE]',e.message));
  };
  // Check frequently so a restart does not reset the six-hour cadence. The actual
  // update time is persisted in guild settings, and the same Discord message is edited.
  await updateTicketClaimLeaderboard();
  addTimer(()=>updateTicketClaimLeaderboard().catch(e=>console.error('[TICKET LEADERBOARD TIMER]',e.message)),60*1000);
  addTimer(()=>cleanupLogs(logRetentionDays),6*60*60*1000);
  addTimer(()=>ai.cleanup(aiRetentionDays),6*60*60*1000);
  addTimer(async()=>{const g=client.guilds.cache.get(guildId);if(!g)return;const cfg=music247.get(guildId);if(cfg){const vc=await g.channels.fetch(cfg.voice_channel_id).catch(()=>null);if(vc?.isVoiceBased())await music.ensure247(g,vc,null).catch(e=>console.error('[247 HEALTH]',e.message));}},20000);
  addTimer(()=>backupNow(undefined,backupRetention).catch(e=>console.error('[DB BACKUP]',e.message)),24*60*60*1000);
});

client.on('guildCreate',async g=>{if(g.id!==guildId){await g.leave().catch(()=>{});return;}await refreshInvites(g)});
client.on('guildMemberAdd',processMemberAdd);
client.on('guildMemberRemove',async m=>{
  try{
    const result=invites.recordMemberLeave(m.guild.id,m.id);
    if(result.changed){
      const data=result.previous;
      await sendLog(m.guild,'invite',{action:'leave',member:m.user.tag,inviter:`<@${data.inviter_id}>`,fake:!!data.fake,joined_at:data.last_joined_at?`<t:${Math.floor(data.last_joined_at/1000)}:R>`:'unknown'});
    } else {
      await sendLog(m.guild,'invite',{action:'leave_unknown',member:m.user.tag});
    }
    await sendLog(m.guild,'member',{action:'leave',user:m.user.tag,user_id:m.id});
  }catch(e){console.error('[MEMBER REMOVE]',e)}
});
client.on('messageDelete',async m=>{if(!m.guild||m.author?.bot)return;try{if(m.partial)await m.fetch().catch(()=>{});await sendLog(m.guild,'message',{action:'delete',channel:m.channel?.name,author:m.author?.tag||'unknown',content:stripMentions(m.content||''),attachments:[...(m.attachments?.values?.()||[])].map(x=>x.url).join('\n'),message_id:m.id})}catch(e){console.error('[MESSAGE DELETE]',e.message)}});
client.on('messageUpdate',async(a,b)=>{if(!b.guild||b.author?.bot)return;try{if(a.partial)await a.fetch().catch(()=>{});if(b.partial)await b.fetch().catch(()=>{});const changed=a.content!==b.content||a.attachments?.size!==b.attachments?.size||a.embeds?.length!==b.embeds?.length||JSON.stringify(a.embeds)!==JSON.stringify(b.embeds);if(changed)await sendLog(b.guild,'message',{action:'edit',channel:b.channel?.name,author:b.author?.tag||'unknown',before:stripMentions(a.content||''),after:stripMentions(b.content||''),attachments_before:a.attachments?.size||0,attachments_after:b.attachments?.size||0,message_id:b.id})}catch(e){console.error('[MESSAGE UPDATE]',e.message)}});
client.on('messageDeleteBulk',async msgs=>{const first=msgs.first();if(first?.guild)await sendLog(first.guild,'message',{action:'bulk_delete',count:msgs.size,channel:first.channel?.name||'unknown'})});
client.on('messageCreate',async m=>{if(m.author.bot||!m.guild)return;try{
  await xp.applyXp(m).catch(e=>{if(e?.reason==='role_sync_failed')sendLog(m.guild,'xp',{action:'role_sync_failed',user:m.author.tag,failures:e.failures?.length||0}).catch(()=>{});});
  // Guess Number: only an exact integer matching the active game can win; wrong guesses are silent.
  const gameResult=guess.check(m.guild.id,m.channel.id,m.content);
  if(gameResult?.correct){
    const starter=await client.users.fetch(gameResult.starter_id).catch(()=>null);
    if(starter)await starter.send({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('🔓 Guess Number Result').setDescription(`بازی تمام شد. عدد مخفی **${gameResult.number}** بود.\nبرنده: <@${m.author.id}>`) ]}).catch(()=>{});
    await m.channel.send({content:`🎯 <@${m.author.id}> عدد درست را گفت و برنده شد!`,allowedMentions:{users:[m.author.id]}}).catch(()=>{});
    await sendLog(m.guild,'guess',{action:'winner',channel:m.channel.id,winner:m.author.tag,starter:gameResult.starter_id,min:gameResult.min,max:gameResult.max});
    return;
  }
  const s=getSettings(m.guild.id);
  if(s.ai?.channelId===m.channel.id){try{const out=await ai.ask(m.guild.id,m.author.id,m.content);await m.reply({content:out,allowedMentions:{repliedUser:false}})}catch(e){if(e.message!=='AI_COOLDOWN'){await sendLog(m.guild,'ai',{action:'error',user:m.author.tag,error:e.message});await m.reply({content:'AI موقتاً در دسترس نیست.',allowedMentions:{repliedUser:false}}).catch(()=>{})}}}
  const cc=db.prepare('SELECT response FROM custom_commands WHERE guild_id=? AND name=?').get(m.guild.id,m.content.trim().toLowerCase());if(cc)await m.channel.send({content:stripMentions(cc.response),allowedMentions:{parse:[]}}).catch(()=>{});
  for(const d of drops.active(m.guild.id,'text',m.channel.id)){if(m.content.trim()===d.trigger_text&&await drops.win(m.guild,d,m.author.id))break;}
}catch(e){console.error('[MESSAGE CREATE]',e.message)}});
client.on('guildMemberUpdate',async(a,b)=>{try{const added=b.roles.cache.filter(r=>!a.roles.cache.has(r.id)).map(r=>`<@&${r.id}>`),removed=a.roles.cache.filter(r=>!b.roles.cache.has(r.id)).map(r=>`<@&${r.id}>`);const changes={};let actor=null;if(a.user.username!==b.user.username){changes.username_before=a.user.username;changes.username_after=b.user.username}if(a.nickname!==b.nickname){changes.nickname_before=a.nickname||'none';changes.nickname_after=b.nickname||'none'}if(added.length)changes.roles_added=added.join(', ');if(removed.length)changes.roles_removed=removed.join(', ');if(added.length||removed.length)actor=await auditActor(b.guild,AuditLogEvent.MemberRoleUpdate,b.id);else if(a.nickname!==b.nickname||a.communicationDisabledUntilTimestamp!==b.communicationDisabledUntilTimestamp)actor=await auditActor(b.guild,AuditLogEvent.MemberUpdate,b.id);if(a.communicationDisabledUntilTimestamp!==b.communicationDisabledUntilTimestamp)changes.timeout=`${a.communicationDisabledUntilTimestamp||'none'} -> ${b.communicationDisabledUntilTimestamp||'none'}`;if(a.premiumSinceTimestamp!==b.premiumSinceTimestamp)changes.boost=`${a.premiumSinceTimestamp||'none'} -> ${b.premiumSinceTimestamp||'none'}`;if(Object.keys(changes).length)await sendLog(b.guild,'member',{action:'update',user:b.user.tag,...changes,...(actor?{by:actor}:{})});}catch(e){console.error('[MEMBER UPDATE]',e.message)}});
client.on('voiceStateUpdate',async(a,b)=>{if(a.channelId===b.channelId&&a.serverMute===b.serverMute&&a.serverDeaf===b.serverDeaf&&a.selfMute===b.selfMute&&a.selfDeaf===b.selfDeaf&&a.selfStream===b.selfStream&&a.selfVideo===b.selfVideo)return;await sendLog(b.guild,'voice',{user:b.member?.user?.tag,from:a.channelId||'none',to:b.channelId||'none',serverMute:b.serverMute,serverDeaf:b.serverDeaf,selfMute:b.selfMute,selfDeaf:b.selfDeaf,stream:b.selfStream,video:b.selfVideo})});
async function auditActor(guild,type,targetId){
  try{
    for(let attempt=0;attempt<4;attempt++){
      const logs=await guild.fetchAuditLogs({type,limit:15});
      const now=Date.now();
      const candidates=logs.entries.filter(x=>{
        const age=now-x.createdTimestamp;
        return (!targetId||x.target?.id===targetId)&&age>=0&&age<8000;
      }).sort((a,b)=>b.createdTimestamp-a.createdTimestamp);
      if(candidates[0])return candidates[0].executor?.tag||'unknown';
      await sleep(600);
    }
    return 'unknown';
  }catch{return 'unknown'}
}
client.on('channelCreate',async c=>c.guild&&sendLog(c.guild,'server',{action:'channel_create',channel:c.name,id:c.id,by:await auditActor(c.guild,AuditLogEvent.ChannelCreate,c.id)}));
client.on('channelDelete',async c=>c.guild&&sendLog(c.guild,'server',{action:'channel_delete',channel:c.name,id:c.id,by:await auditActor(c.guild,AuditLogEvent.ChannelDelete,c.id)}));
client.on('channelUpdate',async(a,b)=>{if(!b.guild)return;const changes={};if(a.name!==b.name)changes.name=`${a.name} -> ${b.name}`;if(a.parentId!==b.parentId)changes.parent=`${a.parentId||'none'} -> ${b.parentId||'none'}`;if(a.topic!==b.topic)changes.topic='changed';if(a.rateLimitPerUser!==b.rateLimitPerUser)changes.slowmode=`${a.rateLimitPerUser} -> ${b.rateLimitPerUser}`;if(Object.keys(changes).length)await sendLog(b.guild,'server',{action:'channel_update',channel:b.name,id:b.id,by:await auditActor(b.guild,AuditLogEvent.ChannelUpdate,b.id),...changes})});
client.on('roleCreate',async r=>sendLog(r.guild,'server',{action:'role_create',role:r.name,id:r.id,by:await auditActor(r.guild,AuditLogEvent.RoleCreate,r.id)}));
client.on('roleDelete',async r=>sendLog(r.guild,'server',{action:'role_delete',role:r.name,id:r.id,by:await auditActor(r.guild,AuditLogEvent.RoleDelete,r.id)}));
client.on('roleUpdate',async(a,b)=>{const changes={};if(a.name!==b.name)changes.name=`${a.name} -> ${b.name}`;if(a.hexColor!==b.hexColor)changes.color=`${a.hexColor} -> ${b.hexColor}`;if(a.position!==b.position)changes.position=`${a.position} -> ${b.position}`;if(a.mentionable!==b.mentionable)changes.mentionable=`${a.mentionable} -> ${b.mentionable}`;if(a.hoist!==b.hoist)changes.hoist=`${a.hoist} -> ${b.hoist}`;if(a.permissions.bitfield!==b.permissions.bitfield)changes.permissions='changed';if(Object.keys(changes).length)await sendLog(b.guild,'server',{action:'role_update',role:b.name,id:b.id,by:await auditActor(b.guild,AuditLogEvent.RoleUpdate,b.id),...changes})});
client.on('guildUpdate',async(a,b)=>{const changes={};if(a.name!==b.name)changes.name=`${a.name} -> ${b.name}`;if(a.icon!==b.icon)changes.icon='changed';if(a.banner!==b.banner)changes.banner='changed';if(a.verificationLevel!==b.verificationLevel)changes.verification=`${a.verificationLevel} -> ${b.verificationLevel}`;if(Object.keys(changes).length)await sendLog(b,'server',{action:'guild_update',by:await auditActor(b,AuditLogEvent.GuildUpdate,b.id),...changes})});
client.on('guildBanAdd',async b=>sendLog(b.guild,'moderation',{action:'ban_add',user:b.user.tag,by:await auditActor(b.guild,AuditLogEvent.MemberBanAdd,b.user.id)}));
client.on('guildBanRemove',async b=>sendLog(b.guild,'moderation',{action:'ban_remove',user:b.user.tag,by:await auditActor(b.guild,AuditLogEvent.MemberBanRemove,b.user.id)}));
client.on('inviteCreate',async x=>queueInviteTask(x.guild,async()=>{await refreshInvites(x.guild);await sendLog(x.guild,'invite',{action:'create',code:x.code,inviter:x.inviter?.tag||'unknown'})}));
client.on('inviteDelete',async x=>queueInviteTask(x.guild,async()=>{invites.removeInviteCode(x.guild.id,x.code);await refreshInvites(x.guild);await sendLog(x.guild,'invite',{action:'delete',code:x.code})}));
client.on('threadCreate',async t=>t.guild&&sendLog(t.guild,'server',{action:'thread_create',name:t.name,id:t.id,parent:t.parentId}));
client.on('threadDelete',async t=>t.guild&&sendLog(t.guild,'server',{action:'thread_delete',name:t.name,id:t.id,parent:t.parentId}));
client.on('threadUpdate',async(a,b)=>b.guild&&a.name!==b.name&&sendLog(b.guild,'server',{action:'thread_update',before:a.name,after:b.name,id:b.id}));
client.on('webhookUpdate',async c=>c.guild&&sendLog(c.guild,'server',{action:'webhook_update',channel:c.name,id:c.id}));
client.on('emojiCreate',async e=>sendLog(e.guild,'emote',{action:'create',name:e.name,id:e.id,by:await auditActor(e.guild,AuditLogEvent.EmojiCreate,e.id)}));
client.on('emojiDelete',async e=>sendLog(e.guild,'emote',{action:'delete',name:e.name,id:e.id,by:await auditActor(e.guild,AuditLogEvent.EmojiDelete,e.id)}));
client.on('emojiUpdate',async(a,b)=>sendLog(b.guild,'emote',{action:'update',before:a.name,after:b.name,id:b.id,by:await auditActor(b.guild,AuditLogEvent.EmojiUpdate,b.id)}));
client.on('error',e=>console.error('[CLIENT]',e));
process.on('unhandledRejection',e=>console.error('[UNHANDLED]',e));
async function shutdown(signal,exitCode=0){if(shuttingDown)return;shuttingDown=true;console.log(`[SHUTDOWN] ${signal}`);for(const t of timers)clearInterval(t);timers.clear();try{await backupNow(undefined,backupRetention).catch(e=>console.error('[BACKUP ON SHUTDOWN]',e.message));await client.destroy();}finally{process.exit(exitCode)}}
process.on('SIGINT',()=>shutdown('SIGINT'));process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('uncaughtException',e=>{console.error('[UNCAUGHT]',e);shutdown('uncaughtException',1).catch(()=>process.exit(1))});
if(!token)throw new Error('DISCORD_TOKEN missing');
music.init(client,(g,t,p)=>sendLog(g,t,p)).then(()=>client.login(token)).catch(e=>{console.error('[BOOT]',e);process.exit(1)});
