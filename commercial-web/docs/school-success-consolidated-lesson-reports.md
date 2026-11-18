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
  - Evidence hosted on other websites keeps its original link.
- **Fresh links on every export.** Each export creates new IDs and secrets and re-renders the PDF, so its file links belong to the new record. A link revoked meanwhile, by anyone in any session, is never reused. Snapshots remain immutable.
- **Revocation** (Teacher 360° → "Check or revoke a sharing link", staff of that school) stops the report, **every file link in it**, and any two-minute PDF ticket already issued. It fails closed if storage cannot be checked.
- **Earlier links keep their original scope:**
  - reduced-content sharing links from PR #11 still open only the reduced copy, with no file access;
  - private `/school-success/report/<id>` links still require sign-in.
- **Preview consolidated report** (both modes): renders, with the same generator, photos and size fallback, the exact report a recipient of the selected class and subject gets, and opens it in a new tab. Nothing is uploaded. File links in the preview open the files directly for the signed-in exporter.
- **Parent Teacher 360° PDFs** (individual, combined, per-school ZIP): one "Open lesson documentation" link per group, in the selected mode. Evidence file tables are listed **without** direct links, so no parent link bypasses the chosen access; files open through the lesson report.
- **Notice at export** for "Anyone with the link": *Anyone who receives or is forwarded these links can view the included student work, photos and recordings, as well as reflections and feedback, without signing in…*
- **Consultant observations** (not part of lesson reports): "Anyone with the link" parent PDFs show counts and dates only; "Require school sign-in" PDFs show the details.

## Limits
- Anyone who has a link (or a one-hour file URL) can open it until it is revoked or expires. Downloaded copies cannot be recalled.
- The media bucket itself remains publicly readable by direct object URL, as before. The report never exposes those permanent URLs.
- Evidence hosted outside the media bucket is linked as it is.

## Schema
None. No migration and no new service.

## Rollback
- Revert the PR.
- Links created by this release stop opening after a rollback.
- Earlier links are unaffected.
