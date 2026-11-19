# Consolidated lesson reports: one complete report, two access options

18 November 2026. This change replaces the two-version design from PR #11 (a reduced shareable copy plus a separate full-evidence link).

## Product rule
- Teacher 360° exports link each teacher, class, section and subject group to **one complete consolidated lesson report**. The report is the Teacher Lesson Documentation PDF with:
  - full lesson plans;
  - classroom activities and photos;
  - student writing samples;
  - available attachments;
  - playable audio recordings;
  - dated teacher reflections as text;
  - recorded feedback.
- Submission order and the existing report structure are unchanged. Audio and reflections stay with their lessons.
- The exporter chooses **who can open** the report and its evidence:
  - **Anyone with the link:** no Vision account needed.
  - **Require school sign-in:** Vision sign-in with School Success access to that school.
- **The choice changes nothing in the report's content.** Creating reports, previewing them, and checking or revoking links remain staff-only, with school authorisation.

## How it works
- **One access record per exported group,** stored once and encrypted in the existing bucket, at `school-success/report-shares/v1/<id>.bin`. It holds:
  - the mode (`link` or `signin`);
  - the full-evidence snapshot;
  - the school and teacher;
  - for `link`, the SHA-256 of a 256-bit secret;
  - the **exact list of storage keys of the evidence included in that report**;
  - who created it, and when.
- **The browser chooses the record's ID** (and, for `link`, the secret) **before rendering.** The report's own evidence links point at that record:

| | Report link | Each evidence link inside the PDF |
|---|---|---|
| Anyone with the link | `/school-success/shared/<id>#<secret>` | `/school-success/shared/<id>/file/<n>#<secret>` |
| Require school sign-in | `/school-success/secure/<id>` | `/school-success/secure/<id>/file/<n>` |

  - Secrets live only in URL fragments, which browsers never send to servers. They are posted in request bodies, never placed in URLs, and only their digest is stored.
- **Opening a file:** the server checks access (secret or sign-in plus school), then revocation, then that file `n` is in that report's list. It answers with a **one-hour signed storage URL**. The browser opens it directly, so photos and writing samples display and recordings play, with no Vision login in link mode.
- **Scope checks at creation:**
  - Every evidence key must be a media-bucket key (no internal objects).
  - A standard key (`schools/<school>/teachers/<teacher>/…`) must belong to the report's own school and teacher.
  - The server reads the saved lessons for the selected school and dates, then verifies every requested key against the teacher, class, section, subject and evidence submission dates. This also covers historical bucket keys that do not name a school or teacher.
  - Before creating any report, preview and export check all selected attachments. If an external or misfiled attachment needs correction, the exporter sees its lesson, date and file label. The school can migrate that attachment into the correct teacher’s media storage and retry the export.
- **Fresh links on every export.** Each export creates new IDs and secrets and re-renders the PDF, so its file links belong to the new record. A link revoked meanwhile, by anyone in any session, is never reused. Snapshots remain immutable.
- **Revocation** (Teacher 360° → "Check or revoke a sharing link", staff of that school) stops the report, **every file link in it**, and any two-minute PDF ticket already issued. It fails closed if storage cannot be checked.
- **Earlier links keep their original scope:**
  - reduced-content sharing links from PR #11 still open only the reduced copy, with no file access;
  - private `/school-success/report/<id>` links still require sign-in.
- **Preview consolidated report** creates one fresh report link for the chosen teacher, class, section, subject and period. It opens the recipient’s viewer using the selected access option, including for every linked file. The preview link can be revoked in the same way as an exported one.
- Individual, combined and per-school Teacher 360° PDFs link to each class and subject’s lesson documentation. Each listed activity, writing sample and other evidence file uses the same file link as that lesson PDF. The link follows the selected access mode and revocation. An exporter can generate a fresh PDF to update a previously downloaded report.
- Staff with School Success access can open **Lesson reviews** in the workspace, select a lesson, inspect its plan and classroom evidence, and rate planning or execution with a short note. A, B and C mean Strong practice, Developing and Needs support. Each save adds a dated entry for that specific lesson period. Earlier feedback remains available. The Academic Review section in a new lesson PDF shows feedback recorded within the export period, including both review areas when supplied.
- **Notice at export** for "Anyone with the link": *Anyone who receives or is forwarded these links can view the included student work, photos and recordings, as well as reflections and feedback, without signing in…*
- When the exporter selects classroom observations, both parent PDFs include the dates, strengths, areas for growth, agreed actions and rubric details. Observations belong to the teacher and period. Lesson-specific review feedback appears with its lesson.

## Limits
- Revocation immediately stops new openings through the report and its evidence links. A storage download address already issued remains usable for one hour from issuance. Recipients keep any files they have already downloaded.
- The media bucket itself remains publicly readable by direct object URL, as before. The report never exposes those permanent URLs.
- Providers hosting external attachments control access to their files. Preview and export identify these files until the school provides a managed copy.

## Verify file downloads against R2

Run this from `commercial-web` in an environment configured for the school media test. It uses unique synthetic objects and removes them after the run.

```sh
SCHOOL_SUCCESS_TEST_R2=1 node --test --test-name-pattern='real R2 serves' tests/success-report-share-route.test.cjs
```

The test opens the signed file addresses issued by the report route for a PNG, a writing PDF and a WAV in each mode. It checks file contents, audio range requests and the response after revocation. The report records and staff session are fixtures. A skipped result means the storage connection was unavailable.

## Schema
None. No migration and no new service.

## Rollback
- Revert the PR.
- Links created by this release stop opening after a rollback.
- Earlier links are unaffected.
