// Type of class period (owner decision, 28 November 2026): a regular lesson, a remedial class or a substitute class.
// Stored inside the saved plan text as a "Period type" heading (no new database column); plans saved before this
// change, and any plan without the heading, are regular lessons.
//  - Remedial class: a short support plan (what the teacher will help with, how many children, what she will do).
//    Reviewed like any lesson; counted under "Remedial support" in Teacher 360° and School 360°, not as a lesson plan.
//  - Substitute class: one line on what was done. Shown everywhere, labelled "Substitute"; not a lesson plan, not
//    counted, and never awaiting review.
export const PERIOD_TYPES=['regular','remedial','substitute'];
export const PERIOD_TYPE_HEADING='Period type';
export const periodTypeNames={regular:'Regular lesson',remedial:'Remedial class',substitute:'Substitute class'};
export const periodTypeTags={regular:'',remedial:'Remedial',substitute:'Substitute'};
// Headings of the remedial and substitute answers in the saved plan text.
export const periodTypeHeadings={children:'Children in this group',support:'Support activity',done:'What was done in this class'};
const byName=new Map(Object.entries(periodTypeNames).map(([key,name])=>[name,key]));
export function periodTypeOf(text){
 const m=/(?:^|\n)Period type\n([^\n]+)/.exec(String(text||'').replace(/\r\n?/g,'\n'));
 return (m&&byName.get(m[1].trim()))||'regular';
}
export const isSubstitute=text=>periodTypeOf(text)==='substitute';
