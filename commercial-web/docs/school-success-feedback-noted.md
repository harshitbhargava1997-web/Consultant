# Feedback "Noted"

24 November 2026. Owner request: teachers mark feedback as read, so the principal, coordinator or consultant knows it was seen.

## Teacher
- In **Feedback**, each comment has a **👍 Noted** button. Tapping it saves the acknowledgement and shows **"✓ Noted on Tue, 24 Nov"**.
- It is saved once and cannot be undone. A second tap or a retry keeps the first date.
- If a reviewer later edits older (legacy) feedback, the edited version can be noted again.
- Only the signed-in teacher (school link and PIN) can mark their own feedback.
  - Staff, school leaders and other teachers are refused.
  - The lesson record must belong to the teacher: same school, teacher name and submitting account.
  - The feedback must exist on that record. Feedback that has changed is refused with "Refresh to see the latest".

## Principal, coordinator, consultant
- **Lesson reviews list:** "Feedback recorded · Teacher noted 24 Nov 2026". If only earlier feedback was noted, it says "Teacher noted earlier feedback".
- **Review lesson → Earlier feedback:**
  - "✓ The teacher noted this feedback on 24 Nov 2026."; or
  - "The teacher has not marked this feedback as noted yet."

## Storage
- **Where it lives:** one row per noted feedback in the existing `success_entries` table (`kind = 'feedback-noted'`). There is no schema change and no migration.
- **Row ID:** `feedback-noted-<lesson record id>-<16-hex hash of the feedback key>`. The feedback key is the rubric review ID, or `legacy:<updated_at>` for older text feedback. The primary key keeps it idempotent.
- **Payload:** record ID, feedback key, teacher name and noted time. The owner is the teacher's submitting account.
- **Reads:** notes are read with the reviews in the existing reads (`read`, `teacherLessons`, `readLessonReviews`), with the same school scope. Notes from another school are ignored.
- **Exports:** the submissions CSV export leaves out the internal note list.

## Tests
- `tests/success-feedback-noted.test.cjs`:
  - noting rubric and legacy feedback, once;
  - a repeat tap keeps the first date;
  - changed feedback (409), another teacher's lesson (403), staff and leaders (403), with nothing saved;
  - reviewers see the noted date and whether all feedback was noted;
  - other-school notes are ignored;
  - stable keys and IDs.
- `tests/success-teacher-summary.test.cjs`: feedback returns its key and noted date.
- `tests/success-lesson-review-route.test.cjs`: unchanged review behaviour with the note read.
- **Browser check** (local production build, synthetic data):
  - the teacher taps Noted and it shows "Noted on Tue, 24 Nov";
  - a principal (fake local sign-in) sees "Teacher noted 24 Nov 2026" in the list and inside the lesson.

## Rollback
- Revert the PR. Saved "Noted" rows stay in `success_entries`, unused.
- If cleanup is needed (only with approval), delete rows with `kind = 'feedback-noted'`.
