-- ============================================================
-- FIX UNPROVISIONED USERS & BACKFILL MISSING PROFILES / COMPANIES (v3)
-- Run this script in your Supabase Production SQL Editor to:
-- 1. Immediately backfill companies, settings, categories, and profiles
--    for any users in auth.users currently missing a profile (including jekiss1016@outlook.com).
-- 2. Update handle_new_user() trigger with numeric company sequence naming (e.g. 'New Contractor Co. 13').
-- 3. Update create_profile_if_missing() RPC function for client-side auto-provisioning.
-- ============================================================

-- 1. Backfill missing company, settings, categories, and profile records for all unprovisioned users
DO $$
DECLARE
  r RECORD;
  v_company_id uuid;
  v_invited_company_id uuid;
  v_invited_role text;
  v_company_name text;
  v_next_num integer;
BEGIN
  FOR r IN 
    SELECT u.id, u.email 
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
  LOOP
    RAISE NOTICE 'Provisioning user: % (%)', r.id, r.email;

    -- Check if user was invited to an existing company
    SELECT company_id, role INTO v_invited_company_id, v_invited_role
    FROM public.company_invitations
    WHERE LOWER(email) = LOWER(r.email)
    LIMIT 1;

    IF v_invited_company_id IS NOT NULL THEN
      INSERT INTO public.profiles (id, company_id, role, email)
      VALUES (r.id, v_invited_company_id, COALESCE(v_invited_role, 'editor'), r.email)
      ON CONFLICT (id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        role = EXCLUDED.role,
        email = EXCLUDED.email;

      DELETE FROM public.company_invitations WHERE LOWER(email) = LOWER(r.email);
    ELSE
      -- Generate unique company name with sequence number (e.g., 'New Contractor Co. 6')
      SELECT COUNT(*) + 1 INTO v_next_num FROM public.companies;
      v_company_name := 'New Contractor Co. ' || v_next_num;
      WHILE EXISTS (SELECT 1 FROM public.companies WHERE name = v_company_name) LOOP
        v_next_num := v_next_num + 1;
        v_company_name := 'New Contractor Co. ' || v_next_num;
      END LOOP;

      -- Create new company
      INSERT INTO public.companies (name, is_active, subscription_level, subscription_status)
      VALUES (v_company_name, true, 'trial', 'active')
      RETURNING id INTO v_company_id;

      -- Create settings
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
        v_company_name,
        '12345 My Business Address Here',
        '206-555-5555',
        COALESCE(r.email, 'contact@mycompany.com'),
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

      -- Seed categories
      INSERT INTO public.categories (company_id, name) VALUES
        (v_company_id, 'Category 1'),
        (v_company_id, 'Labor')
      ON CONFLICT DO NOTHING;

      -- Create profile as owner
      INSERT INTO public.profiles (id, company_id, role, email)
      VALUES (r.id, v_company_id, 'owner', r.email)
      ON CONFLICT (id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        role = EXCLUDED.role,
        email = EXCLUDED.email;
    END IF;
  END LOOP;
END;
$$;

-- 2. Define or replace handle_new_user() trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  invited_company_id uuid;
  invited_role text;
  new_company_id uuid;
  v_company_name text;
  v_next_num integer;
BEGIN
  -- Check if the signing up user's email has a pending company invitation (case-insensitive)
  SELECT company_id, role INTO invited_company_id, invited_role
  FROM public.company_invitations
  WHERE LOWER(email) = LOWER(NEW.email)
  LIMIT 1;

  IF invited_company_id IS NOT NULL THEN
    -- Join inviting company
    INSERT INTO public.profiles (id, company_id, role, email)
    VALUES (NEW.id, invited_company_id, COALESCE(invited_role, 'editor'), NEW.email)
    ON CONFLICT (id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      role = EXCLUDED.role,
      email = EXCLUDED.email;
    
    -- Remove the invitation record
    DELETE FROM public.company_invitations WHERE LOWER(email) = LOWER(NEW.email);
  ELSE
    -- Generate unique numeric company name (e.g., 'New Contractor Co. 6')
    SELECT COUNT(*) + 1 INTO v_next_num FROM public.companies;
    v_company_name := 'New Contractor Co. ' || v_next_num;
    WHILE EXISTS (SELECT 1 FROM public.companies WHERE name = v_company_name) LOOP
      v_next_num := v_next_num + 1;
      v_company_name := 'New Contractor Co. ' || v_next_num;
    END LOOP;

    -- Create new company tenant for signup
    INSERT INTO public.companies (name, is_active, subscription_level, subscription_status)
    VALUES (v_company_name, true, 'trial', 'active')
    RETURNING id INTO new_company_id;

    -- Add settings for company with full defaults
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
      new_company_id,
      v_company_name,
      '12345 My Business Address Here',
      '206-555-5555',
      COALESCE(NEW.email, 'contact@mycompany.com'),
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

    -- Seed default categories for this company
    INSERT INTO public.categories (company_id, name) VALUES
      (new_company_id, 'Category 1'),
      (new_company_id, 'Labor')
    ON CONFLICT DO NOTHING;

    -- Insert profile as owner
    INSERT INTO public.profiles (id, company_id, role, email)
    VALUES (NEW.id, new_company_id, 'owner', NEW.email)
    ON CONFLICT (id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      role = EXCLUDED.role,
      email = EXCLUDED.email;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Error in handle_new_user for user % (email %): %', NEW.id, NEW.email, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Define or replace create_profile_if_missing() RPC function for client-side auto-provisioning
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
  v_company_name text;
  v_next_num integer;
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
      SELECT COUNT(*) + 1 INTO v_next_num FROM public.companies;
      v_company_name := 'New Contractor Co. ' || v_next_num;
      WHILE EXISTS (SELECT 1 FROM public.companies WHERE name = v_company_name) LOOP
        v_next_num := v_next_num + 1;
        v_company_name := 'New Contractor Co. ' || v_next_num;
      END LOOP;

      INSERT INTO public.companies (name, is_active, subscription_level, subscription_status)
      VALUES (v_company_name, true, 'trial', 'active')
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
        v_company_name,
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

-- Grant permissions for RPC function
GRANT EXECUTE ON FUNCTION public.create_profile_if_missing() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_profile_if_missing() TO anon;
