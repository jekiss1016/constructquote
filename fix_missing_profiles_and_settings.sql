-- ============================================================
-- FIX MISSING PROFILES AND SETTINGS RPC & BACKFILL SCRIPT
-- Run this script in the Supabase SQL Editor for Production and Dev.
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

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  SELECT company_id, role INTO v_company_id, v_role
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_company_id IS NULL THEN
    SELECT company_id, role INTO v_company_id, v_role
    FROM public.company_invitations
    WHERE LOWER(email) = LOWER(v_email)
    LIMIT 1;

    IF v_company_id IS NOT NULL THEN
      INSERT INTO public.profiles (id, company_id, role, email)
      VALUES (v_user_id, v_company_id, COALESCE(v_role, 'editor'), v_email)
      ON CONFLICT (id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        role = EXCLUDED.role,
        email = EXCLUDED.email;

      DELETE FROM public.company_invitations WHERE LOWER(email) = LOWER(v_email);
    ELSE
      INSERT INTO public.companies (name)
      VALUES ('New Contractor Co.')
      RETURNING id INTO v_company_id;

      v_role := 'owner';

      INSERT INTO public.settings (company_id, company_name, calculation_method, default_tax_rate, default_markup_percent)
      VALUES (v_company_id, 'New Contractor Co.', 'markup', 8.25, 15.00)
      ON CONFLICT (company_id) DO NOTHING;

      INSERT INTO public.categories (company_id, name) VALUES
        (v_company_id, 'Category 1'),
        (v_company_id, 'Labor')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.profiles (id, company_id, role, email)
      VALUES (v_user_id, v_company_id, v_role, v_email)
      ON CONFLICT (id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        role = EXCLUDED.role,
        email = EXCLUDED.email;
    END IF;
  ELSE
    INSERT INTO public.settings (company_id, company_name, calculation_method, default_tax_rate, default_markup_percent)
    VALUES (v_company_id, 'New Contractor Co.', 'markup', 8.25, 15.00)
    ON CONFLICT (company_id) DO NOTHING;
  END IF;

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

-- Grant execution permission to authenticated users
GRANT EXECUTE ON FUNCTION public.create_profile_if_missing() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_profile_if_missing() TO anon;

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

    INSERT INTO public.settings (company_id, company_name, calculation_method, default_tax_rate, default_markup_percent)
    VALUES (new_co_id, 'New Contractor Co.', 'markup', 8.25, 15.00)
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

  -- 3. Seed default settings rows for ALL companies currently missing a row in public.settings
  INSERT INTO public.settings (company_id, company_name, calculation_method, default_tax_rate, default_markup_percent)
  SELECT id, COALESCE(name, 'New Contractor Co.'), 'markup', 8.25, 15.00
  FROM public.companies
  WHERE id NOT IN (SELECT company_id FROM public.settings)
  ON CONFLICT (company_id) DO NOTHING;
END $$;

-- 4. Update settings RLS policies for maximum resilience
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select settings based on company" ON public.settings;
CREATE POLICY "Select settings based on company" ON public.settings
  FOR SELECT USING (
    company_id = public.get_user_company_id()
    OR public.is_sysadmin()
    OR company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Insert settings based on company write access" ON public.settings;
CREATE POLICY "Insert settings based on company write access" ON public.settings
  FOR INSERT WITH CHECK (
    public.is_sysadmin()
    OR (company_id = public.get_user_company_id() AND public.has_write_access())
    OR company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid() AND role IN ('sysadmin', 'owner', 'editor'))
  );

DROP POLICY IF EXISTS "Update settings based on company write access" ON public.settings;
CREATE POLICY "Update settings based on company write access" ON public.settings
  FOR UPDATE USING (
    public.is_sysadmin()
    OR (company_id = public.get_user_company_id() AND public.has_write_access())
    OR company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid() AND role IN ('sysadmin', 'owner', 'editor'))
  )
  WITH CHECK (
    public.is_sysadmin()
    OR (company_id = public.get_user_company_id() AND public.has_write_access())
    OR company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid() AND role IN ('sysadmin', 'owner', 'editor'))
  );
