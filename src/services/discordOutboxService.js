const crypto = require('crypto');
const { db } = require('../db');
const { PermissionFlagsBits } = require('discord.js');

const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 10;
const RETRY_MS = 1_000;

function enqueueRoleTx(guildId, userId, entityType, level, txDb = db, options = {}) {
  if (!['xp', 'staff'].includes(entityType)) throw new Error('INVALID_OUTBOX_ENTITY_TYPE');
  const desiredLevel = Math.max(0, Number(level) || 0);
  const table = entityType === 'xp' ? 'xp_roles' : 'staff_roles';
  const desiredRoleId = txDb.prepare(`SELECT role_id FROM ${table} WHERE guild_id=? AND level=?`).get(guildId, desiredLevel)?.role_id || null;
  const mapped = txDb.prepare(`SELECT role_id FROM ${table} WHERE guild_id=?`).all(guildId).map(r => r.role_id);
  const extra = Array.isArray(options.extraManagedRoleIds) ? options.extraManagedRoleIds : [];
  const managed = [...new Set([...mapped, ...extra].filter(Boolean))];
  const desired = JSON.stringify({ level: desiredLevel, role_id: desiredRoleId, managed_role_ids: managed });
  const now = Date.now();

  txDb.prepare(`
    INSERT INTO discord_sync_outbox(
      guild_id,entity_type,entity_id,desired_json,desired_role_id,previous_role_ids,
      status,attempts,last_error,created_at,updated_at,lease_until,claim_token,next_attempt_at
    ) VALUES(?,?,?,?,?,'[]','pending',0,NULL,?,?,0,NULL,?)
    ON CONFLICT(entity_type,entity_id) DO UPDATE SET
      guild_id=excluded.guild_id,
      desired_json=excluded.desired_json,
      desired_role_id=excluded.desired_role_id,
      status='pending',
      last_error=NULL,
      updated_at=excluded.updated_at,
      lease_until=0,
      claim_token=NULL,
      next_attempt_at=excluded.next_attempt_at
  `).run(guildId, entityType, String(userId), desired, desiredRoleId, now, now, now);
}

function enqueueRole(guildId, userId, entityType, level, options = {}) {
  return enqueueRoleTx(guildId, userId, entityType, level, db, options);
}

async function apply(client, row) {
  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) throw new Error('GUILD_NOT_AVAILABLE');
  const member = await guild.members.fetch(row.entity_id);
  const data = JSON.parse(row.desired_json);
  const desired = data.role_id || null;
  const ids = [...new Set((data.managed_role_ids || []).filter(Boolean))];
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('BOT_MISSING_MANAGE_ROLES');

  for (const id of ids) {
    const role = await guild.roles.fetch(id).catch(() => null);
    if (role && (role.managed || role.position >= me.roles.highest.position)) {
      throw new Error(`ROLE_NOT_MANAGEABLE:${id}`);
    }
  }

  for (const id of ids) {
    if (id !== desired && member.roles.cache.has(id)) {
      await member.roles.remove(id, `V20 ${row.entity_type} reconciliation`);
    }
  }
  if (desired) {
    const role = await guild.roles.fetch(desired).catch(() => null);
    if (!role) throw new Error(`ROLE_NOT_FOUND:${desired}`);
    if (role.managed || role.position >= me.roles.highest.position) throw new Error(`ROLE_NOT_MANAGEABLE:${desired}`);
    if (!member.roles.cache.has(desired)) await member.roles.add(desired, `V20 ${row.entity_type} reconciliation`);
  }
}

function claimOne(now = Date.now()) {
  const token = crypto.randomUUID();
  const tx = db.transaction(() => {
    const row = db.prepare(`
      SELECT * FROM discord_sync_outbox
      WHERE (status='pending' AND next_attempt_at<=?)
         OR (status='processing' AND lease_until<=?)
      ORDER BY id LIMIT 1
    `).get(now, now);
    if (!row) return null;

    const updated = db.prepare(`
      UPDATE discord_sync_outbox
      SET status='processing', attempts=attempts+1, updated_at=?, lease_until=?, claim_token=?
      WHERE id=?
        AND ((status='pending' AND next_attempt_at<=?) OR (status='processing' AND lease_until<=?))
    `).run(now, now + LEASE_MS, token, row.id, now, now);
    if (!updated.changes) return null;
    return { ...db.prepare('SELECT * FROM discord_sync_outbox WHERE id=?').get(row.id), claim_token: token };
  });
  return tx();
}

function retryDelay(attempts) {
  return Math.min(300_000, RETRY_MS * (2 ** Math.min(Math.max(0, attempts - 1), 8)));
}

async function drain(client, limit = 25) {
  for (let i = 0; i < Math.max(1, Math.min(100, limit)); i++) {
    const row = claimOne();
    if (!row) break;
    try {
      await apply(client, row);
      db.prepare(`UPDATE discord_sync_outbox SET status='done',last_error=NULL,updated_at=?,lease_until=0,claim_token=NULL,next_attempt_at=0 WHERE id=? AND status='processing' AND claim_token=?`)
        .run(Date.now(), row.id, row.claim_token);
    } catch (error) {
      const now = Date.now();
      const failed = row.attempts >= MAX_ATTEMPTS;
      db.prepare(`UPDATE discord_sync_outbox SET status=?,last_error=?,updated_at=?,lease_until=0,claim_token=NULL,next_attempt_at=? WHERE id=? AND status='processing' AND claim_token=?`)
        .run(failed ? 'failed' : 'pending', String(error.message || error).slice(0, 1000), now, failed ? 0 : now + retryDelay(row.attempts), row.id, row.claim_token);
    }
  }
}

function recoverFailed() {
  const now = Date.now();
  db.prepare(`UPDATE discord_sync_outbox SET status='pending',updated_at=?,lease_until=0,claim_token=NULL,next_attempt_at=? WHERE status='processing' AND lease_until<=?`)
    .run(now, now, now);
}

function retryFailed() {
  const now = Date.now();
  return db.prepare(`UPDATE discord_sync_outbox SET status='pending',attempts=0,updated_at=?,lease_until=0,claim_token=NULL,next_attempt_at=? WHERE status='failed'`)
    .run(now, now).changes;
}

module.exports = { enqueueRole, enqueueRoleTx, drain, recoverFailed, retryFailed };
