# Guided teacher planning

School Success starts with English / Hindi language choices, then two primary actions: lesson planning and evidence submission. The device remembers the chosen language; changing it does not translate or replace teacher answers.

## Planning journey

Class details → learning outcome → teaching-learning materials → teacher activities and questions → student activity and participation → classwork and optional homework → checking learning, difficulties and next steps → review and submit.

Each planning card has a guiding question, an editable sentence starter and a collapsed example. Outcome action buttons encourage observable learning. The six optional Bloom thinking levels supply question starters; selecting levels requires teachers to write their actual questions. Starter blanks must be replaced before submission. Teachers review and edit all periods, can add up to ten periods, and can remove an extra period from its class-details card.

The six saved reflection headings and submission API remain compatible with existing lesson documentation. Questions and thinking levels are saved inside teacher activity; homework is saved with practice and application. Canonical class and subject values remain unchanged when their Hindi labels are displayed. Answers remain in the teacher's chosen writing language.

The School Success preparation recorder is removed. Historical recordings remain available, and native Vision recording controls are unchanged. Evidence submission retains two written after-class reflections with English/Hindi guidance and optional editable starters.

## Drafts and submission

Planning drafts use sessionStorage, scoped to actor, school and teacher, including the stable submission ID. Reloading the same tab restores the draft. Switching teachers restores their own draft; a new teacher starts blank. Drafts are local, are not saved to the school until submission, and are not promised across devices or closed tabs. Unavailable device storage produces a visible message. Submission uses the existing PDF generation, direct upload and prepare/commit workflow, including retry behavior.

## Verification

Validation: 258 tests passed, two real-storage tests skipped locally, and the production build passed. Both browser journeys completed without JavaScript errors.

Unit coverage checks bilingual serialization into the existing lesson parser, question/homework preservation, incomplete starter rejection, and maximum-length compatibility. UI tests retain coverage for historical evidence and native Vision recording.

Browser verification uses the production build and a fictional school with mocked API responses. It covers English desktop and Hindi mobile widths, language changes, draft reload, teacher switching, incomplete starters, all six cards, review, PDF creation and the submitted payload. This does not establish a live signed-in teacher submission or physical Safari/Android behavior.

## Release

Deploy only to `vision-school-commercial-staging` from `commercial-staging`. No database migration or environment-variable change is required. The preceding rollback deployment is `dpl_2EfJGcWdFTPTCzNV4AAbY4hfp2w1` (commit `5624e9d`).
