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
