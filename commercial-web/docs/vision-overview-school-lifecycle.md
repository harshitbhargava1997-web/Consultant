# Vision overview and school lifecycle

## Scope

- Overview: total active Vision schools, unique teacher accounts in active schools, active students, and consultants.
- Super Admin sees platform totals, including all registered consultants. Other users see only RLS-permitted records; consultants are counted from their permitted schools' visible assignments.
- School Success records are not included or modified.
- Duplicate Consultant assignments sidebar removed. User management → Consultants retains registration and allocation. Consultant support remains available.

## Recoverable deletion

Super Admin → Schools → Delete school requires confirmation. This updates only `literacy_schools.archived_at` and `archived_by`. It does not delete authentication accounts, classes, memberships, students, assessments, lessons, training assignments or media.

Deleted schools disappear from active selectors and totals. School-scoped APIs, native RLS permissions, and Vision public teacher links reject deleted schools. Super Admin can restore them under Schools → Deleted schools. Existing IDs and historical associations remain unchanged. Shared School Success links and data are independent.

Migration: `migrations/vision-school-lifecycle.sql`, applied to the existing Vision Supabase project before the application release. No records are archived by the migration. The existing permission function is tightened, not given broader privileges.

## Verification

- Existing 62 regression tests passed before release.
- Eight new automated tests cover exact counts (including 5,001 students), teacher pagination/deduplication, permitted-school scope, error/zero handling, four rendered cards, lifecycle authorization, history preservation and navigation/route coverage.
- Production Next.js build succeeded.
- Actual database transactional test verified teacher access before deletion, denied school/student visibility and permissions after deletion, retained underlying records, and restored school/student visibility. All fixture changes rolled back.
- SQL baseline: 8 active schools, 35 distinct teachers, 363 active students, 2 consultants, 0 deleted schools. These are a snapshot, not hard-coded values.
- No real customer school was deleted for testing.
- Authenticated browser click-through and real mobile-device acceptance remain untested without a signed-in test session. Do not represent component tests as a deployed end-to-end test.

## Existing security advisories

The project retains existing advisory findings: API-only tables with RLS and no client policies, authenticated-callable SECURITY DEFINER authorization functions, an anonymous-callable pre-existing training trigger function, and disabled leaked-password protection. This release adds no new grants or SECURITY DEFINER functions and preserves existing API protections. These findings need a separately scoped security review; do not fix them by exposing service credentials or widening RLS.
