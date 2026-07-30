-- ============================================================
-- CREATE PRE-VERIFIED TEST USER IN SUPABASE
-- Run this in the Supabase SQL Editor to instantly create an active,
-- verified account without needing email verification.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_email text := 'Tester@MyBidBook.com';
  v_password text := 'Test123$';
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE LOWER(email) = LOWER(v_email)) THEN
    -- If user already exists, ensure email is confirmed & password is set
    UPDATE auth.users
    SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
        encrypted_password = crypt(v_password, gen_salt('bf')),
        updated_at = now()
    WHERE LOWER(email) = LOWER(v_email);
    RAISE NOTICE 'Updated existing user % to confirmed status with new password.', v_email;
  ELSE
    -- Insert pre-verified user directly into auth.users.
    -- This automatically triggers public.handle_new_user() to create company, settings & profile!
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
      v_user_id,
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(), -- Pre-confirmed email timestamp
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now(),
      'authenticated',
      'authenticated'
    );
    RAISE NOTICE 'Successfully created pre-verified user % with ID %', v_email, v_user_id;
  END IF;
END $$;
