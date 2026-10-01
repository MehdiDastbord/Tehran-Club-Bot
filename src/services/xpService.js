const { db, getSettings, getXp } = require('../db');
const { sendLog } = require('./logService');
const { withKeyLock, withReadLock, withWriteLock } = require('./lockService');
const { levelFromXp, xpForLevel } = require('../utils');
const outbox = require('./discordOutboxService');
const delivery = require('./discordDeliveryService');

function rolesFor(gid) { return db.prepare('SELECT * FROM xp_roles WHERE guild_id=? ORDER BY level').all(gid); }
function roleMap(gid, override=null) {
  if (override) return new Map(Object.entries(override).map(([k,v])=>[Number(k),v]).filter(([k,v])=>Number.isInteger(k)&&k>0&&v));
  return new Map(rolesFor(gid).map(r=>[r.level,r.role_id]));
}
function roleFor(gid, level, override=null) { return roleMap(gid, override).get(Number(level))||null; }
function setXpRole(gid, level, roleId) {
  const l=Math.max(1,Math.floor(Number(level)||0));
  const old=db.prepare('SELECT role_id FROM xp_roles WHERE guild_id=? AND level=?').get(gid,l)?.role_id||null;
  db.prepare('INSERT INTO xp_roles(guild_id,level,role_id) VALUES(?,?,?) ON CONFLICT(guild_id,level) DO UPDATE SET role_id=excluded.role_id').run(gid,l,roleId);
  return old;
}
function removeXpRole(gid, level) {
  const l=Math.max(1,Math.floor(Number(level)||0));
  const old=db.prepare('SELECT role_id FROM xp_roles WHERE guild_id=? AND level=?').get(gid,l)?.role_id||null;
  db.prepare('DELETE FROM xp_roles WHERE guild_id=? AND level=?').run(gid,l);return old;
}

function roleIdsForMap(map){return [...new Set([...map.values()].filter(Boolean))];}
async function validateMap(guild,map){
  const bot=guild.members.me;if(!bot?.permissions.has('ManageRoles'))return [{user:'system',failures:[{role:'xp_roles',error:'Bot lacks ManageRoles'}]}];
  for(const id of roleIdsForMap(map)){const role=await guild.roles.fetch(id).catch(()=>null);if(!role)return [{user:'system',failures:[{role:id,error:'Role not found'}]}];if(role.managed||role.position>=bot.roles.highest.position)return [{user:'system',failures:[{role:id,error:'Role is not manageable by bot'}]}];}
  return [];
}
async function syncRoles(member, level, overrideMap=null) {
  const map=roleMap(member.guild.id,overrideMap); const desired=Number(level)>0?map.get(Number(level))||null:null;
  const ids=roleIdsForMap(map); const bot=member.guild.members.me;
  if(!bot?.permissions.has('ManageRoles'))return [{role:'xp_roles',error:'Bot lacks ManageRoles'}];
  for(const id of ids){const role=member.guild.roles.cache.get(id)||await member.guild.roles.fetch(id).catch(()=>null);if(!role)return [{role:id,error:'Role not found'}];if(role.managed||role.position>=bot.roles.highest.position)return [{role:id,error:'Role not manageable by bot'}];}
  const before=new Set(member.roles.cache.filter(r=>ids.includes(r.id)).map(r=>r.id)); const changed=[];
  try{
    for(const id of before)if(id!==desired){await member.roles.remove(id,'XP role sync');changed.push({id,action:'removed'});}
    if(desired&&!member.roles.cache.has(desired)){await member.roles.add(desired,`XP Level ${level}`);changed.push({id:desired,action:'added'});}
    return [];
  }catch(error){
    for(const c of changed.reverse()){
      try{if(c.action==='removed'&&!member.roles.cache.has(c.id))await member.roles.add(c.id,'XP role sync rollback');if(c.action==='added'&&member.roles.cache.has(c.id))await member.roles.remove(c.id,'XP role sync rollback');}catch(e){console.error('[XP ROLE ROLLBACK]',e.message)}
    }
    return [{role:error?.roleId||desired||'xp_roles',error:error.message}];
  }
}

async function syncAllMembers(guild, overrideMap=null, oldMap=null) {
  const map=roleMap(guild.id,overrideMap);
  const oldIds=oldMap?roleIdsForMap(roleMap(guild.id,oldMap)):[];
  const validation=await validateMap(guild,map); if(validation.length)return validation;
  let members; try{members=await guild.members.fetch();}catch(error){return [{user:'system',failures:[{role:'members',error:error.message}]}];}
  const tx=db.transaction(()=>{
    for(const member of members.values()){
      const row=getXp(guild.id,member.id); const level=row?.level||0;
      outbox.enqueueRoleTx(guild.id,member.id,'xp',level,db,{extraManagedRoleIds:oldIds});
    }
  });
  tx();
  return [];
}

async function changeRoleMapping(guild,level,roleId,remove=false,actorTag='system') {
  return withWriteLock(`xp:${guild.id}`,()=>withKeyLock(`xp-mapping:${guild.id}`,async()=>{
    const current=Object.fromEntries(rolesFor(guild.id).map(r=>[r.level,r.role_id]));
    const old=current[level]||null;
    const candidate={...current}; if(remove)delete candidate[level]; else candidate[level]=roleId;
    const mapValidation=await validateMap(guild,new Map(Object.entries(candidate).map(([k,v])=>[Number(k),v])));
    if(mapValidation.length)return {ok:false,message:'Role Mapping معتبر نیست.',failures:mapValidation};
    const users=db.prepare('SELECT user_id,level FROM xp_users WHERE guild_id=?').all(guild.id);
    db.transaction(()=>{
      if(remove)db.prepare('DELETE FROM xp_roles WHERE guild_id=? AND level=?').run(guild.id,level);
      else db.prepare('INSERT INTO xp_roles(guild_id,level,role_id) VALUES(?,?,?) ON CONFLICT(guild_id,level) DO UPDATE SET role_id=excluded.role_id').run(guild.id,level,roleId);
      for(const row of users)outbox.enqueueRoleTx(guild.id,row.user_id,'xp',row.level,db,{extraManagedRoleIds:old?[old]:[]});
    })();
    await sendLog(guild,'xp',{action:remove?'role_mapping_remove':'role_mapping_set',level,role:roleId||old||'none',by:actorTag});
    return {ok:true,old};
  }));
}

async function applyXp(message) {
  const guildId=message.guild.id,userId=message.author.id,settings={...(getSettings(guildId).xp||{})};
  if(settings.enabled===false||message.author.bot)return {awarded:false,reason:'disabled'};
  const cooldown=Math.max(0,Number(settings.cooldownMs??60000));const min=Math.max(0,Math.floor(Number(settings.min??10))),max=Math.max(min,Math.floor(Number(settings.max??20)));
  return withReadLock(`xp:${guildId}`,()=>withKeyLock(`xp:${guildId}:${userId}`,async()=>{
    const row=getXp(guildId,userId);const now=Date.now();if(now-row.last_xp_at<cooldown)return {awarded:false,reason:'cooldown',row};
    const baseGain=min+Math.floor(Math.random()*(max-min+1));const multiplier=Math.max(0.1,Number(settings.multiplier??1));const gain=Math.max(0,Math.round(baseGain*multiplier));const rawXp=Math.max(0,row.xp+gain);const maxLevel=Math.max(0,Math.floor(Number(settings.maxLevel||0)));const cappedXp=maxLevel>0?Math.min(rawXp,Math.max(0,xpForLevel(maxLevel+1,settings)-1)):rawXp;const finalLevel=levelFromXp(cappedXp,settings);const next={...row,xp:cappedXp,level:finalLevel,messages:row.messages+1,last_xp_at:now};
    db.transaction(()=>{db.prepare(`INSERT INTO xp_users(guild_id,user_id,xp,level,messages,last_xp_at) VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET xp=excluded.xp,level=excluded.level,messages=excluded.messages,last_xp_at=excluded.last_xp_at`).run(guildId,userId,next.xp,next.level,next.messages,next.last_xp_at); if(finalLevel!==row.level){outbox.enqueueRoleTx(guildId,userId,'xp',finalLevel,db);const levelUpId=settings.levelUpChannelId;if(levelUpId)delivery.enqueueSendTx(guildId,levelUpId,{content:`🎉 <@${userId}> به **Level ${finalLevel}** رسید!`,allowedMentions:{users:[userId]}},`xp:levelup:${userId}:${finalLevel}:${next.messages}`,db);}})();
    if(finalLevel!==row.level){await sendLog(message.guild,'xp',{action:'level_up',user:message.author.tag,from:row.level,to:finalLevel,xp:next.xp,gain});}
    return {awarded:true,gain,row,next};
  }));
}

async function manualChange(guild,member,delta,actorTag,action){
  return withReadLock(`xp:${guild.id}`,()=>withKeyLock(`xp:${guild.id}:${member.id}`,async()=>{
    const row=getXp(guild.id,member.id),settings={...(getSettings(guild.id).xp||{})};const maxLevel=Math.max(0,Number(settings.maxLevel||0));let nextXp=Math.max(0,row.xp+delta);if(maxLevel>0)nextXp=Math.min(nextXp,Math.max(0,xpForLevel(maxLevel+1,settings)-1));const nextLevel=levelFromXp(nextXp,settings);
    db.transaction(()=>{db.prepare(`INSERT INTO xp_users(guild_id,user_id,xp,level,messages,last_xp_at) VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET xp=excluded.xp,level=excluded.level,messages=excluded.messages,last_xp_at=excluded.last_xp_at`).run(guild.id,member.id,nextXp,nextLevel,row.messages,Date.now()); outbox.enqueueRoleTx(guild.id,member.id,'xp',nextLevel,db);})();
    await sendLog(guild,'xp',{action,user:member.user.tag,amount:delta,from_xp:row.xp,to_xp:nextXp,from_level:row.level,to_level:nextLevel,by:actorTag});return {ok:true,old:row,next:{...row,xp:nextXp,level:nextLevel}};
  }));
}

async function resetUser(guild,member,actorTag){
  return withReadLock(`xp:${guild.id}`,()=>withKeyLock(`xp:${guild.id}:${member.id}`,async()=>{
    const before=getXp(guild.id,member.id);
    db.transaction(()=>{
      db.prepare('DELETE FROM xp_users WHERE guild_id=? AND user_id=?').run(guild.id,member.id);
      outbox.enqueueRoleTx(guild.id,member.id,'xp',0,db);
    })();
    await sendLog(guild,'xp',{action:'reset',user:member.user.tag,by:actorTag,previous_level:before.level});
    return {ok:true};
  }));
}

async function resetAll(guild,actorTag){
  return withWriteLock(`xp:${guild.id}`,()=>withKeyLock(`xp-resetall:${guild.id}`,async()=>{
    let members; try{members=await guild.members.fetch();}catch(error){return {ok:false,message:`اعضای سرور قابل دریافت نیستند: ${error.message}`};}
    const rows=db.prepare('SELECT user_id FROM xp_users WHERE guild_id=?').all(guild.id);
    db.transaction(()=>{
      db.prepare('DELETE FROM xp_users WHERE guild_id=?').run(guild.id);
      for(const member of members.values())outbox.enqueueRoleTx(guild.id,member.id,'xp',0,db);
      for(const row of rows)if(!members.has(row.user_id))outbox.enqueueRoleTx(guild.id,row.user_id,'xp',0,db);
    })();
    await sendLog(guild,'xp',{action:'resetall',by:actorTag,users:rows.length});
    return {ok:true,users:rows.length};
  }));
}

async function reconcileGuild(guild){
  const mappings=rolesFor(guild.id);
  if(!mappings.length)return [];
  return syncAllMembers(guild);
}

module.exports={reconcileGuild,applyXp,manualChange,resetUser,resetAll,setXpRole,removeXpRole,rolesFor,syncRoles,syncAllMembers,levelFromXp,xpForLevel,changeRoleMapping,roleFor};
