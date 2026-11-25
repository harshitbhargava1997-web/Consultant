# Short school links (25 November 2026, owner decision)

**Link format:** each school's teacher link is now `schoolsuccess.in/<school-name>-<code>`, for example
`schoolsuccess.in/sunrise-public-school-4821`.

## What the owner sees
- **Where:** User management → **Get school link** (and the School management sharing links list) now shows the short link.
- **How it is made:** the link is created the first time it is asked for. After that, the same school always gets the same link.
- **Name part:** the school name in lowercase, with words joined by `-`. It is at most 34 characters, cut at a word.
  - Names with no Latin letters become `school-<code>`.
- **Code:** a 4-digit number (1000–9999), chosen at random by the system. Every school gets its own code, so no two schools share one.
- **Old links still work:** the full link (`/school-success?school=…&access=…&view=teacher`) keeps working, so links already shared are not affected.

## How it works
- **Storage:** the `success_config` settings table holds three entries per school:
  - `shortLink:<id>` → `{access, school, createdAt}`
  - `shortLinkFor:<access>` → `{id}`
  - `shortCode:<code>` → `{id}`
  - Entries are added without overwriting (insert-only). No database migration is needed.
- **Opening a link:** `app/[code]/page.jsx` looks up the ID on the server.
  - A known ID renders the normal School Success page with that school link.
  - Any other address at this level shows "not found", as before.
  - The page is not cached and asks search engines not to list it.
- **In the browser:** the address bar stays short. `lib/school-success/link-params.js` gives the rest of the page the school link as if it were in the address. That covers API requests, PIN sign-in, the teacher session and saved "continue this lesson" links.
- **Access rules are unchanged:** the server still checks the school link exactly as before, including the archived-school check. Each teacher still needs their own PIN.

## Security note
- **Guessing:** the full link's long random token could not be guessed. The short link is protected by the 4-digit code only, so someone who knows the school's name and tries many codes could open the teacher-name screen.
- **Still protected:** each teacher's work stays behind their own PIN. Five wrong PINs lock that teacher for 15 minutes.
- **If stronger protection is ever needed:** use a longer code.
