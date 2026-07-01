-- ====================================================
--  RLS policies for ConstructQuote app (Supabase)
--  Run this script in the Supabase SQL editor.
-- ====================================================

-- Helper function to get the current user's company_id
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS uuid AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper function to check if current user is sysadmin
CREATE OR REPLACE FUNCTION public.is_sysadmin()
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'sysadmin');
$$ LANGUAGE sql SECURITY DEFINER;

-- 1️⃣  profiles – a user can only see & modify their own profile
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_profile_select ON public.profiles;
CREATE POLICY own_profile_select ON public.profiles
  FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS own_profile_insert ON public.profiles;
CREATE POLICY own_profile_insert ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS own_profile_update ON public.profiles;
CREATE POLICY own_profile_update ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS own_profile_delete ON public.profiles;
CREATE POLICY own_profile_delete ON public.profiles
  FOR DELETE USING (id = auth.uid());

-- 2️⃣  companies – a user may create a company and then own it
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
-- Removed recursive own_company_select policy to avoid infinite recursion; rely on onboarding read policy defined later
DROP POLICY IF EXISTS own_company_insert ON public.companies;
CREATE POLICY own_company_insert ON public.companies
  FOR INSERT WITH CHECK (true); -- any authenticated user may create a company
DROP POLICY IF EXISTS own_company_update ON public.companies;
CREATE POLICY own_company_update ON public.companies
  FOR UPDATE USING (id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())) WITH CHECK (true);
DROP POLICY IF EXISTS own_company_delete ON public.companies;
CREATE POLICY own_company_delete ON public.companies
  FOR DELETE USING (id = (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
-- Allow any authenticated user to read companies (required for the foreign‑key check when a profile is created)
DROP POLICY IF EXISTS "User can read companies (onboarding)" ON public.companies;
CREATE POLICY "User can read companies (onboarding)" ON public.companies
  FOR SELECT USING (true);

-- 3️⃣  settings – each company gets a single settings row
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_settings_select ON public.settings;
CREATE POLICY own_settings_select ON public.settings
  FOR SELECT USING (company_id = public.get_user_company_id() or public.is_sysadmin());
DROP POLICY IF EXISTS own_settings_insert ON public.settings;
CREATE POLICY own_settings_insert ON public.settings
  FOR INSERT WITH CHECK ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());
DROP POLICY IF EXISTS own_settings_update ON public.settings;
CREATE POLICY own_settings_update ON public.settings
  FOR UPDATE USING ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin())
  WITH CHECK ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());
DROP POLICY IF EXISTS own_settings_delete ON public.settings;
CREATE POLICY own_settings_delete ON public.settings
  FOR DELETE USING ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

-- NOTE: Other tables (categories, products, customers, quotes) already have appropriate
-- policies in supabase_setup.sql. If you modify them, ensure they also reference
-- `company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())`.

-- End of RLS script
