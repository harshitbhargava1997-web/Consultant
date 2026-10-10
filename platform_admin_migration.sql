
-- PLATFORM SUPER ADMIN DATABASE SETUP
-- Run after the existing assessment_migration.sql.

CREATE TABLE IF NOT EXISTS public.literacy_platform_admins (
    user_id UUID PRIMARY KEY
        REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Protect the Super Admin registry
ALTER TABLE public.literacy_platform_admins
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.literacy_platform_admins
FROM anon, authenticated;

-- First Super Admin:
-- The account must exist in Supabase Authentication
-- and its email must already be confirmed.

INSERT INTO public.literacy_platform_admins (user_id)
SELECT id
FROM auth.users
WHERE lower(email) =
      lower('harshitbhargava1997@gmail.com')
  AND email_confirmed_at IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- Verify installation
SELECT
    a.user_id,
    u.email,
    a.created_at
FROM public.literacy_platform_admins a
JOIN auth.users u ON u.id = a.user_id;
