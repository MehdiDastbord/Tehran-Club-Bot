const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { sqlitePath, backupDir } = require('./config');
const { withKeyLock } = require('./services/lockService');

const full = path.resolve(sqlitePath);
fs.mkdirSync(path.dirname(full), { recursive: true });
const db = new Database(full);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guild_settings_backup (guild_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS xp_users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  last_xp_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS xp_roles (
  guild_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY(guild_id,level)
);
CREATE TABLE IF NOT EXISTS invites (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  leaves INTEGER NOT NULL DEFAULT 0,
  fake INTEGER NOT NULL DEFAULT 0,
  fake_leaves INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  fake_bonus INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS invited_members (
  guild_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  inviter_id TEXT NOT NULL,
  original_inviter_id TEXT,
  joined_at INTEGER NOT NULL,
  fake INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  left_at INTEGER,
  join_count INTEGER NOT NULL DEFAULT 1,
  last_joined_at INTEGER NOT NULL DEFAULT 0,
  last_left_at INTEGER,
  last_invite_code TEXT,
  PRIMARY KEY(guild_id,member_id)
);
CREATE TABLE IF NOT EXISTS invite_codes (
  guild_id TEXT NOT NULL,
  code TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(guild_id,code)
);
CREATE TABLE IF NOT EXISTS invite_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  inviter_id TEXT,
  invite_code TEXT,
  type TEXT NOT NULL,
  fake INTEGER NOT NULL DEFAULT 0,
  rejoin INTEGER NOT NULL DEFAULT 0,
  account_age_days REAL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  points INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS staff_roles (
  guild_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY(guild_id,level)
);
CREATE TABLE IF NOT EXISTS staff_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  old_level INTEGER NOT NULL,
  new_level INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT UNIQUE,
  opener_id TEXT NOT NULL,
  type TEXT NOT NULL,
  claimed_by TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  open_key TEXT,
  control_message_id TEXT
);
CREATE TABLE IF NOT EXISTS ticket_permission_snapshots (
  ticket_id INTEGER NOT NULL,
  subject_id TEXT NOT NULL,
  allow TEXT NOT NULL DEFAULT '0',
  deny TEXT NOT NULL DEFAULT '0',
  had_overwrite INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'unknown',
  PRIMARY KEY(ticket_id,subject_id),
  FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ticket_participants (
  ticket_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  removed_at INTEGER,
  PRIMARY KEY(ticket_id,user_id),
  FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT UNIQUE,
  prize TEXT NOT NULL,
  ends_at INTEGER NOT NULL,
  ended INTEGER NOT NULL DEFAULT 0,
  link TEXT,
  winner_id TEXT
);
CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(giveaway_id,user_id),
  FOREIGN KEY(giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  kind TEXT NOT NULL,
  trigger_text TEXT,
  prize TEXT,
  ended INTEGER NOT NULL DEFAULT 0,
  winner_id TEXT,
  created_at INTEGER NOT NULL,
  ends_at INTEGER
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_commands (
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  response TEXT NOT NULL,
  PRIMARY KEY(guild_id,name)
);
CREATE TABLE IF NOT EXISTS guess_games (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  starter_id TEXT NOT NULL,
  min INTEGER NOT NULL,
  max INTEGER NOT NULL,
  number INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exchange_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT UNIQUE,
  requester_id TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  decided_at INTEGER,
  banner_url TEXT
);
CREATE TABLE IF NOT EXISTS embed_buttons (
  message_id TEXT NOT NULL,
  button_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  response TEXT NOT NULL,
  PRIMARY KEY(message_id,button_index)
);
CREATE INDEX IF NOT EXISTS idx_logs_guild_created ON logs(guild_id,created_at);
CREATE INDEX IF NOT EXISTS idx_invite_events_guild_created ON invite_events(guild_id,created_at);
CREATE INDEX IF NOT EXISTS idx_invite_events_member ON invite_events(guild_id,member_id,created_at);
CREATE INDEX IF NOT EXISTS idx_invited_members_inviter_active ON invited_members(guild_id,inviter_id,active,last_joined_at);
CREATE INDEX IF NOT EXISTS idx_ai_messages_guild_user_id ON ai_messages(guild_id,user_id,id);
CREATE INDEX IF NOT EXISTS idx_ticket_participants_active ON ticket_participants(ticket_id,active);
CREATE INDEX IF NOT EXISTS idx_ticket_snapshots_ticket ON ticket_permission_snapshots(ticket_id);
CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets(guild_id,status,opener_id);
CREATE INDEX IF NOT EXISTS idx_giveaway_entries_order ON giveaway_entries(giveaway_id,joined_at,user_id);
CREATE INDEX IF NOT EXISTS idx_drops_active ON drops(guild_id,channel_id,ended,ends_at);
CREATE INDEX IF NOT EXISTS idx_staff_history_target ON staff_history(guild_id,target_id,created_at);
CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings(guild_id,user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_exchange_status ON exchange_requests(guild_id,status,id);
`);

// Remove legacy Music/24-7 persistence from databases created by older versions.
try { db.exec('DROP TABLE IF EXISTS music_247'); } catch (e) { console.error('[DB LEGACY MUSIC CLEANUP]', e.message); }

function columnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((x) => x.name);
}
function addColumn(table, column, ddl) {
  if (!columnNames(table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

try {
  addColumn('exchange_requests', 'banner_url', 'TEXT');
  addColumn('invites', 'fake_leaves', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('invited_members', 'original_inviter_id', 'TEXT');
  addColumn('invited_members', 'active', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('invited_members', 'left_at', 'INTEGER');
  addColumn('invited_members', 'join_count', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('invited_members', 'last_joined_at', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('invited_members', 'last_left_at', 'INTEGER');
  addColumn('invited_members', 'last_invite_code', 'TEXT');
  addColumn('tickets', 'open_key', 'TEXT');
  addColumn('tickets', 'control_message_id', 'TEXT');
  addColumn('drops', 'ends_at', 'INTEGER');
} catch (e) {
  console.error('[DB MIGRATION]', e.message);
}

// Repair old duplicate open tickets before adding the unique open-key index.
try {
  const dupes = db.prepare(`
    SELECT guild_id, opener_id, COUNT(*) AS c
    FROM tickets WHERE status='open'
    GROUP BY guild_id, opener_id HAVING c > 1
  `).all();
  const closeDupes = db.transaction(() => {
    for (const d of dupes) {
      const rows = db.prepare(`SELECT id FROM tickets WHERE guild_id=? AND opener_id=? AND status='open' ORDER BY id DESC`).all(d.guild_id, d.opener_id);
      for (const row of rows.slice(1)) {
        db.prepare(`UPDATE tickets SET status='closed',closed_at=?,open_key=NULL WHERE id=?`).run(Date.now(), row.id);
      }
    }
  });
  closeDupes();
} catch (e) {
  console.error('[DB TICKET REPAIR]', e.message);
}

try {
  db.prepare(`UPDATE tickets SET open_key = guild_id || ':' || opener_id WHERE status='open' AND open_key IS NULL`).run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_open_key ON tickets(open_key) WHERE open_key IS NOT NULL');
} catch (e) {
  console.error('[DB TICKET INDEX]', e.message);
}

// Backfill new drop end times for legacy drops.
try {
  db.prepare('UPDATE drops SET ends_at=created_at+3600000 WHERE ends_at IS NULL').run();
} catch (e) {
  console.error('[DB DROP MIGRATION]', e.message);
}

// Allow one Guess game per channel instead of one per guild.
try {
  const cols = columnNames('guess_games');
  const guildPk = db.prepare('PRAGMA table_info(guess_games)').all().filter(x => x.pk > 0).map(x => x.name);
  if (guildPk.length === 1 && guildPk[0] === 'guild_id') {
    db.exec(`
      CREATE TABLE IF NOT EXISTS guess_games_v2 (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        starter_id TEXT NOT NULL,
        min INTEGER NOT NULL,
        max INTEGER NOT NULL,
        number INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(guild_id,channel_id)
      );
      INSERT OR REPLACE INTO guess_games_v2(guild_id,channel_id,starter_id,min,max,number,active,created_at)
        SELECT guild_id,channel_id,starter_id,min,max,number,active,created_at FROM guess_games;
      DROP TABLE guess_games;
      ALTER TABLE guess_games_v2 RENAME TO guess_games;
      CREATE INDEX IF NOT EXISTS idx_guess_active ON guess_games(guild_id,active,channel_id);
    `);
  } else {
    db.exec('CREATE INDEX IF NOT EXISTS idx_guess_active ON guess_games(guild_id,active,channel_id)');
  }
} catch (e) {
  console.error('[DB GUESS MIGRATION]', e.message);
}

// V15 migration: separate manual Fake bonuses from real Fake Join counts.
try {
  const cols = db.prepare('PRAGMA table_info(invites)').all().map(x=>x.name);
  if (!cols.includes('fake_bonus')) db.exec('ALTER TABLE invites ADD COLUMN fake_bonus INTEGER NOT NULL DEFAULT 0');
} catch (e) { console.error('[DB INVITE MIGRATION]', e.message); }

// Transactional schema versioning. Never advance a migration version until its migration commits.
const MIGRATIONS = [
  { version: 1, name: 'legacy-v12-baseline', run: () => {} },
  { version: 2, name: 'invite-fake-leave-and-settings-backup', run: () => {} },
  { version: 3, name: 'production-hardening', run: () => {} },
  { version: 4, name: 'separate-invite-fake-bonus', run: () => {
      const cols = db.prepare('PRAGMA table_info(invites)').all().map(x=>x.name);
      if (!cols.includes('fake_bonus')) db.exec('ALTER TABLE invites ADD COLUMN fake_bonus INTEGER NOT NULL DEFAULT 0');
    }
  },
  { version: 5, name: 'production-v16-reconciliation-state', run: () => {
      db.exec(`CREATE TABLE IF NOT EXISTS discord_sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL, desired_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON discord_sync_outbox(status,updated_at)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_invite_events_member ON invite_events(guild_id,member_id,created_at)');
  }},
  { version: 6, name: 'production-v17-ticket-subject-type-and-outbox-constraints', run: () => {
      const cols = db.prepare('PRAGMA table_info(ticket_permission_snapshots)').all().map(x=>x.name);
      if (!cols.includes('subject_type')) db.exec("ALTER TABLE ticket_permission_snapshots ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'unknown'");
      db.exec('CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity ON discord_sync_outbox(entity_type,entity_id,status)');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_outbox_pending_entity ON discord_sync_outbox(entity_type,entity_id) WHERE status IN (\'pending\',\'processing\')');
    }},
  { version: 7, name: 'production-v18-recovery-state', run: () => {
      const cols = db.prepare('PRAGMA table_info(discord_sync_outbox)').all().map(x=>x.name);
      if (!cols.includes('desired_role_id')) db.exec('ALTER TABLE discord_sync_outbox ADD COLUMN desired_role_id TEXT');
      if (!cols.includes('previous_role_ids')) db.exec("ALTER TABLE discord_sync_outbox ADD COLUMN previous_role_ids TEXT NOT NULL DEFAULT '[]'");
      db.exec('CREATE INDEX IF NOT EXISTS idx_invited_members_member_active ON invited_members(guild_id,member_id,active)');
  }},
  { version: 8, name: 'production-v19-outbox-leases-and-delivery', run: () => {
      const cols = db.prepare('PRAGMA table_info(discord_sync_outbox)').all().map(x=>x.name);
      if (!cols.includes('lease_until')) db.exec('ALTER TABLE discord_sync_outbox ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0');
      if (!cols.includes('claim_token')) db.exec('ALTER TABLE discord_sync_outbox ADD COLUMN claim_token TEXT');
      const imCols = db.prepare('PRAGMA table_info(invited_members)').all().map(x=>x.name);
      if (!imCols.includes('attribution_status')) db.exec("ALTER TABLE invited_members ADD COLUMN attribution_status TEXT NOT NULL DEFAULT 'unknown'");
      db.exec('DROP INDEX IF EXISTS idx_sync_outbox_pending_entity');
      db.exec(`DELETE FROM discord_sync_outbox WHERE id NOT IN (SELECT MAX(id) FROM discord_sync_outbox GROUP BY entity_type,entity_id)`);
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_outbox_entity_unique ON discord_sync_outbox(entity_type,entity_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sync_outbox_ready ON discord_sync_outbox(status,updated_at,lease_until)');
      db.exec(`CREATE TABLE IF NOT EXISTS discord_delivery_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
        action TEXT NOT NULL, payload TEXT NOT NULL, dedupe_key TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
        claim_token TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_delivery_outbox_ready ON discord_delivery_outbox(status,updated_at,lease_until)');
  }},
  { version: 9, name: 'production-v20-reliable-retry-and-recovery', run: () => {
      const outCols = db.prepare('PRAGMA table_info(discord_sync_outbox)').all().map(x=>x.name);
      if (!outCols.includes('next_attempt_at')) db.exec('ALTER TABLE discord_sync_outbox ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0');
      const delCols = db.prepare('PRAGMA table_info(discord_delivery_outbox)').all().map(x=>x.name);
      if (!delCols.includes('next_attempt_at')) db.exec('ALTER TABLE discord_delivery_outbox ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sync_outbox_ready_v20 ON discord_sync_outbox(status,next_attempt_at,lease_until,id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_delivery_outbox_ready_v20 ON discord_delivery_outbox(status,next_attempt_at,lease_until,id)');
      db.exec(`CREATE TABLE IF NOT EXISTS backup_restore_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        backup_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT
      )`);
  }},
  { version: 10, name: 'production-v20-feature-completion', run: () => {
      addColumn('tickets', 'close_reason', 'TEXT');
      db.exec(`CREATE TABLE IF NOT EXISTS ticket_feedback (
        ticket_id INTEGER PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        created_at INTEGER NOT NULL,
        FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS ticket_claim_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_claim_events_guild_time ON ticket_claim_events(guild_id,claimed_at,user_id)');
  }},
  { version: 11, name: 'production-v20-invite-reset-boundary', run: () => {
      const cols = db.prepare('PRAGMA table_info(invites)').all().map(x=>x.name);
      if (!cols.includes('reset_at')) db.exec('ALTER TABLE invites ADD COLUMN reset_at INTEGER NOT NULL DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_invited_members_inviter_activity ON invited_members(guild_id,inviter_id,active,last_joined_at)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_invite_events_inviter_time ON invite_events(guild_id,inviter_id,type,created_at)');
  }},
  { version: 12, name: 'production-v20-cumulative-ticket-claims', run: () => {
      // Older V20 databases may already have claimed tickets but no claim-event row
      // because the event table was introduced after the ticket records. Backfill
      // one lifetime claim event per historically claimed ticket without duplicating
      // events already recorded by the live claim path.
      db.prepare(`
        INSERT INTO ticket_claim_events(ticket_id,guild_id,user_id,claimed_at)
        SELECT t.id,t.guild_id,t.claimed_by,COALESCE(t.created_at,?)
        FROM tickets t
        WHERE t.claimed_by IS NOT NULL AND TRIM(t.claimed_by) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM ticket_claim_events e
            WHERE e.ticket_id=t.id AND e.user_id=t.claimed_by
          )
      `).run(Date.now());
      db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_claim_events_user ON ticket_claim_events(guild_id,user_id,claimed_at)');
  }},


];
try {
  for (const migration of MIGRATIONS) {
    const exists = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(migration.version);
    if (exists) continue;
    const tx = db.transaction(() => {
      migration.run();
      db.prepare('INSERT INTO schema_migrations(version,applied_at,name) VALUES(?,?,?)')
        .run(migration.version, new Date().toISOString(), migration.name);
      db.pragma(`user_version = ${migration.version}`);
    });
    tx();
  }
} catch (e) { console.error('[DB SCHEMA VERSION]', e.message); }

function verifyRequiredSchema() {
  const required = {
    discord_sync_outbox: ['id','guild_id','entity_type','entity_id','desired_json','status','attempts','updated_at','lease_until','claim_token'],
    discord_delivery_outbox: ['id','guild_id','channel_id','action','payload','status','attempts','lease_until','claim_token','dedupe_key'],
    invited_members: ['member_id','inviter_id','original_inviter_id','active','join_count','last_joined_at'],
    ticket_permission_snapshots: ['ticket_id','subject_id','subject_type','allow','deny','had_overwrite']
  };
  for (const [table, cols] of Object.entries(required)) {
    const actual = new Set(columnNames(table));
    for (const col of cols) if (!actual.has(col)) throw new Error(`SCHEMA_INCOMPLETE:${table}.${col}`);
  }
}
verifyRequiredSchema();

function deepMerge(base, patch) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function getSettings(guildId) {
  const r = db.prepare('SELECT data FROM guild_settings WHERE guild_id=?').get(guildId);
  if (!r) return {};
  try { return JSON.parse(r.data); }
  catch (e) {
    console.error('[DB SETTINGS] invalid JSON:', e.message);
    const backup = db.prepare('SELECT data FROM guild_settings_backup WHERE guild_id=?').get(guildId);
    if (backup) { try { return JSON.parse(backup.data); } catch (_) {} }
    return {};
  }
}

function setSettings(guildId, patch) {
  return withKeyLock(`settings:${guildId}`, () => {
    const raw = db.prepare('SELECT data FROM guild_settings WHERE guild_id=?').get(guildId)?.data || '{}';
    let current;
    try { current = JSON.parse(raw); } catch (_) {
      const backup = db.prepare('SELECT data FROM guild_settings_backup WHERE guild_id=?').get(guildId)?.data;
      try { current = backup ? JSON.parse(backup) : {}; } catch (_) { current = {}; }
    }
    const data = deepMerge(current, patch);
    const serialized = JSON.stringify(data);
    if (serialized.length > 1000000) throw new Error('SETTINGS_TOO_LARGE');
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      // Preserve the last known-good CURRENT document as the backup BEFORE replacing it.
      let previousValid = null;
      try { previousValid = JSON.parse(raw); } catch (_) {}
      if (previousValid) db.prepare(`INSERT INTO guild_settings_backup(guild_id,data,updated_at) VALUES(?,?,?)
        ON CONFLICT(guild_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`).run(guildId, raw, now);
      db.prepare(`INSERT INTO guild_settings(guild_id,data,updated_at) VALUES(?,?,?)
        ON CONFLICT(guild_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`).run(guildId, serialized, now);
    });
    tx();
    return data;
  });
}

function patchSettings(guildId, mutator) {
  return withKeyLock(`settings:${guildId}`, () => {
    const raw = db.prepare('SELECT data FROM guild_settings WHERE guild_id=?').get(guildId)?.data || '{}';
    let current; try { current = JSON.parse(raw); } catch (_) { const b=db.prepare('SELECT data FROM guild_settings_backup WHERE guild_id=?').get(guildId)?.data; try { current=b?JSON.parse(b):{}; } catch (_) { current={}; } }
    const next = mutator(JSON.parse(JSON.stringify(current))) || {};
    const serialized=JSON.stringify(next), now=new Date().toISOString();
    db.transaction(()=>{
      let previousValid=null; try { previousValid=JSON.parse(raw); } catch (_) {}
      if(previousValid) db.prepare(`INSERT INTO guild_settings_backup(guild_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(guild_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`).run(guildId,raw,now);
      db.prepare(`INSERT INTO guild_settings(guild_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(guild_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`).run(guildId,serialized,now);
    })();
    return next;
  });
}
function setSettingPath(guildId, pathParts, value) {
  const parts=Array.isArray(pathParts)?pathParts.filter(Boolean):String(pathParts||'').split('.').filter(Boolean);
  if(!parts.length)return getSettings(guildId);
  return setSettings(guildId, parts.reduceRight((acc,key)=>({[key]:acc}), value));
}

function log(guildId, type, payload) {
  db.prepare('INSERT INTO logs(guild_id,type,payload,created_at) VALUES(?,?,?,?)')
    .run(guildId, type, JSON.stringify(payload || {}), Date.now());
}

function getXp(guildId, userId) {
  return db.prepare('SELECT * FROM xp_users WHERE guild_id=? AND user_id=?').get(guildId, userId) || {
    guild_id: guildId, user_id: userId, xp: 0, level: 0, messages: 0, last_xp_at: 0
  };
}

function upsertXp(row) {
  db.prepare(`
    INSERT INTO xp_users(guild_id,user_id,xp,level,messages,last_xp_at)
    VALUES(@guild_id,@user_id,@xp,@level,@messages,@last_xp_at)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET
      xp=excluded.xp, level=excluded.level, messages=excluded.messages, last_xp_at=excluded.last_xp_at
  `).run(row);
}

function getStaff(guildId, userId) {
  return db.prepare('SELECT * FROM staff_users WHERE guild_id=? AND user_id=?').get(guildId, userId) || null;
}

function setStaff(guildId, userId, level, points=0) {
  db.prepare(`
    INSERT INTO staff_users(guild_id,user_id,level,points,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET level=excluded.level,points=excluded.points,updated_at=excluded.updated_at
  `).run(guildId,userId,level,points,Date.now());
}

async function backupNow(destination, retention=7) {
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const target = path.resolve(destination || path.join(backupDir, `tehran-club-${stamp}.sqlite`));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await db.backup(target);
  const verify = new Database(target, { readonly:true });
  try {
    const result = String(verify.prepare('PRAGMA integrity_check').get()?.integrity_check || 'unknown');
    if (result !== 'ok') throw new Error(`BACKUP_INTEGRITY_FAILED: ${result}`);
  } finally { verify.close(); }
  if (!destination) {
    const files = fs.readdirSync(backupDir).filter(f=>/^tehran-club-.*\.sqlite$/.test(f)).map(f=>({f, m:fs.statSync(path.join(backupDir,f)).mtimeMs})).sort((a,b)=>b.m-a.m);
    for (const x of files.slice(Math.max(1,Number(retention)||7))) fs.rmSync(path.join(backupDir,x.f),{force:true});
  }
  return target;
}
function integrityCheck() {
  return String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || 'unknown');
}
function listBackups() {
  fs.mkdirSync(backupDir, { recursive: true });
  return fs.readdirSync(backupDir).filter(f=>/^tehran-club-.*\.sqlite$/.test(f))
    .map(f=>({name:f,path:path.resolve(backupDir,f),size:fs.statSync(path.join(backupDir,f)).size,mtimeMs:fs.statSync(path.join(backupDir,f)).mtimeMs}))
    .sort((a,b)=>b.mtimeMs-a.mtimeMs);
}
function verifyBackup(filePath) {
  const target=path.resolve(filePath);
  if(!fs.existsSync(target)) throw new Error('BACKUP_NOT_FOUND');
  const verify=new Database(target,{readonly:true});
  try {
    const result=String(verify.prepare('PRAGMA integrity_check').get()?.integrity_check||'unknown');
    if(result!=='ok') throw new Error(`BACKUP_INTEGRITY_FAILED:${result}`);
    return true;
  } finally { verify.close(); }
}
function requestRestore(filePath) {
  const target=path.resolve(filePath); verifyBackup(target);
  const r=db.prepare('INSERT INTO backup_restore_requests(backup_path,status,requested_at) VALUES(?,?,?)').run(target,'pending',Date.now());
  return {id:r.lastInsertRowid,path:target,status:'pending',message:'Restore برای Restart بعدی ثبت شد.'};
}
module.exports = { db, getSettings, setSettings, patchSettings, setSettingPath, log, getXp, upsertXp, getStaff, setStaff, backupNow, listBackups, verifyBackup, requestRestore, deepMerge, integrityCheck };
