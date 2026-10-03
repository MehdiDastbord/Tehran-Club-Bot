-- Giveaway reliability migration for Tehran Club Bot
-- Run once in Supabase SQL Editor if these tables/columns do not already exist.

CREATE TABLE IF NOT EXISTS public.giveaways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  message_id text,
  prize text NOT NULL,
  duration_minutes integer NOT NULL,
  end_at timestamptz NOT NULL,
  ended boolean NOT NULL DEFAULT false,
  winner_id text,
  link text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.giveaways ADD COLUMN IF NOT EXISTS message_id text;
ALTER TABLE public.giveaways ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE public.giveaways ADD COLUMN IF NOT EXISTS ended boolean NOT NULL DEFAULT false;
ALTER TABLE public.giveaways ADD COLUMN IF NOT EXISTS winner_id text;
ALTER TABLE public.giveaways ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.giveaway_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id uuid NOT NULL REFERENCES public.giveaways(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS giveaway_entries_giveaway_user_uidx
  ON public.giveaway_entries(giveaway_id, user_id);

CREATE INDEX IF NOT EXISTS giveaways_active_end_idx
  ON public.giveaways(ended, end_at);

CREATE INDEX IF NOT EXISTS giveaways_guild_idx
  ON public.giveaways(guild_id);

-- The bot uses the service-role key, so these policies do not affect the bot.
-- If you have custom RLS policies, ensure the service role remains permitted.
