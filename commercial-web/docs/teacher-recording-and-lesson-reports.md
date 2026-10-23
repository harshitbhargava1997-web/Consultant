# Teacher recording and sequential reports

23 October 2026. This follow-up supersedes the grade/subject report redesign. Scope: Vision's native teacher portal and its independent School Success module. Their directories, records, storage and permissions remain separate. The original standalone School Success website is unchanged.

## Final requested behaviour

- Keep the previous report, history and PDF layouts. Remove the grade → subject → dated-lesson hierarchy and its additional workbook sheet.
- Show dated history, usage details and file lists in chronological order, earliest first. Same-day preparation precedes its evidence; otherwise existing event order is retained when no timestamp is available.
- Present saved **Lesson preparation PDFs** and **Audio recordings** as separate file lists, with dated links. Keep classroom activity and other evidence in their previous categories.
- Preserve consolidated summaries, teacher preparation sessions/minutes, existing resource/KPI calculations, comparison pages, report toggles, combined PDFs, school PDF ZIPs and workbook exports.
- Retain the combined-recording improvement: Start–Stop microphone segments contribute to one playable WAV attachment per class period, while written reflection sections remain separate. Prepared audio attachments and existing stored recordings are preserved.
- No database records, storage objects, school assignments, authentication rules or credentials are changed by this correction.

## Verification

55 checks passed, including chronological ordering, separate PDF/audio lists without changing KPI counts, restored PDF layout and exclusions, rendered file links, combined audio playback via FFmpeg/FFprobe, and existing report/teacher-domain regressions. Next.js production build passed. A synthetic PDF is used only for rendering checks, not as evidence of a signed-in customer workflow.

Physical-phone microphone capture and browser speech recognition remain untested. Previously saved audio is not retroactively combined.
