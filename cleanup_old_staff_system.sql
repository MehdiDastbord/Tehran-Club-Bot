-- OPTIONAL: Run after confirming you no longer need the legacy staff-hiring/rank system.
-- This does NOT remove the new Staff Hire ticket type or Tickets Support role.

DROP TABLE IF EXISTS public.staff_members CASCADE;
DROP TABLE IF EXISTS public.staff_ranks CASCADE;
DROP TABLE IF EXISTS public.staff_roles CASCADE;
DROP TABLE IF EXISTS public.staff_applications CASCADE;
DROP TABLE IF EXISTS public.staff_hires CASCADE;

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
