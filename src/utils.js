
function isAdmin(member) {
  return member?.permissions?.has('Administrator');
}
function replacePlaceholders(text, member, guild) {
  return String(text ?? '')
    .replaceAll('[user]', `<@${member.id}>`)
    .replaceAll('[Number]', String(guild.memberCount));
}
function parseDurationMinutes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
module.exports = { isAdmin, replacePlaceholders, parseDurationMinutes };
