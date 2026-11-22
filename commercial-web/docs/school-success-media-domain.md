# School media on `media.schoolsuccess.in`

22 November 2026.

## Change
- Photos, writing samples, recordings, plan PDFs and reflections are served from the school's own media domain, `https://media.schoolsuccess.in`. This is the Cloudflare R2 custom domain on the existing `onelern-media` bucket, which is Active.
- The earlier public development address (`pub-…r2.dev`) is no longer used for new links.
- **Configuration:** `SUCCESS_R2_PUBLIC_BASE_URL=https://media.schoolsuccess.in` (Vercel, Production). Without it, the app keeps using the earlier address, exactly as before.
- **Earlier records:** evidence saved earlier stores full addresses on the r2.dev address. Those are the same objects in the same bucket, so wherever evidence is read they are presented under the current media address:
  - `mapLive`, including the evidence-history comparison;
  - reopening a lesson.

  Nothing stored is rewritten, and no migration is needed. As a result, reports, consolidated report links, reflection loading and the "file outside media storage" check treat old and new files identically.
- Only the exact earlier address is translated. Other websites are never rewritten.

## Keep
- Keep the r2.dev public address **enabled** in R2. PDFs and messages shared before this change contain r2.dev links.

## Verification
- `tests/success-media-domain.test.mjs`:
  - lessons stored on the earlier address map to the media domain with the same storage keys;
  - the consolidated-report check accepts them, while still refusing other storage;
  - nothing changes while no media domain is configured.
- After deploy: open a lesson photo, play a recording and export a lesson PDF with photos.

## Rollback
Remove `SUCCESS_R2_PUBLIC_BASE_URL` and redeploy (or revert). Files saved meanwhile are under the media domain address, which keeps working as long as the custom domain stays connected.
