# Teacher 360 tables and duration display

23 October 2026. Supersedes the chart-view release in the School Success module of the existing Vision staging project.

The original table report layout is restored. The chart renderer, chart stylesheet, chart models and view/unit switches are removed. Previously saved chart or decimal-hour preferences are ignored; remaining saved benchmarks, calendar rules and section selections are preserved without a database migration.

Recorded time, targets, daily averages and period changes use hours plus remaining minutes: 90 minutes appears as `1 hr 30 min`, 125 as `2 hr 5 min`, and 45 as `45 min`. Display values round to the nearest minute; positive durations below half a minute show `<1 min`. Zero is `0 min`; negative comparisons retain their sign. Totals, session counts, attainment percentages and other calculations continue to use the original unrounded minute values. Daily KPI editing remains explicitly labelled in minutes.

The format applies to on-screen Teacher 360/Usage reports, individual and combined PDFs, and school PDF ZIPs. Workbook reports include readable duration columns alongside the original numeric minute columns. Preparation PDF/audio/file sequence, dated period comparison, disabled-KPI omissions and independent evidence/consultant observation selection remain unchanged.

## Verification

- 62 regression checks passed, including actual component rendering and PDF extraction.
- Verified old chart preferences cannot reactivate charts in either the screen report or PDF export.
- Verified hour/minute carries, zero and short durations, negative changes, raw-minute retention, sessions, benchmarks and numeric workbook fields.
- Verified all teachers remain present across multiple PDF pages, disabled KPIs disappear and file section order is retained.
- Next.js production build passed. No dependencies, credentials, source records or database schema were changed.
- Synthetic overview, comparison and teacher PDF pages were rendered and visually inspected.
- Signed-in production browser export clicks and physical-device interaction were not exercised in this pass.

The change applies to the School Success module in Vision. The original standalone School Success application and native Vision reports remain independent.
