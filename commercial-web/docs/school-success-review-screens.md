# Lesson review screens and Academic reviews in the PDFs (owner decision, 26 November 2026)

**Lesson reviews (staff), and the principal's and coordinator's dashboard ("Review lessons"), have three tabs.** They share one selection, so the overview opens a teacher's day or a subject's week directly.

| Tab | Choose | Shows |
|---|---|---|
| **Day-wise · period by period** | date (Previous day / Today / Next day), teacher | That day's periods in order (Period 1, 2, 3… as on the teacher's day): plan, evidence and reflection. "Review this period" opens the Planning/Execution form inside the period; saving uses the existing lesson review. Reviewed periods show their review. |
| **Weekly · subject-wise** | teacher → subject · class → week | The subject's periods day by day, earlier weekly reviews, and the weekly review form (Planning, Execution, Focus for next week). |
| **Week overview** | week, subject filter, "with a subject awaiting review" | Every roster teacher with each class · subject planned that week: periods, periods reviewed, and whether the weekly review is done. Tap a subject for its weekly review, or a teacher for the day-wise view. |

- **Phone tab names:** "Day-wise · Weekly · Overview".
- **Old lesson list:** the earlier list of lessons across a date range stays available on the Lesson reviews page ("Show the list of all lessons in a date range").

**Server** (`POST /api/school-success/weekly-reviews`):
- `week {school, teacher, week}`: unchanged.
- `overview {school, week}`: new. It reads the school's lesson records planned in the week, with reviews (`weekLessonRows` without a teacher) → `weekOverview`.
- **Weekly review matching:** a weekly review counts for a group only through the periods it covers. It never matches by class and subject alone, which another teacher can share.

**Academic reviews in the PDFs** (`lib/school-success/review-summary.js`):
- **Counting rule:** a lesson in the report dates counts as reviewed when it has an Academic Review (single-period, or a weekly review covering it), **whenever it was given**.
- **Teacher 360° PDF:**
  - School page: "Academic reviews" (teacher, lessons, reviewed, awaiting, weekly reviews).
  - Each teacher page: totals, plus each weekly review (week, class · subject, Planning, Execution, Focus for next week, reviewed by).
  - It follows the Evidence section setting. Review notes stay in lesson documentation.
- **School 360° PDF:**
  - "Academic reviews" for each school.
  - With school detail: "Academic reviews by teacher", including roster teachers with no lessons, and the week's weekly reviews.
