-- =====================================================================
-- Seed Test Company Subscription, Member, and Invitation
-- Run this script inside your Supabase SQL Editor to prepare the database 
-- so that E2E settings and team management tests are not skipped.
-- =====================================================================

DO $$
DECLARE
  v_company_id uuid;
  v_test_owner_email text := 'test123@test.com';
  
  -- Dummy Active Member Credentials for duplication tests
  v_active_user_id uuid := '22222222-2222-2222-2222-222222222222';
  v_active_email text := 'active_member@test.com';
  
  -- Pending Invitation email
  v_pending_email text := 'invited_member@test.com';
BEGIN
  -- 1. Get the company_id associated with the test owner account
  SELECT company_id INTO v_company_id 
  FROM public.profiles 
  WHERE LOWER(email) = LOWER(v_test_owner_email);

  IF v_company_id IS NULL THEN
    RAISE NOTICE 'Test owner profile (%) not found. Please log in to the application first to register a company.', v_test_owner_email;
  ELSE
    RAISE NOTICE 'Found company_id % associated with %', v_company_id, v_test_owner_email;

    -- 2. Upgrade the test company's subscription level to Pro Perpetual
    UPDATE public.companies 
    SET subscription_level = 'pro_perpetual',
        subscription_status = 'active',
        subscription_period_end = NULL
    WHERE id = v_company_id;
    RAISE NOTICE 'Upgraded company % subscription_level to pro_perpetual', v_company_id;

    -- 3. Ensure the active member exists in auth.users
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_active_user_id) THEN
      -- Inserting into auth.users will automatically trigger handle_new_user()
      -- which inserts a default profile and new company for this user.
      INSERT INTO auth.users (
        id, 
        email, 
        encrypted_password, 
        email_confirmed_at, 
        raw_app_meta_data, 
        raw_user_meta_data, 
        created_at, 
        updated_at, 
        role, 
        aud
      )
      VALUES (
        v_active_user_id,
        v_active_email,
        -- password hash for 'Test1234'
        '$2a$10$w38yZzJqYqf66bH9.s2Ehu2e4y2Yq4/7.V9Wp5P5rK.W9w6t2K0qC',
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now(),
        'authenticated',
        'authenticated'
      );
      RAISE NOTICE 'Created auth.users record for %', v_active_email;
    ELSE
      -- Update email/metadata if auth user already exists
      UPDATE auth.users
      SET email = v_active_email,
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          updated_at = now()
      WHERE id = v_active_user_id;
    END IF;

    -- 4. Re-associate the active member profile to the test owner's company and set role to editor
    -- (This fixes any default company created by the handle_new_user trigger)
    INSERT INTO public.profiles (id, company_id, role, email)
    VALUES (v_active_user_id, v_company_id, 'editor', v_active_email)
    ON CONFLICT (id) 
    DO UPDATE SET company_id = EXCLUDED.company_id, role = EXCLUDED.role, email = EXCLUDED.email;
    RAISE NOTICE 'Associated active member profile % with company %', v_active_email, v_company_id;

    -- 5. Seed a pending invitation in company_invitations
    INSERT INTO public.company_invitations (company_id, email, role, invited_by)
    VALUES (v_company_id, v_pending_email, 'editor', v_test_owner_email)
    ON CONFLICT (company_id, email) 
    DO UPDATE SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by;
    RAISE NOTICE 'Seeded pending invitation for % in company %', v_pending_email, v_company_id;

    RAISE NOTICE 'SQL Seed script completed successfully.';
  END IF;
END $$;
