const Database=require("better-sqlite3");
const db=new Database("tehran_club.sqlite");
db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS guild_config(guild_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS warns(guild_id TEXT,user_id TEXT,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS xp(guild_id TEXT,user_id TEXT,xp INTEGER NOT NULL DEFAULT 0,level INTEGER NOT NULL DEFAULT 0,voice_minutes INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS level_roles(guild_id TEXT,level INTEGER,role_id TEXT,PRIMARY KEY(guild_id,level));
CREATE TABLE IF NOT EXISTS staff_claims(guild_id TEXT,user_id TEXT,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS staff_members(guild_id TEXT,user_id TEXT,joined_at INTEGER,PRIMARY KEY(guild_id,user_id));
CREATE TABLE IF NOT EXISTS exchange_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,guild_id TEXT,user_id TEXT,server_text TEXT,status TEXT DEFAULT 'pending',created_at INTEGER);
CREATE TABLE IF NOT EXISTS giveaways(id INTEGER PRIMARY KEY AUTOINCREMENT,guild_id TEXT,channel_id TEXT,message_id TEXT,title TEXT,prize TEXT,winners INTEGER,duration_ms INTEGER,ends_at INTEGER,ended INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS giveaway_entries(giveaway_id INTEGER,user_id TEXT,PRIMARY KEY(giveaway_id,user_id));
CREATE TABLE IF NOT EXISTS invites(guild_id TEXT,code TEXT,uses INTEGER,inviter_id TEXT,PRIMARY KEY(guild_id,code));
`);
function getConfig(guildId){
 const row=db.prepare("SELECT data FROM guild_config WHERE guild_id=?").get(guildId);
 if(row) return JSON.parse(row.data);
 return {
  channels:{welcome:null,logs:null,dmLogs:null,inviteLogs:null,ticketLogs:null,ticketStats:null,feedback:null,rankup:null,recruit:null,demote:null,staffWarn:null,xpLevel:null,exchange:null},
  roles:{ticket:null,staffMain:null,staffExtra1:null,staffExtra2:null,staffManager:null},
  welcome:{enabled:true,text:"خوش اومدی {user} به سرور {server} ❤️"},
  staff:{ranks:[],managerRole:null},
  ticket:{category:null,claimRoles:[],panelChannel:null},
  xp:{message:10,voicePerMinute:5,cooldown:30,announce:true,ignoredChannels:[],ignoredRoles:[],ignoreAfk:true},
  levels:{baseXp:100,perLevel:50},
  levelRoles:{}
 };
}
function saveConfig(guildId,cfg){db.prepare("INSERT OR REPLACE INTO guild_config(guild_id,data) VALUES(?,?)").run(guildId,JSON.stringify(cfg));}
module.exports={db,getConfig,saveConfig};
