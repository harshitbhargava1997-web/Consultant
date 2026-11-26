# Weekly review (owner decision, 26 November 2026)

**Lesson reviews has two modes:**
- **Single lessons (day / period):** unchanged.
- **Weekly review:** new.

The principal's and coordinator's dashboard has a **Weekly review** button that opens the same screen.

## Who
- School Success Super Admin and consultants, for their assigned schools.
- Principals and coordinators (school leaders), for their own school.
- Teachers cannot open it.

## What a weekly review covers
- **Scope:** one teacher, one class (with section) and subject, one week (Monday–Sunday).
- **Choosing the week:** the reviewer picks the teacher and the week (This week, Last week, Earlier/Later, or any date). The teacher's lessons planned in that week are grouped by class and subject.
- **Day by day, period by period, each period shows:**
  - its number on that day ("Period 2");
  - the plan under the plan form's headings;
  - classroom activities, written work, remedial support, portfolio, and the after-class reflection.
- **Single periods:** "Review this period" opens the existing lesson review, so day-wise and period-wise reviews stay available alongside the weekly one.

## The review itself
- Planning and Execution ratings (Strong practice / Developing / Needs support), each with a short note. At least one is needed.
- **Focus for next week** (required).

## Storage
No database change.
- The review is saved as one immutable `success_entries` row (kind `lesson-review`) for **every period it covers**, with id `lesson-review-<record>-weekly-<request>`.
- All the rows share one key: `weekly-<request>`.
- The covered periods are read on the server at save time; the browser never supplies them.
- A retry of the same save changes nothing. Further weekly reviews can be added and are kept.

## Where it shows
- **Lesson records, Lesson review dialog and lesson documentation PDFs:** every covered period shows the weekly review as its Academic Review.
- **"Awaiting review":** covered periods are no longer awaiting review. This applies to School 360°, Lesson reviews and the principal's "Lessons reviewed".
- **Teacher's Feedback tab:** the review appears **once**, as "Weekly review · 23 Nov – 29 Nov 2026", with the full text (Planning, Execution, Focus for next week). A single "Noted" covers it on every period.
- **Principal's "Feedback given":** listed once.

## Code
- `lib/school-success/lesson-review-store.js`: `appendWeeklyReview`, and weekly rows in `readRubricRows`.
- `lib/school-success/lesson-reviews.js`: `weeklyReview`, `weeklyRequest`, `weeklyText` and `weekLabel`.
- `lib/school-success/weekly-review.js`: `weekGroups`.
- `lib/school-success/live.js`: `weekLessonRows` and `saveWeeklyReview`.
- `app/api/school-success/weekly-reviews/route.js`.
- `app/school-success/ui/weekly-review.jsx`.
