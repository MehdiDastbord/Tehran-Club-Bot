-- Tehran Club Bot v6 ticket-system migration
-- Run this once in Supabase SQL Editor before deploying the new bot.

-- New panel numbering/type fields. Existing panels are preserved.
ALTER TABLE public.ticket_panels
  ADD COLUMN IF NOT EXISTS panel_number integer,
  ADD COLUMN IF NOT EXISTS panel_type text,
  ADD COLUMN IF NOT EXISTS description text;

-- Give existing panels stable numbers in creation order.
WITH numbered AS (
  SELECT id,
         row_number() OVER (PARTITION BY guild_id ORDER BY created_at NULLS FIRST, id) AS rn
  FROM public.ticket_panels
  WHERE panel_number IS NULL
)
UPDATE public.ticket_panels p
SET panel_number = n.rn
FROM numbered n
WHERE p.id = n.id;

UPDATE public.ticket_panels
SET panel_type = CASE
  WHEN lower(name) LIKE '%support%' THEN 'support'
  WHEN lower(name) LIKE '%exchange%' THEN 'exchange'
  WHEN lower(name) LIKE '%staff%' OR lower(name) LIKE '%hire%' THEN 'staffhire'
  WHEN lower(name) LIKE '%event%' THEN 'eventjoin'
  ELSE 'support'
END
WHERE panel_type IS NULL OR panel_type = '';

ALTER TABLE public.ticket_panels
  ALTER COLUMN panel_number SET NOT NULL,
  ALTER COLUMN panel_type SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ticket_panels_guild_number_uidx
  ON public.ticket_panels(guild_id, panel_number);

CREATE INDEX IF NOT EXISTS ticket_panels_guild_type_idx
  ON public.ticket_panels(guild_id, panel_type);

-- Ticket transcript storage is used by the new transcript button.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Giveaway entry reliability: prevent duplicate entries for the same user.
CREATE UNIQUE INDEX IF NOT EXISTS giveaway_entries_giveaway_user_uidx
  ON public.giveaway_entries(giveaway_id, user_id);

-- -------------------------------------------------------------------------
-- OLD STAFF-HIRING/RANK SYSTEM CLEANUP
-- -------------------------------------------------------------------------
-- The new bot uses a ticket type called "Staff Hire" instead of the old
-- staff-management database system. This removes only legacy staff-system
-- tables/settings; ticket panels and ticket records are preserved.

DROP TABLE IF EXISTS public.staff_members CASCADE;
DROP TABLE IF EXISTS public.staff_ranks CASCADE;
DROP TABLE IF EXISTS public.staff_roles CASCADE;
DROP TABLE IF EXISTS public.staff_applications CASCADE;
DROP TABLE IF EXISTS public.staff_hires CASCADE;

-- Remove old staff-system keys from guild_settings JSON without deleting
-- unrelated settings.
UPDATE public.guild_settings
SET settings = COALESCE(settings, '{}'::jsonb)
  - ARRAY[
      'staff_hire_channel',
      'staff_application_channel',
      'staff_log_channel',
      'staff_ranks',
      'staff_roles',
      'staff_hire_text',
      'staff_manager_role',
      'staff_system_enabled'
    ]::text[],
    updated_at = now();

-- NOTE: Do NOT delete the Tickets Support role. The new ticket system uses it.

-- Dynamic ticket types per panel (supports up to Discord's 25 select-menu options).
ALTER TABLE public.ticket_panels
  ADD COLUMN IF NOT EXISTS ticket_types jsonb;

UPDATE public.ticket_panels
SET ticket_types = jsonb_build_array(
  jsonb_build_object(
    'name', CASE panel_type
      WHEN 'support' THEN 'Support'
      WHEN 'exchange' THEN 'Exchange'
      WHEN 'staffhire' THEN 'Staff Hire'
      WHEN 'eventjoin' THEN 'Event Join'
      ELSE COALESCE(name, 'Ticket')
    END,
    'emoji', CASE panel_type
      WHEN 'support' THEN '🛠️'
      WHEN 'exchange' THEN '💱'
      WHEN 'staffhire' THEN '👔'
      WHEN 'eventjoin' THEN '🎉'
      ELSE COALESCE(button_emoji, '🎫')
    END,
    'prefix', CASE panel_type
      WHEN 'support' THEN 'support'
      WHEN 'exchange' THEN 'exchange'
      WHEN 'staffhire' THEN 'staffhire'
      WHEN 'eventjoin' THEN 'eventjoin'
      ELSE 'ticket'
    END
  )
)
WHERE ticket_types IS NULL OR jsonb_typeof(ticket_types) <> 'array' OR jsonb_array_length(ticket_types) = 0;

CREATE INDEX IF NOT EXISTS ticket_panels_ticket_types_gin_idx
  ON public.ticket_panels USING gin (ticket_types);
