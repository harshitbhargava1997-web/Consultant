// Yellow highlights (owner decision, 27 November 2026): a reviewer taps a sentence of a lesson's plan or written
// after-class reflection to mark it; the teacher sees the same sentences in yellow and listed under the review.
// Sentences end at . ! ? or the Hindi danda (।), or at a line break.
export function sentences(text){
 return String(text||'').split(/\n+/).flatMap(line=>line.match(/[^.!?।]+(?:[.!?।]+["'”’)]*|$)/g)||[]).map(s=>s.trim()).filter(Boolean);
}
export const markKey=h=>[h.record,h.field,String(h.text||'').trim()].join('|');
// Toggle one sentence in a list of highlights.
export function toggleMark(list,mark){
 const key=markKey(mark),has=(list||[]).some(h=>markKey(h)===key);
 return has?list.filter(h=>markKey(h)!==key):[...(list||[]),{record:String(mark.record),field:mark.field,text:String(mark.text).trim()}];
}
// The highlights of one lesson's visible reviews (latest versions), as a Set of keys for quick lookup.
export function lessonMarks(lesson){
 return new Set((lesson?.reviews||[]).flatMap(r=>r.highlights||[]).filter(h=>String(h.record)===String(lesson.recordId)).map(markKey));
}
const reflectionLabels={achievement:'reflection',nextStep:'reflection'};
// Where a highlight sits, for the teacher: "your plan" or "your reflection".
export const markPlace=h=>String(h.field).startsWith('reflection.')||reflectionLabels[h.field]?'your reflection':'your plan';
