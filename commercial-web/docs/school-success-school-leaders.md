# School leaders (principals and coordinators) in School Success

22 November 2026. Phase 1 of stakeholder access (owner-approved):
- the CRM is hidden from school leaders;
- leaders may review lessons;
- principals and coordinators have the same access;
- leaders may reset teacher PINs.

## Adding principals and coordinators (Super Admin, inside School Success)
1. Open **School Success → Schools & teachers → School leaders** (Super Admin only).
2. Choose the school, then enter:
   - full name;
   - role (**Principal** or **Coordinator**);
   - **mobile number**;
   - **starting password** (prefilled `123456`).
3. Click **Add school leader**. This:
   - creates a mobile-number sign-in, marked to change its password at first sign-in. If an account already exists for that mobile number, it is **linked** instead of duplicated.
   - grants **School leader** access to that school. Super Admin accounts and existing consultants are refused.
4. Share the link `https://schoolsuccess.in/school-success`, the mobile number and the starting password.
5. **First sign-in:**
   - the leader signs in with mobile + password and must set their own password (12 or more characters, Vision's existing first-login screen);
   - they then return to School Success automatically.
6. **List and actions:** the list shows each leader's name, role, mobile and status (*Waiting for first sign-in* / *Active*).
   - **Reset password** (back to `123456`, change required again) is offered only for sign-ins created here. Accounts created elsewhere are reset where they were made.
   - **Remove** ends access to that school but keeps the sign-in.
- The Module access page can also grant the School leader role to any existing account.

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
