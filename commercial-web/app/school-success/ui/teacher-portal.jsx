'use client';
import {mapLimited} from '@/lib/school-success/parallel';
import {requestJson} from '@/lib/school-success/request-json';
import {successFetch} from '@/lib/school-success/client';
import { useEffect, useState } from 'react';
import { CheckCircle, BookOpen, ClipboardList, Camera } from 'lucide-react';
import GuidedPlan from './guided-plan';

import SchoolSharingLinks from './school-sharing-links';
import LessonEvidence from './lesson-evidence';
import { submissionSchema, submissionRecords } from '@/lib/school-success/teacher-submissions';
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const newPeriod = () => ({ id: crypto.randomUUID(), grade: '', section: 'A', subject: '', topic: '', reflection: '', materials: '', category: 'activity', files: [] });
export default function TeacherPortal({ data, school, refresh }) {
    const admin = data.actor.role === 'admin', schoolLink = data.actor.role === 'school-teacher', roster = data.roster || [];
    const schools = [...new Set([...roster.map(r => r.school), ...(data.entries || []).map((r) => r.school || r.name)])].filter(Boolean).sort();
    const [selectedSchool, setSchool] = useState(admin ? school || schools[0] || '' : data.actor.school), [teacher, setTeacher] = useState(admin ? '' : data.actor.name), [date, setDate] = useState(day()), [periods, setPeriods] = useState(() => [newPeriod()]), [submissionId, setId] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(''), [error, setError] = useState(''), [receipt, setReceipt] = useState(null), [mode, setMode] = useState(''), [resumeToken, setResumeToken] = useState(''), [savedLinks, setSavedLinks] = useState([]);
    useEffect(() => { if (admin && school)
        setSchool(school); }, [admin, school]);
    useEffect(() => { const token = new URLSearchParams(location.search).get('resume'); if (token) {
        setResumeToken(token);
        setMode('evidence');
    } try {
        const stored = JSON.parse(localStorage.getItem('school-success:teacher-lesson-links-v1') || '[]');
        if (Array.isArray(stored))
            setSavedLinks(stored.filter(l => typeof l?.url === 'string' && l.url.startsWith(location.origin + '/school-success?') && typeof l.submissionId === 'string'));
    }
    catch { } }, []);
    useEffect(() => { const open = () => { const url = new URL(location.href); url.searchParams.delete('resume'); window.history.replaceState(null, '', url.href); setMode('preparation'); setResumeToken(''); requestAnimationFrame(() => document.getElementById('teacher-submission-form')?.scrollIntoView({ behavior: 'smooth' })); }; window.addEventListener('teacher-new-preparation', open); return () => window.removeEventListener('teacher-new-preparation', open); }, []);
    const teachers = [...new Set(roster.filter(r => r.school === selectedSchool).map(r => r.name))].sort();
    const teacherValue = admin ? teacher : schoolLink ? data.actor.name : data.actor.name;
    const contextHeaders = () => { const access = new URLSearchParams(location.search).get('access'); return access ? { 'X-School-Link': access, 'X-Teacher': encodeURIComponent(teacherValue) } : {}; };

    const [language,setLanguage]=useState(''),[draftReady,setDraftReady]=useState(''),[draftStatus,setDraftStatus]=useState('');
    const t=(en,hi)=>language==='hi'?hi:en;
    useEffect(()=>{try{const v=localStorage.getItem('school-success:language');if(v==='en'||v==='hi')setLanguage(v);}catch{}},[]);
    function chooseLanguage(v){setLanguage(v);try{localStorage.setItem('school-success:language',v);}catch{}}
    const draftKey='school-success:planning-draft:'+JSON.stringify([data.actor.email||data.actor.role,selectedSchool,teacherValue]);
    useEffect(()=>{
      setDraftReady('');
      try{const raw=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(raw){submissionSchema.parse({id:raw.id,school:selectedSchool,teacher:teacherValue,date:raw.date,periods:raw.periods.map(p=>({...p,grade:p.grade||'-',subject:p.subject||'-',topic:p.topic||'-'})),files:[]});setPeriods(raw.periods.map(p=>({...p,files:[]})));setId(raw.id);setDate(raw.date);}else{setPeriods([newPeriod()]);setId(crypto.randomUUID());setDate(day());}}
      catch{setPeriods([newPeriod()]);setId(crypto.randomUUID());setDate(day());}setDraftReady(draftKey);
    },[draftKey]);
    useEffect(()=>{if(draftReady!==draftKey||!teacherValue)return;try{sessionStorage.setItem(draftKey,JSON.stringify({id:submissionId,date,periods:periods.map(p=>({...p,files:[]}))}));setDraftStatus(t('Draft saved in this browser tab. Submit to save it to your school.','प्रारूप इस ब्राउज़र टैब में सहेजा गया। विद्यालय में सहेजने के लिए जमा करें।'));}catch{setDraftStatus(t('Draft could not be saved on this device. Keep this tab open.','इस उपकरण पर प्रारूप नहीं सहेजा जा सका। टैब खुला रखें।'));}},[draftReady,draftKey,periods,date,submissionId,language]);
    async function selectTeacher(name, nextMode = 'preparation') { const previousUrl=location.href; const url = new URL(location.href); url.searchParams.set('teacher', name); url.searchParams.delete('resume'); historyReplace(url); setMode(nextMode); setResumeToken(''); setReceipt(null); setBusy(t('Opening teacher workspace','शिक्षक का कार्यक्षेत्र खुल रहा है')); try {
        await refresh();
    }
    catch (e) {
        historyReplace(new URL(previousUrl));setError(e.message);
    } finally {setBusy('');} }
    function historyReplace(url) { window.history.replaceState(null, '', url.href); }
    async function request(body) {
        return requestJson(() => successFetch('/api/school-success/evidence', {method: 'POST', headers: {'Content-Type': 'application/json', ...contextHeaders()}, body: JSON.stringify(body)}));
    }
    async function submit(e) { e.preventDefault(); if (busy)
        return; setError(''); setReceipt(null); setBusy('Checking your submission');  try {
        let submission = submissionSchema.parse({ id: submissionId, school: selectedSchool, teacher: teacherValue, date, periods: periods.map(({ category, files, ...p }) => p), files: periods.flatMap(p => p.files.map(f => ({ id: f.id, periodId: p.id, category: f.category, name: f.file.name, size: f.file.size }))) });
        setBusy('Creating lesson preparation PDFs');
        const { preparationPdf } = await import('@/lib/school-success/preparation-pdf');
        const audioRows = submissionRecords(submission, '', data.mediaPublicBase);
        const generated = [];
        for (const [index, p] of periods.entries()) {
            const bytes = await preparationPdf({ school: selectedSchool, teacher: teacherValue, date, ...p, audioUrls: audioRows[index].Voice_Note_Link.split(',').filter(Boolean) });
            generated.push({ id: p.id, category: 'lesson_plan', file: new File([bytes], 'Lesson-preparation-' + (index + 1) + '.pdf', { type: 'application/pdf' }) });
        }
        submission = submissionSchema.parse({ ...submission, files: [...submission.files, ...generated.map((f, i) => ({ id: f.id, periodId: periods[i].id, category: f.category, name: f.file.name, size: f.file.size }))] });
        const plan = await request({ action: 'prepare', mode: 'preparation', submission, directUploads: true });
        let result = plan;
        if (!plan.saved) {
            const allFiles = [...periods.flatMap(p => p.files), ...generated];
            let completed = 0;
            await mapLimited(plan.files, async file => {
                const actual = allFiles.find(f => f.id === file.id);
                if (!actual) throw Error('A selected file is missing. Choose it again.');
                const response = await successFetch('/api/school-success/evidence/upload', {method: 'POST', headers: {'X-Evidence-Token': file.token, ...contextHeaders()}, body: actual.file, uploadTicket: file.upload});
                if (!response.ok) throw Error((await response.json()).error || 'Evidence upload failed');
                setBusy('Uploaded ' + (++completed) + ' of ' + plan.files.length + ' files');
            });
            setBusy('Saving your class periods');
            result = await request({ action: 'commit', token: plan.token, submission });
        }
        const returnUrl = new URL(location.href);
        returnUrl.searchParams.set('resume', result.resumeToken);
        returnUrl.searchParams.set('teacher', teacherValue);
        returnUrl.searchParams.set('view', 'teacher');
        const saved = { ...result, url: returnUrl.href, school: selectedSchool, teacher: teacherValue, date };
        setReceipt(saved);
        const links = [saved, ...savedLinks.filter(l => l.submissionId !== result.submissionId)].slice(0, 30);
        setSavedLinks(links);
        try {
            localStorage.setItem('school-success:teacher-lesson-links-v1', JSON.stringify(links));
        }
        catch { }
        setPeriods([newPeriod()]);
        setId(crypto.randomUUID());

        if (admin) void refresh().catch(() => setError('Your submission is saved. Refresh the workspace to update the report.'));
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save. Retry using this receipt ID: ' + submissionId);
    }
    finally {
        setBusy('');
    } }
    if(!language)return <section className="card"><h2>Choose your preferred language / अपनी भाषा चुनें</h2><div className="teacher-actions"><button className="teacher-action" type="button" onClick={()=>chooseLanguage('en')}>English</button><button className="teacher-action" type="button" onClick={()=>chooseLanguage('hi')}>हिन्दी</button></div></section>;
    return <div className="teacher-workspace" lang={language}><label className="field"><span>{t('Language','भाषा')}</span><select value={language} disabled={!!busy} onChange={e=>chooseLanguage(e.target.value)}><option value="en">English</option><option value="hi">हिन्दी</option></select></label><section className="teacher-banner"><div><span className="eyebrow">{t('REFLECT • SHARE • GROW','सोचें • साझा करें • आगे बढ़ें')}</span><h2>{t('Share your classroom journey.','अपनी कक्षा की तैयारी करें।')}</h2><p>{t('Record each class period, reflect on the lesson and share evidence of student learning.','पाठ योजना बनाएँ और कक्षा के बाद बच्चों की सीख साझा करें।')}</p></div><BookOpen className="teacher-art" size={88} strokeWidth={1}/></section>
 {admin && <SchoolSharingLinks schools={[...new Set(roster.map(r => r.school))].filter(Boolean).sort()}/>}
 {!data.uploadsEnabled && <div className="alert" role="status">Lesson details and written reflections are active. Photo, video and voice uploads are awaiting the administrator’s media-storage connection.</div>}
 {receipt && <section className="card"><div className="card-head"><h2><CheckCircle size={20}/> {receipt.alreadySaved ? t('Preparation already saved','पाठ योजना पहले ही सहेजी गई है') : t('Preparation saved','पाठ योजना सहेज ली गई')}</h2><span className="pill green">{receipt.periods} {t('period(s)','कालांश')}</span></div><p>{t('Receipt','रसीद')}: <code>{receipt.submissionId}</code></p><p className="hint">{t('After teaching, choose Submit Evidence and the planned lesson date, or use this return link.','पढ़ाने के बाद प्रमाण जमा करें चुनें और योजना की तिथि भरें, या नीचे दिए लिंक से पाठ पर लौटें।')}</p><label className="field"><span>{t('Return to this lesson','इस पाठ पर लौटें')}</span><input readOnly value={receipt.url} onFocus={e => e.target.select()}/></label><a className="button primary" href={receipt.url}>{t('Return to this lesson / add evidence','इस पाठ पर लौटें / प्रमाण जोड़ें')}</a></section>}
 <div className="teacher-actions" role="group" aria-label="What would you like to do?"><button className={'teacher-action' + (mode === 'preparation' ? ' selected' : '')} aria-pressed={mode === 'preparation'} type="button" disabled={!!busy} onClick={() => { const url = new URL(location.href); url.searchParams.delete('resume'); historyReplace(url); setMode('preparation'); }}><ClipboardList size={28}/><b>{t('Submit Lesson Plan','पाठ योजना बनाएँ और जमा करें')}</b><span>{t('Plan up to 10 class periods before teaching.','एक-एक चरण में अपने कालांश की तैयारी करें।')}</span></button><button className={'teacher-action' + (mode === 'evidence' ? ' selected' : '')} aria-pressed={mode === 'evidence'} type="button" disabled={!!busy} onClick={() => setMode('evidence')}><Camera size={28}/><b>{t('Submit Evidence','प्रमाण और चिंतन जमा करें')}</b><span>{t('After teaching, add photos, written work and your reflection.','कक्षा के बाद फोटो, लिखित कार्य और चिंतन साझा करें।')}</span></button></div>
 {savedLinks.some(l => l.school === selectedSchool && l.teacher === teacherValue) && <section className="card"><details><summary>{t('Saved lessons on this device','इस उपकरण पर सहेजे गए पाठ')}</summary>{savedLinks.filter(l => l.school === selectedSchool && l.teacher === teacherValue).map(l => <p key={l.submissionId}><a href={l.url}>{l.date} · {l.teacher} · Return to saved preparation</a></p>)}</details></section>}
 {mode === 'evidence' ? <><section className="card"><div className="form-grid">{admin ? <label className="field"><span>{t('School','विद्यालय')}</span><select value={selectedSchool} onChange={e => { setSchool(e.target.value); setTeacher(''); setResumeToken(''); }}>{schools.map(s => <option key={s}>{s}</option>)}</select></label> : <div className="field"><span>{t('School','विद्यालय')}</span><b>{selectedSchool}</b></div>}{admin || schoolLink ? <label className="field"><span>{t('Teacher','शिक्षक')}</span><select value={teacherValue} onChange={e => { if (schoolLink)
            void selectTeacher(e.target.value, 'evidence');
        else {
            setTeacher(e.target.value);
            setResumeToken('');
        } }}><option value="">{t('Select teacher','शिक्षक चुनें')}</option>{teachers.map(t => <option key={t}>{t}</option>)}</select></label> : <div className="field"><span>{t('Teacher','शिक्षक')}</span><b>{teacherValue}</b></div>}</div></section><LessonEvidence language={language} key={selectedSchool + '|' + teacherValue + '|' + resumeToken} token={resumeToken} headers={contextHeaders} uploadsEnabled={data.uploadsEnabled} school={selectedSchool} teacher={teacherValue} onSaved={async () => { if (admin) await refresh(); }}/></> : mode === 'preparation' ? <GuidedPlan language={language} periods={periods} setPeriods={setPeriods} newPeriod={newPeriod} identity={<div className="form-grid">{admin ? <><label className="field"><span>{t('School','विद्यालय')}</span><select required value={selectedSchool} onChange={e => { setSchool(e.target.value); setTeacher(''); setPeriods([newPeriod()]); setId(crypto.randomUUID()); }}><option value="">{t('Select school','विद्यालय चुनें')}</option>{schools.map(s => <option key={s}>{s}</option>)}</select></label><label className="field"><span>{t('Teacher','शिक्षक')}</span>{teachers.length ? <select required value={teacherValue} onChange={e => {setTeacher(e.target.value);setPeriods([newPeriod()]);setId(crypto.randomUUID());}}><option value="">{t('Select teacher','शिक्षक चुनें')}</option>{teachers.map(t => <option key={t}>{t}</option>)}</select> : <input required value={teacher} onChange={e => {setTeacher(e.target.value);setPeriods([newPeriod()]);setId(crypto.randomUUID());}}/>}</label></> : schoolLink ? <><div className="field"><span>{t('School','विद्यालय')}</span><b>{selectedSchool}</b></div><label className="field"><span>{t('Teacher','शिक्षक')}</span><select required value={teacherValue} onChange={e => void selectTeacher(e.target.value)}><option value="">{t('Select teacher','शिक्षक चुनें')}</option>{teachers.map(t => <option key={t}>{t}</option>)}</select></label></> : <div className="field"><span>{t('School / teacher','विद्यालय / शिक्षक')}</span><b>{selectedSchool} · {teacherValue}</b></div>}<label className="field"><span>{t('Planned lesson date','पाठ की नियोजित तिथि')}</span><input type="date" required value={date} onChange={e => setDate(e.target.value)}/></label></div>} submit={submit} busy={busy} error={error} canSave={!!selectedSchool && !!teacherValue && /^\d{4}-\d{2}-\d{2}$/.test(date)} draftStatus={draftStatus}/> : null}
</div>;
}

