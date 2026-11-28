// Real period number (owner decision, 28 November 2026): in the daily and weekly planners the teacher chooses which
// period of the school day (1–8) a lesson is taught in, so "P4" matches the school timetable instead of the order the
// plans were saved in. Stored inside the saved plan text as a "Period number" heading (no new database column), like
// the period type. Plans saved before this change have no number: on their day they keep the save order and take the
// numbers the day's numbered lessons leave free.
export const PERIOD_NUMBER_HEADING='Period number';
export const MAX_PERIOD=8;
export const PERIOD_NUMBERS=Array.from({length:MAX_PERIOD},(_,i)=>i+1);
export const validPeriod=n=>Number.isInteger(n)&&n>=1&&n<=MAX_PERIOD;
export function periodNumberOf(text){
 const m=/(?:^|\n)Period number\n\s*(\d{1,2})\s*(?:\n|$)/.exec(String(text||'').replace(/\r\n?/g,'\n'));
 const n=m?Number(m[1]):0;return validPeriod(n)?n:0;
}
export const periodNumberText=n=>validPeriod(n)?PERIOD_NUMBER_HEADING+'\n'+n:'';

// Numbers for one teacher's lessons on one day, given in save order. A lesson with its own number keeps it; the
// others take, in save order, the lowest numbers no numbered lesson uses (so old days still read 1, 2, 3…).
// numberOf(item) → its stored number or 0. Returns a Map item → number.
export function assignPeriodNumbers(items,numberOf){
 const out=new Map(),used=new Set();
 for(const it of items){const n=numberOf(it);if(validPeriod(n)){out.set(it,n);used.add(n);}}
 let next=1;
 for(const it of items){if(out.has(it))continue;while(used.has(next))next++;out.set(it,next);used.add(next);}
 return out;
}
// The lowest period number not in `taken` (0 when all eight are used).
export function nextFreePeriod(taken){const t=new Set(taken);return PERIOD_NUMBERS.find(n=>!t.has(n))||0;}
