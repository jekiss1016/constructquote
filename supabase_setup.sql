-- =====================================================================
-- Supabase Database Setup & Schema Configuration Script
-- Run this script inside the Supabase SQL Editor to initialize the database.
-- =====================================================================

-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- ==================== 1. TENANCY SCHEMAS ====================

-- Companies Table
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subscription_level text default 'trial'::text check (subscription_level in ('trial', 'pro', 'pro_perpetual')),
  subscription_status text default 'active'::text,
  subscription_period_end timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- User Profiles Table
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  company_id uuid references public.companies on delete set null,
  role text default 'owner'::text check (role in ('sysadmin', 'owner', 'editor', 'viewer')),
  email text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Company Invitations Table
create table if not exists public.company_invitations (
  company_id uuid references public.companies on delete cascade not null,
  email text not null,
  role text default 'editor'::text check (role in ('editor', 'viewer')) not null,
  invited_by text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (company_id, email)
);

-- ==================== 2. APPLICATION SCHEMAS ====================

-- Categories Table
create table if not exists public.categories (
  company_id uuid references public.companies on delete cascade not null,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (company_id, name)
);

-- Products Table
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies on delete cascade not null,
  name text not null,
  category text not null,
  uom text not null,
  price numeric(12,2) default 0.00 not null,
  labor_rate numeric(12,2) default 0.00 not null,
  status text default 'Active'::text check (status in ('Active', 'Inactive')),
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Customers Table
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies on delete cascade not null,
  name text not null,
  email text,
  phone text,
  address1 text not null,
  address2 text,
  city text not null,
  state text not null,
  zip text not null,
  status text default 'Active'::text check (status in ('Active', 'Inactive')),
  contacts jsonb default '[]'::jsonb not null,
  documents jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Quotes / Proposals Table
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies on delete cascade not null,
  job_id text not null,
  quote_number integer not null,
  customer_id uuid references public.customers on delete set null,
  customer_name text not null,
  project_address text not null,
  customer_phone text,
  customer_email text,
  date date not null,
  expiration_date date not null,
  markup_percent numeric(5,2) default 0.00 not null,
  tax_rate numeric(5,2) default 0.00 not null,
  notes text,
  status text default 'Pending'::text check (status in ('Pending', 'Won', 'Lost', 'Completed', 'Inactive', 'Legacy')),
  version integer default 1 not null,
  parent_quote_id uuid references public.quotes on delete set null,
  is_legacy boolean default false not null,
  created_date_time timestamp with time zone default timezone('utc'::text, now()) not null,
  date_won_lost timestamp with time zone,
  date_completed timestamp with time zone,
  company_logo text,
  print_show_details boolean default true not null,
  print_show_detail_pricing boolean default true not null,
  print_show_quantities boolean default true not null,
  sections jsonb default '[]'::jsonb not null,
  photos jsonb default '[]'::jsonb not null,
  documents jsonb default '[]'::jsonb not null,
  receipts jsonb default '[]'::jsonb not null
);

-- Settings Table (1 per Company)
create table if not exists public.settings (
  company_id uuid primary key references public.companies on delete cascade,
  company_name text not null,
  company_address text,
  company_phone text,
  company_email text,
  default_tax_rate numeric(5,2) default 8.25 not null,
  default_markup_percent numeric(5,2) default 15.00 not null,
  company_logo text,
  theme text default 'light'::text check (theme in ('light', 'dark')),
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ==================== 3. AUTOMATED SIGNUP TRIGGER ====================

-- Definer function to handle automatic tenant creation or join on signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  invited_company_id uuid;
  invited_role text;
  new_company_id uuid;
begin
  -- Check if the signing up user's email has a pending company invitation
  select company_id, role into invited_company_id, invited_role
  from public.company_invitations
  where email = new.email
  limit 1;

  if invited_company_id is not null then
    -- Join inviting company
    insert into public.profiles (id, company_id, role, email)
    values (new.id, invited_company_id, invited_role, new.email);
    
    -- Remove the invitation record
    delete from public.company_invitations where email = new.email;
  else
    -- Create new company tenant for signup
    insert into public.companies (name)
    values ('New Contractor Co.')
    returning id into new_company_id;

    -- Add settings for company
    insert into public.settings (company_id, company_name)
    values (new_company_id, 'New Contractor Co.');

    -- Seed default categories for this company
    insert into public.categories (company_id, name) values
      (new_company_id, 'Category 1');

    -- Insert profile as owner
    insert into public.profiles (id, company_id, role, email)
    values (new.id, new_company_id, 'owner', new.email);
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- Trigger registration
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==================== 4. ROW LEVEL SECURITY (RLS) ====================

-- Enable RLS on all tables
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.company_invitations enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.quotes enable row level security;
alter table public.settings enable row level security;

-- Definer helper to check if user is sysadmin (bypasses tenant scope checks)
create or replace function public.is_sysadmin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'sysadmin'
  );
$$ language sql security definer;

-- Definer helper to fetch current user company_id
create or replace function public.get_user_company_id()
returns uuid
language sql
security definer
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

-- Definer helper to check write roles (sysadmin, owner, editor)
create or replace function public.has_write_access()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('sysadmin', 'owner', 'editor')
  );
$$ language sql security definer;

-- --- Policies for public.profiles ---
-- Recursive policy removed (use direct id-based policy instead)

-- Allow a user to read their own profile by id (needed before a company is assigned)
drop policy if exists "User can view own profile" on public.profiles;
create policy "User can view own profile" on public.profiles
  for select using (id = auth.uid());

-- Allow a user to insert their own profile on first sign‑up (company_id will be set after company creation)
drop policy if exists "User can insert own profile" on public.profiles;
create policy "User can insert own profile" on public.profiles
  for insert with check (id = auth.uid());

-- Allow a user to update their own profile (necessary for changing company_id or roles)
drop policy if exists "User can update own profile" on public.profiles;
create policy "User can update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Allow a user to delete their own profile
drop policy if exists "User can delete own profile" on public.profiles;
create policy "User can delete own profile" on public.profiles
  for delete using (id = auth.uid());

-- The previous incomplete policy caused infinite recursion. It is removed.
drop policy if exists "Owners/sysadmins can manage profiles" on public.profiles;

-- --- Policies for public.company_invitations ---
alter table public.company_invitations enable row level security;

drop policy if exists "Select company invitations based on company" on public.company_invitations;
create policy "Select company invitations based on company" on public.company_invitations
  for select using (company_id = public.get_user_company_id() or public.is_sysadmin());

drop policy if exists "Insert company invitations based on company write access" on public.company_invitations;
create policy "Insert company invitations based on company write access" on public.company_invitations
  for insert with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Delete company invitations based on company write access" on public.company_invitations;
create policy "Delete company invitations based on company write access" on public.company_invitations
  for delete using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

-- --- Policies for public.categories ---
drop policy if exists "Select categories based on company" on public.categories;
create policy "Select categories based on company" on public.categories
  for select using (company_id = public.get_user_company_id() or public.is_sysadmin());

drop policy if exists "Manage categories based on company write access" on public.categories;
drop policy if exists "Insert categories based on company write access" on public.categories;
create policy "Insert categories based on company write access" on public.categories
  for insert with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Update categories based on company write access" on public.categories;
create policy "Update categories based on company write access" on public.categories
  for update using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin())
  with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Delete categories based on company write access" on public.categories;
create policy "Delete categories based on company write access" on public.categories
  for delete using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

-- --- Policies for public.products ---
drop policy if exists "Select products based on company" on public.products;
create policy "Select products based on company" on public.products
  for select using (company_id = public.get_user_company_id() or public.is_sysadmin());

drop policy if exists "Manage products based on company write access" on public.products;
drop policy if exists "Insert products based on company write access" on public.products;
create policy "Insert products based on company write access" on public.products
  for insert with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Update products based on company write access" on public.products;
create policy "Update products based on company write access" on public.products
  for update using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin())
  with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Delete products based on company write access" on public.products;
create policy "Delete products based on company write access" on public.products
  for delete using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

-- --- Policies for public.customers ---
drop policy if exists "Select customers based on company" on public.customers;
create policy "Select customers based on company" on public.customers
  for select using (company_id = public.get_user_company_id() or public.is_sysadmin());

drop policy if exists "Manage customers based on company write access" on public.customers;
drop policy if exists "Insert customers based on company write access" on public.customers;
create policy "Insert customers based on company write access" on public.customers
  for insert with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Update customers based on company write access" on public.customers;
create policy "Update customers based on company write access" on public.customers
  for update using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin())
  with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Delete customers based on company write access" on public.customers;
create policy "Delete customers based on company write access" on public.customers
  for delete using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

-- --- Policies for public.quotes ---
drop policy if exists "Select quotes based on company" on public.quotes;
create policy "Select quotes based on company" on public.quotes
  for select using (company_id = public.get_user_company_id() or public.is_sysadmin());

drop policy if exists "Manage quotes based on company write access" on public.quotes;
drop policy if exists "Insert quotes based on company write access" on public.quotes;
create policy "Insert quotes based on company write access" on public.quotes
  for insert with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Update quotes based on company write access" on public.quotes;
create policy "Update quotes based on company write access" on public.quotes
  for update using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin())
  with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Delete quotes based on company write access" on public.quotes;
create policy "Delete quotes based on company write access" on public.quotes
  for delete using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

-- --- Policies for public.settings ---
drop policy if exists "Select settings based on company" on public.settings;
create policy "Select settings based on company" on public.settings
  for select using (company_id = public.get_user_company_id() or public.is_sysadmin());

drop policy if exists "Manage settings based on company write access" on public.settings;
drop policy if exists "Insert settings based on company write access" on public.settings;
create policy "Insert settings based on company write access" on public.settings
  for insert with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Update settings based on company write access" on public.settings;
create policy "Update settings based on company write access" on public.settings
  for update using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin())
  with check ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

drop policy if exists "Delete settings based on company write access" on public.settings;
create policy "Delete settings based on company write access" on public.settings
  for delete using ((company_id = public.get_user_company_id() and public.has_write_access()) or public.is_sysadmin());

-- ==================== 5. STORAGE BUCKETS SETUP ====================

-- Create buckets for attachments
insert into storage.buckets (id, name, public) values 
  ('pdf-contracts', 'pdf-contracts', true),
  ('job-receipts', 'job-receipts', true),
  ('company-logos', 'company-logos', true),
  ('project-photos', 'project-photos', true)
on conflict (id) do nothing;

-- Storage Policies for Public Reading
drop policy if exists "Public Read Access on PDF Contracts" on storage.objects;
create policy "Public Read Access on PDF Contracts" on storage.objects
  for select using (bucket_id = 'pdf-contracts');
drop policy if exists "Public Read Access on Job Receipts" on storage.objects;
create policy "Public Read Access on Job Receipts" on storage.objects
  for select using (bucket_id = 'job-receipts');
drop policy if exists "Public Read Access on Company Logos" on storage.objects;
create policy "Public Read Access on Company Logos" on storage.objects
  for select using (bucket_id = 'company-logos');
drop policy if exists "Public Read Access on Project Photos" on storage.objects;
create policy "Public Read Access on Project Photos" on storage.objects
  for select using (bucket_id = 'project-photos');

-- Storage Policies for Upload/Delete (User matches folder company ID prefix, or is sysadmin)
drop policy if exists "Write Access on company buckets" on storage.objects;
create policy "Write Access on company buckets" on storage.objects
  for all using (
    auth.role() = 'authenticated' 
    and (bucket_id in ('pdf-contracts', 'job-receipts', 'company-logos', 'project-photos'))
    and (
      split_part(name, '/', 1) = public.get_user_company_id()::text
      or public.is_sysadmin()
    )
  )
  with check (
    auth.role() = 'authenticated' 
    and (bucket_id in ('pdf-contracts', 'job-receipts', 'company-logos', 'project-photos'))
    and (
      split_part(name, '/', 1) = public.get_user_company_id()::text
      or public.is_sysadmin()
    )
  );

-- Add new fields for terms, markup, and tax options (v18)
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS default_terms_notes TEXT;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS default_tax_plus_applicable BOOLEAN DEFAULT FALSE;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS default_terms_notes TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS default_markup_percent NUMERIC(5,2) DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS default_tax_plus_applicable BOOLEAN DEFAULT FALSE;

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS tax_plus_applicable BOOLEAN DEFAULT FALSE;

-- =====================================================================
-- Update profiles constraint and RLS policies (v25)
-- =====================================================================

-- Recreate profiles role check constraint to include all roles
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('sysadmin', 'owner', 'editor', 'viewer'));

-- Recreate company invitations role check constraint to include all roles
ALTER TABLE public.company_invitations DROP CONSTRAINT IF EXISTS company_invitations_role_check;
ALTER TABLE public.company_invitations ADD CONSTRAINT company_invitations_role_check CHECK (role IN ('editor', 'viewer'));

-- Re-create RLS select policy for profiles to support owners, editors, and sysadmins
DROP POLICY IF EXISTS "User can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view profiles in same company" ON public.profiles;
CREATE POLICY "Users can view profiles in same company" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR public.is_sysadmin()
    OR (company_id = public.get_user_company_id() AND public.has_write_access())
  );

-- Re-create RLS insert policy for profiles
DROP POLICY IF EXISTS "User can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Owners/sysadmins can insert profiles in same company" ON public.profiles;
CREATE POLICY "Owners/sysadmins can insert profiles in same company" ON public.profiles
  FOR INSERT WITH CHECK (
    id = auth.uid()
    OR public.is_sysadmin()
    OR (company_id = public.get_user_company_id() AND public.has_write_access())
  );

-- Re-create RLS update policy for profiles
DROP POLICY IF EXISTS "User can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Owners/sysadmins can update profiles in same company" ON public.profiles;
CREATE POLICY "Owners/sysadmins can update profiles in same company" ON public.profiles
  FOR UPDATE USING (
    id = auth.uid()
    OR public.is_sysadmin()
    OR (company_id = public.get_user_company_id() AND public.has_write_access())
  );

-- Re-create RLS delete policy for profiles
DROP POLICY IF EXISTS "User can delete own profile" ON public.profiles;
DROP POLICY IF EXISTS "Owners/sysadmins can delete profiles in same company" ON public.profiles;
CREATE POLICY "Owners/sysadmins can delete profiles in same company" ON public.profiles
  FOR DELETE USING (
    id = auth.uid()
    OR public.is_sysadmin()
    OR (company_id = public.get_user_company_id() AND public.has_write_access())
  );

-- =====================================================================
-- Claims Sync, Hybrid Security Definer Helpers & RLS (v28)
-- =====================================================================

-- 1. Redefine trigger function handle_new_user to auto-create profiles safely without dangerous auth.users updates
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
    VALUES (NEW.id, invited_company_id, invited_role, NEW.email);
    
    -- Remove the invitation record
    DELETE FROM public.company_invitations WHERE LOWER(email) = LOWER(NEW.email);
  ELSE
    -- Create new company tenant for signup
    INSERT INTO public.companies (name)
    VALUES ('New Contractor Co.')
    RETURNING id INTO new_company_id;

    -- Add settings for company
    INSERT INTO public.settings (company_id, company_name)
    VALUES (new_company_id, 'New Contractor Co.');

    -- Seed default categories for this company
    INSERT INTO public.categories (company_id, name) VALUES
      (new_company_id, 'Category 1');

    -- Insert profile as owner
    INSERT INTO public.profiles (id, company_id, role, email)
    VALUES (NEW.id, new_company_id, 'owner', NEW.email);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Define dynamic RLS helper functions and secure RPC data fetchers (recursion-free)
CREATE OR REPLACE FUNCTION public.is_sysadmin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'sysadmin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.has_write_access()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('sysadmin', 'owner', 'editor')
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_company_users(co_id uuid)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  role text,
  email text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF public.is_sysadmin() OR (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()) = co_id THEN
    RETURN QUERY
    SELECT p.id, p.company_id, p.role, p.email, p.created_at
    FROM public.profiles p
    WHERE (co_id IS NULL AND public.is_sysadmin()) OR p.company_id = co_id
    ORDER BY p.email;
  ELSE
    RETURN;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company_invitations(co_id uuid)
RETURNS TABLE (
  company_id uuid,
  email text,
  role text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF public.is_sysadmin() OR (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()) = co_id THEN
    RETURN QUERY
    SELECT i.company_id, i.email, i.role, i.created_at
    FROM public.company_invitations i
    WHERE (co_id IS NULL AND public.is_sysadmin()) OR i.company_id = co_id
    ORDER BY i.email;
  ELSE
    RETURN;
  END IF;
END;
$$;

-- 3. Re-create RLS select/insert/update/delete policies for profiles
DROP POLICY IF EXISTS "Users can view profiles in same company" ON public.profiles;
CREATE POLICY "Users can view profiles in same company" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR public.is_sysadmin()
    OR (company_id = public.get_user_company_id())
  );

DROP POLICY IF EXISTS "Owners/sysadmins can insert profiles in same company" ON public.profiles;
CREATE POLICY "Owners/sysadmins can insert profiles in same company" ON public.profiles
  FOR INSERT WITH CHECK (
    id = auth.uid()
    OR public.is_sysadmin()
    OR (company_id = public.get_user_company_id() AND public.has_write_access())
  );

DROP POLICY IF EXISTS "Owners/sysadmins can update profiles in same company" ON public.profiles;
CREATE POLICY "Owners/sysadmins can update profiles in same company" ON public.profiles
  FOR UPDATE USING (
    id = auth.uid()
    OR public.is_sysadmin()
    OR (company_id = public.get_user_company_id() AND public.has_write_access())
  );

DROP POLICY IF EXISTS "Owners/sysadmins can delete profiles in same company" ON public.profiles;
CREATE POLICY "Owners/sysadmins can delete profiles in same company" ON public.profiles
  FOR DELETE USING (
    id = auth.uid()
    OR public.is_sysadmin()
    OR (company_id = public.get_user_company_id() AND public.has_write_access())
  );

-- --- Policies for public.companies ---
DROP POLICY IF EXISTS "Select companies based on company membership" ON public.companies;
CREATE POLICY "Select companies based on company membership" ON public.companies
  FOR SELECT USING (
    id = public.get_user_company_id()
    OR public.is_sysadmin()
  );

DROP POLICY IF EXISTS "Insert companies for sysadmin" ON public.companies;
CREATE POLICY "Insert companies for sysadmin" ON public.companies
  FOR INSERT WITH CHECK (
    public.is_sysadmin()
    OR auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Update companies for owners/sysadmins" ON public.companies;
CREATE POLICY "Update companies for owners/sysadmins" ON public.companies
  FOR UPDATE USING (
    (id = public.get_user_company_id() AND public.has_write_access())
    OR public.is_sysadmin()
  );

DROP POLICY IF EXISTS "Delete companies for sysadmin" ON public.companies;
CREATE POLICY "Delete companies for sysadmin" ON public.companies
  FOR DELETE USING (
    public.is_sysadmin()
  );

-- 4. Sync custom claims for all existing profiles to auth.users raw_app_meta_data
UPDATE auth.users u
SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb) || 
                        jsonb_build_object('role', p.role, 'company_id', p.company_id)
FROM public.profiles p
WHERE u.id = p.id;

-- 5. Enable pg_net extension and define branded email invitation trigger
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- Enable RLS on config (no policies = only superuser/postgres can access)
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.on_invitation_created()
RETURNS TRIGGER AS $$
DECLARE
  brevo_key text;
  resend_key text;
  co_name text;
  co_logo text;
  email_html text;
  signup_url text;
BEGIN
  -- Fetch API Keys
  SELECT value INTO brevo_key FROM public.system_config WHERE key = 'brevo_api_key';
  SELECT value INTO resend_key FROM public.system_config WHERE key = 'resend_api_key';
  
  -- Failsafe: if no key is configured, skip email delivery
  IF brevo_key IS NULL AND resend_key IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch company details
  SELECT company_name, company_logo INTO co_name, co_logo
  FROM public.settings
  WHERE company_id = NEW.company_id;

  IF co_name IS NULL THEN
    co_name := 'Your Inviting Company';
  END IF;

  -- Construct signup URL (pointing to new custom domain)
  signup_url := 'https://mybidbook.com/index.html?invite=true&email=' || NEW.email || '&company_id=' || NEW.company_id::text;

  -- Build branded email body
  email_html := '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">';
  IF co_logo IS NOT NULL AND co_logo <> '' THEN
    email_html := email_html || '<div style="text-align: center; margin-bottom: 20px;"><img src="' || co_logo || '" style="max-height: 80px; max-width: 200px; object-fit: contain;" /></div>';
  END IF;
  email_html := email_html || '<h2 style="color: #1e293b; text-align: center; margin-bottom: 10px;">You are invited to join ' || co_name || '</h2>';
  email_html := email_html || '<p style="color: #475569; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">';
  IF NEW.invited_by IS NOT NULL THEN
    email_html := email_html || '<strong>' || NEW.invited_by || '</strong> has invited you to join ';
  ELSE
    email_html := email_html || 'You have been invited to join ';
  END IF;
  email_html := email_html || '<strong>' || co_name || '</strong> as a <strong>' || NEW.role || '</strong> on MyBidBook.</p>';
  email_html := email_html || '<div style="text-align: center; margin: 30px 0;"><a href="' || signup_url || '" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Accept Invitation & Create Account</a></div>';
  email_html := email_html || '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />';
  email_html := email_html || '<p style="color: #94a3b8; font-size: 12px; text-align: center;">If you did not expect this invitation, you can safely ignore this email.</p>';
  email_html := email_html || '</div>';

  -- Trigger HTTP POST request securely
  BEGIN
    IF brevo_key IS NOT NULL THEN
      -- Send via Brevo API
      PERFORM net.http_post(
        'https://api.brevo.com/v3/smtp/email',
        jsonb_build_object(
          'sender', jsonb_build_object('name', 'MyBidBook', 'email', 'no-reply@mybidbook.com'),
          'to', jsonb_build_array(jsonb_build_object('email', NEW.email)),
          'subject', 'Invitation to join ' || co_name,
          'htmlContent', email_html
        ),
        '{}'::jsonb,
        jsonb_build_object(
          'Content-Type', 'application/json',
          'api-key', brevo_key
        )
      );
    ELSE
      -- Fallback to Resend API
      PERFORM net.http_post(
        'https://api.resend.com/emails',
        jsonb_build_object(
          'from', 'MyBidBook <onboarding@resend.dev>',
          'to', NEW.email,
          'subject', 'Invitation to join ' || co_name,
          'html', email_html
        ),
        '{}'::jsonb,
        jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || resend_key
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to send invitation email via pg_net: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_on_invitation_created ON public.company_invitations;
CREATE TRIGGER tr_on_invitation_created
AFTER INSERT ON public.company_invitations
FOR EACH ROW
EXECUTE FUNCTION public.on_invitation_created();

-- Delete User by ID (owner/sysadmin privilege)
CREATE OR REPLACE FUNCTION public.delete_user_by_id(user_id uuid)
RETURNS void AS $$
DECLARE
  caller_role text;
  caller_co_id uuid;
  target_co_id uuid;
BEGIN
  -- Get caller details
  SELECT role, company_id INTO caller_role, caller_co_id 
  FROM public.profiles 
  WHERE id = auth.uid();

  -- Get target details
  SELECT company_id INTO target_co_id 
  FROM public.profiles 
  WHERE id = user_id;

  -- Verify permissions:
  -- Caller must be sysadmin, OR (caller must be owner of the same company as target)
  IF caller_role = 'sysadmin' OR (caller_role = 'owner' AND caller_co_id = target_co_id) THEN
    -- Delete from auth.users (which cascades to public.profiles)
    DELETE FROM auth.users WHERE id = user_id;
  ELSE
    RAISE EXCEPTION 'Unauthorized to delete user. You must be an owner of the company or a sysadmin.';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
