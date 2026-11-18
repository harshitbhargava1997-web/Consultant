# Shareable lesson-documentation links (no login to view)

18 November 2026.

**Approved change.** A recipient holding a sharing link may view that one exported lesson-documentation PDF without a portal account.

**Still requires sign-in and school authorisation:**
- generating reports;
- creating, checking and revoking sharing links;
- editing records;
- submitting feedback.

## How it works

- **Separate credential.** A sharing link is `https://<app>/school-success/shared/<share ID>#<secret>`.
  - The **share ID** is a random UUID.
  - The **secret** is 256 random bits (base64url). It lives in the URL **fragment**, which browsers never send to servers, so it does not reach request logs or referrers. The viewer page posts it to the server in a request body.
  - The server keeps only a SHA-256 digest of the secret, compared in constant time.
  - The snapshot ID alone never grants access; existing `/school-success/report/<snapshot ID>` links remain private and still require sign-in plus school access.
- **Bound to one immutable PDF.** The share record `{snapshotId, school, secretSha256, createdBy, createdAt}` is stored once (`If-None-Match: *`) at `school-success/report-shares/v1/<share ID>.bin`.
  - It is encrypted with AES-256-GCM. The key is derived with HKDF from the existing server secret, with its own info string `report-share-aes-v1`, and the record is bound to the share ID and its purpose.
  - It points to one content-addressed, encrypted snapshot that is never overwritten.
- **Opening (no account):**
  1. `POST /api/school-success/report-shares/<id>` with the secret.
  2. The server checks the share, then revocation, then decrypts the snapshot.
  3. It issues a two-minute ticket bound to that share and snapshot.
  4. `GET …?ticket=` serves `application/pdf` inline, with the exact-scope filename and `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`.
- **Revocation.** A signed-in administrator whose grant covers the share's stored school pastes the link into **Check or revoke a sharing link** in Teacher 360°.
  - Only the share ID is sent; the secret stays on the device.
  - Revoking writes an immutable encrypted marker `<share ID>.revoked`, never overwritten.
  - The marker is checked on every open **and** on every PDF serve, so tickets issued before revocation stop working.
  - The check fails closed: any storage answer other than "absent" or "present" refuses access with a 503.
- **What recipients see.** Altered, incomplete or cross-snapshot links say "This sharing link is not valid" or "incomplete". A revoked link says "This sharing link has been revoked by the school".
- **Export.** In Teacher 360° the administrator chooses **Shareable links** (default) or **Private links**, and the notice is shown next to the export buttons:
  > Anyone who holds or is forwarded a shareable link can view that lesson documentation PDF, without a Vision account. Each link opens only the one PDF saved for that teacher, class, section, subject and period. You can revoke a link below: revocation stops future opening through the link, but it cannot recall copies already downloaded.
  - The usage PDFs say: "Anyone with a link can open that PDF without signing in. The school can revoke a link; copies already downloaded cannot be recalled."
  - Individual, combined and per-school ZIP PDFs get one sharing link per exact teacher, class, section, subject and period group. Chronology, formatting and the agreed content are unchanged.
  - A share is created and confirmed in storage before the report is produced. If any group's snapshot or share fails after retries, **no report is produced**, so there are still no broken links.
  - Private exports keep the earlier sign-in links and wording.

## Schema

**No database change is required.** Shares and revocation markers are encrypted objects in the existing bucket, like snapshots.

There is no list of all shares; revocation works from a link, for example one taken from the usage PDF. If a searchable list or audit table is wanted later, this table could be added:

```sql
create table success_report_shares (
  share_id uuid primary key,
  snapshot_id uuid not null,
  school text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked_by text,
  revoked_at timestamptz
);
```

It would be append-only, with no secret digest stored, kept alongside the R2 records. **It is not proposed for this release, and no migration was prepared or applied.**

## Verification

- `node --test tests/*.test.mjs tests/*.test.cjs`: all pass (see the PR). `npm run build` passes.
- `tests/success-report-share-route.test.cjs` runs the real routes, crypto and storage code with an in-memory R2 and covers:
  - opening signed out;
  - ciphertext-only storage;
  - who may create shares;
  - altered, malformed and missing credentials;
  - forged, expired and private tickets;
  - cross-snapshot attempts;
  - revocation (authorisation, enforcement on open and on already-issued tickets, idempotence, marker never rewritten);
  - failing closed;
  - private links unchanged.
- `tests/success-share-viewer.test.mjs` covers the viewer, link parsing, record binding and export error semantics. `tests/success-lesson-links.test.mjs` covers the usage-PDF wording and link targets.
- **Simulated end to end** in Chromium, on desktop and with iPhone 13 emulation (not Safari, not a physical device). It used the real Teacher 360° workspace and real routes behind request routing, with synthetic data and an in-memory R2:
  - **Exports:** individual 2 links, combined 3, ZIP 3. Every link was a share link, with none of the private links.
  - **Opening:** each link opened its exact PDF inline in a fresh signed-out browser, on desktop and phone emulation.
  - **Refusals:**
    - altered secret → not valid;
    - altered ID → not valid;
    - missing secret → incomplete;
    - link 1's ID with link 0's secret → not valid;
    - the private route for the same PDF, signed out → sign-in.
  - **Revocation from the workspace:** confirm dialog → "Revoked". Link 0 was refused afterwards while link 1 still opened, and another school's administrator was refused.
  - **Private export:** sign-in links and wording, redirected to sign-in when signed out.
- **Real bucket:** `scripts/r2-snapshot-selfcheck.mjs --write-synthetic --share --pdf-bytes=1500000 --next-route-context`. It ran with Production settings, through Next's patched fetch, in a build designed to always fail (`dpl_7xScqdJLiDJ8K8FLsWxTSpBrdVuE`) — **PASS**:
  - 1.5 MB synthetic snapshot stored and read back byte-identical; a duplicate write was refused with 412;
  - share created and read back, with the secret digest matching;
  - not revoked → revoked; a second revoke was refused by `If-None-Match` and reported as already revoked;
  - the public bucket URLs of the snapshot, the share record and the marker served ciphertext only.
  The run wrote one synthetic snapshot, one share record and one marker (synthetic school "SYNTHETIC R2 SELF-CHECK"); no teacher records were touched.
- **Not verified:** a live signed-in export on production, Safari/WebKit, physical phones, and PDF viewers in messaging apps.

## Rollback

- Revert the PR; there are no schema or settings changes.
- Sharing links in reports exported while it was live stop opening after a rollback, because the share routes and page disappear. Their share records stay as inert ciphertext.
- Private links are unaffected.
