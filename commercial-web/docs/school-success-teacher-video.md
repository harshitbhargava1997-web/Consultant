# Teachers' "How to use" video

25 November 2026. Owner request: teachers watch the demo video after signing in, and Super Admin sees who watched it.

## Super Admin
- **Where:** School Success → **User management** → **Teacher video** tab.
- **Setting the video:** paste the YouTube link and click **Save video**.
  - Use an **Unlisted** video: Private videos do not play for teachers.
  - The usual link shapes work (`youtu.be/…`, `youtube.com/watch?v=…`, shorts, embed).
  - Saving an empty link removes the video, and teachers then go straight to their portal.
  - A **new** video must be watched again.
- **Report, per school:**
  - each teacher's status (**Watched**, **Started** or **Not opened**);
  - highest % watched, total watch time, first opened and finished (India time);
  - a summary such as "2 of 5 teachers watched · 1 started · 2 not opened".

## Teachers (school link and PIN)
- **The flow:** link → language → name → PIN → **How to use School Success** video. **Continue** unlocks when the video has been watched to the end (95% or more counts). Then the portal opens.
- **If the video cannot load** (weak internet, YouTube blocked, or 20 seconds without loading), the teacher sees **Continue without the video** and **Try again**, so nobody is locked out. This is recorded as an error and does not count as watched.
- **Watching again:** "How to use (video)" in the profile menu, at any time, with no lock.
- **The player:** YouTube's official player on the privacy-enhanced `youtube-nocookie.com` domain. Progress is sent when the video is opened, every 15 seconds while it plays, on pause and at the end.

## Storage and safety
- **Where it is stored:** the existing `success_config` settings table, with no schema change or migration. It uses the same compare-and-set store as teacher PINs.
  - `onboardingVideo` → `{videoId, url, setAt, setBy}`
  - `videoProgress:<sha256(school \0 teacher)>` → `{school, teacher, videoId, firstOpenedAt, lastSeenAt, maxPercent, watchSeconds, completedAt}`
- **Who can do what:**
  - only the signed-in teacher can record their own viewing; staff and other teachers cannot;
  - only Super Admin can set the link or read the report; consultants and school leaders cannot.
- **Limits:** watch time adds at most 120 seconds per update, and the percentage only goes up.
- **Unlisted is not private:** anyone with the YouTube link can watch it. A teacher could copy the link from the player.

## Tests
- `tests/success-onboarding-video.test.cjs`:
  - link parsing;
  - progress rules;
  - who may set, record and read;
  - a new video resets "watched";
  - no video means no lock and no records.
- **Browser check** (local production build, test YouTube player, synthetic data):
  - Continue is locked until the end, then the portal opens;
  - replay from the profile menu;
  - the "cannot load" path continues;
  - the Super Admin tab with the report.

## 25 November 2026: locked player (owner decision)
- **Hidden:** YouTube's controls (`controls=0`), keyboard (`disablekb`), fullscreen (`fs=0`), annotations and related videos from other channels.
- **Blocked by a transparent layer:**
  - the top strip (title, channel, Share) always;
  - after playback starts, the whole video, so taps reach only our controls and never YouTube's links;
  - the long-press menu.
- **Our controls:** **Play/Pause** (also by tapping the video) and **back 10 seconds**. There is no skipping ahead, and a progress bar shows elapsed / total time.
- **First play:** phones only allow it from a tap on the video itself. Until then, the middle of the video is left open, with a "Tap the video to start" hint.
- **Watermark:** the teacher's name and school appear faintly on the video.
- **Limit:** the video ID is still in the page code, and a screen recording is always possible.
