# Teacher recording and structured lesson reports

23 October 2026. Scope: Vision's native literacy teacher portal and the independent School Success module within the existing Vision staging application. Their directories, records, permissions, storage and lesson identities stay separate. The original standalone School Success site is not automatically synchronized or changed by this release.

Deployed runtime: `2c35dbecadd7812aa2c146947192d8bf0620af50`. Vercel deployment `dpl_7boKMWWPKTUWR8WrmwUQj424XqnZ` is READY in `bom1`; https://vision-school-commercial-staging.vercel.app/ resolves to this deployment.

## Combined recording

Each class period now has one combined microphone recording. Stopping and restarting dictation for learning objective, teaching-learning materials, teacher activity, student activity, practice and review adds audio to the same draft attachment. Written reflection fields remain separate. The separate microphone-only control contributes to the same combined recording.

Each completed browser recording is decoded, normalized to mono 16 kHz audio and appended to a playable PCM WAV file. Complete WebM/MP4 containers are not blindly concatenated. The draft retains one attachment identity across additions; separate periods have separate accumulators. Removing the combined attachment resets that period's accumulator. Explicitly attached prepared audio files remain separate attachments. Existing saved recordings are preserved rather than rewritten.

Saving stays blocked while capture or combining is active, and recording controls prevent simultaneous capture across periods. A failed conversion retains its pending segment in the current draft and blocks saving until the teacher retries or explicitly discards that segment. Microphone tracks are released on stop and unmount. Recording remains a teacher choice, with no “optional” label.

## Structured review

- School Success Teacher 360 screen, individual and combined PDFs, school PDF ZIPs and evidence workbook rows now follow grade, subject, planned lesson date, section and lesson topic.
- Preparation PDF/audio and subsequent classroom evidence stay associated through explicit record identities. Equal topic text does not merge unrelated lessons. Each evidence update keeps its submission date and actual teaching date.
- The School Success teacher history uses the same grade/subject/dated-lesson organization.
- Vision's native teacher history groups each period under its grade and subject and displays only that period's preparation files and evidence updates. Its school-leader teacher report separately shows preparation and classroom activity counts under the same structure.
- Consolidated summaries, preparation sessions/minutes, separate period comparison, disabled-KPI exclusions, distinct resource usage categories and opt-in consultant observations remain intact. Missing historical grade or subject is explicitly labelled; it is not guessed from names.
- The workbook retains its existing summary, usage, settings and comparison exports, adds dated lesson-preparation detail and includes grade, subject, section, planned date, stage, submission date and teaching date with evidence links.

## Verification

- 57 local checks passed, including an independent FFmpeg/FFprobe decode confirming all audio segments are playable and ordered in one output file.
- Rendered React controls and Vision history were checked, including period-specific file isolation.
- PDF text checks verify dated grade/subject grouping, linked preparation and successive updates, original KPI visibility, consolidated summaries and comparison layout.
- A three-page synthetic report was rendered and visually inspected for table layout and heading/page-break behaviour. It is a QA sample, not a customer's report or a deployed-workflow demonstration.
- Production Next.js build passed. No schema migration, credential change, permission change or customer-record rewrite is required.
- Deployed root, School Success and native teacher route returned HTTP 200. The served teacher bundle contains the combined-recording control. Anonymous School Success, native teacher and school-progress API calls returned HTTP 401. These are availability/code-delivery/access checks, not a signed-in microphone workflow test.
- Database counts before and after release matched: 61,524 School Success records, one native Vision lesson and two historical implementation entries. No customer writes were made for these checks. The final deployment's error/fatal runtime-log scan returned no matching entries at the time checked.

Physical iPhone/Android microphone capture, browser speech recognition and real-device codec conversion remain untested in this pass. Local audio encoding/decoding and component tests do not substitute for those device checks. Previously saved audio is not retroactively combined.
