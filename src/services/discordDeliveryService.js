const crypto = require('crypto');
const { db } = require('../db');

const LEASE_MS = 30_000;
const RETRY_MS = 1_000;
const MAX_ATTEMPTS = 10;

function enqueueActionTx(guildId, channelId, action, payload, dedupeKey, txDb = db) {
  const now = Date.now();
  txDb.prepare(`
    INSERT INTO discord_delivery_outbox(
      guild_id,channel_id,action,payload,dedupe_key,status,attempts,last_error,lease_until,claim_token,created_at,updated_at,next_attempt_at
    ) VALUES(?,?,?,?,?,'pending',0,NULL,0,NULL,?,?,?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      guild_id=excluded.guild_id,
      channel_id=excluded.channel_id,
      action=excluded.action,
      payload=excluded.payload,
      status=CASE WHEN excluded.action='edit' THEN 'pending' WHEN discord_delivery_outbox.status='done' THEN 'done' ELSE 'pending' END,
      attempts=CASE WHEN excluded.action='edit' THEN 0 ELSE discord_delivery_outbox.attempts END,
      last_error=NULL,
      updated_at=excluded.updated_at,
      lease_until=0,
      claim_token=NULL,
      next_attempt_at=excluded.next_attempt_at
  `).run(guildId, channelId, action, JSON.stringify(payload), dedupeKey, now, now, now);
}

function enqueueSendTx(guildId, channelId, payload, dedupeKey, txDb = db) {
  return enqueueActionTx(guildId, channelId, 'send', payload, dedupeKey, txDb);
}
function enqueueEditTx(guildId, channelId, messageId, payload, dedupeKey, txDb = db) {
  return enqueueActionTx(guildId, channelId, 'edit', { message_id: messageId, ...payload }, dedupeKey, txDb);
}
function enqueueSend(guildId, channelId, payload, dedupeKey) { return enqueueSendTx(guildId, channelId, payload, dedupeKey, db); }
function enqueueEdit(guildId, channelId, messageId, payload, dedupeKey) { return enqueueEditTx(guildId, channelId, messageId, payload, dedupeKey, db); }

function claim(now = Date.now()) {
  const token = crypto.randomUUID();
  const tx = db.transaction(() => {
    const row = db.prepare(`
      SELECT * FROM discord_delivery_outbox
      WHERE (status='pending' AND next_attempt_at<=?)
         OR (status='processing' AND lease_until<=?)
      ORDER BY id LIMIT 1
    `).get(now, now);
    if (!row) return null;
    const r = db.prepare(`
      UPDATE discord_delivery_outbox
      SET status='processing',attempts=attempts+1,updated_at=?,lease_until=?,claim_token=?
      WHERE id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='processing' AND lease_until<=?))
    `).run(now, now + LEASE_MS, token, row.id, now, now);
    if (!r.changes) return null;
    return { ...db.prepare('SELECT * FROM discord_delivery_outbox WHERE id=?').get(row.id), claim_token: token };
  });
  return tx();
}

function retryDelay(attempts) { return Math.min(300_000, RETRY_MS * (2 ** Math.min(Math.max(0, attempts - 1), 8))); }

async function perform(client, row) {
  const channel = await client.channels.fetch(row.channel_id);
  if (!channel?.isTextBased()) throw new Error('DELIVERY_CHANNEL_NOT_TEXT_BASED');
  const payload = JSON.parse(row.payload);
  if (row.action === 'send') return channel.send(payload);
  if (row.action === 'edit') {
    const message = await channel.messages.fetch(payload.message_id);
    const { message_id, ...edit } = payload;
    return message.edit(edit);
  }
  throw new Error(`UNKNOWN_DELIVERY_ACTION:${row.action}`);
}

async function drain(client, limit = 25) {
  for (let i = 0; i < Math.max(1, Math.min(100, limit)); i++) {
    const row = claim();
    if (!row) break;
    try {
      await perform(client, row);
      db.prepare(`UPDATE discord_delivery_outbox SET status='done',last_error=NULL,updated_at=?,lease_until=0,claim_token=NULL,next_attempt_at=0 WHERE id=? AND status='processing' AND claim_token=?`)
        .run(Date.now(), row.id, row.claim_token);
    } catch (error) {
      const now = Date.now();
      const failed = row.attempts >= MAX_ATTEMPTS;
      db.prepare(`UPDATE discord_delivery_outbox SET status=?,last_error=?,updated_at=?,lease_until=0,claim_token=NULL,next_attempt_at=? WHERE id=? AND status='processing' AND claim_token=?`)
        .run(failed ? 'failed' : 'pending', String(error.message || error).slice(0, 1000), now, failed ? 0 : now + retryDelay(row.attempts), row.id, row.claim_token);
    }
  }
}

function recover() {
  const now = Date.now();
  db.prepare(`UPDATE discord_delivery_outbox SET status='pending',updated_at=?,lease_until=0,claim_token=NULL,next_attempt_at=? WHERE status='processing' AND lease_until<=?`).run(now, now, now);
}
function retryFailed() {
  const now = Date.now();
  return db.prepare(`UPDATE discord_delivery_outbox SET status='pending',updated_at=?,lease_until=0,claim_token=NULL,next_attempt_at=? WHERE status='failed'`).run(now, now).changes;
}

module.exports = { enqueueSend, enqueueSendTx, enqueueEdit, enqueueEditTx, drain, recover, retryFailed };
