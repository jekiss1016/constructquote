-- Supabase initialization script for ConstructQuote application
-- Run this script in the Supabase SQL editor or via the Supabase CLI

-- Enable extensions (if needed)
create extension if not exists "uuid-ossp";

-- Table: companies
create table if not exists companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamp with time zone default now()
);

-- Table: profiles
create table if not exists profiles (
  id uuid primary key,
  email text not null unique,
  role text not null default 'viewer',
  company_id uuid references companies(id) on delete cascade,
  created_at timestamp with time zone default now()
);

-- Table: settings
create table if not exists settings (
  company_id uuid primary key references companies(id) on delete cascade,
  company_name text,
  company_address text,
  company_phone text,
  company_email text,
  default_tax_rate numeric,
  default_markup_percent numeric,
  company_logo text,
  theme text default 'light',
  created_at timestamp with time zone default now()
);

-- Table: categories
create table if not exists categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  company_id uuid references companies(id) on delete cascade,
  created_at timestamp with time zone default now()
);

-- Table: products
create table if not exists products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text,
  uom text,
  price numeric default 0,
  labor_rate numeric default 0,
  status text default 'Active',
  description text,
  company_id uuid references companies(id) on delete cascade,
  created_at timestamp with time zone default now()
);

-- Table: customers
create table if not exists customers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text,
  phone text,
  address text,
  status text default 'Active',
  contacts jsonb default '[]'::jsonb,
  documents jsonb default '[]'::jsonb,
  company_id uuid references companies(id) on delete cascade,
  created_at timestamp with time zone default now()
);

-- Table: quotes
create table if not exists quotes (
  id uuid primary key default uuid_generate_v4(),
  job_id text,
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  project_address text,
  customer_phone text,
  customer_email text,
  date timestamp with time zone default now(),
  expiration_date timestamp with time zone,
  markup_percent numeric default 0,
  tax_rate numeric default 0,
  notes text,
  status text default 'Pending',
  version integer default 1,
  parent_quote_id uuid references quotes(id),
  is_legacy boolean default false,
  date_won_lost timestamp with time zone,
  date_completed timestamp with time zone,
  sections jsonb default '[]'::jsonb,
  photos jsonb default '[]'::jsonb,
  documents jsonb default '[]'::jsonb,
  receipts jsonb default '[]'::jsonb,
  company_id uuid references companies(id) on delete cascade,
  created_at timestamp with time zone default now()
);

-- Optional: create indexes for frequently queried columns
create index if not exists idx_profiles_company_id on profiles(company_id);
create index if not exists idx_settings_company_id on settings(company_id);
create index if not exists idx_categories_company_id on categories(company_id);
create index if not exists idx_products_company_id on products(company_id);
create index if not exists idx_customers_company_id on customers(company_id);
create index if not exists idx_quotes_company_id on quotes(company_id);

-- Add Row Level Security (RLS) policies if you wish to restrict access per company
-- Example policy for profiles
-- enable rls;
-- create policy "company_isolation" on profiles using (company_id = auth.uid());
