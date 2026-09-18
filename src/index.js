require("dotenv").config();
const {Client,GatewayIntentBits,Partials,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,PermissionFlagsBits}=require("discord.js");
const {db,getConfig,saveConfig}=require("./db");
const {isManager,rankIndex,log,levelForXp}=require("./utils");

const client=new Client({intents:[
 GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,
 GatewayIntentBits.MessageContent,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildModeration,
 GatewayIntentBits.GuildInvites
],partials:[Partials.Channel,Partials.Message]});

const cooldown=new Map();
const drops=new Map();

async function addXp(member,amount,voice=false){
 const cfg=getConfig(member.guild.id);
 const ignored=voice?false:(cfg.xp.ignoredChannels||[]).includes(member.guild.channels.cache.find(c=>c.id===member.channelId)?.id);
 if(ignored) return;
 const roles=member.roles.cache.map(r=>r.id);
 if(!voice && roles.some(r=>(cfg.xp.ignoredRoles||[]).includes(r))) return;
 let row=db.prepare("SELECT * FROM xp WHERE guild_id=? AND user_id=?").get(member.guild.id,member.id);
 if(!row) row={xp:0,level:0,voice_minutes:0};
 const old=row.level; row.xp+=amount; if(voice) row.voice_minutes++;
 const nl=levelForXp(row.xp,cfg);
 db.prepare("INSERT OR REPLACE INTO xp(guild_id,user_id,xp,level,voice_minutes) VALUES(?,?,?,?,?)").run(member.guild.id,member.id,row.xp,nl,row.voice_minutes);
 if(nl>old){
  const roleId=cfg.levelRoles[String(nl)];
  if(roleId && member.guild.roles.cache.has(roleId)) {
   const configured=new Set(Object.values(cfg.levelRoles));
   for(const rid of configured) if(rid!==roleId && member.roles.cache.has(rid)) await member.roles.remove(rid).catch(()=>{});
   await member.roles.add(roleId).catch(()=>{});
  }
  if(cfg.xp.announce && cfg.channels.xpLevel){
   const ch=member.guild.channels.cache.get(cfg.channels.xpLevel);
   if(ch) ch.send(`🎉 تبریک ${member}! لولت شد **${nl}** 🚀`);
  }
 }
}

client.once("ready",async()=>{
 console.log(`Logged in as ${client.user.tag}`);
 setInterval(async()=>{
  for(const guild of client.guilds.cache.values()){
   const cfg=getConfig(guild.id),afk=guild.afkChannelId;
   for(const [,member] of guild.members.cache){
    if(member.user.bot || !member.voice.channelId) continue;
    if(cfg.xp.ignoreAfk && afk && member.voice.channelId===afk) continue;
    await addXp(member,cfg.xp.voicePerMinute||5,true);
   }
  }
 },60000);
 setInterval(endGiveaways,10000);
});

client.on("guildMemberAdd",async m=>{
 const cfg=getConfig(m.guild.id);
 if(cfg.welcome.enabled && cfg.channels.welcome){
  const ch=m.guild.channels.cache.get(cfg.channels.welcome);
  if(ch) ch.send((cfg.welcome.text||"خوش اومدی {user}").replaceAll("{user}",`${m}`).replaceAll("{server}",m.guild.name));
 }
 await log(m.guild,cfg,"👋 ورود عضو",`${m.user.tag} وارد سرور شد.`);
});

client.on("guildMemberRemove",async m=>{const cfg=getConfig(m.guild.id);await log(m.guild,cfg,"🚪 خروج عضو",`${m.user.tag} از سرور خارج شد.`);});
client.on("messageCreate",async m=>{
 if(m.author.bot||!m.guild) return;
 const cfg=getConfig(m.guild.id);
 if(cfg.xp.message){
  const key=m.guild.id+":"+m.author.id,now=Date.now(),last=cooldown.get(key)||0;
  if(now-last>=(cfg.xp.cooldown||30)*1000){cooldown.set(key,now);await addXp(m.member,cfg.xp.message||10);}
 }
 if(drops.has(m.channel.id)){
  const d=drops.get(m.channel.id);
  if(d.mode==="text" && m.content.trim()===d.answer){drops.delete(m.channel.id);await m.channel.send(`🎉 ${m.author} برنده **${d.prize}** شد!`);await log(m.guild,cfg,"🎯 Drop برنده",`${m.author.tag} برنده ${d.prize} شد.`);}
 }
});
client.on("messageDelete",async m=>{if(!m.guild)return;await log(m.guild,getConfig(m.guild.id),"🗑️ حذف پیام",`پیام در <#${m.channelId}> حذف شد.`);});
client.on("messageUpdate",async(a,b)=>{if(!a.guild)return;if(a.content!==b.content)await log(a.guild,getConfig(a.guild.id),"✏️ ویرایش پیام",`پیام در <#${a.channelId}> ویرایش شد.`);});
client.on("channelCreate",async c=>{await log(c.guild,getConfig(c.guild.id),"📁 ساخت چنل",`< #${c.id}> ساخته شد.`);});
client.on("channelDelete",async c=>{await log(c.guild,getConfig(c.guild.id),"🗑️ حذف چنل",`${c.name} حذف شد.`);});
client.on("roleCreate",async r=>{await log(r.guild,getConfig(r.guild.id),"🎭 ساخت رول",`${r} ساخته شد.`);});
client.on("roleDelete",async r=>{await log(r.guild,getConfig(r.guild.id),"🎭 حذف رول",`${r.name} حذف شد.`);});
client.on("guildBanAdd",async b=>{await log(b.guild,getConfig(b.guild.id),"🔨 بن",`${b.user.tag} بن شد.`);});
client.on("guildBanRemove",async b=>{await log(b.guild,getConfig(b.guild.id),"🔓 آنبن",`${b.user.tag} آنبن شد.`);});
client.on("voiceStateUpdate",async(o,n)=>{if(o.channelId===n.channelId)return;await log(n.guild,getConfig(n.guild.id),"🔊 Voice",`${n.member?.user.tag||"عضو"}: ${o.channelId?"خروج":"ورود"} / ${n.channelId?"ورود":"خروج"}`);});
client.on("interactionCreate",async i=>{
 if(i.isChatInputCommand()) return command(i);
 if(i.isButton()) return button(i);
 if(i.isModalSubmit()) return modal(i);
});

async function command(i){
 const cfg=getConfig(i.guild.id);
 if(i.commandName==="setup"){return setup(i,cfg);}
 if(["rankup","rankdown","staff"].includes(i.commandName)&&!isManager(i.member,cfg)) return i.reply({content:"❌ دسترسی مدیریت استاف نداری.",ephemeral:true});
 if(i.commandName==="rankup"||i.commandName==="rankdown"){
  const target=i.options.getMember("user"); if(!target)return i.reply({content:"عضو پیدا نشد.",ephemeral:true});
  let idx=rankIndex(target,cfg); if(idx<0)return i.reply({content:"❌ این عضو هیچ رنک استافی ندارد.",ephemeral:true});
  const dir=i.commandName==="rankup"?1:-1,ni=idx+dir;
  if(ni<0||ni>=cfg.staff.ranks.length)return i.reply({content:dir>0?"❌ بالاترین رنک استاف است.":"❌ پایین‌ترین رنک استاف است.",ephemeral:true});
  const old=cfg.staff.ranks[idx],next=cfg.staff.ranks[ni];
  await target.roles.remove(old.roleId).catch(()=>{});
  await target.roles.add(next.roleId).catch(()=>{});
  const ch=cfg.channels[dir>0?"rankup":"demote"]; if(ch)i.guild.channels.cache.get(ch)?.send(`**${dir>0?"📈 رنک اپ":"📉 دیموت"}**\n👤 ${target}\n🔄 ${old.name} → ${next.name}\n👮 توسط: ${i.user}`);
  await log(i.guild,cfg,dir>0?"📈 Rank Up":"📉 Demote",`${target.user.tag}: ${old.name} → ${next.name}\nتوسط ${i.user.tag}`);
  return i.reply({content:`✅ ${target} از **${old.name}** به **${next.name}** تغییر کرد.`});
 }
 if(i.commandName==="staff"){
  const sub=i.options.getSubcommand(),u=i.options.getMember("user");
  if(sub==="join"){
   if(cfg.roles.staffMain)await u.roles.add(cfg.roles.staffMain).catch(()=>{});
   for(const r of [cfg.roles.staffExtra1,cfg.roles.staffExtra2])if(r)await u.roles.add(r).catch(()=>{});
   db.prepare("INSERT OR REPLACE INTO staff_members VALUES(?,?,?)").run(i.guild.id,u.id,Date.now());
   await log(i.guild,cfg,"👮 ورود به استاف",`${u.user.tag} توسط ${i.user.tag} وارد استاف شد.`);
   return i.reply(`✅ ${u} به استاف اضافه شد.`);
  }
  if(sub==="remove"){
   if(cfg.roles.staffMain)await u.roles.remove(cfg.roles.staffMain).catch(()=>{});
   for(const r of [cfg.roles.staffExtra1,cfg.roles.staffExtra2])if(r)await u.roles.remove(r).catch(()=>{});
   db.prepare("DELETE FROM staff_members WHERE guild_id=? AND user_id=?").run(i.guild.id,u.id);
   await log(i.guild,cfg,"🚪 خروج از استاف",`${u.user.tag} توسط ${i.user.tag} از استاف خارج شد.`);
   return i.reply(`✅ ${u} از استاف خارج شد.`);
  }
  const rows=db.prepare("SELECT user_id,count FROM staff_claims WHERE guild_id=? ORDER BY count DESC LIMIT 20").all(i.guild.id);
  return i.reply({content:rows.length?rows.map((x,n)=>`${n+1}. <@${x.user_id}> — ${x.count} کلیم`).join("\n"):"هنوز آماری ثبت نشده.",ephemeral:true});
 }
 if(i.commandName==="giveaway"){
  const title=i.options.getString("title"),prize=i.options.getString("prize"),w=i.options.getInteger("winners"),minutes=i.options.getInteger("minutes");
  const end=Date.now()+minutes*60000;
  const row=db.prepare("INSERT INTO giveaways(guild_id,channel_id,title,prize,winners,duration_ms,ends_at) VALUES(?,?,?,?,?,?,?)").run(i.guild.id,i.channel.id,title,prize,w,minutes*60000,end);
  const emb=new EmbedBuilder().setTitle(`🎉 ${title}`).setDescription(`🎁 جایزه: **${prize}**\n🏆 برنده: **${w}** نفر\n⏱️ پایان: <t:${Math.floor(end/1000)}:R>\n👥 شرکت‌کنندگان: **0**`).setTimestamp();
  const msg=await i.channel.send({embeds:[emb],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gw:${row.lastInsertRowid}`).setLabel("شرکت در گیووای").setEmoji("🎉").setStyle(ButtonStyle.Success))]});
  db.prepare("UPDATE giveaways SET message_id=? WHERE id=?").run(msg.id,row.lastInsertRowid);
  return i.reply({content:"✅ گیووای ساخته شد.",ephemeral:true});
 }
 if(i.commandName==="drop"){
  const mode=i.options.getString("mode"),prize=i.options.getString("prize"),answer=i.options.getString("answer");
  if(mode==="text"&&!answer)return i.reply({content:"برای حالت متنی باید متن برنده را وارد کنی.",ephemeral:true});
  const id=`drop:${Date.now()}`;
  if(mode==="button"){
   const msg=await i.channel.send({embeds:[new EmbedBuilder().setTitle("🎯 DROP").setDescription(`🎁 جایزه: **${prize}**\n⚡ اولین نفری که دکمه را بزند برنده است!`)],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(id).setLabel("🎯 دریافت جایزه").setStyle(ButtonStyle.Danger))]});
   drops.set(i.channel.id,{mode,prize,msg:id});
  }else{await i.channel.send({embeds:[new EmbedBuilder().setTitle("🎯 DROP متنی").setDescription(`🎁 جایزه: **${prize}**\n⚡ اولین نفری که متن تعیین‌شده را بفرستد برنده است!`)]});drops.set(i.channel.id,{mode,prize,answer});}
  return i.reply({content:"✅ دراپ ساخته شد.",ephemeral:true});
 }
 if(i.commandName==="ticket"){
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket:open").setLabel("🎫 ساخت تیکت").setStyle(ButtonStyle.Primary));
  return i.reply({content:"پنل تیکت آماده شد.",components:[row]});
 }
 if(i.commandName==="clear"){if(!i.member.permissions.has(PermissionFlagsBits.ManageMessages))return i.reply({content:"❌ دسترسی نداری.",ephemeral:true});const n=i.options.getInteger("amount");await i.channel.bulkDelete(n,true);return i.reply({content:`✅ ${n} پیام پاک شد.`,ephemeral:true});}
 if(["kick","ban","timeout"].includes(i.commandName)){
  if(!i.member.permissions.has(PermissionFlagsBits.ModerateMembers))return i.reply({content:"❌ دسترسی نداری.",ephemeral:true});
  const u=i.options.getMember("user"),reason=i.options.getString("reason")||"بدون دلیل";
  if(i.commandName==="kick")await u.kick(reason);
  if(i.commandName==="ban")await u.ban({reason});
  if(i.commandName==="timeout")await u.timeout(i.options.getInteger("minutes")*60000,reason);
  await log(i.guild,cfg,`🛡️ ${i.commandName.toUpperCase()}`,`${u.user.tag}\nدلیل: ${reason}\nتوسط: ${i.user.tag}`);
  return i.reply(`✅ انجام شد: ${u}`);
 }
 if(i.commandName==="warn"){
  if(!i.member.permissions.has(PermissionFlagsBits.ModerateMembers))return i.reply({content:"❌ دسترسی نداری.",ephemeral:true});
  const u=i.options.getMember("user"),reason=i.options.getString("reason")||"بدون دلیل";
  const old=db.prepare("SELECT count FROM warns WHERE guild_id=? AND user_id=?").get(i.guild.id,u.id)?.count||0,n=old+1;
  db.prepare("INSERT OR REPLACE INTO warns VALUES(?,?,?)").run(i.guild.id,u.id,n);
  if(n>=3){await u.timeout(2*60*60*1000,"رسیدن به ۳ وارن");db.prepare("UPDATE warns SET count=0 WHERE guild_id=? AND user_id=?").run(i.guild.id,u.id);}
  await log(i.guild,cfg,"⚠️ Warn",`${u.user.tag} — وارن ${n}\nدلیل: ${reason}\nتوسط: ${i.user.tag}`);
  return i.reply(`⚠️ ${u} وارن شد. تعداد: ${n>=3?0:n}${n>=3?" — به‌دلیل ۳ وارن، ۲ ساعت تایم‌اوت شد.":""}`);
 }
 if(i.commandName==="exchange"){
  const b=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("exchange:form").setLabel("💱 ثبت اکسچنج").setStyle(ButtonStyle.Primary));
  return i.reply({content:"برای ثبت درخواست روی دکمه بزنید.",components:[b]});
 }
 if(i.commandName==="level"){
  const u=i.options.getMember("user")||i.member,row=db.prepare("SELECT xp,level FROM xp WHERE guild_id=? AND user_id=?").get(i.guild.id,u.id)||{xp:0,level:0};
  return i.reply(`📊 **${u.user.username}**\n⭐ XP: **${row.xp}**\n🏆 Level: **${row.level}**`);
 }
 if(i.commandName==="leaderboard"){
  const rows=db.prepare("SELECT user_id,xp,level FROM xp WHERE guild_id=? ORDER BY xp DESC LIMIT 10").all(i.guild.id);
  return i.reply(rows.length?rows.map((x,n)=>`${n+1}. <@${x.user_id}> — Level ${x.level} | ${x.xp} XP`).join("\n"):"هنوز کسی XP ندارد.");
 }
 if(i.commandName==="invites")return i.reply("🔗 سیستم ثبت دعوت فعال است و اطلاعات دعوت در لاگ تنظیم‌شده ثبت می‌شود.");
}

async function setup(i,cfg){
 const {ModalBuilder,TextInputBuilder,TextInputStyle}=require("discord.js");
 const modal=new ModalBuilder().setCustomId("setup:main").setTitle("⚙️ تنظیمات تهران کلاب");
 const add=(id,label,value,style=TextInputStyle.Short)=>new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setValue(value||"").setRequired(false);
 const rows=[
  add("welcome","متن خوشامدگویی",cfg.welcome.text,TextInputStyle.Paragraph),
  add("channels","چنل‌ها: welcome,logs,dmLogs,inviteLogs,ticketLogs,ticketStats,feedback,xpLevel,rankup,recruit,demote,staffWarn,exchange",Object.values(cfg.channels).join("|"),TextInputStyle.Paragraph),
  add("roles","رول‌ها: ticket,staffMain,staffExtra1,staffExtra2,staffManager",Object.values(cfg.roles).join("|"),TextInputStyle.Paragraph),
  add("ranks","رنک‌ها از پایین به بالا: name:roleId,name:roleId",cfg.staff.ranks.map(x=>`${x.name}:${x.roleId}`).join(","),TextInputStyle.Paragraph),
  add("levelroles","رول Level: level:roleId,level:roleId",Object.entries(cfg.levelRoles).map(([l,r])=>`${l}:${r}`).join(","),TextInputStyle.Paragraph)
 ].map(x=>new ActionRowBuilder().addComponents(x));
 modal.addComponents(...rows);return i.showModal(modal);
}
async function modal(i){
 if(i.customId==="setup:main"){
  const cfg=getConfig(i.guild.id),vals=i.fields;
  cfg.welcome.text=vals.getTextInputValue("welcome")||cfg.welcome.text;
  const chKeys=["welcome","logs","dmLogs","inviteLogs","ticketLogs","ticketStats","feedback","xpLevel","rankup","recruit","demote","staffWarn","exchange"];
  const ch=vals.getTextInputValue("channels").split("|");chKeys.forEach((k,n)=>cfg.channels[k]=ch[n]||null);
  const roleKeys=["ticket","staffMain","staffExtra1","staffExtra2","staffManager"];
  const rr=vals.getTextInputValue("roles").split("|");roleKeys.forEach((k,n)=>cfg.roles[k]=rr[n]||null);
  cfg.staff.ranks=vals.getTextInputValue("ranks").split(",").filter(Boolean).map((x,n)=>{const [name,roleId]=x.split(":");return {level:n,name,roleId};});
  cfg.levelRoles={};for(const x of vals.getTextInputValue("levelroles").split(",").filter(Boolean)){const [l,r]=x.split(":");if(l&&r)cfg.levelRoles[l]=r;}
  saveConfig(i.guild.id,cfg);return i.reply({content:"✅ تنظیمات ذخیره شد.",ephemeral:true});
 }
}
async function button(i){
 const cfg=getConfig(i.guild.id);
 if(i.customId==="ticket:open"){
  const name=`ticket-${i.user.username}`.slice(0,90);
  const ch=await i.guild.channels.create({name,type:ChannelType.GuildText,parent:cfg.ticket.category||undefined,permissionOverwrites:[
   {id:i.guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
   {id:i.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},
   ...(cfg.roles.ticket?[{id:cfg.roles.ticket,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}]:[])
  ]});
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket:claim").setLabel("📌 کلیم").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("ticket:close").setLabel("🔒 بستن").setStyle(ButtonStyle.Danger));
  await ch.send({content:`🎫 ${i.user} تیکتت ساخته شد.`,components:[row]});
  if(cfg.channels.ticketLogs)i.guild.channels.cache.get(cfg.channels.ticketLogs)?.send(`🎫 تیکت توسط ${i.user} باز شد: ${ch}`);
  return i.reply({content:`✅ تیکت ساخته شد: ${ch}`,ephemeral:true});
 }
 if(i.customId==="ticket:claim"){
  if(!isManager(i.member,cfg)&&!(cfg.ticket.claimRoles||[]).some(r=>i.member.roles.cache.has(r)))return i.reply({content:"❌ اجازه کلیم نداری.",ephemeral:true});
  const topic=i.channel.topic||"",match=topic.match(/CLAIMER:(\d+)/);if(match)return i.reply({content:"❌ این تیکت قبلاً کلیم شده.",ephemeral:true});
  await i.channel.setTopic(`CLAIMER:${i.user.id}`).catch(()=>{});
  const overwrites=i.channel.permissionOverwrites.cache;
  for(const [id,o] of overwrites){if(id===i.guild.roles.everyone.id||id===i.user.id||id===cfg.roles.ticket)continue;await o.edit({SendMessages:false}).catch(()=>{});}
  db.prepare("INSERT INTO staff_claims(guild_id,user_id,count) VALUES(?,?,1) ON CONFLICT(guild_id,user_id) DO UPDATE SET count=count+1").run(i.guild.id,i.user.id);
  if(cfg.channels.ticketStats)i.guild.channels.cache.get(cfg.channels.ticketStats)?.send(`📊 ${i.user} کلیم کرد — مجموع کلیم: ${db.prepare("SELECT count FROM staff_claims WHERE guild_id=? AND user_id=?").get(i.guild.id,i.user.id).count}`);
  await log(i.guild,cfg,"📌 Claim Ticket",`${i.user.tag} تیکت ${i.channel.name} را کلیم کرد.`);
  return i.reply(`✅ ${i.user} این تیکت را کلیم کرد.`);
 }
 if(i.customId==="ticket:close"){
  const {ModalBuilder,TextInputBuilder,TextInputStyle}=require("discord.js");
  const m=new ModalBuilder().setCustomId("ticketclose").setTitle("🔒 بستن تیکت");
  m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("دلیل بسته شدن").setStyle(TextInputStyle.Paragraph).setRequired(true)));
  return i.showModal(m);
 }
 if(i.customId.startsWith("gw:")){
  const id=Number(i.customId.split(":")[1]);const g=db.prepare("SELECT * FROM giveaways WHERE id=?").get(id);if(!g||g.ended)return i.reply({content:"این گیووای تمام شده.",ephemeral:true});
  db.prepare("INSERT OR IGNORE INTO giveaway_entries VALUES(?,?)").run(id,i.user.id);
  const n=db.prepare("SELECT COUNT(*) c FROM giveaway_entries WHERE giveaway_id=?").get(id).c;
  const emb=i.message.embeds[0];const d=emb.description.replace(/شرکت‌کنندگان: \*\*\d+\*\*/,"شرکت‌کنندگان: **"+n+"**");
  await i.message.edit({embeds:[EmbedBuilder.from(emb).setDescription(d)]});
  return i.reply({content:"🎉 وارد گیووای شدی!",ephemeral:true});
 }
 if(i.customId.startsWith("drop:")){
  const d=drops.get(i.channel.id);if(!d)return i.reply({content:"این دراپ قبلاً برده شده.",ephemeral:true});
  drops.delete(i.channel.id);await i.message.edit({components:[]});await i.channel.send(`🎉 ${i.user} برنده **${d.prize}** شد!`);await log(i.guild,cfg,"🎯 Drop برنده",`${i.user.tag} برنده ${d.prize} شد.`);return i.reply({content:"تبریک! 🎉",ephemeral:true});
 }
 if(i.customId==="exchange:form"){
  const {ModalBuilder,TextInputBuilder,TextInputStyle}=require("discord.js");
  const m=new ModalBuilder().setCustomId("exchange:submit").setTitle("💱 فرم اکسچنج");
  m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("server").setLabel("سرور خودت را وارد کن").setPlaceholder("لینک یا آیدی سرور").setStyle(TextInputStyle.Short).setRequired(true)));
  return i.showModal(m);
 }
 if(i.customId.startsWith("exchange:approve:")||i.customId.startsWith("exchange:reject:")){
  const id=Number(i.customId.split(":")[2]);const req=db.prepare("SELECT * FROM exchange_requests WHERE id=?").get(id);if(!req||req.status!=="pending")return i.reply({content:"این درخواست قبلاً بررسی شده.",ephemeral:true});
  const ok=i.customId.startsWith("exchange:approve");db.prepare("UPDATE exchange_requests SET status=? WHERE id=?").run(ok?"approved":"rejected",id);
  if(ok&&cfg.channels.exchange){const ch=i.guild.channels.cache.get(cfg.channels.exchange);if(ch)await ch.send(`💱 اکسچنج تأیید شد\n👤 <@${req.user_id}>\n🌐 ${req.server_text}`);}
  await i.message.edit({components:[]});return i.reply({content:ok?"✅ تأیید شد و در چنل اکسچنج ارسال شد.":"❌ رد شد.",ephemeral:true});
 }
}
async function modalClose(i){
 const reason=i.fields.getTextInputValue("reason"),cfg=getConfig(i.guild.id);
 const topic=i.channel.topic||"",m=topic.match(/CLAIMER:(\d+)/),userId=m?.[1];
 if(cfg.channels.ticketLogs)i.guild.channels.cache.get(cfg.channels.ticketLogs)?.send(`🔒 تیکت ${i.channel.name} بسته شد\nدلیل: ${reason}\nتوسط: ${i.user}`);
 await log(i.guild,cfg,"🔒 بستن Ticket",`${i.channel.name}\nدلیل: ${reason}\nتوسط: ${i.user.tag}`);
 if(userId){const u=await client.users.fetch(userId).catch(()=>null);if(u&&cfg.channels.feedback){const row=new ActionRowBuilder().addComponents(...[1,2,3,4,5].map(n=>new ButtonBuilder().setCustomId(`feedback:${i.channel.id}:${n}`).setLabel(`${n} ⭐`).setStyle(ButtonStyle.Secondary)));await u.send({content:"⭐ لطفاً کیفیت پشتیبانی تیکتت را از ۱ تا ۵ امتیاز بده.",components:[row]}).catch(()=>{});}}
 await i.reply("🔒 تیکت در حال بسته شدن است.");setTimeout(()=>i.channel.delete().catch(()=>{}),1500);
}
async function endGiveaways(){
 const now=Date.now(),rows=db.prepare("SELECT * FROM giveaways WHERE ended=0 AND ends_at<=?").all(now);
 for(const g of rows){
  const ch=client.channels.cache.get(g.channel_id);const msg=ch&&await ch.messages.fetch(g.message_id).catch(()=>null);
  const entries=db.prepare("SELECT user_id FROM giveaway_entries WHERE giveaway_id=?").all(g.id).map(x=>x.user_id);
  const winners=entries.sort(()=>Math.random()-0.5).slice(0,g.winners);
  if(ch)await ch.send(winners.length?`🎉 گیووای **${g.title}** تمام شد!\n🏆 برنده‌ها: ${winners.map(x=>`<@${x}>`).join("، ")}\n🎁 جایزه: **${g.prize}**`:`❌ برای گیووای **${g.title}** شرکت‌کننده کافی وجود نداشت.`);
  if(msg)await msg.edit({components:[]}).catch(()=>{});
  db.prepare("UPDATE giveaways SET ended=1 WHERE id=?").run(g.id);
 }
}
client.on("interactionCreate",async i=>{
 if(i.isModalSubmit()&&i.customId==="ticketclose")return modalClose(i);
 if(i.isModalSubmit()&&i.customId==="exchange:submit"){
  const server=i.fields.getTextInputValue("server"),cfg=getConfig(i.guild.id);
  const r=db.prepare("INSERT INTO exchange_requests(guild_id,user_id,server_text,created_at) VALUES(?,?,?,?)").run(i.guild.id,i.user.id,server,Date.now());
  if(cfg.channels.logs){const ch=i.guild.channels.cache.get(cfg.channels.logs);if(ch){const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`exchange:approve:${r.lastInsertRowid}`).setLabel("تأیید").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`exchange:reject:${r.lastInsertRowid}`).setLabel("رد").setStyle(ButtonStyle.Danger));await ch.send({content:"💱 درخواست جدید اکسچنج",embeds:[new EmbedBuilder().setDescription(`👤 <@${i.user.id}>\n🌐 ${server}\n🆔 درخواست: ${r.lastInsertRowid}`)],components:[row]});}}
  return i.reply({content:"✅ درخواستت برای Staff ارسال شد.",ephemeral:true});
 }
});
client.login(process.env.DISCORD_TOKEN);
