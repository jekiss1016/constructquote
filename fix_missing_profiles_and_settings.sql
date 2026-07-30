-- ============================================================
-- FIX MISSING PROFILES AND SETTINGS RPC & BACKFILL SCRIPT
-- Run this script in the Supabase SQL Editor for Production and Dev.
-- This creates the create_profile_if_missing() RPC function and
-- backfills any missing settings/profiles for all users and companies.
-- ============================================================

-- 1. Create or replace create_profile_if_missing RPC function
CREATE OR REPLACE FUNCTION public.create_profile_if_missing()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_company_id uuid;
  v_role text;
  v_profile jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Fetch email from auth.users
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- Check if profile exists
  SELECT company_id, role INTO v_company_id, v_role
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_company_id IS NULL THEN
    -- Check if email has a pending invitation
    SELECT company_id, role INTO v_company_id, v_role
    FROM public.company_invitations
    WHERE LOWER(email) = LOWER(v_email)
    LIMIT 1;

    IF v_company_id IS NOT NULL THEN
      -- Join invited company
      INSERT INTO public.profiles (id, company_id, role, email)
      VALUES (v_user_id, v_company_id, COALESCE(v_role, 'editor'), v_email)
      ON CONFLICT (id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        role = EXCLUDED.role,
        email = EXCLUDED.email;

      DELETE FROM public.company_invitations WHERE LOWER(email) = LOWER(v_email);
    ELSE
      -- Create new company tenant for user
      INSERT INTO public.companies (name)
      VALUES ('New Contractor Co.')
      RETURNING id INTO v_company_id;

      v_role := 'owner';

      -- Create settings for company
      INSERT INTO public.settings (company_id, company_name)
      VALUES (v_company_id, 'New Contractor Co.')
      ON CONFLICT (company_id) DO NOTHING;

      -- Seed default categories
      INSERT INTO public.categories (company_id, name) VALUES
        (v_company_id, 'Category 1'),
        (v_company_id, 'Labor')
      ON CONFLICT DO NOTHING;

      -- Insert profile as owner
      INSERT INTO public.profiles (id, company_id, role, email)
      VALUES (v_user_id, v_company_id, v_role, v_email)
      ON CONFLICT (id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        role = EXCLUDED.role,
        email = EXCLUDED.email;
    END IF;
  ELSE
    -- Ensure settings row exists for this company
    INSERT INTO public.settings (company_id, company_name)
    VALUES (v_company_id, 'New Contractor Co.')
    ON CONFLICT (company_id) DO NOTHING;
  END IF;

  -- Return complete profile object with companies relation
  SELECT row_to_json(p)::jsonb INTO v_profile
  FROM (
    SELECT pr.*, json_build_object(
      'subscription_level', COALESCE(c.subscription_level, 'trial'),
      'subscription_status', COALESCE(c.subscription_status, 'active'),
      'is_active', COALESCE(c.is_active, true)
    ) as companies
    FROM public.profiles pr
    LEFT JOIN public.companies c ON c.id = pr.company_id
    WHERE pr.id = v_user_id
  ) p;

  RETURN jsonb_build_object('success', true, 'profile', v_profile);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 2. Backfill profiles and settings for any existing users in auth.users missing a profile or company
DO $$
DECLARE
  r RECORD;
  new_co_id uuid;
BEGIN
  FOR r IN 
    SELECT u.id, u.email 
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL OR p.company_id IS NULL
  LOOP
    INSERT INTO public.companies (name)
    VALUES ('New Contractor Co.')
    RETURNING id INTO new_co_id;

    INSERT INTO public.settings (company_id, company_name)
    VALUES (new_co_id, 'New Contractor Co.')
    ON CONFLICT (company_id) DO NOTHING;

    INSERT INTO public.categories (company_id, name) VALUES
      (new_co_id, 'Category 1'),
      (new_co_id, 'Labor')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.profiles (id, company_id, role, email)
    VALUES (r.id, new_co_id, 'owner', r.email)
    ON CONFLICT (id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      role = 'owner',
      email = EXCLUDED.email;
  END LOOP;

  -- 3. Ensure all companies have a row in public.settings
  INSERT INTO public.settings (company_id, company_name)
  SELECT id, COALESCE(name, 'New Contractor Co.')
  FROM public.companies
  WHERE id NOT IN (SELECT company_id FROM public.settings)
  ON CONFLICT (company_id) DO NOTHING;
END $$;
