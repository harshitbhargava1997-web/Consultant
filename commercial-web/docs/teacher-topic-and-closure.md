# Teacher topic dictation and after-class reflection

Applies to the native Vision teacher portal and the School Success module inside Vision. The standalone School Success site is unchanged.

- Topic / lesson number uses browser speech recognition, English (India) or Hindi, and fills editable text. It does not create a lesson audio attachment.
- After-class reflection has achievements, what went well, and next support prompts. Teachers may leave prompts blank, type, or record and transcribe.
- Each completed closure recording is a single retained file. Recognition restarting does not split the recording. Existing preparation audio combining is unchanged.
- Written closure is generated as a dated PDF on submission. It is an evidence document, not an editable preparation field. No preparation text is replaced.
- Closure PDF and audio use a distinct `closure` file category. School Success stores their URLs through its existing append-only classroom-evidence columns and history; `/closure/` in the storage path preserves classification. Vision retains the category in its existing evidence-update JSON.
- Existing lesson, period, school, teacher, version and update-ID checks remain in force. There is no database migration.
- Reflection-only updates are allowed by generating the closure PDF. File-only updates remain allowed.
- Teacher 360 has an After-class reflections report-section checkbox. School 360 school-detail PDF has a separate After-class reflections file-category checkbox. Closure files do not increment activity KPI counts.
- Audio and PDF links remain in My Evidence and existing downloads. Previous updates remain unchanged.

Verification: unit/regression tests cover browser recognition recovery, closure validation and period identity, preparation preservation, KPI separation, older report-setting defaults, component rendering, and generated PDF inclusion/exclusion. Production Next.js build checked. Actual mobile microphone capture and authenticated live submissions still require the teacher pilot; automated checks do not establish iPhone/Android recognition reliability.
