const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const ffmpegPath = require('ffmpeg-static');
const { getSettings } = require('../db');
const { withKeyLock } = require('./lockService');

let player = null;
function get(){if(!player)throw new Error('Music player not initialized');return player}
async function init(client, logger){
  player=new Player(client,{ffmpegPath:ffmpegPath||undefined});
  await player.extractors.loadMulti(DefaultExtractors);
  player.events.on('playerError',(q,e)=>logger?.(q.guild,'music',{action:'player_error',error:e.message,track:q.currentTrack?.title||'unknown'}));
  player.events.on('error',(q,e)=>logger?.(q.guild,'music',{action:'queue_error',error:e.message}));
  player.events.on('playerSkip',(q,t)=>logger?.(q.guild,'music',{action:'skip_on_error',track:t?.title||'unknown'}));
  player.events.on('disconnect',(q)=>logger?.(q.guild,'music',{action:'disconnect',channel:q.channel?.id||'unknown'}));
  player.events.on('connection',(q)=>logger?.(q.guild,'music',{action:'connected',channel:q.channel?.id||'unknown'}));
  return player;
}

async function getOrCreateQueue(guild, voice, {stay=false,textChannel=null}={}){
  const p=get();
  let q=p.nodes.get(guild.id);
  if(!q){
    q=p.nodes.create(guild,{metadata:{textChannelId:textChannel?.id||null},leaveOnEnd:!stay,leaveOnStop:!stay,leaveOnEmpty:!stay,leaveOnEmptyCooldown:300000,bufferingTimeout:15000,skipOnNoStream:true,volume:100,repeatMode:0});
  }
  if(q.channel?.id && q.channel.id!==voice.id) throw new Error('MUSIC_ALREADY_IN_ANOTHER_VOICE');
  if(!q.connection || q.connection.joinConfig?.channelId!==voice.id) await q.connect(voice);
  return q;
}
async function play(guild,voice,query,user,stay=false,textChannel=null){
  const p=get();
  return withKeyLock(`music:${guild.id}`,async()=>{
    const result=await p.search(String(query),{requestedBy:user,fallbackSearchEngine:'auto',searchEngine:'auto'});
    if(!result.hasTracks())throw new Error('آهنگی پیدا نشد.');
    let q=p.nodes.get(guild.id);
    if(q){
      if(q.channel?.id && q.channel.id!==voice.id)throw new Error('MUSIC_ALREADY_IN_ANOTHER_VOICE');
      // Keep a single Discord Player voice connection. Reconfigure lifecycle options for 24/7.
      q.options.leaveOnEnd=!stay;q.options.leaveOnStop=!stay;q.options.leaveOnEmpty=!stay;
      q.metadata={textChannelId:textChannel?.id||q.metadata?.textChannelId||null};
      if(!q.connection)await q.connect(voice);
      const wasPlaying=typeof q.isPlaying==='function'?q.isPlaying():!!q.currentTrack;
      q.addTrack(result.tracks[0]);
      if(!wasPlaying)await q.node.play();
      return result.tracks[0];
    }
    q=await p.play(voice,result,{nodeOptions:{metadata:{textChannelId:textChannel?.id||null},leaveOnEnd:!stay,leaveOnStop:!stay,leaveOnEmpty:!stay,leaveOnEmptyCooldown:300000,bufferingTimeout:15000,skipOnNoStream:true,volume:100,repeatMode:0}});
    return q.currentTrack||result.tracks[0];
  });
}
function queue(g){return get().nodes.get(g)||null}
async function control(g,action,value){
  const q=queue(g);if(!q)throw new Error('هیچ Music Queue فعالی نیست.');
  if(action==='skip')return q.node.skip();
  if(action==='pause')return q.node.setPaused(true);
  if(action==='resume')return q.node.setPaused(false);
  if(action==='stop'){q.options.leaveOnEnd=true;q.options.leaveOnStop=true;q.options.leaveOnEmpty=true;return q.delete();}
  if(action==='leave'){q.options.leaveOnEnd=true;q.options.leaveOnStop=true;q.options.leaveOnEmpty=true;return q.delete();}
  if(action==='volume')return q.node.setVolume(value);
  if(action==='loop')return q.setRepeatMode(value);
  throw new Error('Music action نامعتبر است.');
}
async function ensure247(guild,voice,textChannel=null){
  return withKeyLock(`music247:${guild.id}`,async()=>{
    const p=get();
    let q=p.nodes.get(guild.id);
    if(q?.channel?.id && q.channel.id!==voice.id){
      try{q.options.leaveOnEnd=true;q.options.leaveOnStop=true;q.options.leaveOnEmpty=true;await q.delete();}catch(e){throw new Error(`MUSIC_MOVE_FAILED: ${e.message}`)}
      q=null;
    }
    if(!q)q=p.nodes.create(guild,{metadata:{textChannelId:textChannel?.id||null},leaveOnEnd:false,leaveOnStop:false,leaveOnEmpty:false,leaveOnEmptyCooldown:300000,bufferingTimeout:15000,skipOnNoStream:true,volume:100,repeatMode:0});
    q.options.leaveOnEnd=false;q.options.leaveOnStop=false;q.options.leaveOnEmpty=false;
    q.metadata={textChannelId:textChannel?.id||q.metadata?.textChannelId||null};
    if(!q.connection)await q.connect(voice);
    return q;
  });
}
function status(guildId){const q=queue(guildId);if(!q)return null;return {channelId:q.channel?.id||null,track:q.currentTrack,queue:q.tracks?.toArray?.()||[],paused:q.node.isPaused?.()||false,volume:q.node.volume??null,repeatMode:q.repeatMode??0,connection:q.connection?.state?.status||'unknown'}}
function getVoiceConnection(guildId){const q=queue(guildId);return q?.connection||null;}
module.exports={init,get,getOrCreateQueue,play,queue,control,ensure247,status,getVoiceConnection};
