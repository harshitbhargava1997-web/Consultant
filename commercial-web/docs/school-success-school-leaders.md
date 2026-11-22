# School leaders (principals and coordinators) in School Success

22 November 2026. Phase 1 of stakeholder access (owner-approved):
- the CRM is hidden from school leaders;
- leaders may review lessons;
- principals and coordinators have the same access;
- leaders may reset teacher PINs.

## Granting access (Super Admin)
1. The principal or coordinator signs in to Vision with an existing account (mobile number + password, or email + password). Vision literacy accounts are reused only as a sign-in; no Vision literacy school or membership is linked.
2. Super Admin opens **School Success → Module access** and selects the account.
3. Choose role **School leader (principal or coordinator)**, tick their school, and save. Existing grants are unchanged: they keep the **Consultant** role.

## What a school leader sees (their assigned school only)
- **School 360°**, including the **Teacher PINs** panel (reset a teacher's PIN; set the school starting PIN).
- **Teacher 360°**: benchmark overview, teacher profiles, lesson records, and report downloads and links for their school.
- **Lesson reviews**: open lessons and record rubric feedback, plus CSV export.
- **Classroom visits** (view).

## What is consultant-only (fails closed for leaders)
Enforced on the server, not just hidden in the menu:
- **CRM:**
  - contacts, connect calls, tickets and their legacy copies are removed from leaders' data;
  - no CRM archive is created for them;
  - CRM templates are refused.
- **Changes through the portal route are all refused:**
  - schools, people, access and school links;
  - directory archive;
  - shared report defaults.
- **Data actions in the gateway:** only `read` and `readLessonReviews` are allowed. Imports, CRM writes, observations, legacy reviews and every teacher lesson/evidence action are refused.
- **Teacher submissions:** the evidence route refuses leaders. Lessons are submitted by teachers, or by consultants on their behalf.
- **Unchanged:** Overview, School CRM, Schools & teachers, Data & imports, the Teacher portal admin view and Media settings stay hidden from leaders.

## Identity
- Leaders keep the staff role internally (`role: 'admin'`) and add `leader: true`, `staffRole: 'leader'`. Read paths, reports, report links, lesson reviews and PIN administration therefore work with the existing school checks (`allowedSchools`, `assertSchool`).
- `assertConsultant()` guards every consultant-only path.

## Not in Phase 1
- Showing reviewer roles to teachers ("Feedback from: Principal / Consultant").
- Grade- or subject-limited coordinators.
- Teacher mobile + password accounts.

## Tests
`tests/success-school-leader.test.cjs` covers:
- grant defaults;
- mobile-number leader identity and school scope;
- CRM stripped for leaders but kept for consultants;
- every write and teacher action refused in the gateway;
- the portal write route refused;
- PIN panel access for their school only.

## Rollback
Revert the PR. Leader grants then behave as consultant grants for the same schools, so **revoke leader grants first** if rolling back.
