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
-- Claims Sync, Dynamic Security Definer Helpers & RLS (v27)
-- =====================================================================

-- 1. Redefine trigger function handle_new_user to auto-confirm emails and create profile
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

    -- Auto-confirm email
    UPDATE auth.users
    SET email_confirmed_at = now(),
        confirmed_at = now()
    WHERE id = NEW.id;
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

    -- Auto-confirm email
    UPDATE auth.users
    SET email_confirmed_at = now(),
        confirmed_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Redefine security definer helper functions to dynamically query tables (completely recursion-free as they bypass RLS internally)
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



