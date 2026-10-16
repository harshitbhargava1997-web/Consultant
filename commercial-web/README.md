# Vision School Platform — commercial Next.js staging

This is a **separate Next.js application** located in commercial-web/, intentionally isolated from the existing Streamlit apps. It uses a single Supabase Auth login, membership-based school selection, classes, rosters, cumulative literacy competency assessments, progress reports, and platform-admin school/user provisioning.

## Safety boundaries

- DO NOT merge the commercial-staging branch into main until explicitly approved.
- DO NOT put Supabase service-role / secret keys in the repo or in NEXT_PUBLIC variables.
- DO NOT expose legacy teacher_records or classroom_observations through a public API; Row Level Security is disabled on those production tables as of the initial audit.
- Existing implementation evidence, classroom observation records, and R2 media have not been migrated or altered. These two navigation sections explicitly indicate pending migration.
- Production onboarding needs a separate verified-email flow, auditing, rate limits, access revocation, enforceable password rotation, consent/privacy notices for minors, staged data migration, backups, and school-scoped authorization tests. Temporary-password first-login enforcement currently applies to the web interface, not direct PostgREST API access.
- Supabase RLS policies remain the ultimate access boundary. Test by signing in as users of two different schools before adding actual student data.

## Setup

1. In Vercel, create a **new project** linked to the existing Consultant repository. Set **Root Directory = commercial-web**. Deploy **commercial-staging**, not main.
2. Configure NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (public publishable/anon key), SUPABASE_SERVICE_ROLE_KEY (private server-only variable) in Vercel **Preview** scope. Point to a separately provisioned staging Supabase project before using test accounts.
3. Configure Supabase Auth Site URL / Redirect URLs to include the exact Vercel staging deployment URL, including /reset. Never leave localhost:3000 for email recovery.
4. Use the existing assessment_migration.sql and platform_admin_migration.sql **on staging**, then test with synthetic schools and students. These are not bundled for automatic execution here.
5. Do not enable public commercial sign-ups or connect the existing production service-role key until the permissions and security audit is complete.

## What works in source

- Supabase Auth email/password login for school leaders and email-or-mobile/password login for teachers. Email accounts reset through recovery email; mobile-only teachers require an administrator-assisted password reset.
- One browser app with accessible-school selector and role-aware sidebar navigation.
- Platform Super Admin APIs verify bearer JWT against Supabase Auth and the private literacy_platform_admins registry before elevated actions.
- School creation, owner/principal/coordinator/teacher account assignment (new account temporary credential displayed once).
- School-scoped classes, independent student assessment IDs, CSV student roster import.
- Cumulative competencies Nursery–Grade 5, student and leadership teacher assessment RPC, basic literacy level reports (provisional 80%/80% rule).
- Historical implementation and observation tabs intentionally present as pending rather than fabricated data.

## Limitations to resolve for commercial production

1. Require true server-enforced first-login password change and email ownership verification; avoid confirmed-by-admin addresses before independent email verification.
2. Fix/validate all RLS & RPC security-definer protections and tenant-scoped grants in staging. Specifically **legacy tables have RLS disabled**, and this must not be silently changed on the live system.
3. Review privacy obligations for children's educational records, contracts with schools, data retention, data subject requests, encryption/backup and secure evidence uploads.
4. Establish consistent school_id/user_id/class_id linking between legacy and new data; no naive name-based joins.
5. Add observability, automated integration testing, audit events, rate limits, reliable CSV import transactions, and permission to remove users.
6. Review hosting/SLAs and disaster recovery for paying customers.

## Dev commands

npm install
npm run dev
npm run build

Node 20+ recommended. Copy .env.example to .env.local for local development and NEVER commit real values.

## Source of truth

GitHub: harshitbhargava1997-web/Consultant, branch commercial-staging, path commercial-web.
