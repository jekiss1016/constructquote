-- ============================================================
-- FIX & PRE-VERIFY TEST USER IN SUPABASE GOTRUE
-- Run this script in the Supabase SQL Editor for Production or Dev
-- to ensure instance_id, cost-10 bcrypt password, and confirmation timestamps are set.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
  v_email text := 'Tester@MyBidBook.com';
  v_password text := 'Test123$';
  v_user_id uuid;
BEGIN
  -- Find existing user ID or generate a new one
  SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = LOWER(v_email) LIMIT 1;
  
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      is_sso_user
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf', 10)),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now(),
      FALSE
    );
    RAISE NOTICE 'Inserted new user % with instance_id and confirmed_at', v_email;
  ELSE
    -- Fix existing user record attributes required by GoTrue
    UPDATE auth.users
    SET instance_id = '00000000-0000-0000-0000-000000000000'::uuid,
        aud = 'authenticated',
        role = 'authenticated',
        encrypted_password = crypt(v_password, gen_salt('bf', 10)),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        confirmed_at = COALESCE(confirmed_at, now()),
        raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
        updated_at = now(),
        is_sso_user = FALSE,
        banned_until = NULL,
        deleted_at = NULL
    WHERE id = v_user_id;
    RAISE NOTICE 'Updated existing user % attributes for GoTrue sign in', v_email;
  END IF;

  -- Ensure matching profile exists in public.profiles
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    INSERT INTO public.profiles (id, company_id, role, email)
    VALUES (
      v_user_id,
      (SELECT id FROM public.companies LIMIT 1),
      'owner',
      v_email
    )
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  END IF;
END $$;
