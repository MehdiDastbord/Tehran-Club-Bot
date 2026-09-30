require('dotenv').config();
const required=['DISCORD_TOKEN','CLIENT_ID','GUILD_ID','OWNER_IDS'];
const missing=required.filter(k=>!process.env[k]);
if(missing.length)console.warn(`[CONFIG] Missing: ${missing.join(', ')}`);
const num=(value,fallback,min,max)=>{const n=Number(value);if(!Number.isFinite(n))return fallback;return Math.max(min,Math.min(max,n));};
module.exports={
  token:process.env.DISCORD_TOKEN,
  clientId:process.env.CLIENT_ID,
  guildId:process.env.GUILD_ID,
  owners:String(process.env.OWNER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean),
  sqlitePath:process.env.SQLITE_PATH||'./data/tehran-club.sqlite',
  aiKey:process.env.OPENAI_API_KEY||'',
  aiModel:process.env.AI_MODEL||'gpt-5.6-luna',
  aiMaxHistory:num(process.env.AI_MAX_HISTORY,12,2,30),
  aiMaxChars:num(process.env.AI_MAX_CHARS,24000,4000,100000),
  aiRetentionDays:num(process.env.AI_RETENTION_DAYS,30,1,3650),
  logRetentionDays:num(process.env.LOG_RETENTION_DAYS,30,1,3650),
  backupDir:process.env.BACKUP_DIR||'./backups',
  backupRetention:num(process.env.BACKUP_RETENTION,7,1,365),
  botName:process.env.BOT_NAME||'Tehran Club',
  banchRoleId:process.env.BANCH_ROLE_ID||'1550062330182762556',
  banchAccessRoleId:process.env.BANCH_ACCESS_ROLE_ID||'1551549678825373786'
};
