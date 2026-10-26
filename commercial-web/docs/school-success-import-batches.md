# School Success large workbook imports

The old importer sent all selected workbooks as one JSON request. Excel compression allowed a valid selection below the 10 MB file limit to expand above Vercel's 4.5 MB request limit. Vercel returned plain-text HTTP 413 `Request Entity Too Large / FUNCTION_PAYLOAD_TOO_LARGE`; attempting `response.json()` displayed an unexpected-token error.

The importer now checks and saves sequential batches bounded by 1,000,000 UTF-8 JSON bytes and 500 rows, with row/batch progress. Every original row is submitted during saving, preserving database validation, deduplication and enrichment of existing sessions. Preview-only duplicate counting spans batches using the existing database's session identity rules. Source filename and Excel row numbers remain available for corrections. A failed save explains partial progress and allows retrying the same files; previously committed sessions are skipped by the existing RPC.

The existing 10 MB file-selection and 20,000-row limits remain. No credentials, permissions, database functions, records or storage settings are changed by this release. No standalone School Success deployment is modified.

Verification:

- Reproduced the exact live failure using an unauthenticated 4,800,012-byte diagnostic request: HTTP 413 with the screenshot's plain-text error. The same endpoint returns HTTP 401 for a small unauthenticated request.
- Seven new tests include a real compressed 6,500-row workbook whose expanded JSON exceeds 4.5 MB, UTF-8/JSON byte bounds, cross-batch preview duplicates, detail enrichment, correction locations, readable non-JSON errors and interrupted-save retries. Five existing import-validation tests also pass.
- Production Next.js build passed.
- Existing database RPC verified inside a rolled-back transaction: preview writes nothing, duplicates across calls are skipped, missing book/grade/subject details are enriched, rejected rows retain file and Excel row, and repeated imports insert no duplicates. Test records and import-run entries were rolled back.
- The user's actual workbooks and signed-in browser import are not available in this session; the user must refresh and select those files again after deployment.
