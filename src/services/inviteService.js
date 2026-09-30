const { db } = require('../db');

function ensure(guildId, userId) {
  db.prepare(`INSERT INTO invites(guild_id,user_id,uses,leaves,fake,fake_leaves,added,fake_bonus,reset_at) VALUES(?,?,0,0,0,0,0,0,0)
    ON CONFLICT(guild_id,user_id) DO NOTHING`).run(guildId, userId);
  return db.prepare('SELECT * FROM invites WHERE guild_id=? AND user_id=?').get(guildId, userId);
}

function stats(guildId, userId) {
  const row = ensure(guildId, userId);
  const boundary=Number(row.reset_at||0);
  const activeValid = db.prepare('SELECT COUNT(*) AS c FROM invited_members WHERE guild_id=? AND inviter_id=? AND active=1 AND fake=0 AND last_joined_at>=?').get(guildId, userId,boundary).c;
  const valid = Math.max(0, activeValid + Number(row.added || 0));
  const activeFake = db.prepare('SELECT COUNT(*) AS c FROM invited_members WHERE guild_id=? AND inviter_id=? AND active=1 AND fake=1 AND last_joined_at>=?').get(guildId, userId,boundary).c;
  const totalJoins = db.prepare('SELECT COUNT(*) AS c FROM invite_events WHERE guild_id=? AND inviter_id=? AND type="JOIN" AND created_at>=?').get(guildId, userId,boundary).c;
  const active = db.prepare('SELECT COUNT(*) AS c FROM invited_members WHERE guild_id=? AND inviter_id=? AND active=1 AND last_joined_at>=?').get(guildId, userId,boundary).c;
  return { ...row, valid, total_joins: totalJoins, active_members: active, active_fake: activeFake, fake_bonus: Number(row.fake_bonus || 0) };
}

function leaderboard(guildId, limit=50) {
  return db.prepare(`SELECT i.*, MAX(0, COALESCE((SELECT COUNT(*) FROM invited_members imv WHERE imv.guild_id=i.guild_id AND imv.inviter_id=i.user_id AND imv.active=1 AND imv.fake=0 AND imv.last_joined_at>=i.reset_at),0)+i.added) AS valid,
    (SELECT COUNT(*) FROM invited_members im WHERE im.guild_id=i.guild_id AND im.inviter_id=i.user_id AND im.active=1 AND im.last_joined_at>=i.reset_at) AS active_members
    FROM invites i WHERE i.guild_id=? AND i.user_id<>'unknown' ORDER BY valid DESC, (SELECT COUNT(*) FROM invite_events e WHERE e.guild_id=i.guild_id AND e.inviter_id=i.user_id AND e.type='JOIN' AND e.created_at>=i.reset_at) DESC, i.added DESC, i.user_id ASC LIMIT ?`).all(guildId, Math.max(1, Math.min(100, limit)));
}

function addBonus(guildId, userId, amount) {
  const a = Math.max(0, Math.floor(Number(amount) || 0));
  if (!a) return ensure(guildId, userId);
  db.prepare(`INSERT INTO invites(guild_id,user_id,uses,leaves,fake,fake_leaves,added,fake_bonus) VALUES(?,?,0,0,0,0,?,0)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET added=MAX(0, invites.added+excluded.added)`).run(guildId, userId, a);
  return stats(guildId, userId);
}
function removeBonus(guildId, userId, amount) {
  const a = Math.max(0, Math.floor(Number(amount) || 0));
  const row = ensure(guildId, userId);
  db.prepare('UPDATE invites SET added=MAX(0,added-?) WHERE guild_id=? AND user_id=?').run(a, guildId, userId);
  return { ...row, added: Math.max(0, row.added - a) };
}
function addFakeBonus(guildId, userId, amount) {
  const a = Math.max(0, Math.floor(Number(amount) || 0));
  if (!a) return ensure(guildId, userId);
  db.prepare(`INSERT INTO invites(guild_id,user_id,uses,leaves,fake,fake_leaves,added,fake_bonus) VALUES(?,?,0,0,0,0,0,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET fake_bonus=MAX(0, invites.fake_bonus+excluded.fake_bonus)`).run(guildId, userId, a);
  return stats(guildId, userId);
}
function removeFakeBonus(guildId, userId, amount) {
  const a = Math.max(0, Math.floor(Number(amount) || 0));
  const row = ensure(guildId, userId);
  db.prepare('UPDATE invites SET fake_bonus=MAX(0,fake_bonus-?) WHERE guild_id=? AND user_id=?').run(a, guildId, userId);
  return { ...row, fake_bonus: Math.max(0, row.fake_bonus - a) };
}

function recordUse(guildId, inviterId) {
  db.prepare(`INSERT INTO invites(guild_id,user_id,uses,leaves,fake,fake_leaves,added,fake_bonus) VALUES(?,?,1,0,0,0,0,0)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET uses=uses+1`).run(guildId, inviterId);
}
function recordFake(guildId, inviterId) {
  db.prepare(`INSERT INTO invites(guild_id,user_id,uses,leaves,fake,fake_leaves,added,fake_bonus) VALUES(?,?,0,0,1,0,0,0)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET fake=fake+1`).run(guildId, inviterId);
}
function recordLeave(guildId, inviterId, wasFake=false) {
  if(!inviterId || inviterId==='unknown') return;
  db.prepare(`INSERT INTO invites(guild_id,user_id,uses,leaves,fake,fake_leaves,added,fake_bonus) VALUES(?,?,0,?,0,?,0,0)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET leaves=leaves+1, fake_leaves=fake_leaves+excluded.fake_leaves`).run(guildId, inviterId, wasFake?0:1, wasFake?1:0);
}

function membership(guildId, memberId) {
  return db.prepare('SELECT * FROM invited_members WHERE guild_id=? AND member_id=?').get(guildId, memberId) || null;
}
function upsertMembership(guildId, memberId, inviterId, code, fake, rejoin) {
  const previous = membership(guildId, memberId);
  const effectiveInviter = inviterId || previous?.inviter_id || 'unknown';
  const original = previous?.original_inviter_id || (inviterId || null);
  const now = Date.now();
  db.prepare(`INSERT INTO invited_members(guild_id,member_id,inviter_id,original_inviter_id,joined_at,fake,active,left_at,join_count,last_joined_at,last_left_at,last_invite_code,attribution_status)
    VALUES(?,?,?,?,?,?,1,NULL,1,?,?,?,?)
    ON CONFLICT(guild_id,member_id) DO UPDATE SET
      inviter_id=excluded.inviter_id,
      original_inviter_id=COALESCE(invited_members.original_inviter_id,excluded.original_inviter_id),
      joined_at=invited_members.joined_at,
      fake=excluded.fake,
      active=1,
      left_at=NULL,
      join_count=invited_members.join_count+1,
      last_joined_at=excluded.last_joined_at,
      last_invite_code=excluded.last_invite_code, attribution_status=excluded.attribution_status`).run(guildId, memberId, effectiveInviter, original, now, fake ? 1 : 0, now, now, code || null, inviterId?'known':(previous?'recovered':'unknown'));
  return { previous, rejoin: !!rejoin };
}
function markLeave(guildId, memberId) {
  const previous = membership(guildId, memberId);
  if (!previous || !previous.active) return { previous, changed: false };
  const now = Date.now();
  db.prepare('UPDATE invited_members SET active=0,left_at=?,last_left_at=? WHERE guild_id=? AND member_id=? AND active=1').run(now, now, guildId, memberId);
  return { previous, changed: true };
}
function inviterOf(guildId, memberId) { return membership(guildId, memberId); }
function invitedList(guildId, inviterId, limit=50, mode='all') {
  const lim=Math.max(1,Math.min(100,limit));
  if(mode==='active') return db.prepare('SELECT * FROM invited_members WHERE guild_id=? AND inviter_id=? AND active=1 ORDER BY last_joined_at DESC,member_id').all(guildId, inviterId).slice(0,lim);
  if(mode==='left') return db.prepare('SELECT * FROM invited_members WHERE guild_id=? AND inviter_id=? AND active=0 ORDER BY last_left_at DESC,member_id').all(guildId, inviterId).slice(0,lim);
  if(mode==='fake') return db.prepare('SELECT * FROM invited_members WHERE guild_id=? AND inviter_id=? AND fake=1 ORDER BY last_joined_at DESC,member_id').all(guildId, inviterId).slice(0,lim);
  return db.prepare('SELECT * FROM invited_members WHERE guild_id=? AND inviter_id=? ORDER BY last_joined_at DESC,member_id').all(guildId, inviterId).slice(0,lim);
}
function eventList(guildId, { inviterId=null, type='all', limit=50, offset=0 }={}) {
  const lim=Math.max(1,Math.min(100,Math.floor(Number(limit)||50))); const off=Math.max(0,Math.floor(Number(offset)||0));
  const types=[];
  if(type==='join') types.push('JOIN');
  else if(type==='left') types.push('LEAVE');
  else if(type==='fake') types.push('JOIN');
  else if(type==='rejoin') types.push('JOIN');
  let sql='SELECT * FROM invite_events WHERE guild_id=?'; const params=[guildId];
  if(inviterId){sql+=' AND inviter_id=?';params.push(inviterId)}
  if(types.length){sql+=` AND type IN (${types.map(()=>'?').join(',')})`;params.push(...types)}
  if(type==='fake')sql+=' AND fake=1';
  if(type==='rejoin')sql+=' AND rejoin=1';
  sql+=' ORDER BY id DESC LIMIT ? OFFSET ?';params.push(lim,off);
  return db.prepare(sql).all(...params);
}
function addEvent(guildId,{memberId,inviterId,code,type,fake=false,rejoin=false,accountAgeDays=null}) {
  db.prepare(`INSERT INTO invite_events(guild_id,member_id,inviter_id,invite_code,type,fake,rejoin,account_age_days,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(guildId,memberId,inviterId||null,code||null,String(type||'JOIN').toUpperCase(),fake?1:0,rejoin?1:0,accountAgeDays==null?null:Number(accountAgeDays),Date.now());
}
function totalJoins(guildId, inviterId) { return db.prepare('SELECT COUNT(*) AS c FROM invite_events WHERE guild_id=? AND inviter_id=? AND type="JOIN"').get(guildId, inviterId).c; }
function recordJoin(guildId,{memberId,inviterId=null,code=null,fake=false,rejoin=false,countRejoin=true,accountAgeDays=null}) {
  const tx=db.transaction(()=>{
    const current=membership(guildId,memberId);
    // Discord may deliver/retry the same join event. Never count an already-active
    // membership twice and never create duplicate JOIN history for the same active state.
    if(current?.active) return {duplicate:true, rejoin:false, inviterId:current.inviter_id};
    if(inviterId){
      // A rejoin is a new raw invite use only when the configured policy counts rejoins.
      const countRawUse=!rejoin || !!countRejoin;
      if(countRawUse) recordUse(guildId,inviterId);
      if(fake)recordFake(guildId,inviterId);
      upsertMembership(guildId,memberId,inviterId,code,fake,rejoin);
    } else {
      // Unknown attribution is still a real membership state. Never guess an inviter.
      upsertMembership(guildId,memberId,null,code||current?.last_invite_code,fake,rejoin);
    }
    addEvent(guildId,{memberId,inviterId:inviterId||current?.inviter_id||null,code:code||current?.last_invite_code,type:'JOIN',fake,rejoin,accountAgeDays});
    return {duplicate:false,rejoin:!!rejoin,inviterId:inviterId||current?.inviter_id||null};
  });
  return tx();
}
function recordMemberLeave(guildId,memberId){
  const current=membership(guildId,memberId);if(!current||!current.active)return {changed:false,previous:current};
  const tx=db.transaction(()=>{if(current.inviter_id && current.inviter_id!=='unknown')recordLeave(guildId,current.inviter_id,!!current.fake);markLeave(guildId,memberId);addEvent(guildId,{memberId,inviterId:current.inviter_id,code:current.last_invite_code,type:'LEAVE',fake:!!current.fake,rejoin:false});});
  tx();return {changed:true,previous:current};
}
function listMembers(guildId,{mode='all',inviterId=null,limit=50,offset=0}={}){
  const lim=Math.max(1,Math.min(100,Math.floor(Number(limit)||50))); const off=Math.max(0,Math.floor(Number(offset)||0));let where='guild_id=?';const params=[guildId];
  if(inviterId){where+=' AND inviter_id=?';params.push(inviterId)}
  if(mode==='active')where+=' AND active=1';
  if(mode==='left')where+=' AND active=0';
  if(mode==='fake')where+=' AND fake=1';
  return db.prepare(`SELECT * FROM invited_members WHERE ${where} ORDER BY COALESCE(last_joined_at,joined_at) DESC, member_id ASC LIMIT ? OFFSET ?`).all(...params,lim,off);
}


function removeInviteCode(guildId, code) { db.prepare('DELETE FROM invite_codes WHERE guild_id=? AND code=?').run(guildId,code); }
function upsertInviteCode(guildId, code, uses) { db.prepare(`INSERT INTO invite_codes(guild_id,code,uses,updated_at) VALUES(?,?,?,?) ON CONFLICT(guild_id,code) DO UPDATE SET uses=excluded.uses,updated_at=excluded.updated_at`).run(guildId,code,uses,Date.now()); }

function reset(guildId, userId=null) {
  const boundary=Date.now();
  const tx=db.transaction(()=>{
    if(userId){
      db.prepare('INSERT INTO invites(guild_id,user_id,uses,leaves,fake,fake_leaves,added,fake_bonus,reset_at) VALUES(?,?,0,0,0,0,0,0,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET uses=0,leaves=0,fake=0,fake_leaves=0,added=0,fake_bonus=0,reset_at=excluded.reset_at').run(guildId,userId,boundary);
    } else {
      db.prepare('UPDATE invites SET uses=0,leaves=0,fake=0,fake_leaves=0,added=0,fake_bonus=0,reset_at=? WHERE guild_id=?').run(boundary,guildId);
      db.prepare('DELETE FROM invite_codes WHERE guild_id=?').run(guildId);
    }
  });
  tx();
}

module.exports={stats,leaderboard,add:addBonus,remove:removeBonus,addFake:addFakeBonus,removeFake:removeFakeBonus,recordUse,recordFake,recordLeave,recordJoin,recordMemberLeave,membership,upsertMembership,markLeave,inviterOf,invitedList,listMembers,eventList,addEvent,totalJoins,removeInviteCode,upsertInviteCode,reset};
