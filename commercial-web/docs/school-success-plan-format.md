# Lesson plans in reviews and lesson PDFs use the plan form's headings (owner request, 26 November 2026)

**Before:** Lesson review, Lesson records, School 360° and the lesson documentation PDFs showed saved plans under older labels:
- "Learning objective", "Teacher activity", "Practice / classwork" and "Review / homework";
- with "Classwork and homework:" run into the review text.

**Now** they use the headings teachers see when planning:
1. Learning outcome
2. Teaching-learning materials
3. Teacher activity (I do)
4. Student activity and participation (We do)
5. Practice and apply (You do)
6. Check learning and next steps
7. Classwork and homework (its own section)

**Code:**
- `lib/school-success/lesson-records.js`: `lessonPlanFields` and `parseLessonPlan`.
- The saved text is unchanged. Only the display labels change, and the classwork part is split out of the review section, as the teacher's "Read plan" screen already did.

**School 360° evidence feed:** shows the plan under these headings instead of the raw saved text.

**Lesson PDF:** a long label now keeps its own space; before, a wrapped label ran into the next row.

## Subjects for new lesson plans depend on the class (owner decision, 26 November 2026)
| Classes | Subjects offered |
|---|---|
| Nursery, LKG, UKG | Phonics / Literacy, Numeracy, Environmental Studies (EVS), Gross and fine motor activities, Stories and rhymes, Art and craft, Hindi, Playtime, Extracurricular / co-curricular |
| Grades 1–5 | Environmental Studies (EVS), English, Mathematics, Hindi, Computer, General Knowledge (GK), English Grammar, Science, Social Science, Extracurricular / co-curricular, Phonics / Literacy, Stories and rhymes, Art and craft |

**Removed:** "All Subjects Together", "Play Activity", "Play Based" and "Play Time". "Play Time" is replaced by "Playtime" for pre-primary.

**Labels:** Hindi labels are included. The same label "Extracurricular / co-curricular" is used for both groups, so reports and filters group it together.

**Code:** `subjectsFor(grade)` in `lib/school-success/teacher-flow.js`. Before a class is chosen, every subject is listed.

**When the subject no longer fits:**
- This covers a removed subject in an older draft, or a class changed after the subject was picked.
- The Subject box shows "Select", and the teacher must choose again before saving. The check is in `planningIssue` and `planProblem`.

**Unchanged:**
- Lessons saved earlier keep their subject in reports and history.
- Vision's own teacher portal (`app/ImplementationWorkspace.jsx`).
