const { db, getStaff } = require('../db');
const { sendLog } = require('./logService');
const { withKeyLock, withReadLock, withWriteLock } = require('./lockService');
const outbox = require('./discordOutboxService');

function listRoles(gid){return db.prepare('SELECT * FROM staff_roles WHERE guild_id=? ORDER BY level').all(gid)}
function setRole(gid,level,roleId){const l=Math.max(1,Math.floor(Number(level)||0));const old=db.prepare('SELECT role_id FROM staff_roles WHERE guild_id=? AND level=?').get(gid,l)?.role_id||null;db.prepare('INSERT INTO staff_roles(guild_id,level,role_id) VALUES(?,?,?) ON CONFLICT(guild_id,level) DO UPDATE SET role_id=excluded.role_id').run(gid,l,roleId);return old}
function removeRole(gid,level){const l=Math.max(1,Math.floor(Number(level)||0));const old=db.prepare('SELECT role_id FROM staff_roles WHERE guild_id=? AND level=?').get(gid,l)?.role_id||null;db.prepare('DELETE FROM staff_roles WHERE guild_id=? AND level=?').run(gid,l);return old}
function roleFor(gid,level,map=null){if(map)return map.get(Number(level))||null;return db.prepare('SELECT role_id FROM staff_roles WHERE guild_id=? AND level=?').get(gid,Number(level))?.role_id||null}
function setStaff(gid,userId,level,points=0){db.prepare(`INSERT INTO staff_users(guild_id,user_id,level,points,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET level=excluded.level,points=excluded.points,updated_at=excluded.updated_at`).run(gid,userId,Math.max(0,Math.floor(level)),Math.max(0,Math.floor(points)),Date.now())}
function listMembers(gid,limit=50){
  const max=Math.max(1,Math.min(100,Math.floor(Number(limit)||50)));
  const members=db.prepare('SELECT * FROM staff_users WHERE guild_id=? AND level>0 ORDER BY level DESC,points DESC,user_id ASC LIMIT ?').all(gid,max);
  const mappings=listRoles(gid).sort((a,b)=>b.level-a.level);
  const byLevel=new Map();
  for(const row of members){if(!byLevel.has(row.level))byLevel.set(row.level,[]);byLevel.get(row.level).push(row);}
  const groups=[];
  for(const map of mappings){const rows=byLevel.get(map.level)||[];if(rows.length)groups.push({level:map.level,role_id:map.role_id,members:rows});byLevel.delete(map.level);}
  const unmapped=[];
  for(const [level,rows] of [...byLevel.entries()].sort((a,b)=>b[0]-a[0])){groups.push({level,role_id:null,members:rows});unmapped.push(...rows);}
  return {groups,unmapped};
}

function mapFromDb(gid,override=null){return override instanceof Map?new Map(override):new Map(listRoles(gid).map(x=>[x.level,x.role_id]));}
function ids(map){return [...new Set([...map.values()].filter(Boolean))]}
async function validateMap(guild,map){const bot=guild.members.me;if(!bot?.permissions.has('ManageRoles'))return [{user:'system',failures:[{role:'staff_roles',error:'Bot lacks ManageRoles'}]}];for(const id of ids(map)){const role=await guild.roles.fetch(id).catch(()=>null);if(!role)return [{user:'system',failures:[{role:id,error:'Role not found'}]}];if(role.managed||role.position>=bot.roles.highest.position)return [{user:'system',failures:[{role:id,error:'Role not manageable by bot'}]}];}return []}
async function syncRoles(member,level,override=null){const map=mapFromDb(member.guild.id,override);const desired=Number(level)>0?map.get(Number(level))||null:null;const managedIds=ids(map);const bot=member.guild.members.me;if(!bot?.permissions.has('ManageRoles'))return [{role:'staff_roles',error:'Bot lacks ManageRoles'}];for(const id of managedIds){const role=member.guild.roles.cache.get(id)||await member.guild.roles.fetch(id).catch(()=>null);if(!role)return [{role:id,error:'Role not found'}];if(role.managed||role.position>=bot.roles.highest.position)return [{role:id,error:'Role not manageable by bot'}];}
  const before=new Set(member.roles.cache.filter(r=>managedIds.includes(r.id)).map(r=>r.id));const changed=[];try{for(const id of before)if(id!==desired){await member.roles.remove(id,'Staff role sync');changed.push({id,action:'removed'});}if(desired&&!member.roles.cache.has(desired)){await member.roles.add(desired,`Staff Level ${level}`);changed.push({id:desired,action:'added'});}return [];}catch(error){for(const c of changed.reverse()){try{if(c.action==='removed'&&!member.roles.cache.has(c.id))await member.roles.add(c.id,'Staff role rollback');if(c.action==='added'&&member.roles.cache.has(c.id))await member.roles.remove(c.id,'Staff role rollback');}catch(e){console.error('[STAFF ROLLBACK]',e.message)}}return [{role:error?.roleId||desired||'staff_roles',error:error.message}];}
}
async function syncAllMembers(guild,override=null,oldMap=null){
  const map=mapFromDb(guild.id,override);
  const oldIds=oldMap?ids(mapFromDb(guild.id,oldMap)):[];
  const valid=await validateMap(guild,map); if(valid.length)return valid;
  let members; try{members=await guild.members.fetch();}catch(error){return [{user:'system',failures:[{role:'members',error:error.message}]}];}
  db.transaction(()=>{
    for(const member of members.values()){
      const row=getStaff(guild.id,member.id); const level=row?.level||0;
      outbox.enqueueRoleTx(guild.id,member.id,'staff',level,db,{extraManagedRoleIds:oldIds});
    }
  })();
  return [];
}

async function changeRoleMapping(guild,level,roleId,remove=false,actorTag='system'){
  return withWriteLock(`staff:${guild.id}`,()=>withKeyLock(`staff-mapping:${guild.id}`,async()=>{
    const current=mapFromDb(guild.id); const candidate=new Map(current); const old=candidate.get(level)||null;
    if(remove)candidate.delete(level);else candidate.set(level,roleId);
    const valid=await validateMap(guild,candidate);if(valid.length)return {ok:false,message:'Role Mapping معتبر نیست.',failures:valid};
    const users=db.prepare('SELECT user_id,level FROM staff_users WHERE guild_id=?').all(guild.id);
    db.transaction(()=>{
      if(remove)db.prepare('DELETE FROM staff_roles WHERE guild_id=? AND level=?').run(guild.id,level);
      else db.prepare('INSERT INTO staff_roles(guild_id,level,role_id) VALUES(?,?,?) ON CONFLICT(guild_id,level) DO UPDATE SET role_id=excluded.role_id').run(guild.id,level,roleId);
      for(const row of users)outbox.enqueueRoleTx(guild.id,row.user_id,'staff',row.level,db,{extraManagedRoleIds:old?[old]:[]});
    })();
    await sendLog(guild,'staff',{action:remove?'role_mapping_remove':'role_mapping_set',level,role:roleId||old||'none',by:actorTag});
    return {ok:true,old};
  }));
}

async function changeLevel(guild,target,actor,desired,action,reason){
  return withReadLock(`staff:${guild.id}`,()=>withKeyLock(`staff:${guild.id}:${target.id}`,async()=>{
    const requested=Number(desired);if(!Number.isFinite(requested))return {ok:false,message:'Staff Level باید عدد معتبر باشد.'};const current=getStaff(guild.id,target.id),old=current?.level||0,points=current?.points||0,next=Math.max(0,Math.min(1000000000,Math.floor(requested)));
    if(next===old)return {ok:false,message:'Level تغییری نکرد.'};
    db.transaction(()=>{ setStaff(guild.id,target.id,next,points); db.prepare('INSERT INTO staff_history(guild_id,target_id,actor_id,action,old_level,new_level,reason,created_at) VALUES(?,?,?,?,?,?,?,?)').run(guild.id,target.id,actor.id,action,old,next,reason||'بدون دلیل',Date.now()); outbox.enqueueRoleTx(guild.id,target.id,'staff',next,db); })();
    await sendLog(guild,'staff',{action,target:target.user.tag,from:old,to:next,by:actor.user.tag,reason:reason||'بدون دلیل'});return {ok:true,old,next,action};
  }));
}
async function removeStaff(guild,target,actor,reason){
  return withReadLock(`staff:${guild.id}`,()=>withKeyLock(`staff:${guild.id}:${target.id}`,async()=>{
    const current=getStaff(guild.id,target.id);const old=current?.level||0;if(old<=0)return {ok:false,message:'این کاربر Staff نیست.'};
    db.transaction(()=>{
      db.prepare('DELETE FROM staff_users WHERE guild_id=? AND user_id=?').run(guild.id,target.id);
      db.prepare('INSERT INTO staff_history(guild_id,target_id,actor_id,action,old_level,new_level,reason,created_at) VALUES(?,?,?,?,?,?,?,?)').run(guild.id,target.id,actor.id,'STAFF_REMOVE',old,0,reason||'بدون دلیل',Date.now());
      outbox.enqueueRoleTx(guild.id,target.id,'staff',0,db);
    })();
    await sendLog(guild,'staff',{action:'STAFF_REMOVE',target:target.user.tag,from:old,to:0,by:actor.user.tag,reason:reason||'بدون دلیل'});
    return {ok:true,old,next:0};
  }));
}
async function changeRank(guild,target,actor,delta,reason){const current=getStaff(guild.id,target.id),old=current?.level||0;return changeLevel(guild,target,actor,old+delta,delta>0?'RANK_UP':'RANK_DOWN',reason)}
async function reconcileGuild(guild){
  const mappings=listRoles(guild.id);
  if(!mappings.length)return [];
  return syncAllMembers(guild);
}

module.exports={reconcileGuild,getStaff,setStaff,setRole,removeRole,listRoles,listMembers,roleFor,changeRank,changeLevel,removeStaff,syncRoles,syncAllMembers,changeRoleMapping};
