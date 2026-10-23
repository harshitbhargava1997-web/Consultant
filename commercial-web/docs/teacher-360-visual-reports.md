# Teacher 360 report views and time units

23 October 2026. Applies to the School Success module in the existing Vision staging project.

## Using the report

Open School Success, then Teacher 360 or Usage & reports. The Report format control offers Tables, Charts and Both. Hours is the default; Minutes remains available. The selected view is used for the current report, individual teacher PDFs, combined PDFs and school PDF ZIPs. Save report defaults stores the choices with the existing workspace report settings.

Hours are decimal: 90 minutes becomes 1.5 hours. The workbook uses the selected time unit with explicit column headings; daily KPI configuration stays explicitly labelled in minutes. Stored durations, import deduplication, working-day rules, session counts and attainment percentages are unchanged.

## Charts and boundaries

- Resource minutes are converted into hours only for presentation. Lesson preparation, Book, Additional Materials and E-book remain separate categories.
- Recorded-versus-target bars use a common zero baseline and show exact values alongside bars. Targets are absent when quantitative KPIs are disabled or the target is zero. Hidden resource sections are omitted.
- Book/chapter charts retain the grade, subject and session count. Session counts are not plotted against a time axis.
- Previous and current period bars retain the date ranges beneath their labels. School comparisons and teacher comparisons remain on the separate comparison section/pages.
- All selected teachers, including zero-use teachers, remain in consolidated reports. Long chart lists paginate rather than dropping teachers.
- Evidence KPI counts, chronological file lists, saved preparation PDFs, recordings and observations retain their existing behaviour. The PDF attachment sequence remains preparation PDFs, audio, activity, writing, phonics, then remaining selected evidence.
- Original standalone School Success, native Vision reports, teacher forms, authentication, school links, CRM and storage configuration are outside this change.

## Verification

- 63 regression checks passed across reports, charts, actual component rendering, PDF text, imports, public-teacher domain rules, module access, audio and evidence sequence.
- All six display/unit combinations were exercised against actual PDF generation and actual report component rendering.
- Verified legacy saved settings load without a migration and new settings survive schema validation/serialization.
- Verified hours conversion, session counts, percentages, zero activity, disabled targets, hidden modules, dated comparison and multi-page teacher preservation.
- Next.js production build passed. No dependency was added.
- Synthetic school overview, period comparison and individual teacher PDF pages were rendered to PNG and visually checked for legibility and layout.
- A signed-in production browser download and physical mobile-device interaction were not exercised in this pass. Local rendering and generated PDFs do not substitute for those checks.
- No customer records, saved report settings or credentials were changed during verification.
