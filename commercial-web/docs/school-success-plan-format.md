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
