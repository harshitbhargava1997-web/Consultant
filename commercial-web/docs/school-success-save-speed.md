# Faster saving of lesson plans and classroom evidence (25 November 2026)

The owner reported that saving a lesson plan or classroom evidence took 15–30 seconds on phones.

## What we measured
Measurements used Chromium on this machine, with the CPU slowed 4× and 6× to stand in for mid-range and budget Android phones. No real phone was used.

| Step | Before | After |
|---|---|---|
| Lesson-plan PDF, per class period (built on the phone) | 3.5 s (4×) to 5.5 s (6×) | 0.2–0.3 s |
| Camera photo sent to storage | the original size, e.g. 6.4 MB | about 0.7 MB (resized when chosen, about 0.5 s) |

- **Lesson plans:** a weekly plan builds one PDF per period, one day after another. At these speeds, the PDF step alone could add 15–30 seconds before anything was sent.
- **Photos:** at a typical school mobile upload speed of 2 Mbit/s, a 6.4 MB photo takes about 26 seconds to send. A 0.7 MB copy takes about 3 seconds.

## Changes
1. **Lesson-plan PDF pages are JPEG images instead of PNG** (`lib/school-success/preparation-pdf.js`).
   - The file size is the same (about 160–180 KB per page).
   - Text is equally sharp when rendered and compared side by side.
2. **Large photos are resized before upload** (`lib/school-success/shrink-photo.js`).
   - Which files: JPEG, PNG and WebP over 1 MB.
   - How: the longest side becomes at most 2048 px, saved as JPEG at 85% quality.
   - When: as soon as the photo is chosen, so the work is done while the teacher writes.
   - Unchanged: videos, PDFs, audio and small photos. If resizing fails, or would not make the file smaller, the original is sent.
   - Privacy: resizing also drops hidden camera details such as location.
   - Retries: a retry reuses the same resized copy, so the size checked by the server always matches.
3. **Sign-in and storage settings are read in parallel** on each save request (`app/api/school-success/evidence/route.js`). The sign-in result is still checked first.
4. **One timing line per save request** in the server logs.
   - Format: `school-success timing {"route":"evidence","action":"prepare","status":200,"authMs":…,"totalMs":…}`.
   - It holds no teacher, school, lesson or file details.
   - Use the logs to check server time with real teachers.

## Not changed
- The lesson and evidence records.
- Who can save.
- Server checks.
- Storage layout.
- Existing files.

## Lesson plans no longer make a PDF (owner decision, 25 November 2026)
**How plans are saved now:** a saved plan is stored as text in the lesson record. Saving no longer builds or uploads a PDF: it is just two quick server requests per day.

**Where plans are read:** every screen and report reads the plan from the lesson record.
- **Lesson documentation** (the "Open lesson documentation" report): already showed the plan as text, and already hid the generated PDF when text existed.
- **Lesson review:** shows the plan text.
- **Teacher's "Read plan":** shows the plan text.
- **Principal's "This week":** works from the saved lesson details.

**How plans are counted** (`lib/school-success/lesson-plan-items.js`, `evidenceFiles(row)`):
- A saved lesson plan that has **no plan file** counts as one **lesson plan** item.
- A plan that already has a plan file is left exactly as it was. This covers the PDF that older plans were saved with, and any uploaded plan photo or document. So **older plans count exactly as before**, and no plan counts twice.

**Where the counts appear:**
- **Teacher 360° "Lesson plans submitted":** counts these items.
  - On screen, new plans are listed without a file link, marked "saved lesson plan (in lesson documentation)".
  - The Teacher 360° PDF already left lesson-plan links out (they belong in lesson documentation).
- **School 360° "Lesson plans"** (renamed from "Lesson preparation PDFs"):
  - The category count includes saved plans.
  - The filter shows lesson-plan rows, with the plan text, as before.
  - The School PDF lists new plans as "Saved plan (text)" and keeps "Open file" links for older PDFs and uploaded plan files.
- **School 360° "Unique uploaded files" and "Teachers with uploads":** count real files only. A text plan is not an uploaded file. Older plans still count their PDFs there, as before.

**Checked with test data:**
- Older lessons: every Teacher 360° and School 360° number is identical before and after. All earlier report tests pass unchanged.
- New plans without a PDF: they count once each. Before this change they would have been missed.

**Existing PDFs** are not deleted or changed.

## Lesson records and lesson documentation use the Teacher evidence categories (owner request, 25 November 2026)
**Before:** Lesson records (Teacher 360° and School 360°) and the lesson documentation PDF used older headings:
- "Audio recordings" (preparation voice notes from the previous portal) was shown as a main category.
- Remedial support and student portfolio were hidden inside "Further classroom evidence".
- After-class reflections were called "Teacher reflections".

**Now:** the summary tiles, section list, lesson sections, school overview and lesson index all follow Teacher 360° "Teacher evidence", in the same order:
1. Lesson plans submitted.
2. Classroom activities.
3. Student written work.
4. Remedial support.
5. After-class reflections.
6. Student portfolio / assessment.
7. Then the Academic Review.

**Previous-portal items come last:**
- **"Audio recordings (previous portal)":** its summary tile shows only when there are any.
- **"Other evidence (previous portal)":** phonics evidence, event pictures and other files.

**Counts:** each category in Lesson records is checked against Teacher 360° on test data (`tests/success-lesson-categories.test.mjs`).

**Report access:** every file is still included once.

**Saved settings:** a saved choice to hide "Further classroom evidence" still hides remedial support and portfolio, unless they have their own choice.
