'use client';
import {useState,useRef,useEffect} from 'react';
import {CalendarDays,CalendarRange,ChevronDown,Check,Plus,Trash2,Target,Package,Presentation,Users,PencilLine,ListChecks,House,CircleAlert} from 'lucide-react';
import {guide,withPlanning,planningIssue,planProblem,MAX_DAILY_PERIODS,MAX_WEEKLY_DAYS,nextSchoolDay} from '@/lib/school-success/planning-guide';
import {teacherGrades,teacherSections,teacherSubjects} from '@/lib/school-success/teacher-flow';

export const hindiOptions={'Nursery':'नर्सरी','LKG':'एलकेजी','UKG':'यूकेजी','Not Applicable':'लागू नहीं','All Subjects Together':'सभी विषय एक साथ','Phonics / Literacy':'ध्वनि एवं साक्षरता','Mathematics':'गणित','Numeracy':'संख्या ज्ञान','English':'अंग्रेज़ी','Hindi':'हिन्दी','Environmental Studies (EVS)':'पर्यावरण अध्ययन','Science':'विज्ञान','Social Science':'सामाजिक विज्ञान','General Knowledge (GK)':'सामान्य ज्ञान','English Grammar':'अंग्रेज़ी व्याकरण','Computer':'कंप्यूटर','Play Activity':'खेल गतिविधि','Play Time':'खेल का समय','Play Based':'खेल आधारित'};
const icons={objective:Target,materials:Package,teacher:Presentation,student:Users,practice:PencilLine,review:ListChecks,classwork:House};
const months={en:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],hi:['जन','फ़र','मार्च','अप्रै','मई','जून','जुल','अग','सित','अक्टू','नव','दिस']};
const weekdays={en:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],hi:['रवि','सोम','मंगल','बुध','गुरु','शुक्र','शनि']};
export function dayLabel(day,language='en'){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day||'');if(!m)return '';const d=new Date(day+'T00:00:00Z');return weekdays[language][d.getUTCDay()]+', '+Number(m[3])+' '+months[language][Number(m[2])-1];}
export const newBlock=(extra={})=>({id:crypto.randomUUID(),submissionId:crypto.randomUUID(),grade:'',section:'A',subject:'',topic:'',answers:{},reflection:'',materials:'',...extra});

// One-page lesson plan: the plan type and its shared details at the top, then one block per class period (daily
// plan) or per day (weekly subject plan). Every planning field is visible; guidance sits inside the boxes.
export default function LessonPlanForm({language,plan,setPlan,identity,submit,busy,error,canSave,draftStatus,today}){
 const hi=language==='hi',t=(en,hn)=>hi?hn:en;
 const [open,setOpen]=useState(()=>new Set(plan.blocks.slice(0,1).map(b=>b.id))),[warning,setWarning]=useState(null);
 const refs=useRef({});
 useEffect(()=>{setOpen(s=>plan.blocks.some(b=>s.has(b.id))?s:new Set(plan.blocks.slice(0,1).map(b=>b.id)));},[plan.blocks.map(b=>b.id).join()]);
 const weekly=plan.type==='weekly',option=v=>hi?(hindiOptions[v]||v.replace('Grade ','कक्षा ')):v;
 const merged=b=>weekly?{...b,grade:plan.shared.grade,section:plan.shared.section,subject:plan.shared.subject}:b;
 const issue=b=>planningIssue(merged(b),{needsDate:weekly});
 const savedFor=b=>!!(weekly?plan.saved?.[b.submissionId]:plan.saved?.[plan.shared.submissionId]);
 const done=plan.blocks.filter(b=>!issue(b)).length;
 function update(changes){setPlan(p=>({...p,...changes}));setWarning(null);}
 function updateBlock(id,changes){setPlan(p=>({...p,blocks:p.blocks.map(b=>b.id===id?withPlanning(b,{...changes,answerLanguage:language}):b)}));setWarning(null);}
 function answer(b,key,value){updateBlock(b.id,{answers:{...b.answers,[key]:value}});}
 function toggle(id,force){setOpen(s=>{const n=new Set(s);(force??!n.has(id))?n.add(id):n.delete(id);return n;});}
 function chooseType(type){
  if(type===plan.type)return;
  // Answers are kept. Shared class/subject moves between the top of the form and the blocks.
  if(type==='weekly'){const first=plan.blocks[0]||{};const days=[];let d=plan.date||nextSchoolDay(today);
   const blocks=plan.blocks.map(b=>{const day=days.length?nextSchoolDay(days[days.length-1]):d;days.push(day);return {...b,date:day};});
   setPlan(p=>({...p,type,shared:{...p.shared,grade:p.shared.grade||first.grade||'',section:p.shared.section||first.section||'A',subject:p.shared.subject||first.subject||''},blocks:blocks.slice(0,MAX_WEEKLY_DAYS)}));}
  else setPlan(p=>({...p,type,date:p.blocks[0]?.date||p.date,blocks:p.blocks.map(b=>({...b,grade:b.grade||p.shared.grade,section:b.section||p.shared.section||'A',subject:b.subject||p.shared.subject}))}));
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
  const problem=planProblem(plan);
  if(problem){setWarning({block:null,key:problem});refs.current.top?.scrollIntoView({behavior:'smooth',block:'start'});return;}
  const bad=plan.blocks.find(b=>issue(b));
  if(bad){const key=issue(bad);toggle(bad.id,true);setWarning({block:bad.id,key});
   requestAnimationFrame(()=>{const el=document.getElementById('plan-'+bad.id+'-'+key)||refs.current[bad.id];el?.scrollIntoView({behavior:'smooth',block:'center'});el?.focus?.({preventScroll:true});});return;}
  submit(e);
 }
 const topMessages={empty:t('Add at least one period.','कम से कम एक कालांश जोड़ें।'),date:weekly?t('Choose a date for every day.','हर दिन की तिथि चुनें।'):t('Choose the lesson date.','पाठ की तिथि चुनें।'),subject:t('Choose the class and subject for this weekly plan.','इस साप्ताहिक योजना के लिए कक्षा और विषय चुनें।'),count:t('Too many blocks for one plan.','एक योजना में बहुत अधिक भाग हैं।'),'duplicate-date':t('Two days have the same date. Give each day its own date.','दो दिनों की तिथि एक ही है। हर दिन की अलग तिथि चुनें।')};
 const fieldMessage=t('Please complete this part.','कृपया यह भाग पूरा करें।');
 const missing=(b,key)=>warning?.block===b.id&&warning.key===key;
 const select=(label,value,options,onChange,id,invalid)=><label className={'field'+(invalid?' invalid':'')}><span>{label}</span><select id={id} value={value} onChange={e=>onChange(e.target.value)}><option value="">{t('Select','चुनें')}</option>{options.map(v=><option key={v} value={v}>{option(v)}</option>)}</select></label>;
 const blockTitle=(b,i)=>weekly?t('Day','दिन')+' '+(i+1)+(b.date?' · '+dayLabel(b.date,language):''):t('Period','कालांश')+' '+(i+1);
 const blockSummary=b=>{const m=merged(b);return [m.grade&&option(m.grade)+(m.section&&m.section!=='Not Applicable'?' '+m.section:''),m.subject&&option(m.subject),b.topic].filter(Boolean).join(' · ');};

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
     {select(t('Subject','विषय'),plan.shared.subject,teacherSubjects,v=>update({shared:{...plan.shared,subject:v}}),'plan-shared-subject',warning?.key==='subject'&&!plan.shared.subject)}
    </div>
    :<div className="lp-shared single"><label className={'field'+(warning?.key==='date'?' invalid':'')}><span>{t('Lesson date','पाठ की तिथि')}</span><input type="date" value={plan.date} onChange={e=>update({date:e.target.value})}/><small>{plan.date?dayLabel(plan.date,language):''}</small></label></div>}
   {warning&&!warning.block&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{topMessages[warning.key]||fieldMessage}</p>}
  </section>

  {plan.blocks.map((b,i)=>{const locked=savedFor(b),isOpen=open.has(b.id)&&!locked,complete=!issue(b),filled=guide.filter(([k])=>b.answers?.[k]?.trim()).length;
   return <section key={b.id} data-block={b.id} ref={el=>{refs.current[b.id]=el;}} className={'lp-card lp-block'+(complete?' complete':'')+(isOpen?' open':'')}>
    <header className="lp-block-head">
     <button type="button" className="lp-block-toggle" aria-expanded={isOpen} onClick={()=>toggle(b.id)}>
      <span className="lp-num">{complete?<Check size={16}/>:i+1}</span>
      <span className="lp-block-title"><b>{blockTitle(b,i)}</b><small>{blockSummary(b)||t('Add class details and your plan','कक्षा का विवरण और योजना भरें')}</small></span>
      {locked?<span className="pill green">{t('Saved','सहेजा गया')}</span>:<span className="lp-progress" aria-label={filled+' / '+guide.length}><span style={{width:(filled/guide.length*100)+'%'}}/></span>}
      <ChevronDown size={18} className="lp-chevron"/>
     </button>
     {plan.blocks.length>1&&!locked&&<button type="button" className="icon lp-remove" aria-label={t('Remove','हटाएँ')+' '+blockTitle(b,i)} onClick={()=>removeBlock(b.id)}><Trash2 size={16}/></button>}
    </header>
    {isOpen&&<div className="lp-block-body">
     <div className={'lp-details'+(weekly?' weekly':'')}>
      {weekly?<label className={'field'+(missing(b,'date')?' invalid':'')}><span>{t('Date','तिथि')}</span><input id={'plan-'+b.id+'-date'} type="date" value={b.date||''} onChange={e=>setPlan(p=>({...p,blocks:p.blocks.map(x=>x.id===b.id?{...x,date:e.target.value}:x)}))}/></label>
      :<>{select(t('Class','कक्षा'),b.grade,teacherGrades,v=>updateBlock(b.id,{grade:v}),'plan-'+b.id+'-details',missing(b,'details')&&!b.grade)}
        {select(t('Section','वर्ग'),b.section,teacherSections,v=>updateBlock(b.id,{section:v}))}
        {select(t('Subject','विषय'),b.subject,teacherSubjects,v=>updateBlock(b.id,{subject:v}),undefined,missing(b,'details')&&!b.subject)}</>}
      <label className={'field lp-topic'+(missing(b,'details')&&!b.topic?.trim()?' invalid':'')}><span>{t('Lesson number and topic','पाठ क्रमांक और विषयवस्तु')}</span><input id={weekly?'plan-'+b.id+'-details':undefined} maxLength={1000} value={b.topic} placeholder={t('Example: LP 12 — Plants around us','उदाहरण: पाठ 12 — हमारे आस-पास के पौधे')} onChange={e=>updateBlock(b.id,{topic:e.target.value})}/></label>
     </div>
     <div className="lp-fields">
      {guide.map(([key,titles,placeholders,max])=>{const Icon=icons[key],value=b.answers?.[key]||'';
       return <label key={key} className={'lp-field'+(key==='classwork'?' wide':'')+(missing(b,key)?' invalid':'')+(value.trim()?' filled':'')}>
        <span className="lp-field-label"><span className="lp-field-icon"><Icon size={16}/></span>{titles[hi?1:0]}{value.trim()&&<Check size={14} className="lp-tick"/>}</span>
        <textarea id={'plan-'+b.id+'-'+key} rows={3} maxLength={max} value={value} placeholder={placeholders[hi?1:0]} onChange={e=>answer(b,key,e.target.value)}/>
        {missing(b,key)?<small className="lp-field-error">{fieldMessage}</small>:value.length>max*.8&&<small className="lp-count">{value.length}/{max}</small>}
       </label>;})}
     </div>
     <p className="lp-mic-hint">{t('Type, or tap the microphone on your phone keyboard to speak.','टाइप करें या फ़ोन के कीबोर्ड के माइक से बोलकर लिखें।')}</p>
     {complete&&<button type="button" className="text-button" onClick={()=>toggle(b.id,false)}><Check size={15}/>{t('Done — collapse','पूरा — छोटा करें')}</button>}
    </div>}
   </section>;})}

  {plan.blocks.length<(weekly?MAX_WEEKLY_DAYS:MAX_DAILY_PERIODS)&&<button type="button" className="lp-add" onClick={addBlock}><Plus size={18}/>{weekly?t('Add another day','एक और दिन जोड़ें'):t('Add another period','एक और कालांश जोड़ें')}</button>}

  <div className="lp-submit-bar">
   <div><b>{done} / {plan.blocks.length}</b> <span>{weekly?t('days ready','दिन तैयार'):t('periods ready','कालांश तैयार')}</span>{busy&&<small role="status">{busy}…</small>}</div>
   <button type="submit" className="button primary" disabled={!canSave||!!busy}>{busy?t('Saving…','सहेजा जा रहा है…'):t('Submit lesson plan','पाठ योजना जमा करें')}</button>
  </div>
  {warning?.block&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{warning.key==='length'?t('This plan is too long. Please shorten some answers.','यह योजना बहुत लंबी है। कुछ उत्तर छोटे करें।'):t('Some parts are not complete yet. The first one is highlighted above.','कुछ भाग अभी अधूरे हैं। पहला भाग ऊपर दिखाया गया है।')}</p>}
  {error&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{error}</p>}
 </fieldset></form>;
}
