import {reflectionPrompts} from './teacher-flow.js';
import {PERIOD_TYPE_HEADING,periodTypeHeadings} from './period-types.js';
import {PERIOD_NUMBER_HEADING} from './period-number.js';
// Splits a saved lesson plan (the preparation text saved by the lesson plan form under the six standard headings)
// back into readable sections, for the teacher's "Read plan" screen. Classwork and homework, saved inside the review
// section, become their own section. Text that does not use the headings (older or free-form notes) is returned as
// one "notes" section, unchanged.
const CLASSWORK = /^(Classwork and homework:|कक्षा कार्य और गृहकार्य:)\s*$/m;
export const planSectionTitles = {
 objective: ['Learning outcome', 'सीखने का प्रतिफल'],
 materials: ['Teaching-learning materials', 'शिक्षण-अधिगम सामग्री'],
 teacher: ['Teacher activity (I do)', 'शिक्षक की गतिविधि (मैं करूँ)'],
 student: ['Students together (We do)', 'बच्चों की गतिविधि (हम करें)'],
 practice: ['Practice and apply (You do)', 'अभ्यास और उपयोग (आप करें)'],
 review: ['Check learning and next steps', 'सीख की जाँच और आगे के कदम'],
 classwork: ['Classwork and homework', 'कक्षा कार्य और गृहकार्य'],
 notes: ['Your notes', 'आपके नोट्स'],
 periodType: ['Type of period', 'कालांश का प्रकार'],
 children: ['Children in this group', 'इस समूह के बच्चे'],
 support: ['Support activity', 'सहायता गतिविधि'],
 done: ['What was done in this class', 'इस कक्षा में क्या किया गया']
};
export function parsePlanText(text) {
 const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
 if (!raw) return [];
 const labels = new Map([...reflectionPrompts.map(([key, label]) => [label, key]), [PERIOD_TYPE_HEADING, 'periodType'], [PERIOD_NUMBER_HEADING, 'periodNumber'], ...Object.entries(periodTypeHeadings).map(([key, label]) => [label, key])]);
 const sections = [];
 let current = null;
 const before = [];
 for (const line of raw.split('\n')) {
  const key = labels.get(line.trim());
  if (key) { current = { key, lines: [] }; sections.push(current); continue; }
  (current ? current.lines : before).push(line);
 }
 const out = [];
 if (before.join('\n').trim()) out.push({ key: 'notes', text: before.join('\n').trim() });
 for (const s of sections) {
  // The period number is shown in the title ("Period 4"), not as a section.
  if (s.key === 'periodNumber') continue;
  const body = s.lines.join('\n').trim();
  if (s.key === 'review' && CLASSWORK.test(body)) {
   const [review, classwork] = body.split(CLASSWORK).filter((_, i) => i !== 1);
   if (review?.trim()) out.push({ key: 'review', text: review.trim() });
   if (classwork?.trim()) out.push({ key: 'classwork', text: classwork.trim() });
  } else if (body) out.push({ key: s.key, text: body });
 }
 return out;
}
