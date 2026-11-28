'use client';
import {useState,useRef,useEffect} from 'react';
import {CalendarDays,CalendarRange,ChevronDown,Check,CircleCheck,Plus,Trash2,Target,Package,Presentation,Users,PencilLine,ListChecks,House,CircleAlert} from 'lucide-react';
import {periodsOn,classOf} from '@/lib/school-success/day-periods';
import {guide,guideFor,withPlanning,planningIssue,planProblem,MAX_DAILY_PERIODS,MAX_WEEKLY_DAYS,nextSchoolDay} from '@/lib/school-success/planning-guide';
import {teacherGrades,teacherSections,subjectsFor} from '@/lib/school-success/teacher-flow';
import {NO_PLAN,statusLabel,halfNames} from '@/lib/school-success/day-status';
import DayStatus,{rangeText} from './day-status';
import {PERIOD_CHOICES,EXTRA,nextFreePeriod,freePeriods,periodName} from '@/lib/school-success/period-number';

export const hindiOptions={'Nursery':'नर्सरी','LKG':'एलकेजी','UKG':'यूकेजी','Not Applicable':'लागू नहीं','All Subjects Together':'सभी विषय एक साथ','Phonics / Literacy':'ध्वनि एवं साक्षरता','Mathematics':'गणित','Numeracy':'संख्या ज्ञान','English':'अंग्रेज़ी','Hindi':'हिन्दी','Environmental Studies (EVS)':'पर्यावरण अध्ययन','Science':'विज्ञान','Social Science':'सामाजिक विज्ञान','General Knowledge (GK)':'सामान्य ज्ञान','English Grammar':'अंग्रेज़ी व्याकरण','Computer':'कंप्यूटर','Play Activity':'खेल गतिविधि','Gross and fine motor activities':'स्थूल और सूक्ष्म गतिक गतिविधियाँ','Playtime':'खेल का समय','Extracurricular / co-curricular':'पाठ्येतर / सह-पाठ्यचर्या गतिविधियाँ','Stories and rhymes':'कहानियाँ और कविताएँ','Art and craft':'कला और शिल्प','Play Time':'खेल का समय','Play Based':'खेल आधारित'};
const icons={objective:Target,materials:Package,teacher:Presentation,student:Users,practice:PencilLine,review:ListChecks,classwork:House,children:Users,support:PencilLine,done:ListChecks};
// Type of class period (owner decision, 28 November 2026); Regular is chosen first.
const periodTypeOptions=[['regular','Regular','नियमित'],['remedial','Remedial','उपचारात्मक'],['substitute','Substitute','स्थानापन्न']];
const months={en:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],hi:['जन','फ़र','मार्च','अप्रै','मई','जून','जुल','अग','सित','अक्टू','नव','दिस']};
const weekdays={en:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],hi:['रवि','सोम','मंगल','बुध','गुरु','शुक्र','शनि']};
export function dayLabel(day,language='en'){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day||'');if(!m)return '';const d=new Date(day+'T00:00:00Z');return weekdays[language][d.getUTCDay()]+', '+Number(m[3])+' '+months[language][Number(m[2])-1];}
export const newBlock=(extra={})=>({id:crypto.randomUUID(),submissionId:crypto.randomUUID(),grade:'',section:'A',subject:'',topic:'',answers:{},reflection:'',materials:'',...extra});

// One-page lesson plan: the plan type and its shared details at the top, then one block per class period (daily
// plan) or per day (weekly subject plan). Every planning field is visible; guidance sits inside the boxes.
// savedLessons: the teacher's saved lessons (summary). On a daily plan, the periods already saved for the chosen
// date are listed with a green tick and the new periods continue from the next number (owner request, 25 November
// 2026); on a weekly plan, a day that already has a saved plan for the same class and subject is marked.
// dayApi (optional): reads and saves the teacher's day status for the lesson date (owner decision, 28 November
// 2026). On a day that needs no lesson plan (absent, exam, holiday or vacation) the period forms are hidden; on an
// exam day the teacher can still add a period for a class they take.
export default function LessonPlanForm({language,plan,setPlan,identity,submit,busy,error,canSave,draftStatus,today,savedLessons=[],onReadSaved,dayApi}){
 const hi=language==='hi',t=(en,hn)=>hi?hn:en;
 const [open,setOpen]=useState(()=>new Set(plan.blocks.slice(0,1).map(b=>b.id))),[warning,setWarning]=useState(null);
 const refs=useRef({});
 const [day,setDay]=useState({date:'',status:null,loaded:false}),[classAnyway,setClassAnyway]=useState(false);
 useEffect(()=>{
  if(plan.type==='weekly'||!dayApi||!plan.date){setDay({date:'',status:null,loaded:false});return;}
  let live=true;setClassAnyway(false);setDay(d=>d.date===plan.date?d:{date:plan.date,status:null,loaded:false});
  dayApi({action:'read',from:plan.date,to:plan.date}).then(r=>{if(live)setDay({date:plan.date,status:(r.statuses||[]).find(x=>x.date===plan.date)||null,loaded:true});})
   .catch(()=>{if(live)setDay({date:plan.date,status:null,loaded:true});});
  return ()=>{live=false;};
 },[plan.date,plan.type,!!dayApi]);
 useEffect(()=>{setOpen(s=>plan.blocks.some(b=>s.has(b.id))?s:new Set(plan.blocks.slice(0,1).map(b=>b.id)));},[plan.blocks.map(b=>b.id).join()]);
 const weekly=plan.type==='weekly',option=v=>hi?(hindiOptions[v]||v.replace('Grade ','कक्षा ')):v;
 const merged=b=>weekly?{...b,grade:plan.shared.grade,section:plan.shared.section,subject:plan.shared.subject}:b;
 // Which period of the day (1–8) each lesson is taught in (owner decision, 28 November 2026). Daily plan: the next
 // free number is filled in and the teacher can change it. Weekly plan: "Usually period" for every day, which a day
 // can change. A number already planned on that day is flagged before saving.
 const numberOf=b=>weekly?b.periodNumber||plan.shared.periodNumber||0:b.periodNumber||0;
 // Only periods a teacher chose block a number; Extra never clashes and can be used many times a day.
 const takenOn=date=>new Map(periodsOn(savedLessons,date).filter(x=>x.chosen&&x.number<EXTRA).map(x=>[x.number,x]));
 function clashOf(b){
  const n=numberOf(b);if(!n||n===EXTRA)return null;
  const taken=takenOn(weekly?b.date:plan.date),saved=taken.get(n),others=weekly?[]:plan.blocks.filter(x=>x.id!==b.id).map(numberOf);
  const free=freePeriods([...taken.keys(),...others]).map(f=>f===EXTRA?t('Extra','अतिरिक्त'):f).join(' · ');
  if(saved)return {n,free,what:[saved.period.subject,classOf(saved.period)].filter(Boolean).map(option).join(' · ')};
  if(others.includes(n))return {n,free,what:''};
  return null;
 }
 const issue=b=>planningIssue(merged(b),{needsDate:weekly})||(!numberOf(b)||clashOf(b)?'period':'');
 const savedFor=b=>!!(weekly?plan.saved?.[b.submissionId]:plan.saved?.[plan.shared.submissionId]);
 const done=plan.blocks.filter(b=>!issue(b)).length;
 const dayNow=!weekly&&day.date===plan.date?day.status:null,noPlan=Boolean(dayNow&&NO_PLAN.has(dayNow.status)&&!(dayNow.status==='exam'&&classAnyway));
 const savedToday=!weekly&&plan.date?periodsOn(savedLessons,plan.date):[],maxNew=weekly?MAX_WEEKLY_DAYS:Math.max(0,MAX_DAILY_PERIODS-savedToday.length);
 const savedKey=savedToday.map(x=>x.chosen?x.number:0).join(',');
 useEffect(()=>{
  if(weekly)return;
  // New periods get the lowest free numbers until the teacher picks one; a picked number is kept.
  setPlan(p=>{
   const used=new Set(periodsOn(savedLessons,p.date).filter(x=>x.chosen).map(x=>x.number));
   p.blocks.forEach(b=>{if(b.periodNumber&&!b.autoNumber)used.add(b.periodNumber);});
   let changed=false;
   const blocks=p.blocks.map(b=>{if(b.periodNumber&&!b.autoNumber)return b;const n=nextFreePeriod(used);used.add(n);if((b.periodNumber||0)===n&&b.autoNumber)return b;changed=true;return withPlanning(b,{periodNumber:n||undefined,autoNumber:true,answerLanguage:b.answerLanguage||language});});
   return changed?{...p,blocks}:p;
  });
 },[weekly,plan.date,savedKey,plan.blocks.map(b=>b.id+':'+(b.autoNumber?'a':b.periodNumber||0)).join()]);
 const alreadyPlanned=b=>weekly&&b.date&&periodsOn(savedLessons,b.date).some(x=>classOf(x.period)===classOf(plan.shared)&&x.period.subject===plan.shared.subject);
 function update(changes){setPlan(p=>({...p,...changes}));setWarning(null);}
 function updateBlock(id,changes){setPlan(p=>({...p,blocks:p.blocks.map(b=>b.id===id?withPlanning(b,{...changes,answerLanguage:language}):b)}));setWarning(null);}
 function answer(b,key,value){updateBlock(b.id,{answers:{...b.answers,[key]:value}});}
 function toggle(id,force){setOpen(s=>{const n=new Set(s);(force??!n.has(id))?n.add(id):n.delete(id);return n;});}
 function chooseType(type){
  if(type===plan.type)return;
  // Answers are kept. Shared class/subject moves between the top of the form and the blocks.
  // Period numbers start again: a daily plan fills in free numbers, a weekly plan uses "Usually period".
  if(type==='weekly'){const first=plan.blocks[0]||{};const days=[];let d=plan.date||nextSchoolDay(today);
   const blocks=plan.blocks.map(b=>{const day=days.length?nextSchoolDay(days[days.length-1]):d;days.push(day);return {...b,date:day,periodNumber:undefined,autoNumber:undefined};});
   setPlan(p=>({...p,type,shared:{...p.shared,grade:p.shared.grade||first.grade||'',section:p.shared.section||first.section||'A',subject:p.shared.subject||first.subject||''},blocks:blocks.slice(0,MAX_WEEKLY_DAYS)}));}
  else setPlan(p=>({...p,type,date:p.blocks[0]?.date||p.date,blocks:p.blocks.map(b=>({...b,grade:b.grade||p.shared.grade,section:b.section||p.shared.section||'A',subject:b.subject||p.shared.subject,periodNumber:undefined,autoNumber:undefined}))}));
  setWarning(null);
  try{localStorage.setItem('school-success:plan-type',type);}catch{}
 }
 function addBlock(){
  const last=plan.blocks[plan.blocks.length-1];
  const b=newBlock(weekly?{date:last?.date?nextSchoolDay(last.date):nextSchoolDay(today)}:{grade:last?.grade||'',section:last?.section||'A'});
  setPlan(p=>({...p,blocks:[...p.blocks,b]}));
  plan.blocks.forEach(x=>{if(!issue(x))toggle(x.id,false);});toggle(b.id,true);
  requestAnimationFrame(()=>refs.current[b.id]?.scrollIntoView({behavior:'smooth',block:'start'}));
 }
 function removeBlock(id){setPlan(p=>({...p,blocks:p.blocks.filter(b=>b.id!==id)}));}
 function save(e){
  e.preventDefault();
  const problem=planProblem(plan)||(!weekly&&plan.blocks.length>maxNew?'count':'');
  if(problem){setWarning({block:null,key:problem});refs.current.top?.scrollIntoView({behavior:'smooth',block:'start'});return;}
  const bad=plan.blocks.find(b=>issue(b));
  if(bad){const key=issue(bad);toggle(bad.id,true);setWarning({block:bad.id,key});
   requestAnimationFrame(()=>{const el=document.getElementById('plan-'+bad.id+'-'+key)||refs.current[bad.id];el?.scrollIntoView({behavior:'smooth',block:'center'});el?.focus?.({preventScroll:true});});return;}
  submit(e);
 }
 const topMessages={empty:t('Add at least one period.','कम से कम एक कालांश जोड़ें।'),date:weekly?t('Choose a date for every day.','हर दिन की तिथि चुनें।'):t('Choose the lesson date.','पाठ की तिथि चुनें।'),subject:t('Choose the class and subject for this weekly plan.','इस साप्ताहिक योजना के लिए कक्षा और विषय चुनें।'),count:weekly||!savedToday.length?t('Too many blocks for one plan.','एक योजना में बहुत अधिक भाग हैं।'):t('A day can have up to '+MAX_DAILY_PERIODS+' periods. '+savedToday.length+' are already saved for this date.','एक दिन में अधिकतम '+MAX_DAILY_PERIODS+' कालांश हो सकते हैं। इस तिथि के '+savedToday.length+' पहले से सहेजे गए हैं।'),'duplicate-date':t('Two days have the same date. Give each day its own date.','दो दिनों की तिथि एक ही है। हर दिन की अलग तिथि चुनें।')};
 const fieldMessage=t('Please complete this part.','कृपया यह भाग पूरा करें।');
 const missing=(b,key)=>warning?.block===b.id&&warning.key===key;
 const select=(label,value,options,onChange,id,invalid)=><label className={'field'+(invalid?' invalid':'')}><span>{label}</span><select id={id} value={options.includes(value)?value:''} onChange={e=>onChange(e.target.value)}><option value="">{t('Select','चुनें')}</option>{options.map(v=><option key={v} value={v}>{option(v)}</option>)}</select></label>;
 const blockTitle=(b,i)=>weekly?t('Day','दिन')+' '+(i+1)+(b.date?' · '+dayLabel(b.date,language):''):(periodName(numberOf(b),{hi,choice:true})||t('Period','कालांश')+' ?');
 const pickPeriod=(b,n)=>updateBlock(b.id,{periodNumber:n,autoNumber:false});
 function periodPicker(b,{label,value,taken,onPick,clash,hint,id}){
  const invalid=!clash&&missing(b,'period')&&!value;
  return <div className={'lp-pnum'+(clash||invalid?' invalid':'')}><span className="lp-pnum-label">{label}</span>
   <div className="lp-pnum-row" role="radiogroup" aria-label={label}>{PERIOD_CHOICES.map(n=><button key={n} type="button" role="radio" aria-checked={value===n} aria-label={n===EXTRA?t('Extra period','अतिरिक्त कालांश'):undefined} id={n===1?id:undefined} className={'lp-pnum-btn'+(n===EXTRA?' extra':'')+(value===n?(clash?' clash':' on'):'')+(taken.has(n)&&value!==n?' taken':'')} onClick={()=>onPick(n)}>{n===EXTRA?t('Extra','अति.'):n}</button>)}</div>
   {clash?<small className="lp-field-error">{t('Period '+clash.n+' is already planned for this day'+(clash.what?' ('+clash.what+')':' in this plan')+'. Free on this day: '+clash.free+'.','कालांश '+clash.n+' की योजना इस दिन पहले से है'+(clash.what?' ('+clash.what+')':'')+'। इस दिन खाली: '+clash.free+'।')}</small>
   :invalid?<small className="lp-field-error">{t('Choose the period.','कालांश चुनें।')}</small>:hint?<small className="lp-pnum-hint">{hint}</small>:null}</div>;
 }
 const typeTag=b=>b.periodType==='remedial'?t('Remedial','उपचारात्मक'):b.periodType==='substitute'?t('Substitute','स्थानापन्न'):'';
 const blockSummary=b=>{const m=merged(b);return [typeTag(b),m.grade&&option(m.grade)+(m.section&&m.section!=='Not Applicable'?' '+m.section:''),m.subject&&option(m.subject),b.topic].filter(Boolean).join(' · ');};

 return <form className="lp-form" id="teacher-submission-form" onSubmit={save} noValidate><fieldset disabled={!!busy} className="teacher-fields">
  <section className="lp-card lp-setup" ref={el=>{refs.current.top=el;}}>
   <div className="lp-heading"><div><span className="eyebrow">{t('LESSON PLAN','पाठ योजना')}</span><h2>{t('Plan your lessons','अपने पाठ की योजना बनाएँ')}</h2></div><p className="lp-draft" role="status">{draftStatus}</p></div>
   <div className="lp-type" role="radiogroup" aria-label={t('Plan type','योजना का प्रकार')}>
    {[['daily',CalendarDays,t('Daily plan','दैनिक योजना'),t('Next day · several periods, any class or subject','अगला दिन · कई कालांश, कोई भी कक्षा या विषय')],['weekly',CalendarRange,t('Weekly subject plan','साप्ताहिक विषय योजना'),t('One subject · several days of the week','एक विषय · सप्ताह के कई दिन')]].map(([v,Icon,label,desc])=>
     <button key={v} type="button" role="radio" aria-checked={plan.type===v} className={'lp-type-option'+(plan.type===v?' selected':'')} onClick={()=>chooseType(v)}><span className="lp-type-icon"><Icon size={22}/></span><span><b>{label}</b><small>{desc}</small></span><span className="lp-radio" aria-hidden="true">{plan.type===v&&<Check size={14}/>}</span></button>)}
   </div>
   {identity}
   {weekly?<div className="lp-shared">
     {select(t('Class','कक्षा'),plan.shared.grade,teacherGrades,v=>update({shared:{...plan.shared,grade:v}}),'plan-shared-grade',warning?.key==='subject'&&!plan.shared.grade)}
     {select(t('Section','वर्ग'),plan.shared.section,teacherSections,v=>update({shared:{...plan.shared,section:v}}),'plan-shared-section')}
     {select(t('Subject','विषय'),plan.shared.subject,subjectsFor(plan.shared.grade),v=>update({shared:{...plan.shared,subject:v}}),'plan-shared-subject',warning?.key==='subject'&&!subjectsFor(plan.shared.grade).includes(plan.shared.subject))}
    </div>
    :<div className="lp-shared single"><label className={'field'+(warning?.key==='date'?' invalid':'')}><span>{t('Lesson date','पाठ की तिथि')}</span><input type="date" value={plan.date} onChange={e=>update({date:e.target.value})}/><small>{plan.date?dayLabel(plan.date,language):''}</small></label></div>}
   {!weekly&&dayApi&&plan.date&&<DayStatus language={language} date={plan.date} api={dayApi} saved={dayNow} disabled={!day.loaded||!!busy} onSaved={s=>{setDay({date:plan.date,status:s,loaded:true});setClassAnyway(false);}}/>}
   {weekly&&periodPicker({id:'shared'},{label:t('Usually period','सामान्य कालांश'),value:plan.shared.periodNumber||0,taken:new Set(),onPick:n=>update({shared:{...plan.shared,periodNumber:n}}),clash:null,id:'plan-shared-period',
     hint:t('Every day of this plan takes this period; you can change a day below.','इस योजना के हर दिन यही कालांश होगा; नीचे किसी दिन को बदल सकते हैं।')})}
   {warning&&!warning.block&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{topMessages[warning.key]||fieldMessage}</p>}
  </section>

  {savedToday.length>0&&<section className="lp-card lp-saved" aria-label={t('Already planned','पहले से योजना')}>
   <h3>{t('Already planned for ','पहले से योजना — ')+dayLabel(plan.date,language)}</h3>
   <ul>{savedToday.map(x=><li key={x.key}><button type="button" className="lp-saved-row" disabled={!onReadSaved} onClick={()=>onReadSaved?.(x.lesson.resumeToken,x.index,x.period)}>
    <CircleCheck size={20} className="lp-saved-tick" aria-hidden="true"/><span><b>{x.chosen?periodName(x.number,{hi})+' · ':''}{[x.period.grade&&option(x.period.grade)+(x.period.section&&x.period.section!=='Not Applicable'?' '+x.period.section:''),x.period.subject&&option(x.period.subject)].filter(Boolean).join(' · ')}</b><small>{x.period.topic}</small></span><span className="pill green">{t('Saved','सहेजा गया')}</span></button></li>)}</ul>
   {maxNew>0?<p className="hint">{t('Add more periods below and choose which period each one is.','नीचे और कालांश जोड़ें और हर एक का कालांश क्रमांक चुनें।')}</p>:<p className="hint">{t('All '+MAX_DAILY_PERIODS+' periods of this day are planned. Choose another date to plan more.','इस दिन के सभी '+MAX_DAILY_PERIODS+' कालांश की योजना बन चुकी है। और योजना के लिए दूसरी तिथि चुनें।')}</p>}
  </section>}

  {noPlan&&<section className={'lp-card ds-notice '+dayNow.status} role="status">
   <h3>{t('No lesson plan needed for this day','इस दिन पाठ योजना की आवश्यकता नहीं')}</h3>
   <p>{statusLabel(dayNow,language)}{dayNow.from!==dayNow.to?' · '+rangeText(dayNow):''}. {t('Your principal can see this.','आपके प्रधानाचार्य इसे देख सकते हैं।')}{savedToday.length?' '+t((savedToday.length===1?'The period':'The '+savedToday.length+' periods')+' already planned for this day stay saved.','इस दिन के पहले से नियोजित कालांश सहेजे रहेंगे।'):''}</p>
   {dayNow.status==='exam'&&<button type="button" className="button" onClick={()=>setClassAnyway(true)}><Plus size={16}/>{t('Taking a class on this day? Add a period','इस दिन कक्षा ले रहे हैं? कालांश जोड़ें')}</button>}
  </section>}
  {!weekly&&dayNow?.status==='half-day'&&dayNow.half&&<p className="hint ds-half">{t('Half day: plan only the periods of your '+halfNames[dayNow.half][0].toLowerCase()+'.','आधा दिन: केवल '+halfNames[dayNow.half][1]+' के कालांश की योजना बनाएँ।')}</p>}

  {!noPlan&&plan.blocks.map((b,i)=>{const locked=savedFor(b),isOpen=open.has(b.id)&&!locked,complete=!issue(b),fields=guideFor(b.periodType),filled=fields.filter(([k])=>b.answers?.[k]?.trim()).length;
   return <section key={b.id} data-block={b.id} ref={el=>{refs.current[b.id]=el;}} className={'lp-card lp-block'+(complete?' complete':'')+(isOpen?' open':'')}>
    <header className="lp-block-head">
     <button type="button" className="lp-block-toggle" aria-expanded={isOpen} onClick={()=>toggle(b.id)}>
      <span className="lp-num">{complete?<Check size={16}/>:weekly?i+1:numberOf(b)===EXTRA?'X':numberOf(b)||'?'}</span>
      <span className="lp-block-title"><b>{blockTitle(b,i)}</b><small>{blockSummary(b)||t('Add class details and your plan','कक्षा का विवरण और योजना भरें')}</small>{!locked&&alreadyPlanned(b)&&<small className="lp-already">{t('A plan for this class and subject is already saved on this day.','इस दिन इस कक्षा और विषय की योजना पहले से सहेजी गई है।')}</small>}</span>
      {locked?<span className="pill green">{t('Saved','सहेजा गया')}</span>:<span className="lp-progress" aria-label={filled+' / '+fields.length}><span style={{width:(filled/fields.length*100)+'%'}}/></span>}
      <ChevronDown size={18} className="lp-chevron"/>
     </button>
     {plan.blocks.length>1&&!locked&&<button type="button" className="icon lp-remove" aria-label={t('Remove','हटाएँ')+' '+blockTitle(b,i)} onClick={()=>removeBlock(b.id)}><Trash2 size={16}/></button>}
    </header>
    {isOpen&&<div className="lp-block-body">
     {weekly?periodPicker(b,{label:t('Period on this day','इस दिन का कालांश'),value:numberOf(b),taken:new Set(takenOn(b.date).keys()),onPick:n=>updateBlock(b.id,{periodNumber:n===plan.shared.periodNumber?undefined:n}),clash:clashOf(b),id:'plan-'+b.id+'-period',
       hint:b.periodNumber&&b.periodNumber!==plan.shared.periodNumber?t('Changed for this day only','केवल इस दिन के लिए बदला गया'):plan.shared.periodNumber?t('Same as “Usually period”','“सामान्य कालांश” के समान'):t('Choose “Usually period” above, or a period for this day','ऊपर “सामान्य कालांश” चुनें या इस दिन का कालांश')})
     :periodPicker(b,{label:t('Which period?','कौन-सा कालांश?'),value:numberOf(b),taken:new Set(takenOn(plan.date).keys()),onPick:n=>pickPeriod(b,n),clash:clashOf(b),id:'plan-'+b.id+'-period',
       hint:takenOn(plan.date).size?t('Grey: already planned for this day','धूसर: इस दिन पहले से नियोजित'):''})}
     <div className="lp-ptype" role="radiogroup" aria-label={t('Type of period','कालांश का प्रकार')}>{periodTypeOptions.map(([v,en,hn])=>{const on=(b.periodType||'regular')===v;return <button key={v} type="button" role="radio" aria-checked={on} className={'lp-ptype-option '+v+(on?' on':'')} onClick={()=>updateBlock(b.id,{periodType:v})}>{hi?hn:en}</button>;})}</div>
     <div className={'lp-details'+(weekly?' weekly':'')}>
      {weekly?<label className={'field'+(missing(b,'date')?' invalid':'')}><span>{t('Date','तिथि')}</span><input id={'plan-'+b.id+'-date'} type="date" value={b.date||''} onChange={e=>setPlan(p=>({...p,blocks:p.blocks.map(x=>x.id===b.id?{...x,date:e.target.value}:x)}))}/></label>
      :<>{select(t('Class','कक्षा'),b.grade,teacherGrades,v=>updateBlock(b.id,{grade:v}),'plan-'+b.id+'-details',missing(b,'details')&&!b.grade)}
        {select(t('Section','वर्ग'),b.section,teacherSections,v=>updateBlock(b.id,{section:v}))}
        {select(t('Subject','विषय'),b.subject,subjectsFor(b.grade),v=>updateBlock(b.id,{subject:v}),undefined,missing(b,'details')&&!subjectsFor(b.grade).includes(b.subject))}</>}
      <label className={'field lp-topic'+(missing(b,'details')&&!b.topic?.trim()?' invalid':'')}><span>{b.periodType==='remedial'?t('What will you help with?','आप किसमें मदद करेंगे?'):b.periodType==='substitute'?t('Topic','विषयवस्तु'):t('Lesson number and topic','पाठ क्रमांक और विषयवस्तु')}</span><input id={weekly?'plan-'+b.id+'-details':undefined} maxLength={1000} value={b.topic} placeholder={b.periodType==='remedial'?t('Example: Carrying in 2-digit addition','उदाहरण: दो अंकों के जोड़ में हासिल'):t('Example: LP 12 — Plants around us','उदाहरण: पाठ 12 — हमारे आस-पास के पौधे')} onChange={e=>updateBlock(b.id,{topic:e.target.value})}/></label>
     </div>
     <div className="lp-fields">
      {fields.map(([key,titles,placeholders,max])=>{const Icon=icons[key],value=b.answers?.[key]||'';
       return <label key={key} className={'lp-field'+(key==='classwork'?' wide':'')+(missing(b,key)?' invalid':'')+(value.trim()?' filled':'')}>
        <span className="lp-field-label"><span className="lp-field-icon"><Icon size={16}/></span>{titles[hi?1:0]}{value.trim()&&<Check size={14} className="lp-tick"/>}</span>
        <textarea id={'plan-'+b.id+'-'+key} rows={key==='children'?1:3} maxLength={max} value={value} placeholder={placeholders[hi?1:0]} onChange={e=>answer(b,key,e.target.value)}/>
        {missing(b,key)?<small className="lp-field-error">{fieldMessage}</small>:value.length>max*.8&&<small className="lp-count">{value.length}/{max}</small>}
       </label>;})}
     </div>
     <p className="lp-mic-hint">{t('Type, or tap the microphone on your phone keyboard to speak.','टाइप करें या फ़ोन के कीबोर्ड के माइक से बोलकर लिखें।')}</p>
     {complete&&<button type="button" className="text-button" onClick={()=>toggle(b.id,false)}><Check size={15}/>{t('Done — collapse','पूरा — छोटा करें')}</button>}
    </div>}
   </section>;})}

  {!noPlan&&plan.blocks.length<maxNew&&<button type="button" className="lp-add" onClick={addBlock}><Plus size={18}/>{weekly?t('Add another day','एक और दिन जोड़ें'):t('Add another period','एक और कालांश जोड़ें')}</button>}

  {!noPlan&&<div className="lp-submit-bar">
   <div><b>{done} / {plan.blocks.length}</b> <span>{weekly?t('days ready','दिन तैयार'):t('periods ready','कालांश तैयार')}</span>{busy&&<small role="status">{busy}…</small>}</div>
   <button type="submit" className="button primary" disabled={!canSave||!!busy}>{busy?t('Saving…','सहेजा जा रहा है…'):t('Submit lesson plan','पाठ योजना जमा करें')}</button>
  </div>}
  {warning?.block&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{warning.key==='length'?t('This plan is too long. Please shorten some answers.','यह योजना बहुत लंबी है। कुछ उत्तर छोटे करें।'):t('Some parts are not complete yet. The first one is highlighted above.','कुछ भाग अभी अधूरे हैं। पहला भाग ऊपर दिखाया गया है।')}</p>}
  {error&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{error}</p>}
 </fieldset></form>;
}
