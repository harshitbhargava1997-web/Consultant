# School 360° in School Success

## Entry and navigation

School Success → School 360° opens the complete permitted school portfolio. The initial screen contains quantitative tables and counts only. It includes schools with no teachers or usage, and zero-usage teachers remain in denominators.

Open a school for consolidated usage, the teacher breakdown and an evidence-flow tab. Open a teacher from either school tab to use the existing Teacher 360° component with the exact school-teacher key. The reporting dates carry through all levels. Back buttons retain the portfolio sort/search and school evidence filters, and restore the prior scroll position. The parent retains view state while using the module.

Entering from the sidebar clears the global school selector to show the complete portfolio. Changing the global school selector while in School 360° returns to its portfolio table with that selection applied.

## Calculations and scope

- Reuses `buildProfiles` and saved Teacher 360° settings, calendars and holidays. Book, E-book, Additional Materials and lesson preparation stay separate; durations use hours and remaining minutes.
- Teacher totals count school-teacher profiles; matching names across schools are never merged. Participation means positive recorded usage. School targets are sums of the teacher targets, not averages of teacher percentages.
- Prepared lessons and lessons with classroom evidence are distinct record identities. Multiple updates remain separate dated feed events, without inflating the lesson count. Duplicate URLs are counted once per teacher within a school.
- Review coverage uses the latest recorded lesson feedback. Submission counts are not quality ratings.
- Archived schools and teachers are excluded by default, with explicit historical inclusion.
- Uses the existing authorized School Success data response. No new API, database migration, credentials, storage settings or permission expansion. Public teacher forms do not receive the School 360° navigation.

## Evidence and downloads

School evidence can be filtered by teacher, category, review status, search and chronological order, with 20 entries per page. File links reuse their existing URLs and existing review actions. Files are not preloaded by the new screen.

Portfolio PDF/CSV exports contain quantitative summaries only. School PDFs add the teacher table. Teacher evidence links are selectable in school PDFs; consultant observations have an independent opt-in. Evidence links follow preparation, audio, activities, writing, phonics, portfolios, events and other files. Disabled report sections and benchmark columns are omitted. Existing Teacher 360° combined PDFs, school ZIPs and workbook exports remain available in the teacher drilldown.

## Verification

- Twelve new tests cover school and teacher identities, zero usage, archives, calendars, duplicate updates, filters, quantitative-only portfolio rendering, actual school evidence rendering, exact Teacher 360° selection, PDF scope/order and disabled sections.
- The full 89-test suite passed. The affected PDF tests were rerun after tightening the observation-kind filter.
- Production Next.js build passed; the final release build is also verified by Vercel.
- Sample PDFs were rendered and visually inspected, including 28 long school names and ordered school evidence. Tables were split for readable durations; headings stay with their tables.
- Browser interaction and mobile-device testing remain unverified: the available Playwright package had no browser binary, and its browser download returned an invalid archive. Temporary local QA routes were removed before release. No authenticated session or real school records were modified for testing.
