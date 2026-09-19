
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken:false, persistSession:false } }
);

async function getSettings(guildId) {
  const { data, error } = await supabase.from('guild_settings').select('settings').eq('guild_id',guildId).maybeSingle();
  if (error) throw error;
  return data?.settings || {};
}
async function setSettings(guildId, patch) {
  const old = await getSettings(guildId);
  const settings = {...old,...patch};
  const { error } = await supabase.from('guild_settings').upsert({guild_id:guildId,settings,updated_at:new Date().toISOString()});
  if (error) throw error;
  return settings;
}
module.exports = { supabase, getSettings, setSettings };
