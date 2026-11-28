// Real period number (owner decision, 28 November 2026): in the daily and weekly planners the teacher chooses which
// period of the school day a lesson is taught in, so "P4" matches the school timetable instead of the order the plans
// were saved in. Periods 1–7 are the timetable; the eighth choice is "Extra" (zero period, before or after school,
// revision or extra class): it never clashes and a day can have several. Stored inside the saved plan text as a
// "Period number" heading ("4", or "Extra"); no new database column. Plans saved before this change have no number:
// on their day they keep the save order and take the numbers the day's numbered lessons leave free, and they never
// block a number in the planner.
export const PERIOD_NUMBER_HEADING='Period number';
export const REGULAR_PERIODS=7;
export const EXTRA=8;                 // the stored choice "Extra"
export const EXTRA_BASE=100;          // day numbers of Extra lessons: 101, 102… (always after the timetable periods)
export const PERIOD_CHOICES=[1,2,3,4,5,6,7,EXTRA];
export const MAX_PERIOD=REGULAR_PERIODS;
export const validPeriod=n=>Number.isInteger(n)&&n>=1&&n<=EXTRA;
export const isTimetablePeriod=n=>Number.isInteger(n)&&n>=1&&n<=REGULAR_PERIODS;
export function periodNumberOf(text){
 const m=/(?:^|\n)Period number\n\s*(\d{1,2}|Extra)\s*(?:\n|$)/.exec(String(text||'').replace(/\r\n?/g,'\n'));
 if(!m)return 0;if(m[1]==='Extra')return EXTRA;
 const n=Number(m[1]);return isTimetablePeriod(n)?n:0;
}
export const periodNumberText=n=>n===EXTRA?PERIOD_NUMBER_HEADING+'\nExtra':isTimetablePeriod(n)?PERIOD_NUMBER_HEADING+'\n'+n:'';

// Numbers for one teacher's lessons on one day, given in save order. A lesson with a timetable period keeps it; an
// Extra lesson gets EXTRA_BASE+1, +2… in save order; the others take, in save order, the lowest numbers no
// timetable lesson uses (so older days still read 1, 2, 3…). numberOf(item) → its stored choice or 0.
export function assignPeriodNumbers(items,numberOf){
 const out=new Map(),used=new Set();let extra=0;
 for(const it of items){const n=numberOf(it);if(isTimetablePeriod(n)){out.set(it,n);used.add(n);}else if(n===EXTRA)out.set(it,EXTRA_BASE+(++extra));}
 let next=1;
 for(const it of items){if(out.has(it))continue;while(used.has(next))next++;out.set(it,next);used.add(next);}
 return out;
}
// The lowest free timetable period, else Extra.
export function nextFreePeriod(taken){const t=new Set(taken);return PERIOD_CHOICES.find(n=>n===EXTRA||!t.has(n));}
export const freePeriods=taken=>{const t=new Set(taken);return PERIOD_CHOICES.filter(n=>n===EXTRA||!t.has(n));};

// "Period 4" / "P4" / "Extra"; n is a day number (from assignPeriodNumbers) or a stored choice when choice:true.
export function periodName(n,{short=false,hi=false,choice=false}={}){
 if((choice&&n===EXTRA)||n>EXTRA_BASE)return hi?'अतिरिक्त':'Extra';
 if(!n)return '';
 return short?'P'+n:(hi?'कालांश ':'Period ')+n;
}
