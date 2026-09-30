import sqlite3, time, uuid

db=sqlite3.connect(':memory:')
db.executescript('''
CREATE TABLE discord_sync_outbox(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 desired_json TEXT NOT NULL, desired_role_id TEXT, previous_role_ids TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 lease_until INTEGER NOT NULL DEFAULT 0, claim_token TEXT, next_attempt_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_sync_unique ON discord_sync_outbox(entity_type,entity_id);
''')
now=int(time.time()*1000)
db.execute("INSERT INTO discord_sync_outbox(guild_id,entity_type,entity_id,desired_json,created_at,updated_at,next_attempt_at) VALUES(?,?,?,?,?,?,?)",
           ('g','xp','u','{}',now,now,now))
# Upsert must work without a partial-index conflict target.
db.execute("INSERT INTO discord_sync_outbox(guild_id,entity_type,entity_id,desired_json,created_at,updated_at,next_attempt_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET desired_json=excluded.desired_json,updated_at=excluded.updated_at,next_attempt_at=excluded.next_attempt_at",
           ('g','xp','u','{"level":2}',now,now+1,now+1))
assert db.execute('select count(*) from discord_sync_outbox').fetchone()[0]==1
# Atomic claim semantics: first claimant changes status, second cannot claim the same row.
token=str(uuid.uuid4());
t=db.execute("UPDATE discord_sync_outbox SET status='processing',claim_token=?,lease_until=? WHERE id=1 AND status='pending' AND next_attempt_at<=?",(token,now+30000,now+2))
assert t.rowcount==1
t2=db.execute("UPDATE discord_sync_outbox SET status='processing',claim_token=? WHERE id=1 AND status='pending' AND next_attempt_at<=?",(str(uuid.uuid4()),now+2))
assert t2.rowcount==0
print('OUTBOX_SQL_TEST_PASS')
