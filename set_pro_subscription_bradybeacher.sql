-- ============================================================
-- UPDATE SUBSCRIPTION TO PRO LEVEL FOR DELEGATED USER
-- Target Email: bradybeacher@gmail.com
-- Target Level: 'pro'
-- Expiration Date: November 13, 2026 (2026-11-13)
-- ============================================================

-- 1. Ensure table schema supports subscription_period_end column
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS subscription_period_end timestamp with time zone;

-- 2. Update company record for bradybeacher@gmail.com
DO $$
DECLARE
  target_email text := 'bradybeacher@gmail.com';
  target_company_id uuid;
  target_company_name text;
BEGIN
  -- Locate company_id for user profile
  SELECT company_id INTO target_company_id
  FROM public.profiles
  WHERE LOWER(email) = LOWER(target_email)
  LIMIT 1;

  IF target_company_id IS NULL THEN
    RAISE NOTICE 'No profile or company found for email: %', target_email;
  ELSE
    -- Update company subscription tier, status, and expiration date
    UPDATE public.companies
    SET 
      subscription_level = 'pro',
      subscription_status = 'active',
      subscription_period_end = '2026-11-13 23:59:59+00'::timestamptz,
      is_active = true
    WHERE id = target_company_id
    RETURNING name INTO target_company_name;

    RAISE NOTICE 'Successfully updated company % (ID: %) to Pro level through 2026-11-13.', 
      target_company_name, target_company_id;
  END IF;
END;
$$;

-- 3. Verify updated company record
SELECT 
  p.email,
  c.id AS company_id,
  c.name AS company_name,
  c.subscription_level,
  c.subscription_status,
  c.subscription_period_end,
  c.is_active
FROM public.profiles p
JOIN public.companies c ON c.id = p.company_id
WHERE LOWER(p.email) = LOWER('bradybeacher@gmail.com');
