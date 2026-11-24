# School leaders (principals, coordinators and school management) in School Success

22 November 2026. Phase 1 of stakeholder access (owner-approved):
- the CRM is hidden from school leaders;
- leaders may review lessons;
- principals and coordinators have the same access;
- leaders may reset teacher PINs.

## Adding principals and coordinators (Super Admin, inside School Success)
1. Open **School Success → User management**, then **Add school leader** (or the **School leaders** tab). Super Admin only.
2. Choose the school, then enter:
   - full name;
   - role (**Principal**, **Coordinator** or **School management**);
   - **mobile number**;
   - **starting password** (prefilled `123456`).
3. Click **Add school leader**. This:
   - creates a mobile-number sign-in, marked to change its password at first sign-in. A mobile number that already has an account is **refused** ("already registered, please change the details").
   - grants **School leader** access to that school. Super Admin accounts and existing consultants are refused.
4. Share the link `https://schoolsuccess.in/school-success`, the mobile number and the starting password.
5. **First sign-in:**
   - the leader signs in with mobile + password and must set their own password (at least 6 characters, Vision's first-login screen);
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

## 24 November 2026: review dashboard only (owner decision)
School leaders (Principal, Coordinator, School management) now open **one review dashboard** instead of the staff workspace. There is no sidebar, School 360°, Teacher 360°, Classroom visits or Teacher portal for them. Super Admin and consultants are unchanged.
- **Header:** their title and school, for example "Principal · Sunrise Public School".
- **Filters:**
  - dates: This week (Monday to today), Last week, This month, or a date range of up to 100 days. Dates outside the loaded period are loaded on choice.
  - teacher and subject.
- **Numbers:** teachers who planned / all teachers, evidence files shared, and lessons reviewed / lessons.
- **New evidence to review:** lessons with evidence and no feedback, each with **Review**. This opens the existing review window (plan, evidence, Planning and Execution ratings with remarks).
- **No plan yet:** teachers with no lesson plan in the dates (and subject), with their last plan date.
- **Lesson plans:** every lesson in the filters, with plan, evidence, reviewed or awaiting, and teacher-noted status, plus Review / Open.
- **Feedback given:** remarks with date and whether the teacher has noted them.
- **Profile menu:** **Teacher PINs** (opens on their school) and **Sign out**.

Server permissions are unchanged: leaders still read only their own school and can only record reviews and reset PINs. Their job title (`title`) is now included in the signed-in identity. Code: `app/school-success/ui/leader-app.jsx`. Tests: `tests/success-leader-dashboard.test.mjs`.

## 24 November 2026: sign-in fixes (owner decision)
- **Passwords:** every Vision and School Success account uses one rule, 6 to 128 characters (6 digits are fine), with no uppercase, number or symbol requirement. It covers:
  - first sign-in;
  - password change and reset;
  - starting passwords set by Super Admin, consultants and school management, including bulk import.
  The rule lives in `lib/password-policy.js`.
- **Adding a leader with an existing mobile number** is refused, with "This mobile number is already registered. Please change the details and use a different mobile number." (or "already a school leader for this school"). Previously the existing account was linked, keeping its own password and email, so the leader could not sign in with what was shared.
- **Accounts linked earlier:** they have no Reset password button. Remove them from the school and add the person again with a mobile number that has no account, or reset their password where the account was created.

## 24 November 2026: School Success's own sign-in (owner decision)
School Success and Vision literacy are separate programmes, and School Success staff sign in at **schoolsuccess.in/school-success**.
- **Sign-in page:**
  - School Success branding, mobile number (or email) and password;
  - friendly errors ("The mobile number or password is not correct.").
  It is shown whenever a principal, coordinator, school management member or consultant is not signed in. There is no "Sign in to Vision" button.
- **First sign-in:** "Set your own password" (at least 6 characters), then straight into School Success.
- **No access:** a signed-in account without School Success access sees "No School Success access", with Sign out.
- **Sign out:** stays on School Success's sign-in page.
- **Unchanged:** teachers keep the school link and PIN; Vision's own sign-in page; user management.
- **Accounts:** leader accounts are created in School Success → School leaders. Their access comes from School Success module access, not Vision school memberships, so they do not appear in Vision's user management. The shared sign-in service only checks the password.
- **Code:** `app/school-success/ui/success-sign-in.jsx`, wired in `portal.jsx`.
- **Tests:** `tests/success-sign-in.test.mjs`. A phone browser check of the whole flow was run with a fake sign-in service.

## 24 November 2026: User management and "who gave the review"
- **User management:** "Schools & teachers" is renamed **User management**.
  - Actions at the top: **Add school**, **Add teacher** and **Add school leader** (Super Admin).
  - Two tabs: **Schools & teachers** and **School leaders**.
  - **Add school leader** opens the School leaders tab with the form ready. With a single school, it is preselected.
- **Reviewer on every review:**
  - **Saved with each new review:** the reviewer's name and role (Principal / Coordinator / School management / Consultant / Super Admin), stored with the rubric in the review's existing record. There is no schema change.
  - **Older reviews:** labelled by how the reviewer signed in: "School leader" for mobile sign-ins, otherwise "School Success team".
  - **Where it shows:**
    - teacher Feedback tab ("From Meera Rao, Principal");
    - Lesson reviews list ("Feedback recorded by …");
    - review window and principal "Feedback given" ("— Meera Rao, Principal" under the remarks);
    - lesson documentation text.
- **Tests:** `tests/success-reviewer-name.test.mjs`.
