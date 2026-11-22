# Teacher PIN sign-in for School Success school links

22 November 2026. Owner-approved:
- teachers sign in with their own PIN;
- the shared starting PIN is `123456`, set by the administrator;
- school management needs the teacher's PIN to submit on their behalf;
- sessions last 30 days.

## Teacher flow
1. Open the school link and choose a language (English / हिन्दी).
2. Choose your name from the school's teacher list.
3. Enter your 6-digit PIN.
   - **First time, or after a reset:** enter the starting PIN (`123456`, or the school's own starting PIN). Then **create your own PIN** and type it twice. The starting PIN never opens the portal by itself.
   - The new PIN is refused if it is `123456`, the school's starting PIN, all one digit (`000000`) or a simple sequence (`234567`, `987654`).
4. The teacher portal opens:
   - this month's lessons, evidence and feedback;
   - Submit lesson plan;
   - Add evidence and the pending-evidence list;
   - Feedback received.
5. In the portal:
   - **Change PIN** needs the current PIN. It signs out the teacher's other phones and browsers.
   - **Log out** returns to the name list.

The teacher stays signed in on that browser for **30 days**, or until they log out or their PIN is changed or reset.

## Administrator (School Success portal → Teacher portal view → "Teacher PINs")
- **Status for each teacher of the school:** *PIN created*, *Using starting PIN* or *Locked (wrong PINs)*. The PIN itself is never shown or stored readably.
- **Reset PIN (forgot PIN):** the teacher returns to the starting PIN and must create a new one. Every device where they are signed in is signed out.
- **Starting PIN for the school:** 6 digits, default `123456`. It applies to teachers who have not created their own PIN.
- Only School Success administrators whose access covers that school can view or reset.
- Onboarding uses the existing *Schools & teachers* directory. Any active teacher listed for the school can sign in with the starting PIN.

## Security
- **Hashing:** PINs are stored only as salted scrypt hashes in `success_config`:
  - `teacherPin:<sha256(school\0teacher)>` for each teacher;
  - `teacherPinDefault:<sha256(school)>` for a custom starting PIN.
  - Writes use the row `revision` as compare-and-set, so concurrent attempts or resets cannot overwrite each other.
- **Lockout:** 5 wrong PINs lock that teacher for 15 minutes. The right PIN also waits until the lock ends; an administrator reset unlocks at once.
- **Sessions:**
  - After a correct PIN, the server issues a signed session (HMAC with `SCHOOL_SUCCESS_SIGNING_KEY`) bound to the school link, school, teacher and **PIN version**.
  - Every request on a school link that names a teacher must carry a valid session for that teacher, with the current PIN version. Otherwise it returns `401`.
  - Changing or resetting a PIN increases the version, which ends every earlier session.
  - Rotating the signing key signs everyone out.
- **First-time change ticket:** the starting PIN yields only a 10-minute, single-purpose ticket for creating a PIN. It is bound to the PIN version, so it cannot be reused after a PIN is created.
- **What doesn't need a session:** the school-link landing without a teacher (the name list) needs only the link, as before.
- **Unchanged:**
  - a teacher's saved work stays linked to *school link + teacher name* (the same submitter identity), so existing lessons, evidence and feedback appear after sign-in;
  - signed-in School Success administrators are not affected.

## Known limits (accepted)
- With one shared starting PIN, someone holding the school link could choose a teacher who **has not yet created a PIN** and claim it. Mitigations:
  - the administrator list shows who is still on the starting PIN;
  - reset is instant;
  - a school-specific starting PIN can be set.
- School management can no longer submit on a teacher's behalf without that teacher's PIN. Administrators can still act for any teacher from the signed-in portal.
- A teacher removed from the directory can no longer sign in. Their PIN record stays, but it is unused.

## Schema
No migration. Records use the existing `success_config` table, which is already restricted to the service role.

## Verification
- `tests/success-teacher-pin.test.cjs` runs the real PIN module, school-link identity, signing, the teacher PIN route and the admin PIN route against an in-memory database. It covers:
  - PIN rules and hashing;
  - first sign-in with a forced PIN creation;
  - the starting PIN being refused afterwards;
  - sessions limited to their own teacher and link;
  - forged and cross-link tokens refused;
  - lockout after 5 wrong PINs and unlock after 15 minutes;
  - change and reset signing out earlier sessions;
  - change-ticket misuse;
  - administrator status, reset and starting PIN, scoped to the administrator's schools.
- Browser check of the production build (iPhone 13 emulation, synthetic school, mocked API):
  - language, name, wrong PIN, starting PIN, create PIN (easy PIN refused), portal, change PIN, reload keeps the session, log out;
  - no page errors or horizontal overflow.
- The admin panel was checked on its own, because the local build has no Vision sign-in.
- **Not verified:** live sign-in against the real database, and physical phones.

## Rollback
- Revert the PR. School links then open teachers without a PIN again, as before.
- PIN records stay, unused, in `success_config`.
