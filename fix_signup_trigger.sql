-- ============================================================
-- FIX SIGNUP TRIGGER FUNCTION (handle_new_user)
-- Run this script in the Supabase SQL Editor for your production project
-- to make user registration robust against trigger exceptions and duplicate profile conflicts.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  invited_company_id uuid;
  invited_role text;
  new_company_id uuid;
BEGIN
  -- Check if the signing up user's email has a pending company invitation (case-insensitive)
  SELECT company_id, role INTO invited_company_id, invited_role
  FROM public.company_invitations
  WHERE LOWER(email) = LOWER(NEW.email)
  LIMIT 1;

  IF invited_company_id IS NOT NULL THEN
    -- Join inviting company
    INSERT INTO public.profiles (id, company_id, role, email)
    VALUES (NEW.id, invited_company_id, invited_role, NEW.email)
    ON CONFLICT (id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      role = EXCLUDED.role,
      email = EXCLUDED.email;
    
    -- Remove the invitation record
    DELETE FROM public.company_invitations WHERE LOWER(email) = LOWER(NEW.email);
  ELSE
    -- Create new company tenant for signup
    INSERT INTO public.companies (name)
    VALUES ('New Contractor Co.')
    RETURNING id INTO new_company_id;

    -- Add settings for company
    INSERT INTO public.settings (company_id, company_name)
    VALUES (new_company_id, 'New Contractor Co.')
    ON CONFLICT (company_id) DO NOTHING;

    -- Seed default categories for this company
    INSERT INTO public.categories (company_id, name) VALUES
      (new_company_id, 'Category 1'),
      (new_company_id, 'Labor');

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
