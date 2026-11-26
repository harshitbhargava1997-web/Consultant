export const teacherGrades = ['Nursery', 'LKG', 'UKG', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'];
export const teacherSections = ['A', 'B', 'C', 'D', 'Not Applicable'];
// Subjects a teacher can plan for depend on the class (owner decision, 26 November 2026). "All Subjects Together"
// and the three play options are gone; lessons saved earlier keep their subject.
export const PRE_PRIMARY_GRADES = ['Nursery', 'LKG', 'UKG'];
export const prePrimarySubjects = ['Phonics / Literacy', 'Numeracy', 'Environmental Studies (EVS)', 'Gross and fine motor activities', 'Stories and rhymes', 'Art and craft', 'Hindi', 'Playtime', 'Extracurricular / co-curricular'];
export const primarySubjects = ['Environmental Studies (EVS)', 'English', 'Mathematics', 'Hindi', 'Computer', 'General Knowledge (GK)', 'English Grammar', 'Science', 'Social Science', 'Extracurricular / co-curricular', 'Phonics / Literacy', 'Stories and rhymes', 'Art and craft'];
// Every subject offered for some class (used before a class is chosen, and for filters).
export const teacherSubjects = [...new Set([...prePrimarySubjects, ...primarySubjects])];
export const subjectsFor = grade => PRE_PRIMARY_GRADES.includes(grade) ? prePrimarySubjects : /^Grade [1-5]$/.test(grade || '') ? primarySubjects : teacherSubjects;
export const reflectionPrompts = [['objective', 'Why — learning objective'], ['materials', 'Teaching-learning materials / resources'], ['teacher', 'Teacher activity — how'], ['student', 'Student activity'], ['practice', 'Practice & apply'], ['review', 'Review / next step']];
export const reflectionSectionLimit = 800;
export function formatReflection(parts) { return reflectionPrompts.filter(([key]) => parts[key]?.trim()).map(([key, label]) => label + '\n' + parts[key].trim()).join('\n\n'); }
export function teachingPracticeText(school, teacher, date, periods, receipt) { return ['TEACHING PRACTICE REFLECTION', school, teacher, 'Lesson date: ' + date, ...(receipt ? ['Receipt: ' + receipt] : []), ...periods.flatMap((p, i) => ['', 'Period ' + (i + 1) + ' · ' + [p.grade, p.section, p.subject].filter(Boolean).join(' / '), p.topic || '', p.reflection || '', p.materials && !p.reflection?.includes('Teaching-learning materials / resources\n') ? 'Materials: ' + p.materials : '', ...(p.files || []).map((f) => f.url ? f.category + ': ' + f.url : 'Evidence: ' + (f.file?.name || f.name || ''))])].join('\n'); }
export function downloadPractice(text, name = 'teaching-practice.txt') { const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function schoolLinkIdentity(value, teacher) { const link = value; if (!link?.school || !Array.isArray(link.teachers))
    throw Error('403:School link is invalid'); if (teacher && !link.teachers.includes(teacher))
    throw Error('403:Choose a teacher from this school'); return { school: link.school, name: teacher, teachers: link.teachers }; }

