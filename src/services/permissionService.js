const { PermissionFlagsBits } = require('discord.js');
const { getSettings } = require('../db');
const { isOwner, isAdmin, hasRole } = require('../utils');
const { owners } = require('../config');

const ACCESS_KEYS = ['giveaway','exchange','logs','ticket','staff','xp','invite','ai','drop','emote','guess','moderation_ban','moderation_kick','moderation_timeout','moderation_warn'];

function hasAccess(member, key, { admin = true, owner = true } = {}) {
  if (owner && isOwner(member?.id, owners)) return true;
  if (admin && isAdmin(member)) return true;
  const roleId = getSettings(member?.guild?.id || '').accessRoles?.[key];
  return hasRole(member, roleId);
}
function hasStrictRole(member, roleId, { allowOwner = false } = {}) {
  if (allowOwner && isOwner(member?.id, owners)) return true;
  return hasRole(member, roleId);
}
function canManageTarget(interaction, target) {
  const guild = interaction.guild;
  const member = interaction.member;
  if (!target || !member) return { ok:false, message:'Member پیدا نشد.' };
  if (target.id === guild.ownerId) return { ok:false, message:'نمی‌توانی Owner را مدیریت کنی.' };
  if (target.id === member.id) return { ok:false, message:'نمی‌توانی خودت را مدیریت کنی.' };
  if (member.id !== guild.ownerId && target.roles.highest.position >= member.roles.highest.position) return { ok:false, message:'Role هدف باید پایین‌تر از Role شما باشد.' };
  const me = guild.members.me;
  if (me && !me.permissions.has(PermissionFlagsBits.Administrator) && target.roles.highest.position >= me.roles.highest.position) return { ok:false, message:'Role بات باید بالاتر از Role هدف باشد.' };
  return { ok:true };
}
function botHas(guild, permission) { return !!guild.members.me?.permissions?.has(permission); }

module.exports = { ACCESS_KEYS, hasAccess, hasStrictRole, canManageTarget, botHas, PermissionFlagsBits };
