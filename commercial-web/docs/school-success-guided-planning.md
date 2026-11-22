# Teacher lesson planning and home summary

22 November 2026. Replaces the step-by-step planning wizard from PR #16.

## Teacher journey
1. **Choose a language:** English or हिन्दी. The device remembers the choice, and it can be changed at any time from the top of the page. Changing language never translates or replaces a teacher's answers.
2. **Home screen:**
   - **This month:** lessons planned, how many have classroom evidence, and feedback received.
   - **Submit lesson plan** and **Add evidence**.
   - **Lessons needing evidence:** lessons planned up to today that have no classroom evidence yet. One tap opens the lesson to add evidence.
   - **Feedback received:** the newest academic-review comments on the teacher's own lessons. Items are marked "New" on the first visit after they arrive.
3. **Submit lesson plan** (one page, no steps). At the top, choose the plan type:

| | Daily plan (next day) | Weekly subject plan |
|---|---|---|
| Fixed at the top | One date (defaults to the next school day) | Class, section and subject |
| Each block | Period 1, 2, 3 … (each with its own class, section and subject) | Day 1, 2, 3 … (each with its own date, auto-filled with the next school days, Sundays skipped) |
| Maximum | 10 periods | 6 days |

   - Every block shows all planning fields at once, in this order:
     - lesson number and topic;
     - learning outcome;
     - teaching-learning materials;
     - teacher activities;
     - student activity and participation;
     - classwork and practice;
     - check learning and next steps;
     - homework (optional).
   - **The sentence starter is faded placeholder text inside each box.** There are no starter buttons, examples, quick buttons or thinking levels.
   - A completed block collapses to a one-line summary; tap it to reopen.
   - **One "Submit lesson plan" button** sits in a bar fixed to the bottom of the screen. If anything is missing, the page opens and highlights the first incomplete field.
   - The plan type is remembered on the device. Switching type keeps the answers already typed.
4. **Add evidence:**
   - The teacher taps a lesson in "Lessons needing evidence".
   - Searching by planned date remains available as a fallback ("Can't find your lesson?").
   - The after-class reflection also uses faded starters instead of buttons.

## How plans are saved (no schema change)
- **A daily plan** is one submission: one date, several periods. This is exactly as before.
- **A weekly subject plan** is saved as **one submission per day**. Each day has one period with the shared class, section and subject, and its own planned date.
  - Every saved lesson is therefore the same kind of record as before. Teacher 360°, School 360°, the lesson PDFs, evidence and reviews are unchanged.
- **Retries never create duplicates.** Each day has a stable submission ID kept in the draft.
  - If saving stops part-way (for example, after day 2 of 5), the saved days are marked "Saved" and locked.
  - Submitting again continues with the remaining days.
- **Drafts** stay in `sessionStorage` for the actor, school and teacher, as before. Drafts from the earlier one-date form are restored as a daily plan.
- The existing pipeline is used for every submission: preparation PDF, direct upload, then prepare/commit.

## Home summary data: `POST /api/school-success/evidence {action:'myLessons'}`
- Returns the teacher's lessons with a planned date from 60 days ago to 30 days ahead, each with:
  - its evidence status;
  - a reopen link (the same sealed one-year `lesson-resume` grant as `findLessons`).
- Also returns the review feedback recorded on exactly those lesson records:
  - legacy `portal_evidence_reviews`;
  - rubric reviews.
- **Scope is the same as `findLessons`:** school, teacher and the submitting account.
  - For teachers and school links, these values come from the signed-in identity. Request values are ignored.
  - Administrators pass a school and teacher, and their school grant is checked.
- The gateway (`teacherLessons`) filters rows again after the database read. Feedback is read only for record IDs of those rows, restricted to the same school.

### Access change for review
**Before this change, recorded feedback was shown only to School Success administrators.** With this change, a teacher sees the feedback recorded on their own lessons in "Feedback received". Two points to confirm:
- A school link (no sign-in) shows feedback for the teacher selected on that link. Anyone holding a school's link can therefore read that school's teachers' feedback.
- The reopened lesson screen (`resume`) is unchanged and still shows feedback only to administrators.

## Verification
- Unit and route tests:
  - plan-to-submission mapping (daily: one submission; weekly: one per day with its own date);
  - school-day dates;
  - field completeness;
  - maximum lengths in English and Hindi;
  - summary scoping (other teachers, other accounts, out-of-window rows and reviews on other records are excluded; a teacher cannot widen the scope; an administrator outside the school is refused).
- Browser checks against the production build, with synthetic data (fictional school and teacher) and mocked API responses:
  - language choice and home summary on iPhone 13 emulation;
  - a daily plan with two periods of different classes and subjects, including validation and saving;
  - a weekly Hindi plan on desktop, saved as three submissions with consecutive dates;
  - the "Lessons needing evidence" list and opening a lesson;
  - the empty state;
  - no JavaScript errors and no horizontal overflow.
- **Not yet verified:**
  - a live signed-in submission;
  - physical iPhone Safari and Android devices.

## Release
- Deploy only to `vision-school-commercial-staging` from `commercial-staging`.
- No database migration or environment-variable change is required.
- Rollback: revert the PR. Saved lessons are ordinary records and remain valid.
