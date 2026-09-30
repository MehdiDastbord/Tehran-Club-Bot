const { EmbedBuilder, MessageFlags, PermissionsBitField } = require('discord.js');

const COLORS = { default: 0x5865F2, success: 0x57F287, error: 0xED4245, warn: 0xFEE75C, info: 0x3498DB };

function embed(title, description, color = COLORS.default) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(String(description || '—').slice(0,4096)).setTimestamp();
}
function ok(text) { return embed('✅ انجام شد', text, COLORS.success); }
function err(text) { return embed('❌ خطا', text, COLORS.error); }
function info(text) { return embed('ℹ️ اطلاعات', text, COLORS.info); }
function warn(text) { return embed('⚠️ توجه', text, COLORS.warn); }
function isOwner(id, owners) { return owners.includes(String(id)); }
function isAdmin(member) { return !!member?.permissions?.has?.(PermissionsBitField.Flags.Administrator); }
function hasRole(member, roleId) { return !!roleId && !!member?.roles?.cache?.has?.(String(roleId)); }
function placeholders(text, member, guild, extra = {}) {
  return String(text || '')
    .replaceAll('[user]', `<@${member.id}>`)
    .replaceAll('[username]', member.user.username)
    .replaceAll('[server]', guild.name)
    .replaceAll('[members]', String(guild.memberCount))
    .replaceAll('[level]', String(extra.level ?? ''))
    .replaceAll('[xp]', String(extra.xp ?? ''));
}
function stripMentions(text) {
  return String(text ?? '')
    .replace(/<@!?\d+>/g, '@user')
    .replace(/<@&\d+>/g, '@role')
    .replace(/<#\d+>/g, '#channel')
    .replace(/@everyone|@here/gi, '@mention');
}
function clamp(text, max=1024) { return String(text ?? '').slice(0,max); }
function safeEmoji(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const custom = s.match(/^<(a?):([\w~]+):(\d{17,20})>$/);
  if (custom) return { id: custom[3], name: custom[2], animated: custom[1] === 'a' };
  if (s.includes(':') || /[<>]/.test(s)) return null;
  return s;
}
function parseDuration(value) {
  const m = String(value || '').trim().match(/^(\d+)\s*(s|m|h|d)?$/i);
  if (!m) return null;
  const n = Number(m[1]); const unit = (m[2] || 'm').toLowerCase();
  return n * ({s:1000,m:60000,h:3600000,d:86400000}[unit]);
}

function xpRequirement(level, settings = {}) {
  const l = Math.max(0, Math.floor(Number(level)||0));
  const curve = String(settings.curve || 'linear').toLowerCase();
  const mult = Math.max(0.1, Number(settings.multiplier ?? 1));
  let value;
  if (curve === 'exponential') value = 5 * l * l + (l * 50) + 75;
  else if (curve === 'flat') value = 1000;
  else value = (l * 100) + 75;
  return Math.max(1, Math.floor(value * mult));
}
function xpForLevel(level, settings = {}) {
  const l = Math.max(0, Math.floor(Number(level)||0));
  const curve = String(settings.curve || 'linear').toLowerCase();
  const mult = Math.max(0.1, Number(settings.multiplier ?? 1));
  let total;
  if(curve==='flat') total=1000*l;
  else if(curve==='exponential') total=5*(l*(l-1)*(2*l-1)/6)+25*l*(l-1)+75*l;
  else total=50*l*(l-1)+75*l;
  total*=mult;
  return Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.floor(total)));
}
function levelFromXp(xp, settings = {}) {
  const amount = Math.max(0, Math.floor(Number(xp) || 0));
  const configuredMax = Math.max(0, Math.floor(Number(settings.maxLevel || 0)));
  const maxLevel = configuredMax>0?configuredMax:100000000;
  if(amount<xpForLevel(1,settings))return 0;
  if(configuredMax>0&&amount>=xpForLevel(configuredMax,settings))return configuredMax;
  let lo=0,hi=1;
  while(hi<maxLevel&&xpForLevel(hi,settings)<=amount){hi=Math.min(maxLevel,hi*2)}
  while(lo+1<hi){const mid=Math.floor((lo+hi)/2);if(xpForLevel(mid,settings)<=amount)lo=mid;else hi=mid;}
  return lo;
}
function nextLevelXp(level, settings={}) { return xpForLevel(level + 1, settings); }
function safeReply(interaction, payload) {
  return (async()=>{
    try {
      if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
      return await interaction.reply(payload);
    } catch (e) {
      if (![10062,40060].includes(e?.code)) console.error('[REPLY]', e?.message || e);
      return null;
    }
  })();
}
async function safeFollowUp(interaction, payload) {
  try { return interaction.followUp(payload); } catch (e) { console.error('[FOLLOWUP]', e?.message || e); return null; }
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { COLORS, embed, ok, err, info, warn, isOwner, isAdmin, hasRole, placeholders, stripMentions, clamp, safeEmoji, parseDuration, xpRequirement, xpForLevel, levelFromXp, nextLevelXp, safeReply, safeFollowUp, sleep };
