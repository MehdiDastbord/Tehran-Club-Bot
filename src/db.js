const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("Missing environment variable: DATABASE_URL");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const schema = `
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  data JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS warns (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS xp (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  voice_minutes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS level_roles (
  guild_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, level)
);
CREATE TABLE IF NOT EXISTS staff_claims (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS staff_members (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at BIGINT,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS exchange_requests (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  server_text TEXT,
  status TEXT DEFAULT 'pending',
  created_at BIGINT
);
CREATE TABLE IF NOT EXISTS giveaways (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  title TEXT,
  prize TEXT,
  winners INTEGER,
  duration_ms BIGINT,
  ends_at BIGINT,
  ended INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id BIGINT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  guild_id TEXT NOT NULL,
  code TEXT NOT NULL,
  uses INTEGER,
  inviter_id TEXT,
  PRIMARY KEY (guild_id, code)
);
CREATE INDEX IF NOT EXISTS idx_xp_guild_xp ON xp(guild_id, xp DESC);
CREATE INDEX IF NOT EXISTS idx_giveaways_active ON giveaways(ended, ends_at);
`;

let initialized;
async function initDb() {
  if (!initialized) {
    initialized = pool.query(schema);
  }
  await initialized;
}

async function query(text, values = []) {
  await initDb();
  return pool.query(text, values);
}

function defaultConfig() {
  return {
    channels: { welcome:null,logs:null,dmLogs:null,inviteLogs:null,ticketLogs:null,ticketStats:null,feedback:null,rankup:null,recruit:null,demote:null,staffWarn:null,xpLevel:null,exchange:null },
    roles: { ticket:null,staffMain:null,staffExtra1:null,staffExtra2:null,staffManager:null },
    welcome: { enabled:true,text:"خوش اومدی {user} به سرور {server} ❤️" },
    staff: { ranks:[],managerRole:null },
    ticket: { category:null,claimRoles:[],panelChannel:null },
    xp: { message:10,voicePerMinute:5,cooldown:30,announce:true,ignoredChannels:[],ignoredRoles:[],ignoreAfk:true },
    levels: { baseXp:100,perLevel:50 },
    levelRoles: {}
  };
}

async function getConfig(guildId) {
  const { rows } = await query("SELECT data FROM guild_config WHERE guild_id=$1", [guildId]);
  if (rows[0]) return rows[0].data;
  const cfg = defaultConfig();
  await query("INSERT INTO guild_config(guild_id,data) VALUES($1,$2::jsonb) ON CONFLICT(guild_id) DO NOTHING", [guildId, JSON.stringify(cfg)]);
  return cfg;
}

async function saveConfig(guildId, cfg) {
  await query("INSERT INTO guild_config(guild_id,data) VALUES($1,$2::jsonb) ON CONFLICT(guild_id) DO UPDATE SET data=EXCLUDED.data", [guildId, JSON.stringify(cfg)]);
}

async function getXp(guildId, userId) {
  const { rows } = await query("SELECT xp,level,voice_minutes FROM xp WHERE guild_id=$1 AND user_id=$2", [guildId,userId]);
  return rows[0] || null;
}

async function saveXp(guildId, userId, xp, level, voiceMinutes) {
  await query(`INSERT INTO xp(guild_id,user_id,xp,level,voice_minutes) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET xp=EXCLUDED.xp, level=EXCLUDED.level, voice_minutes=EXCLUDED.voice_minutes`, [guildId,userId,xp,level,voiceMinutes]);
}

async function upsertStaffMember(guildId,userId,joinedAt) {
  await query("INSERT INTO staff_members(guild_id,user_id,joined_at) VALUES($1,$2,$3) ON CONFLICT(guild_id,user_id) DO UPDATE SET joined_at=EXCLUDED.joined_at", [guildId,userId,joinedAt]);
}
async function removeStaffMember(guildId,userId) { await query("DELETE FROM staff_members WHERE guild_id=$1 AND user_id=$2", [guildId,userId]); }
async function getStaffClaims(guildId) { const r=await query("SELECT user_id,count FROM staff_claims WHERE guild_id=$1 ORDER BY count DESC LIMIT 20",[guildId]); return r.rows; }
async function incrementStaffClaim(guildId,userId) { const r=await query("INSERT INTO staff_claims(guild_id,user_id,count) VALUES($1,$2,1) ON CONFLICT(guild_id,user_id) DO UPDATE SET count=staff_claims.count+1 RETURNING count",[guildId,userId]); return r.rows[0].count; }
async function getWarnCount(guildId,userId) { const r=await query("SELECT count FROM warns WHERE guild_id=$1 AND user_id=$2",[guildId,userId]); return r.rows[0]?.count || 0; }
async function setWarnCount(guildId,userId,count) { await query("INSERT INTO warns(guild_id,user_id,count) VALUES($1,$2,$3) ON CONFLICT(guild_id,user_id) DO UPDATE SET count=EXCLUDED.count",[guildId,userId,count]); }
async function createGiveaway(guildId,channelId,title,prize,winners,durationMs,endsAt) { const r=await query("INSERT INTO giveaways(guild_id,channel_id,title,prize,winners,duration_ms,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[guildId,channelId,title,prize,winners,durationMs,endsAt]); return Number(r.rows[0].id); }
async function setGiveawayMessage(id,messageId) { await query("UPDATE giveaways SET message_id=$1 WHERE id=$2",[messageId,id]); }
async function getGiveaway(id) { const r=await query("SELECT * FROM giveaways WHERE id=$1",[id]); return r.rows[0] || null; }
async function enterGiveaway(id,userId) { await query("INSERT INTO giveaway_entries(giveaway_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,userId]); }
async function getGiveawayEntryCount(id) { const r=await query("SELECT COUNT(*)::int AS c FROM giveaway_entries WHERE giveaway_id=$1",[id]); return r.rows[0].c; }
async function getActiveEndingGiveaways(now) { const r=await query("SELECT * FROM giveaways WHERE ended=0 AND ends_at<=$1",[now]); return r.rows; }
async function getGiveawayEntries(id) { const r=await query("SELECT user_id FROM giveaway_entries WHERE giveaway_id=$1",[id]); return r.rows; }
async function endGiveaway(id) { await query("UPDATE giveaways SET ended=1 WHERE id=$1",[id]); }
async function createExchangeRequest(guildId,userId,serverText,createdAt) { const r=await query("INSERT INTO exchange_requests(guild_id,user_id,server_text,created_at) VALUES($1,$2,$3,$4) RETURNING id",[guildId,userId,serverText,createdAt]); return Number(r.rows[0].id); }
async function getExchangeRequest(id) { const r=await query("SELECT * FROM exchange_requests WHERE id=$1",[id]); return r.rows[0] || null; }
async function updateExchangeStatus(id,status) { await query("UPDATE exchange_requests SET status=$1 WHERE id=$2",[status,id]); }
async function getLevel(guildId,userId) { return getXp(guildId,userId); }
async function getLeaderboard(guildId) { const r=await query("SELECT user_id,xp,level FROM xp WHERE guild_id=$1 ORDER BY xp DESC LIMIT 10",[guildId]); return r.rows; }

module.exports={pool,query,initDb,getConfig,saveConfig,getXp,saveXp,upsertStaffMember,removeStaffMember,getStaffClaims,incrementStaffClaim,getWarnCount,setWarnCount,createGiveaway,setGiveawayMessage,getGiveaway,enterGiveaway,getGiveawayEntryCount,getActiveEndingGiveaways,getGiveawayEntries,endGiveaway,createExchangeRequest,getExchangeRequest,updateExchangeStatus,getLevel,getLeaderboard};
