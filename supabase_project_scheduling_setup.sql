-- Run this SQL in your Supabase SQL Editor to add the project-level schedule settings column

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS schedule_settings jsonb DEFAULT '{}'::jsonb;
