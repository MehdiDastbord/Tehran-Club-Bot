const { db } = require('../db');
function set(g,v,t){db.prepare('INSERT INTO music_247(guild_id,voice_channel_id,text_channel_id,enabled) VALUES(?,?,?,1) ON CONFLICT(guild_id) DO UPDATE SET voice_channel_id=excluded.voice_channel_id,text_channel_id=excluded.text_channel_id,enabled=1').run(g,v,t||null)}
function disable(g){db.prepare('UPDATE music_247 SET enabled=0 WHERE guild_id=?').run(g)}
function get(g){return db.prepare('SELECT * FROM music_247 WHERE guild_id=? AND enabled=1').get(g)}
function all(){return db.prepare('SELECT * FROM music_247 WHERE enabled=1').all()}
module.exports={set,disable,get,all};
