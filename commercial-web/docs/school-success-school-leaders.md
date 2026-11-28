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

## 26 November 2026: principal home without repeated lists (owner decision)
The 24 November dashboard showed the same lessons in four lists. It is replaced by one home screen and four bottom tabs. The sections "New evidence to review", "No plan yet", "Lesson plans" and "Feedback given" are gone; their content now lives in the places below.
- **This week (home):**
  - date chips: Last week, This week, This month, Dates (up to 100 days);
  - three counts: teachers who planned / all teachers, evidence files shared, and subjects awaiting review. The last count has **Review now**, which opens the first subject week still awaiting review;
  - **Your teachers:** one row per teacher with their periods, how many are reviewed, and **Open day**. Their subjects (class and subject, per week) show as chips: amber when awaiting review (or "1 of 3 reviewed"), green when every period is reviewed ("Weekly review done" or "Reviewed"). Tapping a chip opens that subject's week.
  - Teachers without a plan in the dates show a **No plan yet** flag with their last plan date, at the end of the list.
- **Day:** the day-wise review (every period of one teacher's day, each reviewed on the spot).
- **Weekly:** the weekly subject-wise review. One review for the subject's week, and each period can still be reviewed on its own below it.
- **Feedback:** every review given in the dates, each on its own: weekly reviews (once, however many periods they cover) and period reviews ("Period 2 · 23 Nov").
  - Each shows the reviewer, date and whether the teacher has noted it, with **Open week** or **Open day**.
  - Filters: teacher, subject, review type (weekly and period / weekly / period) and noted / not noted.
- The Week overview table stays on the staff screens; on the principal home the teacher card replaces it.
- No server or permission change. Lesson records now also carry each review separately (`reviews`: text, date, reviewer, weekly details, the teacher's noted date) alongside the combined `feedback`.
- Code: `lib/school-success/leader-home.js`, `app/school-success/ui/leader-app.jsx`; `ReviewScreens` takes `tab`, `initial` and `onSelect`. Tests: `tests/success-leader-dashboard.test.mjs`.

## 27 November 2026: editing reviews and yellow highlights (owner decision)
**Editing.** Every saved period review and weekly review has an **Edit** button on the review screens (Day and Weekly) for those allowed. The editor can change the Planning and Execution ratings, the remarks, the weekly focus and the highlights.
- Who may edit (checked on the server, `mayEditReview`):
  - Super Admin: every review.
  - Principal, coordinator and school management: reviews first given by their school's leadership, for their own school only.
  - A School Success consultant: only reviews they gave.
- Nothing is overwritten. An edit is a new stored version (`edits` names the first version). Screens, reports, PDFs and the teacher see the latest version, credited to who first gave it, with "Updated" and who changed it.
- The latest version has its own key, so the teacher's earlier **Noted** no longer applies and they note it again.
- An edit must start from the latest version. If someone else changed the review meanwhile, saving is refused with "changed by someone else, refresh".

**Highlights.** While reviewing (or editing), the reviewer taps a sentence of the lesson plan or written after-class reflection to mark it yellow, and taps again to remove it.
- On the weekly screen, taps go to the weekly review unless a period's own review is open.
- Highlights are saved with the review and must be on the lessons it covers.
- Teachers see each highlighted sentence quoted under the review in Feedback ("Highlighted in your plan"), and in yellow when they open the plan.
- Photos, videos and audio cannot be highlighted.

**Highlights in the lesson documentation PDF** (owner decision, 27 November 2026):
- Sentences highlighted by any reviewer (latest version of each review) are drawn on a yellow band in the lesson plan and written reflections, with the note "Highlighted lines were marked by a reviewer." The Academic Review panel does not list them.
- The option "Reviewer highlights" (Lesson records, on by default) turns this off.
- The older reduced "shareable copy" variant never shows highlights.
- **Teacher 360° export:** next to "Who can open the lesson reports", choose **With highlights** (default) or **Without highlights**. This sets the consolidated lesson reports for that export, including those opened by "Anyone with the link" without sign-in.

Code:
- `lib/school-success/highlights.js`, `lesson-reviews.js` (schemas, `mayEditReview`), `lesson-review-store.js` (`latestVersions`, `readReviewVersions`), `live.js` (`editReview`);
- the `edit` action of `/api/school-success/lesson-reviews`;
- `ui/review-screens.jsx`, `teacher-summary.jsx`, `teacher-app.jsx`.

Tests: `tests/success-review-edit.test.cjs`, `tests/success-review-highlights.test.mjs`.

## 28 November 2026: day status in the Planner (owner decision, option B)
**What the teacher sees.** On a daily plan, under the lesson date:
- Three one-tap buttons: **Present · Half day · Absent**. Present is the default and needs no tap.
- An **"Exam or holiday? Mark it"** link opens big tiles for School examination, Summer vacation, Winter vacation, Festival vacation, National holiday and Additional holiday.

**What each status asks for.**
- **Half day:** which half the teacher was in school.
- **Absent:** an optional note.
- **Examination:** the type (Unit test, Periodic test, Term exam, Half-yearly or Annual) and From–To dates.
- **Vacations:** From–To dates. A festival or national holiday can also have an optional name.
- **Additional holiday:** for any other holiday the school gives, such as a sports day or a local fair. It needs a name, plus From–To dates.

**Effect on planning.**
- On an absent, exam, holiday or vacation day the period forms are hidden, with "No lesson plan needed for this day".
- Periods already planned for that day stay saved.
- On an exam day the teacher can still add a period for a class they take.
- On a half day the teacher is reminded to plan only that half's periods.

**Principal correction.**
- The Week overview has a **"This day"** row under each teacher.
- Principals, coordinators and the School Success team click a day to mark or correct it, with an optional reason.
- The teacher's planner shows "Changed by <name, role> · you marked: …".

**Storage.**
- Append-only `success_entries` rows of kind `day-status`. There is no new table, column or migration.
- Row id: `day-status-<from>-<to>-<teacher hash>-<request id>`.
- The latest row covering a date is that day's status. Earlier rows, such as the teacher's own mark before a correction, are kept.
- Teachers save only their own day; the school and name come from the PIN session.
- Staff and leaders save only for teachers on their school's list.
- Sign-ins are never returned. Who saved a status is shown by name and role.

**Not included.** Moving already-planned periods to another date, the weekly subject plan, the teacher Home screen, the principal Home and the 360° PDFs are unchanged.

Code: `lib/school-success/day-status.js`, `app/api/school-success/day-status/route.js`, `app/school-success/ui/day-status.jsx`. Tests: `tests/success-day-status.test.mjs`.

## 28 November 2026: type of class period — regular, remedial, substitute (owner decision)
**Plan form.** Each period has a switch: **Regular · Remedial · Substitute**. Regular is chosen first and keeps the full plan.
- **Remedial** asks: what you will help with (the topic), how many children (a number or group, no names), and what you will do.
- **Substitute** asks: class, subject, topic, and what was done in the class.

**Storage.** The type is saved inside the plan text as a "Period type" heading, followed by the short answers. There is no database change, and plans without the heading are regular lessons. See `lib/school-success/period-types.js`.

**Counts.**
- A remedial class's plan counts under **Remedial support** in Teacher 360° and School 360°, not as a lesson plan.
- A substitute class is not a lesson plan and is not counted. It is never awaiting review, not part of the academic review counts, not covered by a weekly review, and not on the principal's "This week" chips.

**Labels.**
- Week overview cells show the period number and type: "P1 ✓ ahead", "P4 Remedial ✓", "P1 Substitute · not for review". Hovering gives the period, day, type, topic, submission time and review status.
- Day-wise and weekly period cards show a Remedial or Substitute tag.
- Lesson PDFs name the type on each lesson and in the index. A substitute class shows "Substitute" in the Review column.

The teacher's Home screen is unchanged. Tests: `tests/success-period-types.test.mjs`.

## 28 November 2026: lesson PDFs by planned date, Week overview planning grid, principal lesson PDF (owner decision)
**Lesson PDFs follow the planned date.**
- Applies to the Teacher 360° report's "Open lesson documentation" PDFs, Lesson records, and the principal's download.
- A lesson is included when the day it was planned for falls in the dates, not when it was submitted. A week planned on Sunday shows Monday's lessons under Monday.
- Each lesson carries its whole record: all evidence, reflections and reviews, even those added after the dates. Lessons are in teaching order: planned day, then period.
- Every lesson shows **Planned for**, **Plan submitted** and **Taught**.

**Index.**
- Grouped by planned day, with each lesson's period and when its plan was submitted.
- A **Review** column says Weekly, Period, Weekly + Period, or not reviewed.
- Each weekly review is its own row after the last lesson it covers, with its page.

**Weekly reviews in the PDF.**
- A weekly review is printed once, after the last lesson of that class and subject in the week it covers.
- Each of its other lessons shows one line: "Reviewed in the weekly review … — see page N".
- Period reviews stay with their own lesson.

**Week overview (Lesson reviews).**
- One block per teacher, one row per class and subject, one column per day.
- Each lesson shows when its plan was submitted against its planned day (✓ ahead, = same day, +n days late) and whether it is reviewed (Weekly, Reviewed or Awaiting). Tapping it opens that day.
- Columns: "This week" (planned ahead and reviewed counts) and "Weekly review" (done, or open to write it).
- Summary strip: lessons planned, planned ahead, same day, written after the lesson, lessons reviewed.

**Principal, coordinator and school management.** Profile menu → **Download lesson PDF**:
- teacher, dates (up to 100 days), and one class and subject or all;
- the same PDF, built in the browser from the school's own data.

**Data.**
- The portal read also returns lessons planned for the dates (`recordQuery`).
- Share links accept evidence of either selection, so reports exported earlier still open.
- Code: `lesson-records.js` (scope `planned`, `comparePlanned`), `lesson-report-pdf.js`, `weekly-review.js` (`planningOf`), `review-screens.jsx`, `leader-lesson-pdf.jsx`, `lesson-snapshots.js`, `read-query.js`, `report-shares/route.js`.
- Tests: `tests/success-lesson-pdf-planned.test.mjs`.

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
