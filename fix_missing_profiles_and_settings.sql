-- ============================================================
-- FIX MISSING PROFILES AND SETTINGS RPC & COMPLETE BACKFILL SCRIPT
-- Run this script in the Supabase SQL Editor for Production and Dev.
-- ============================================================

-- 0. SCHEMA ALIGNMENT (Ensure Production table columns match Dev 100%)
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS company_address text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS company_phone text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS company_email text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS default_tax_rate numeric(5,2) DEFAULT 10.00;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS default_markup_percent numeric(5,2) DEFAULT 20.00;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS calculation_method text DEFAULT 'markup';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS company_logo text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS theme text DEFAULT 'light';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS default_terms_notes text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS default_tax_plus_applicable boolean DEFAULT false;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS quote_email_body_default text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS scheduling_config jsonb DEFAULT '{"workdays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "weekend_days": [0, 6], "holidays": [], "custom_workdays": []}'::jsonb;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS subscription_level text DEFAULT 'trial';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS default_terms_notes text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS default_markup_percent numeric(5,2) DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS default_tax_rate numeric(5,2) DEFAULT 0.00;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS default_tax_plus_applicable boolean DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS quote_email_body_default text;

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS calculation_method varchar(10) DEFAULT 'markup';
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS tax_plus_applicable boolean DEFAULT false;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS schedule_tasks jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS schedule_settings jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('sysadmin', 'owner', 'editor', 'viewer'));

-- 1. Create or replace save_company_settings RPC function
CREATE OR REPLACE FUNCTION public.save_company_settings(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Fetch user profile
  SELECT company_id, role INTO v_company_id, v_role
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_company_id IS NULL THEN
    -- Try auto-provisioning profile if missing
    PERFORM public.create_profile_if_missing();
    SELECT company_id, role INTO v_company_id, v_role
    FROM public.profiles
    WHERE id = v_user_id;
  END IF;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No company profile found for user');
  END IF;

  IF COALESCE(v_role, 'owner') NOT IN ('sysadmin', 'owner', 'editor') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions to update settings');
  END IF;

  -- Upsert company settings with defaults
  INSERT INTO public.settings (
    company_id,
    company_name,
    company_address,
    company_phone,
    company_email,
    default_tax_rate,
    default_markup_percent,
    calculation_method,
    company_logo,
    theme,
    default_terms_notes,
    default_tax_plus_applicable,
    quote_email_body_default,
    scheduling_config
  ) VALUES (
    v_company_id,
    COALESCE(p_settings->>'company_name', 'Enter Your Company Name Here'),
    COALESCE(p_settings->>'company_address', '12345 My Business Address Here'),
    COALESCE(p_settings->>'company_phone', '206-555-5555'),
    COALESCE(p_settings->>'company_email', 'contact@mycompany.com'),
    COALESCE((p_settings->>'default_tax_rate')::numeric, 10.00),
    COALESCE((p_settings->>'default_markup_percent')::numeric, 20.00),
    COALESCE(p_settings->>'calculation_method', 'markup'),
    COALESCE(p_settings->>'company_logo', ''),
    COALESCE(p_settings->>'theme', 'light'),
    COALESCE(p_settings->>'default_terms_notes', 'Default payment terms, validations, etc.'),
    COALESCE((p_settings->>'default_tax_plus_applicable')::boolean, false),
    COALESCE(p_settings->>'quote_email_body_default', 'Default email body text when sending quotes to customers.'),
    COALESCE(p_settings->'scheduling_config', '{"workdays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "weekend_days": [0, 6], "holidays": [], "custom_workdays": []}'::jsonb)
  )
  ON CONFLICT (company_id) DO UPDATE SET
    company_name = COALESCE(EXCLUDED.company_name, settings.company_name),
    company_address = COALESCE(EXCLUDED.company_address, settings.company_address),
    company_phone = COALESCE(EXCLUDED.company_phone, settings.company_phone),
    company_email = COALESCE(EXCLUDED.company_email, settings.company_email),
    default_tax_rate = COALESCE(EXCLUDED.default_tax_rate, settings.default_tax_rate),
    default_markup_percent = COALESCE(EXCLUDED.default_markup_percent, settings.default_markup_percent),
    calculation_method = COALESCE(EXCLUDED.calculation_method, settings.calculation_method),
    company_logo = COALESCE(EXCLUDED.company_logo, settings.company_logo),
    theme = COALESCE(EXCLUDED.theme, settings.theme),
    default_terms_notes = COALESCE(EXCLUDED.default_terms_notes, settings.default_terms_notes),
    default_tax_plus_applicable = COALESCE(EXCLUDED.default_tax_plus_applicable, settings.default_tax_plus_applicable),
    quote_email_body_default = COALESCE(EXCLUDED.quote_email_body_default, settings.quote_email_body_default),
    scheduling_config = COALESCE(EXCLUDED.scheduling_config, settings.scheduling_config);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 2. Create or replace create_profile_if_missing RPC function
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
      VALUES ('Enter Your Company Name Here')
      RETURNING id INTO v_company_id;

      v_role := 'owner';

      INSERT INTO public.settings (
        company_id,
        company_name,
        company_address,
        company_phone,
        company_email,
        default_tax_rate,
        default_markup_percent,
        calculation_method,
        company_logo,
        theme,
        default_terms_notes,
        default_tax_plus_applicable,
        quote_email_body_default,
        scheduling_config
      ) VALUES (
        v_company_id,
        'Enter Your Company Name Here',
        '12345 My Business Address Here',
        '206-555-5555',
        COALESCE(v_email, 'contact@mycompany.com'),
        10.00,
        20.00,
        'markup',
        '',
        'light',
        'Default payment terms, validations, etc.',
        false,
        'Default email body text when sending quotes to customers.',
        '{"workdays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "weekend_days": [0, 6], "holidays": [], "custom_workdays": []}'::jsonb
      ) ON CONFLICT (company_id) DO NOTHING;

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
    INSERT INTO public.settings (
      company_id,
      company_name,
      company_address,
      company_phone,
      company_email,
      default_tax_rate,
      default_markup_percent,
      calculation_method,
      company_logo,
      theme,
      default_terms_notes,
      default_tax_plus_applicable,
      quote_email_body_default,
      scheduling_config
    ) VALUES (
      v_company_id,
      'Enter Your Company Name Here',
      '12345 My Business Address Here',
      '206-555-5555',
      COALESCE(v_email, 'contact@mycompany.com'),
      10.00,
      20.00,
      'markup',
      '',
      'light',
      'Default payment terms, validations, etc.',
      false,
      'Default email body text when sending quotes to customers.',
      '{"workdays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "weekend_days": [0, 6], "holidays": [], "custom_workdays": []}'::jsonb
    ) ON CONFLICT (company_id) DO NOTHING;
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

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.save_company_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_company_settings(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.create_profile_if_missing() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_profile_if_missing() TO anon;

-- 3. Seed/Backfill complete default settings rows for ALL companies currently missing a row in public.settings
INSERT INTO public.settings (
  company_id,
  company_name,
  company_address,
  company_phone,
  company_email,
  default_tax_rate,
  default_markup_percent,
  calculation_method,
  company_logo,
  theme,
  default_terms_notes,
  default_tax_plus_applicable,
  quote_email_body_default,
  scheduling_config
)
SELECT 
  id,
  COALESCE(name, 'Enter Your Company Name Here'),
  '12345 My Business Address Here',
  '206-555-5555',
  'contact@mycompany.com',
  10.00,
  20.00,
  'markup',
  '',
  'light',
  'Default payment terms, validations, etc.',
  false,
  'Default email body text when sending quotes to customers.',
  '{"workdays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "weekend_days": [0, 6], "holidays": [], "custom_workdays": []}'::jsonb
FROM public.companies
WHERE id NOT IN (SELECT company_id FROM public.settings)
ON CONFLICT (company_id) DO NOTHING;

-- 4. Simplify settings RLS policies
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select settings based on company" ON public.settings;
CREATE POLICY "Select settings based on company" ON public.settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Insert settings based on company write access" ON public.settings;
CREATE POLICY "Insert settings based on company write access" ON public.settings FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Update settings based on company write access" ON public.settings;
CREATE POLICY "Update settings based on company write access" ON public.settings FOR UPDATE USING (
  company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) OR public.is_sysadmin()
);
