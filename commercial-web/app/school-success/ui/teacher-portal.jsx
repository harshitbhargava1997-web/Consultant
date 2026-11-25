'use client';
import {mapLimited} from '@/lib/school-success/parallel';
import {requestJson} from '@/lib/school-success/request-json';
import {successFetch} from '@/lib/school-success/client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle, ClipboardList, Camera, ArrowLeft, Languages, BookOpenCheck, KeyRound, LogOut } from 'lucide-react';
import TeacherLogin, {ChangePin} from './teacher-login';
import TeacherPinAdmin from './teacher-pin-admin';
import {clearTeacherSession} from '@/lib/school-success/teacher-session';
import LessonPlanForm, {newBlock, dayLabel, hindiOptions} from './lesson-plan-form';
import {SummaryStrip, RecentLessons, FeedbackCard, newFeedbackCount} from './teacher-summary';
import {TeacherHome, TabBar, ProfileSheet, PlanReader, todaysLessons} from './teacher-app';
import OnboardingVideo, {videoApi} from './onboarding-video';
import SchoolSharingLinks from './school-sharing-links';
import LessonEvidence from './lesson-evidence';
import { submissionSchema } from '@/lib/school-success/teacher-submissions';
import { planSubmissions, nextSchoolDay, PLAN_TYPES } from '@/lib/school-success/planning-guide';
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function storedType(){try{const v=localStorage.getItem('school-success:plan-type');return PLAN_TYPES.includes(v)?v:'daily';}catch{return 'daily';}}
export function emptyPlan(type=storedType(),today=day()){const first=nextSchoolDay(today);return {v:2,type,date:first,shared:{grade:'',section:'A',subject:'',submissionId:crypto.randomUUID()},blocks:[newBlock(type==='weekly'?{date:first}:{})],saved:{}};}
// Restores a planning draft from this tab, including drafts saved by the earlier one-date form.
export function restoreDraft(raw){
 if(!raw||typeof raw!=='object')return null;
 if(Array.isArray(raw.periods)&&uuid.test(raw.id||''))return {...emptyPlan('daily'),date:raw.date,shared:{grade:'',section:'A',subject:'',submissionId:raw.id},blocks:raw.periods.filter(p=>uuid.test(p?.id||'')).map(p=>({...newBlock(),...p,files:undefined}))};
 if(raw.v!==2||!PLAN_TYPES.includes(raw.type)||!Array.isArray(raw.blocks)||!raw.blocks.length||!uuid.test(raw.shared?.submissionId||''))return null;
 if(raw.blocks.some(b=>!uuid.test(b?.id||'')||!uuid.test(b?.submissionId||'')))return null;
 return {...raw,saved:raw.saved&&typeof raw.saved==='object'?raw.saved:{}};
}
export default function TeacherPortal({ data, school, refresh }) {
    const admin = data.actor.role === 'admin', schoolLink = data.actor.role === 'school-teacher', roster = data.roster || [];
    const schools = [...new Set([...roster.map(r => r.school), ...(data.entries || []).map((r) => r.school || r.name)])].filter(Boolean).sort();
    const [selectedSchool, setSchool] = useState(admin ? school || schools[0] || '' : data.actor.school), [teacher, setTeacher] = useState(admin ? '' : data.actor.name);
    const [plan, setPlan] = useState(() => emptyPlan('daily')), [busy, setBusy] = useState(''), [error, setError] = useState(''), [receipt, setReceipt] = useState(null), [mode, setMode] = useState(''), [resumeToken, setResumeToken] = useState(''), [savedLinks, setSavedLinks] = useState([]);
    const [summary, setSummary] = useState(null), [summaryError, setSummaryError] = useState(''), [summaryLoading, setSummaryLoading] = useState(false);
    const top = useRef(null), [pinPanel, setPinPanel] = useState(false), [pinNotice, setPinNotice] = useState('');
    // Teacher app (school-link teachers): the plan being read, the period Add evidence opens on, and the profile menu.
    const [readTarget, setReadTarget] = useState(null), [evPeriod, setEvPeriod] = useState(null), [sheet, setSheet] = useState(false);
    // "How to use" video: shown after PIN sign-in until watched; replay from the profile menu.
    const [video, setVideo] = useState({ id: '', watched: true, replay: false });
    useEffect(() => { if (admin && school) setSchool(school); }, [admin, school]);
    useEffect(() => { const token = new URLSearchParams(location.search).get('resume'); if (token) { setResumeToken(token); setMode('evidence'); } try {
        const stored = JSON.parse(localStorage.getItem('school-success:teacher-lesson-links-v1') || '[]');
        if (Array.isArray(stored)) setSavedLinks(stored.filter(l => typeof l?.url === 'string' && l.url.startsWith(location.origin + '/school-success?') && typeof l.submissionId === 'string'));
    } catch { } }, []);
    useEffect(() => { const open = () => { const url = new URL(location.href); url.searchParams.delete('resume'); window.history.replaceState(null, '', url.href); setMode('preparation'); setResumeToken(''); requestAnimationFrame(() => document.getElementById('teacher-submission-form')?.scrollIntoView({ behavior: 'smooth' })); }; window.addEventListener('teacher-new-preparation', open); return () => window.removeEventListener('teacher-new-preparation', open); }, []);
    const teachers = [...new Set(roster.filter(r => r.school === selectedSchool).map(r => r.name))].sort();
    const teacherValue = admin ? teacher : data.actor.name;
    const contextHeaders = () => { const access = new URLSearchParams(location.search).get('access'); return access ? { 'X-School-Link': access, 'X-Teacher': encodeURIComponent(teacherValue) } : {}; };

    const [language,setLanguage]=useState(''),[draftReady,setDraftReady]=useState(''),[draftStatus,setDraftStatus]=useState('');
    const t=(en,hi)=>language==='hi'?hi:en;
    useEffect(()=>{try{const v=localStorage.getItem('school-success:language');if(v==='en'||v==='hi')setLanguage(v);}catch{}},[]);
    function chooseLanguage(v){setLanguage(v);try{localStorage.setItem('school-success:language',v);}catch{}}
    const draftKey='school-success:planning-draft:'+JSON.stringify([data.actor.email||data.actor.role,selectedSchool,teacherValue]);
    useEffect(()=>{
      setDraftReady('');
      let restored=null;try{restored=restoreDraft(JSON.parse(sessionStorage.getItem(draftKey)||'null'));}catch{}
      setPlan(restored||emptyPlan());setDraftReady(draftKey);
    },[draftKey]);
    useEffect(()=>{if(draftReady!==draftKey||!teacherValue)return;try{sessionStorage.setItem(draftKey,JSON.stringify(plan));setDraftStatus(t('Draft kept in this browser tab','प्रारूप इस टैब में सुरक्षित है'));}catch{setDraftStatus(t('Draft could not be kept on this device. Keep this tab open.','इस उपकरण पर प्रारूप नहीं सहेजा जा सका। टैब खुला रखें।'));}},[draftReady,draftKey,plan,language]);

    async function request(body) {
        return requestJson(() => successFetch('/api/school-success/evidence', {method: 'POST', headers: {'Content-Type': 'application/json', ...contextHeaders()}, body: JSON.stringify(body)}));
    }
    async function loadSummary() {
        if (!selectedSchool || !teacherValue) { setSummary(null); return; }
        setSummaryLoading(true); setSummaryError('');
        try { setSummary(await request({ action: 'myLessons', school: selectedSchool, teacher: teacherValue })); }
        catch (e) { setSummaryError(t('Your lesson summary could not be loaded. ','आपका सारांश नहीं खुल सका। ') + (e.message || '')); }
        finally { setSummaryLoading(false); }
    }
    useEffect(() => { setSummary(null); if (language) void loadSummary(); }, [selectedSchool, teacherValue, language]);
    useEffect(() => { if (!schoolLink || !teacherValue) return; videoApi({ action: 'get' }, contextHeaders).then(r => setVideo({ id: r.videoId || '', watched: !r.videoId || !!r.watched, replay: false })).catch(() => {}); }, [schoolLink, teacherValue]);
    async function signOut() { clearTeacherSession(); setMode(''); setResumeToken(''); setReceipt(null); setPinPanel(false); const url = new URL(location.href); url.searchParams.delete('teacher'); url.searchParams.delete('resume'); historyReplace(url); try { await refresh(); } catch (e) { setError(e.message); } }
    function historyReplace(url) { window.history.replaceState(null, '', url.href); }
    function go(next) { const url = new URL(location.href); url.searchParams.delete('resume'); historyReplace(url); if (next !== 'evidence') setResumeToken(''); setMode(next); setError(''); requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }
    function openLesson(token, period = null) { setEvPeriod(Number.isInteger(period) ? period : null); setResumeToken(token); setMode('evidence'); setReceipt(null); requestAnimationFrame(() => (schoolLink ? top.current : document.getElementById('lesson-evidence'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }
    // The teacher marks one piece of feedback as read; the reviewer sees "Teacher noted" with the date.
    async function noteFeedback(f) {
        const r = await request({ action: 'noteFeedback', recordId: f.recordId, key: f.key });
        setSummary(s => s && ({ ...s, feedback: s.feedback.map(x => x.recordId === f.recordId && x.key === f.key ? { ...x, notedAt: r.notedAt || new Date().toISOString() } : x) }));
    }
    function readPlan(token, period = 0, match = null) { setReadTarget({ token, period, match }); setMode('read'); setReceipt(null); requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start' })); }

    // Saves one submission through the existing preparation workflow (PDF, direct upload, prepare/commit).
    async function saveOne(sub) {
        let submission = submissionSchema.parse({ id: sub.id, school: selectedSchool, teacher: teacherValue, date: sub.date, periods: sub.periods.map(p => ({ id: p.id, grade: p.grade, section: p.section, subject: p.subject, topic: p.topic, reflection: p.reflection, materials: p.materials })), files: [] });
        const { preparationPdf } = await import('@/lib/school-success/preparation-pdf');
        const generated = [];
        for (const [index, p] of submission.periods.entries()) {
            const bytes = await preparationPdf({ school: selectedSchool, teacher: teacherValue, date: sub.date, ...p, audioUrls: [] });
            generated.push({ id: p.id, category: 'lesson_plan', file: new File([bytes], 'Lesson-preparation-' + (index + 1) + '.pdf', { type: 'application/pdf' }) });
        }
        submission = submissionSchema.parse({ ...submission, files: generated.map(f => ({ id: f.id, periodId: f.id, category: f.category, name: f.file.name, size: f.file.size })) });
        const prepared = await request({ action: 'prepare', mode: 'preparation', submission, directUploads: true });
        if (prepared.saved) return prepared;
        await mapLimited(prepared.files, async file => {
            const actual = generated.find(f => f.id === file.id);
            if (!actual) throw Error('A lesson plan PDF is missing. Submit again.');
            const response = await successFetch('/api/school-success/evidence/upload', {method: 'POST', headers: {'X-Evidence-Token': file.token, ...contextHeaders()}, body: actual.file, uploadTicket: file.upload});
            if (!response.ok) throw Error((await response.json()).error || 'Upload failed');
        });
        return request({ action: 'commit', token: prepared.token, submission });
    }
    async function submit(e) { e.preventDefault(); if (busy) return; setError(''); setReceipt(null);
        const subs = planSubmissions({ ...plan, school: selectedSchool, teacher: teacherValue });
        let saved = { ...(plan.saved || {}) };
        try {
            for (const [i, sub] of subs.entries()) {
                if (saved[sub.id]) continue;
                setBusy(subs.length > 1 ? t('Saving ' + (i + 1) + ' of ' + subs.length, (i + 1) + ' / ' + subs.length + ' सहेजा जा रहा है') : t('Saving your lesson plan', 'आपकी पाठ योजना सहेजी जा रही है'));
                const result = await saveOne(sub);
                const returnUrl = new URL(location.href);
                returnUrl.searchParams.set('resume', result.resumeToken); returnUrl.searchParams.set('teacher', teacherValue); returnUrl.searchParams.set('view', 'teacher');
                saved = { ...saved, [sub.id]: { submissionId: result.submissionId || sub.id, alreadySaved: !!result.alreadySaved, url: returnUrl.href, date: sub.date, periods: sub.periods.map(p => ({ grade: p.grade, section: p.section, subject: p.subject, topic: p.topic })) } };
                // Remember progress so a retry after a failure continues with the next day instead of repeating.
                setPlan(p => ({ ...p, saved }));
            }
            const items = subs.map(s => saved[s.id]);
            setReceipt({ type: plan.type, items });
            const links = [...items.map(r => ({ submissionId: r.submissionId, url: r.url, school: selectedSchool, teacher: teacherValue, date: r.date })), ...savedLinks.filter(l => !items.some(r => r.submissionId === l.submissionId))].slice(0, 30);
            setSavedLinks(links);
            try { localStorage.setItem('school-success:teacher-lesson-links-v1', JSON.stringify(links)); } catch { }
            const keep = plan.type === 'weekly' ? { shared: { ...plan.shared, submissionId: crypto.randomUUID() } } : {};
            setPlan({ ...emptyPlan(plan.type), ...keep });
            setMode('');
            requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
            void loadSummary();
            if (admin) void refresh().catch(() => setError('Your submission is saved. Refresh the workspace to update the report.'));
        } catch (e) {
            const count = Object.keys(saved).length - Object.keys(plan.saved || {}).length;
            setError((e instanceof Error ? e.message : 'Could not save.') + ' ' + (count > 0 ? t(count + ' of ' + subs.length + ' were saved. Submit again to save the rest.', subs.length + ' में से ' + count + ' सहेजे गए। बाकी सहेजने के लिए फिर जमा करें।') : t('Your plan is still here. Submit again to retry.', 'आपकी योजना यहीं है। फिर से जमा करें।')));
        } finally { setBusy(''); }
    }
    const option = v => language === 'hi' ? (hindiOptions[v] || v.replace('Grade ', 'कक्षा ')) : v;

    if(!language)return <section className="lp-language"><span className="lp-language-icon"><Languages size={28}/></span><h2>Choose your language</h2><p>अपनी भाषा चुनें</p><div className="lp-language-options"><button type="button" onClick={()=>chooseLanguage('en')}><span>Aa</span><b>English</b></button><button type="button" onClick={()=>chooseLanguage('hi')}><span>अ</span><b>हिन्दी</b></button></div></section>;
    if(schoolLink && !data.actor.name)return <div className="teacher-workspace tp" lang={language}><div className="tp-top"><div><span className="eyebrow">{t('SCHOOL SUCCESS','स्कूल सक्सेस')}</span><h2>{t('Teacher sign-in','शिक्षक साइन इन')}</h2></div><label className="tp-language"><Languages size={16}/><select aria-label={t('Language','भाषा')} value={language} onChange={e=>chooseLanguage(e.target.value)}><option value="en">English</option><option value="hi">हिन्दी</option></select></label></div><TeacherLogin language={language} school={data.actor.school} teachers={roster.map(r => r.name)} onSignedIn={async () => { const url = new URL(location.href); url.searchParams.delete('teacher'); historyReplace(url); await refresh(); }}/></div>;
    const identity = admin ? <div className="lp-shared"><label className="field"><span>{t('School','विद्यालय')}</span><select value={selectedSchool} onChange={e => { setSchool(e.target.value); setTeacher(''); }}><option value="">{t('Select school','विद्यालय चुनें')}</option>{schools.map(s => <option key={s}>{s}</option>)}</select></label><label className="field"><span>{t('Teacher','शिक्षक')}</span>{teachers.length ? <select value={teacherValue} onChange={e => setTeacher(e.target.value)}><option value="">{t('Select teacher','शिक्षक चुनें')}</option>{teachers.map(n => <option key={n}>{n}</option>)}</select> : <input value={teacher} onChange={e => setTeacher(e.target.value)}/>}</label></div>
        : null;
    const who = JSON.stringify([data.actor.email || data.actor.role, selectedSchool, teacherValue]);
    const receiptCard = receipt ? <section className="ts-card tp-receipt" role="status"><div className="ts-card-head"><div><h3><CheckCircle size={20}/> {receipt.type === 'weekly' ? t('Weekly plan saved','साप्ताहिक योजना सहेजी गई') : t('Lesson plan saved','पाठ योजना सहेजी गई')}</h3><p>{t('After teaching, your lessons appear under “Recent lessons”.','पढ़ाने के बाद आपके पाठ “हाल के पाठ” में दिखेंगे।')}</p></div></div>
      <ul className="tp-receipt-list">{receipt.items.map(r => <li key={r.submissionId}><span><b>{dayLabel(r.date, language)}</b>{r.periods.map((p, i) => <small key={i}>{[option(p.grade) + (p.section && p.section !== 'Not Applicable' ? ' ' + p.section : ''), option(p.subject), p.topic].filter(Boolean).join(' · ')}</small>)}</span><a className="text-button" href={r.url}>{t('Return link','वापसी लिंक')}</a></li>)}</ul>
      <p className="hint">{t('Receipt','रसीद')}: <code>{receipt.items.map(r => r.submissionId.slice(0, 8)).join(', ')}</code></p></section> : null;
    if (schoolLink) {
        const initials = String(teacherValue || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const label = p => [[option(p.grade), p.section && p.section !== 'Not Applicable' ? p.section : ''].filter(Boolean).join(' '), option(p.subject)].filter(Boolean).join(' · ');
        const next = todaysLessons(summary).find(l => l.resumeToken !== resumeToken && !l.evidence);
        const tab = next => { setSheet(false); if (next === 'read') return; go(next); };
        if (video.id && (!video.watched || video.replay)) return <div className="teacher-workspace tp ta-app" lang={language} ref={top}>
         <div className="ta-top"><div className="ta-brand"><i>S</i>School Success</div></div>
         <OnboardingVideo key={video.id + (video.replay ? ':r' : '')} videoId={video.id} language={language} headers={contextHeaders} firstTime={!video.watched} onDone={() => setVideo(v => ({ ...v, watched: true, replay: false }))}/>
        </div>;
        return <div className="teacher-workspace tp ta-app" lang={language} ref={top}>
         <div className="ta-top"><div className="ta-brand"><i>S</i>School Success</div><button type="button" className="ta-avatar" aria-label={t('Your profile','आपकी प्रोफ़ाइल')} onClick={() => setSheet(true)}>{initials}</button></div>
         {pinPanel && <ChangePin language={language} teacher={teacherValue} onCancel={() => setPinPanel(false)} onDone={() => { setPinPanel(false); setPinNotice(t('Your new PIN is saved. Other phones were signed out.','आपका नया PIN सहेजा गया। दूसरे फ़ोन से साइन आउट हो गया।')); }}/>}
         {pinNotice && <div className="alert success" role="status">{pinNotice}</div>}
         {!data.uploadsEnabled && <div className="alert" role="status">{t('Lesson plans and written reflections are active. Photo and video uploads are waiting for the school’s media storage.','पाठ योजना और लिखित चिंतन चालू हैं। फोटो और वीडियो अपलोड मीडिया भंडारण जुड़ने के बाद चालू होंगे।')}</div>}
         {mode === '' && <TeacherHome summary={summary} language={language} teacher={teacherValue} school={selectedSchool} newFeedback={newFeedbackCount(summary, who)} onRead={readPlan} onEvidence={openLesson} onPlan={() => go('preparation')} loading={summaryLoading} error={summaryError} onRetry={loadSummary} notice={receiptCard}/>}
         {mode === 'read' && readTarget && <PlanReader key={readTarget.token + ':' + readTarget.period} token={readTarget.token} periodIndex={readTarget.period} match={readTarget.match} request={request} language={language} today={summary?.today || day()} onBack={() => go('')} onEvidence={openLesson}/>}
         {mode === 'evidence' && <div id="lesson-evidence"><LessonEvidence language={language} key={selectedSchool + '|' + teacherValue + '|' + resumeToken} token={resumeToken} headers={contextHeaders} uploadsEnabled={data.uploadsEnabled} school={selectedSchool} teacher={teacherValue} compactSearch lessonChoices={summary?.lessons} onPickLesson={token => openLesson(token)} initialPeriod={evPeriod} onReadPlan={readPlan} onHome={() => go('')} nextLesson={next && { badge: dayLabel(next.plannedOn, language).split(',')[0], title: label(next.periods[0] || {}) + (next.periods.length > 1 ? ' +' + (next.periods.length - 1) : ''), subtitle: (next.periods[0]?.topic || '') + ' · ' + t('Read plan','योजना पढ़ें'), onOpen: () => readPlan(next.resumeToken, 0, next.periods[0]) }} onSaved={async () => { void loadSummary(); }}/></div>}
         {mode === 'feedback' && <div className="ta-feedback"><FeedbackCard summary={summary} language={language} who={who} onOpen={token => readPlan(token, 0)} onNote={noteFeedback}/></div>}
         {mode === 'preparation' && <LessonPlanForm key={draftKey} language={language} plan={plan} setPlan={setPlan} identity={identity} submit={submit} busy={busy} error={error} canSave={!!selectedSchool && !!teacherValue} draftStatus={draftStatus} today={day()}/>}
         {mode !== 'preparation' && error && <div className="alert error" role="alert">{error}</div>}
         <TabBar mode={mode} onGo={tab} badge={mode === 'feedback' ? 0 : newFeedbackCount(summary, who)} language={language} disabled={!!busy}/>
         <ProfileSheet open={sheet} onClose={() => setSheet(false)} name={teacherValue} school={selectedSchool} language={language} onLanguage={chooseLanguage} onChangePin={() => { setSheet(false); setPinNotice(''); setPinPanel(true); requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start' })); }} onLogout={() => { setSheet(false); void signOut(); }} onVideo={video.id ? () => { setSheet(false); setVideo(v => ({ ...v, replay: true })); } : undefined}/>
        </div>;
    }
    return <div className="teacher-workspace tp" lang={language} ref={top}>
     <div className="tp-top">
      <div><span className="eyebrow">{t('REFLECT • SHARE • GROW','सोचें • साझा करें • आगे बढ़ें')}</span><h2>{teacherValue ? t('Welcome, ','नमस्ते, ') + teacherValue : t('Teacher workspace','शिक्षक कार्यक्षेत्र')}</h2><p>{selectedSchool}</p></div>
      <div className="tp-tools"><label className="tp-language"><Languages size={16}/><select aria-label={t('Language','भाषा')} value={language} disabled={!!busy} onChange={e=>chooseLanguage(e.target.value)}><option value="en">English</option><option value="hi">हिन्दी</option></select></label>
       {schoolLink && <><button type="button" className="tp-chip" disabled={!!busy} onClick={() => { setPinPanel(v => !v); setPinNotice(''); }}><KeyRound size={15}/>{t('Change PIN','PIN बदलें')}</button><button type="button" className="tp-chip" disabled={!!busy} onClick={() => void signOut()}><LogOut size={15}/>{t('Log out','लॉग आउट')}</button></>}</div>
     </div>
     {schoolLink && pinPanel && <ChangePin language={language} teacher={teacherValue} onCancel={() => setPinPanel(false)} onDone={() => { setPinPanel(false); setPinNotice(t('Your new PIN is saved. Other phones were signed out.','आपका नया PIN सहेजा गया। दूसरे फ़ोन से साइन आउट हो गया।')); }}/>}
     {pinNotice && <div className="alert success" role="status">{pinNotice}</div>}
     {admin && <SchoolSharingLinks schools={[...new Set(roster.map(r => r.school))].filter(Boolean).sort()}/>}
     {admin && <TeacherPinAdmin schools={[...new Set(roster.map(r => r.school))].filter(Boolean).sort()}/>}
     {!data.uploadsEnabled && <div className="alert" role="status">Lesson details and written reflections are active. Photo, video and voice uploads are awaiting the administrator’s media-storage connection.</div>}
     {teacherValue && mode !== 'preparation' && <SummaryStrip summary={summary} language={language}/>}
     {receiptCard}
     {mode && <button type="button" className="text-button tp-back" onClick={() => go('')}><ArrowLeft size={15}/>{t('Back to home','मुख्य पृष्ठ पर लौटें')}</button>}
     <div className={'teacher-actions tp-actions' + (mode ? ' compact' : '')} role="group" aria-label={t('What would you like to do?','आप क्या करना चाहेंगे?')}>
      <button className={'teacher-action' + (mode === 'preparation' ? ' selected' : '')} aria-pressed={mode === 'preparation'} type="button" disabled={!!busy} onClick={() => go('preparation')}><span className="tp-action-icon"><ClipboardList size={24}/></span><b>{t('Submit lesson plan','पाठ योजना जमा करें')}</b><span>{t('Plan the next day, or one subject for the week.','अगले दिन की, या एक विषय की साप्ताहिक योजना बनाएँ।')}</span></button>
      <button className={'teacher-action' + (mode === 'evidence' ? ' selected' : '')} aria-pressed={mode === 'evidence'} type="button" disabled={!!busy} onClick={() => go('evidence')}><span className="tp-action-icon c2"><Camera size={24}/></span><b>{t('Add evidence','प्रमाण जोड़ें')}</b><span>{t('After teaching, add photos, written work and your reflection.','कक्षा के बाद फोटो, लिखित कार्य और चिंतन जोड़ें।')}</span></button>
     </div>
     {mode === '' && teacherValue && <div className="tp-home-grid">
      <RecentLessons summary={summary} language={language} onOpen={openLesson} limit={3} onShowAll={() => go('evidence')} loading={summaryLoading} error={summaryError} onRetry={loadSummary}/>
      <FeedbackCard summary={summary} language={language} who={who} onOpen={openLesson}/>
     </div>}
     {mode === '' && !teacherValue && admin && <section className="ts-card"><div className="ts-empty"><BookOpenCheck size={28}/><p>{t('Choose a teacher to see their lessons.','पाठ देखने के लिए शिक्षक चुनें।')}</p></div>{identity}</section>}
     {mode === 'evidence' && <>
      {admin && <section className="ts-card">{identity}</section>}
      {!resumeToken && <RecentLessons summary={summary} language={language} onOpen={openLesson} loading={summaryLoading} error={summaryError} onRetry={loadSummary}/>}
      <div id="lesson-evidence"><LessonEvidence language={language} key={selectedSchool + '|' + teacherValue + '|' + resumeToken} token={resumeToken} headers={contextHeaders} uploadsEnabled={data.uploadsEnabled} school={selectedSchool} teacher={teacherValue} compactSearch lessonChoices={summary?.lessons} onPickLesson={openLesson} onSaved={async () => { void loadSummary(); if (admin) await refresh(); }}/></div>
      {savedLinks.some(l => l.school === selectedSchool && l.teacher === teacherValue) && <section className="ts-card"><details><summary>{t('Saved lessons on this device','इस उपकरण पर सहेजे गए पाठ')}</summary>{savedLinks.filter(l => l.school === selectedSchool && l.teacher === teacherValue).map(l => <p key={l.submissionId}><a href={l.url}>{dayLabel(l.date, language) || l.date} · {l.teacher}</a></p>)}</details></section>}
     </>}
     {mode === 'preparation' && <LessonPlanForm key={draftKey} language={language} plan={plan} setPlan={setPlan} identity={identity} submit={submit} busy={busy} error={error} canSave={!!selectedSchool && !!teacherValue} draftStatus={draftStatus} today={day()}/>}
     {mode !== 'preparation' && error && <div className="alert error" role="alert">{error}</div>}
    </div>;
}
