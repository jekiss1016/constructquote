-- ============================================================
-- DUPLICATE EMAIL CLEANUP SCRIPT
-- Run this in the Supabase SQL Editor BEFORE adding the unique index.
-- This script finds and removes duplicate (company_id, email) pairs
-- in both profiles and company_invitations, keeping only the OLDEST record.
-- ============================================================

-- ==================== STEP 1: PREVIEW DUPLICATES ====================
-- Run this first to SEE what duplicates exist (read-only, no changes).

-- 1a) Duplicate emails in profiles (same company)
SELECT company_id, LOWER(email) AS email, COUNT(*) AS duplicate_count,
       MIN(created_at) AS oldest, MAX(created_at) AS newest
FROM public.profiles
WHERE company_id IS NOT NULL
GROUP BY company_id, LOWER(email)
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- 1b) Duplicate emails in company_invitations (same company)
-- Note: This table has PRIMARY KEY (company_id, email) so true duplicates
-- should not exist unless the PK was added after data was already inserted.
SELECT company_id, LOWER(email) AS email, COUNT(*) AS duplicate_count,
       MIN(created_at) AS oldest, MAX(created_at) AS newest
FROM public.company_invitations
GROUP BY company_id, LOWER(email)
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;


-- ==================== STEP 2: DELETE DUPLICATES ====================
-- Only run this AFTER reviewing the results from Step 1.
-- These DELETE statements keep the OLDEST record (earliest created_at)
-- and remove all newer duplicates.

-- 2a) Remove duplicate profiles, keeping the oldest
DELETE FROM public.profiles p
WHERE EXISTS (
    SELECT 1
    FROM public.profiles p2
    WHERE p2.company_id = p.company_id
      AND LOWER(p2.email) = LOWER(p.email)
      AND p2.created_at < p.created_at
);

-- 2b) Remove duplicate invitations, keeping the oldest
-- (Safety net in case any slipped past the PK)
DELETE FROM public.company_invitations i
WHERE EXISTS (
    SELECT 1
    FROM public.company_invitations i2
    WHERE i2.company_id = i.company_id
      AND LOWER(i2.email) = LOWER(i.email)
      AND i2.created_at < i.created_at
);


-- ==================== STEP 3: ADD UNIQUE INDEX ====================
-- After duplicates are cleaned, add the unique index to prevent future duplicates.
-- This is also included in supabase_setup.sql for new deployments.

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_company_email_unique
  ON public.profiles (company_id, LOWER(email));

-- Verify: re-run the duplicate queries from Step 1 — they should return 0 rows.
