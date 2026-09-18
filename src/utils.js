const {PermissionFlagsBits,EmbedBuilder}=require("discord.js");
function isManager(member,cfg){
 return member.permissions.has(PermissionFlagsBits.Administrator) ||
   (cfg.roles.staffManager && member.roles.cache.has(cfg.roles.staffManager)) ||
   (cfg.staff.managerRole && member.roles.cache.has(cfg.staff.managerRole));
}
function rankIndex(member,cfg){
 for(let i=0;i<cfg.staff.ranks.length;i++) if(member.roles.cache.has(cfg.staff.ranks[i].roleId)) return i;
 return -1;
}
async function log(guild,cfg,title,description){
 const id=cfg.channels.logs;
 if(!id) return;
 const ch=guild.channels.cache.get(id); if(!ch) return;
 await ch.send({embeds:[new EmbedBuilder().setTitle(title).setDescription(description).setTimestamp()]});
}
function levelForXp(xp,cfg){
 let level=0,need=cfg.levels.baseXp||100;
 while(xp>=need){xp-=need;level++;need=(cfg.levels.baseXp||100)+(level*(cfg.levels.perLevel||50));}
 return level;
}
module.exports={isManager,rankIndex,log,levelForXp};
