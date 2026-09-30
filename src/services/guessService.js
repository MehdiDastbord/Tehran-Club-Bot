const crypto = require('crypto');
const { db } = require('../db');
const { withKeyLock } = require('./lockService');

function normalize(min, max) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) return { error: 'Min و Max باید عدد صحیح باشند.' };
  if (max < min) return { error: 'حداقل باید کمتر از یا مساوی حداکثر باشد.' };
  if (max - min > 1000000) return { error: 'بازه بیش از حد بزرگ است.' };
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return { error: 'محدوده عددی معتبر نیست.' };
  return { min, max };
}

function start(guildId, channelId, starterId, min, max) {
  const v = normalize(min, max);
  if (v.error) return v;
  return withKeyLock(`guess:${guildId}:${channelId}`, async () => {
    const number = crypto.randomInt(v.min, v.max + 1);
    db.transaction(() => {
      // One active game per channel; starting again replaces only that channel's game.
      db.prepare('UPDATE guess_games SET active=0 WHERE guild_id=? AND channel_id=? AND active=1').run(guildId, channelId);
      db.prepare('INSERT INTO guess_games(guild_id,channel_id,starter_id,min,max,number,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
        .run(guildId, channelId, starterId, v.min, v.max, number, Date.now());
    })();
    return db.prepare('SELECT * FROM guess_games WHERE guild_id=? AND channel_id=? AND active=1').get(guildId, channelId);
  });
}

function get(guildId, channelId) {
  return db.prepare('SELECT * FROM guess_games WHERE guild_id=? AND channel_id=? AND active=1').get(guildId, channelId) || null;
}

function stop(guildId, channelId) {
  return db.prepare('UPDATE guess_games SET active=0 WHERE guild_id=? AND channel_id=? AND active=1').run(guildId, channelId).changes > 0;
}

function check(guildId, channelId, text) {
  const r = get(guildId, channelId);
  if (!r) return null;
  const n = Number(String(text).trim());
  if (!Number.isInteger(n) || n < r.min || n > r.max) return null;
  if (n !== r.number) return { wrong: true, game: r };
  const result = db.prepare('UPDATE guess_games SET active=0 WHERE guild_id=? AND channel_id=? AND active=1').run(guildId, channelId);
  return result.changes ? { ...r, correct: true } : null;
}

module.exports = { start, get, stop, check };
