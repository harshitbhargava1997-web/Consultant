# Teacher 360° report options and teacher evidence types

22 November 2026. Owner request: add a Lesson preparation & documentation tick box, make Book usage optional, and align the Teacher evidence KPI with what teachers submit in the new portal.

## Report sections (Teacher 360° → KPI parameters)
New tick boxes; both are **on by default**, so existing reports are unchanged until someone unticks them:
- **Book usage**: book / chapter breakdown. When unticked, the Book usage target row and the Book / chapter breakdown section leave the PDF, the cover and the comparison.
- **Lesson preparation & documentation**: lesson plans, evidence, reflections and lesson report links. When unticked:
  - the *Lesson documentation* section and its lesson report links leave the PDF;
  - evidence tables list counts only, with no file links;
  - downloads skip preparing lesson-report links.
- **Lesson preparation** (Lesson Plan resource usage) and the other sections are unchanged.

## Teacher evidence types (counts and targets per review period)
| # | Type | Counts these files | Default target |
|---|------|--------------------|----------------|
| 1 | Lesson plans submitted | lesson plan uploads / generated plan PDFs | 4 |
| 2 | Classroom activities | activity photos and videos | 3 |
| 3 | Student written work | writing samples | 3 |
| 4 | Remedial support | remedial support evidence | 1 |
| 5 | After-class reflections | written or recorded reflections | 3 |
| 6 | Student portfolio / assessment | portfolio and assessment evidence | 1 |

- **Removed as KPI types:** "LP / Audio notes", "Phonics evidence" and "Portfolio artifacts".
- **Nothing is deleted.** Phonics files, audio notes and event pictures from the previous portal still appear in the report's file lists, labelled *(previous portal)*.
- **Saved settings:** shared report defaults saved with the old five evidence targets fall back to the new six defaults. Saved six-value targets are kept. CSV/XLSX column names are unchanged.

## Tests
- `tests/success-report-pdf.test.mjs`: Book unticked; documentation unticked (counts kept, links removed).
- `tests/success-reports.test.mjs`: new defaults; old five-target settings migrate.
- Existing report, lesson-link and evidence-feed tests are updated to the new types.

## Rollback
Revert the PR, then re-save the shared report defaults in Teacher 360°: the older code expects five evidence targets, not six.
