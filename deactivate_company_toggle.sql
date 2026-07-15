-- ==============================================================================
-- Company Deactivation Script
-- ==============================================================================

-- 1. Run this first to ensure the 'is_active' column exists on the companies table.
-- By setting DEFAULT true, all newly created companies will automatically be active upon sign-up!
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;

-- 2. Use the statement below to DEACTIVATE a company so they cannot log in.
-- Simply replace the ID with the UUID of the company you want to deactivate.
-- UPDATE public.companies SET is_active = false WHERE id = 'REPLACE-WITH-COMPANY-UUID';

-- 3. Use the statement below to REACTIVATE a company.
-- UPDATE public.companies SET is_active = true WHERE id = 'REPLACE-WITH-COMPANY-UUID';
