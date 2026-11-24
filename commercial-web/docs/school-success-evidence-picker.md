# Add evidence: choose the lesson day and the period from dropdowns

24 November 2026. Owner request: in Add evidence, teachers pick the day and the period to submit evidence for, the same way Submit lesson plan opens and closes each period.

## What the teacher sees
1. **Lesson day** dropdown at the top of Add evidence.
   - It lists the teacher's lessons planned on or before today, newest first. Each item shows the date, the class and subject (+N for more periods), and "evidence needed" or "evidence added".
   - Daily plans and each day of a weekly plan appear as separate days. Future lessons are not listed.
   - Choosing a day opens that lesson; no date search is needed. Search by planned date is still available under "Can't find your lesson?".
   - If files or a reflection are added but not submitted, switching day asks first.
2. **Add evidence for** dropdown, shown when the lesson has more than one period. Choosing a period opens it and closes the others.
3. Each period is a block that opens and closes by tapping its header (same look as the lesson plan form). The header shows:
   - a tick and "N files / reflection" for what was added in this update;
   - "Evidence saved" when earlier evidence exists.
4. Files and reflections added to a closed period are kept and submitted together with the others in one update.

## Unchanged
Upload, prepare/commit, update IDs, retry behaviour, server checks and evidence categories are unchanged. The data comes from the teacher's existing home summary (`myLessons`, the last 60 days), so no new server call or permission is added.

## Tests
- `tests/success-evidence-picker.test.mjs`: day list (planned on or before today, newest first) and period labels.
- Phone browser check against the local production build, with synthetic data:
  - day options;
  - period options;
  - one period open at a time;
  - tapping a header opens another period;
  - the switch-day prompt;
  - files from two periods submitted together;
  - single-period lessons show no period dropdown.

## Rollback
Revert the PR.
