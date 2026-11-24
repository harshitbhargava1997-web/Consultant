'use client';
import WrittenReflection from './written-reflection';
import {classroomEvidenceCategories} from '@/lib/classroom-evidence';
import {closurePrompts} from '@/lib/closure-reflection';
import {parseClosureText,isReflectionTextUrl} from '@/lib/school-success/reflection-text';
import {isGeneratedPreparationPdf} from '@/lib/school-success/lesson-records';
import {successFetch} from '@/lib/school-success/client';
import {mapLimited} from '@/lib/school-success/parallel';
import {requestJson} from '@/lib/school-success/request-json';
import {transferWrittenReflections} from '@/lib/school-success/storage-upload';
import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, FileText, ChevronDown, Check } from 'lucide-react';
import { dayLabel } from './lesson-plan-form';
import { evidenceCategories, submissionSchema } from '@/lib/school-success/teacher-submissions';
import { lessonStageLabel } from '@/lib/school-success/lesson-workflow';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const showDay = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? Number(m[3]) + ' ' + months[Number(m[2]) - 1] + ' ' + m[1] : ''; };
const isAudio = url => /\.(wav|mp3|m4a|ogg|webm|aac)(\?|$)/i.test(url);

// Saved material for one class period, shown as readable text and links (never raw JSON).
export function SavedPeriodRecord({ lesson, period }) {
    const files = lesson.files.filter(f => f.periodId === period.id), byDate = (a, b) => (a.date || '').localeCompare(b.date || '');
    const closure = files.filter(f => f.category === 'After-class reflection');
    const written = closure.filter(f => isReflectionTextUrl(f.url)).sort(byDate), legacy = closure.filter(f => !isReflectionTextUrl(f.url) && !isAudio(f.url)).sort(byDate);
    const recordings = files.filter(f => isAudio(f.url) && (f.category === 'After-class reflection' || f.category === 'Voice reflection')).sort(byDate);
    // The generated preparation PDF repeats the saved preparation text shown above; keep it only when no text exists.
    const other = files.filter(f => f.category !== 'After-class reflection' && !(f.category === 'Voice reflection' && isAudio(f.url)) && !(isGeneratedPreparationPdf(f.url) && period.reflection?.trim())).sort(byDate);
    const feedback = (lesson.feedback || []).filter(r => r.periodId === period.id);
    return <>
        <details><summary>Saved lesson preparation</summary><p style={{ whiteSpace: 'pre-wrap' }}>{period.reflection || 'No written notes recorded.'}</p></details>
        {written.length > 0 && <div className="saved-reflections"><h4>Saved after-class reflections</h4>{written.map((f, i) => <article className="saved-reflection" key={f.url}><b>Reflection {written.length > 1 ? i + 1 + ' · ' : ''}{showDay(f.date) || 'Date not recorded'}</b>{f.reflection ? closurePrompts.filter(([key]) => f.reflection.answers?.[key]).map(([key, label]) => <div key={key}><span>{label}</span><p>{f.reflection.answers[key]}</p></div>) : <p className="hint">This reflection could not be loaded just now. Use “Reload saved lesson” to try again.</p>}</article>)}</div>}
        {legacy.length > 0 && <div><h4>Earlier reflections (saved PDF)</h4><div className="evidence-files">{legacy.map(f => <a className="file" href={f.url} key={f.url} target="_blank" rel="noopener noreferrer"><FileText size={15}/>Reflection PDF{f.date ? ' · ' + showDay(f.date) : ''}</a>)}</div></div>}
        {recordings.length > 0 && <div><h4>Recordings</h4>{recordings.map(f => <p key={f.url}><small>{f.category === 'Voice reflection' ? 'Lesson planning recording' : 'After-class recording'}{f.date ? ' · ' + showDay(f.date) : ''}</small><audio controls preload="none" src={f.url} style={{ width: '100%' }}/></p>)}</div>}
        {other.length > 0 && <div className="evidence-files">{other.map((f, i) => <a className="file" href={f.url} key={f.url + ':' + i} target="_blank" rel="noopener noreferrer"><FileText size={15}/>{f.category}{f.date ? ' · ' + showDay(f.date) : ''}</a>)}</div>}
        {feedback.map((r, i) => <div className="feedback" key={i}><b>Academic Review{r.date ? ' · ' + showDay(String(r.date).slice(0, 10)) : ''}</b><p>{r.text}</p></div>)}
    </>;
}

// Lessons a teacher can add evidence to from the day dropdown: planned on or before today, newest first.
export function evidenceDayChoices(lessons, todayValue) {
    return (lessons || []).filter(l => l.resumeToken && l.plannedOn && l.plannedOn <= todayValue).sort((a, b) => b.plannedOn.localeCompare(a.plannedOn) || String(a.id).localeCompare(String(b.id)));
}
export function periodLabel(p, i, language = 'en') {
    const section = p.section && p.section !== 'Not Applicable' ? p.section : '';
    return (language === 'hi' ? 'कालांश ' : 'Period ') + (i + 1) + ' · ' + [[p.grade, section].filter(Boolean).join(' '), p.subject].filter(Boolean).join(' · ');
}

export default function LessonEvidence({ token: initialToken, headers, uploadsEnabled, school, teacher, onSaved, language='en', compactSearch=false, lessonChoices, onPickLesson }) {
    const t=(en,hi)=>language==='hi'?hi:en;
    // Which class periods are expanded. Closed periods stay mounted (hidden), so their chosen files and typed
    // reflections are kept and still submitted.
    const [open, setOpen] = useState(() => new Set()), [focus, setFocus] = useState('');
    const [token, setToken] = useState(initialToken), [date, setDate] = useState(today()), [matches, setMatches] = useState(null);
    const [lesson, setLesson] = useState(null), [pending, setPending] = useState({}), [category, setCategory] = useState({}), [conductedOn, setConductedOn] = useState(''), [updateId, setUpdateId] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(''), [error, setError] = useState(''), [receipt, setReceipt] = useState(null);
    const [reflections, setReflections] = useState({});
    const uploadedFiles = useRef(new Set());
    async function request(body) {
        try {
            return await requestJson(() => successFetch('/api/school-success/evidence', {method: 'POST', headers: {'Content-Type': 'application/json', ...headers()}, body: JSON.stringify(body)}));
        } catch (error) {
            if (error.fileId) uploadedFiles.current.delete(error.fileId);
            throw error;
        }
    }

    async function find(e) { e.preventDefault(); setError(''); setBusy('Finding saved lessons'); setMatches(null); setLesson(null); setReceipt(null); setToken(''); try {
        const d = await request({ action: 'findLessons', school, teacher, date });
        setMatches(d.lessons);
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy('');
    } }
    async function load(keepReceipt = false) { if (!token)
        return; setError(''); setBusy('Loading saved preparation'); if (!keepReceipt)
        setReceipt(null); try {
        const d = await request({ action: 'resume', resume: token });
        setLesson(d);
        setConductedOn(d.conductedOn || (d.submission.date <= today() ? d.submission.date : ''));
        uploadedFiles.current.clear();
        setPending({}); setReflections({});
        setUpdateId(crypto.randomUUID());
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy('');
    } }
    useEffect(() => { if (token)
        void load(); }, [token]);
    const lessonKey = lesson?.submission?.id || '';
    useEffect(() => { const first = lesson?.submission?.periods?.[0]?.id; setOpen(new Set(first ? [first] : [])); setFocus(first || ''); }, [lessonKey]);
    const dirty = Object.values(pending).some(a => a?.length) || Object.values(reflections).some(v => v?.trim());
    const days = onPickLesson ? evidenceDayChoices(lessonChoices, today()) : [];
    function pickDay(value) {
        if (!value || value === token) return;
        if (dirty && !window.confirm(t('Files or a reflection you added for this lesson have not been submitted. Switch lesson and discard them?','इस पाठ के लिए जोड़ी गई फ़ाइलें या चिंतन अभी जमा नहीं हुए हैं। पाठ बदलकर उन्हें हटाएँ?'))) return;
        onPickLesson(value);
    }
    function pickPeriod(id) {
        setFocus(id); setOpen(new Set([id]));
        requestAnimationFrame(() => document.getElementById('ev-period-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    function togglePeriod(id) { setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); setFocus(id); }
    const dayOption = l => { const first = l.periods?.[0] || {}; return (dayLabel(l.plannedOn, language) || l.plannedOn) + ' · ' + [[first.grade, first.section && first.section !== 'Not Applicable' ? first.section : ''].filter(Boolean).join(' '), first.subject].filter(Boolean).join(' · ') + ((l.periods?.length || 0) > 1 ? ' +' + (l.periods.length - 1) : '') + ' · ' + (l.evidence ? t('evidence added','प्रमाण जमा') : t('evidence needed','प्रमाण बाकी')); };
    // On any failure the typed reflections and chosen files stay on screen with the same update ID, so a retry
    // resubmits the same update and cannot create a duplicate.
    async function save(e) { e.preventDefault(); if (!lesson || busy)
        return; setError(''); setBusy('Checking classroom update'); try {
        const all = Object.entries(pending).flatMap(([periodId,items])=>items.map(f=>({...f,periodId})));
        // Written reflections are sent as text; the server saves them as dated, lesson-linked records.
        const written = lesson.submission.periods.filter(p => reflections[p.id]?.trim()).map(p => ({ periodId: p.id, answers: parseClosureText(reflections[p.id]) })).filter(r => r.answers.achievement || r.answers.nextStep);
        if (Object.values(reflections).some(value=>/_{2,}/.test(value))) throw Error(t('Complete the blanks in your written reflection.','चिंतन के खाली स्थान पूरे करें।'));
        if (!all.length && !written.length)
            throw Error('Add a classroom evidence file or an after-class reflection before submitting.');
        const submission = submissionSchema.parse({ ...lesson.submission, files: all.map(f => ({ id: f.id, periodId:f.periodId, category: f.category, name: f.file.name, size: f.file.size })) });
        const prepared = await request({ action: 'prepare', mode: 'evidence', resume: token, submission, version: lesson.version, updateId, conductedOn, reflections: written, uploadWrittenReflections: true, directUploads: true });
        let result = prepared;
        if (!prepared.saved) {
            let completed = prepared.files.filter(f => uploadedFiles.current.has(f.id)).length;
            const transfers = prepared.files.filter(f => !uploadedFiles.current.has(f.id)).map(f => async () => {
                const actual = all.find(x => x.id === f.id);
                if (!actual) throw Error('A selected file is missing. Choose it again.');
                const response = await successFetch('/api/school-success/evidence/upload', {
                    method: 'POST', headers: {...headers(), 'X-Evidence-Token': f.token}, body: actual.file, uploadTicket: f.upload
                });
                if (!response.ok) throw Error((await response.json()).error || 'Upload failed');
                uploadedFiles.current.add(f.id);
                setBusy('Uploaded ' + (++completed) + ' of ' + prepared.files.length + ' files');
            });
            if (prepared.reflectionUploads?.length) transfers.unshift(() => transferWrittenReflections(prepared.reflectionUploads));
            setBusy('Uploading classroom evidence');
            await mapLimited(transfers, transfer => transfer());
            setBusy('Attaching evidence to the lesson');
            result = await request({ action: 'commit', token: prepared.token, submission, reflections: written });
        }
        setReceipt(result);
        // A receipt closes this draft even if refreshing the saved lesson fails. Reopening starts a new update.
        setLesson(null);
        setPending({}); setReflections({}); uploadedFiles.current.clear();
        setUpdateId(crypto.randomUUID());
        setBusy('');
        void Promise.resolve().then(onSaved).catch(() => setError('Your evidence was saved. Refresh the workspace to see the updated report.'));
    }
    catch (e) {
        setError(e.message + ' Your reflection and files are still here; submit again to retry.');
        setBusy('');
    } }
    return <section className="card"><div className="card-head"><div><h2>{t('Submit evidence','प्रमाण जमा करें')}</h2><p>{t('Find the lesson you prepared, then add evidence and your after-class reflection.','अपनी पाठ योजना चुनें, फिर प्रमाण और कक्षा के बाद का चिंतन जोड़ें।')}</p></div></div>{days.length > 0 && <label className="field ev-pick"><span>{t('Lesson day','पाठ का दिन')}</span><select value={days.some(l => l.resumeToken === token) ? token : ''} disabled={!!busy} onChange={e => pickDay(e.target.value)}><option value="">{t('Choose the day you taught','पढ़ाने का दिन चुनें')}</option>{days.map(l => <option key={l.id} value={l.resumeToken}>{dayOption(l)}</option>)}</select><small className="hint">{t('Lessons from your daily and weekly plans, newest first.','आपकी दैनिक और साप्ताहिक योजनाओं के पाठ, नए पहले।')}</small></label>}{(!compactSearch||!token)&&<details className="ts-search" open={!compactSearch&&!days.length}><summary>{t('Can’t find your lesson? Search by planned date','पाठ नहीं मिल रहा? योजना की तिथि से खोजें')}</summary><form onSubmit={find}><label className="field"><span>{t('Planned lesson date','पाठ की नियोजित तिथि')}</span><input type="date" required value={date} onChange={e => { setDate(e.target.value); setMatches(null); setLesson(null); setToken(''); setReceipt(null); }} disabled={!!busy}/></label><button className="button primary" type="submit" disabled={!!busy || !teacher || !school}>{t('Find saved lessons','सहेजे गए पाठ खोजें')}</button><p className="hint">{t('Choose the date used when saving your preparation. Select the matching class, subject and topic below.','योजना सहेजते समय चुनी तिथि चुनें। नीचे कक्षा, विषय और पाठ चुनें।')}</p></form></details>}{matches && <div>{matches.length === 0 ? <p role="status">{t('No saved preparations found for this teacher and date. Check the planned date, or save your lesson preparation first.','इस शिक्षक और तिथि के लिए योजना नहीं मिली। तिथि जाँचें या पहले योजना जमा करें।')}</p> : matches.map(m => <div className="teacher-period" key={m.id}>{m.periods.map((p, i) => <p key={i}><b>Period {i + 1} · {p.grade} {p.section} · {p.subject}</b><br />{p.topic}</p>)}<span className="pill green">{lessonStageLabel(m.stage)}</span> <button type="button" className="button" disabled={!!busy} onClick={() => { if (token === m.resumeToken)
        void load();
    else {
        setLesson(null);
        setToken(m.resumeToken);
    } }}>{t('Select lesson / add evidence','पाठ चुनें / प्रमाण जोड़ें')}</button></div>)}</div>}{busy && <p role="status">{busy}…</p>}{error && <div className="alert error" role="alert">{error}</div>}{token && <button className="text-button" type="button" disabled={!!busy} onClick={() => void load()}>{t('Reload saved lesson','सहेजा पाठ फिर खोलें')}</button>}{receipt && <div className="alert success" role="status">{receipt.alreadySaved ? 'This update was already saved.' : 'Evidence saved · ' + lessonStageLabel(receipt.stage || lesson?.stage)} · Receipt {receipt.submissionId}</div>}{lesson && <><div className="flex-between"><div><h3>{lesson.submission.school} · {lesson.submission.teacher}</h3><p>Planned lesson date: {lesson.submission.date}</p></div><span className="pill green">{lessonStageLabel(lesson.stage)}</span></div><form onSubmit={save}><fieldset className="teacher-fields" disabled={!!busy}><label className="field"><span>{t('Actual lesson conducted on','पढ़ाने की वास्तविक तिथि')}</span><input type="date" required max={today()} value={conductedOn} onChange={e => setConductedOn(e.target.value)}/></label><p className="hint">{t('Use the day you taught the lesson. The evidence upload time is recorded separately.','जिस दिन पढ़ाया वह तिथि चुनें। प्रमाण जमा करने का समय अलग सहेजा जाता है।')}</p>{lesson.submission.periods.length > 1 && <label className="field ev-pick"><span>{t('Add evidence for','प्रमाण किसके लिए')}</span><select value={focus} onChange={e => pickPeriod(e.target.value)}>{lesson.submission.periods.map((p, i) => <option key={p.id} value={p.id}>{periodLabel(p, i, language)}{p.topic ? ' · ' + p.topic : ''}{(pending[p.id]?.length || reflections[p.id]?.trim()) ? ' ✓' : ''}</option>)}</select><small className="hint">{t('Open one period at a time. Files added to other periods are kept and submitted together.','एक बार में एक कालांश खोलें। दूसरे कालांशों में जोड़ी गई फ़ाइलें भी साथ में जमा होंगी।')}</small></label>}{lesson.submission.periods.map((p, index) => { const single = lesson.submission.periods.length === 1, isOpen = single || open.has(p.id), added = (pending[p.id]?.length || 0), wrote = !!reflections[p.id]?.trim(), saved = lesson.files.some(f => f.periodId === p.id);
        return <section className={'lp-card lp-block ev-period' + (isOpen ? ' open' : '') + (added || wrote ? ' complete' : '')} id={'ev-period-' + p.id} key={p.id}><header className="lp-block-head"><button type="button" className="lp-block-toggle" aria-expanded={isOpen} disabled={single} onClick={() => togglePeriod(p.id)}><span className="lp-num">{added || wrote ? <Check size={16}/> : index + 1}</span><span className="lp-block-title"><b>{periodLabel(p, index, language)}</b><small>{p.topic || t('No topic recorded','विषयवस्तु दर्ज नहीं')}</small></span>{added || wrote ? <span className="pill green">{[added ? added + ' ' + t(added === 1 ? 'file' : 'files', 'फ़ाइल') : '', wrote ? t('reflection', 'चिंतन') : ''].filter(Boolean).join(' · ')}</span> : saved ? <span className="pill">{t('Evidence saved','प्रमाण सहेजा')}</span> : null}{!single && <ChevronDown size={18} className="lp-chevron"/>}</button></header><div className="lp-block-body teacher-period" hidden={!isOpen}><SavedPeriodRecord lesson={lesson} period={p}/><WrittenReflection language={language} key={p.id+':'+updateId} disabled={!!busy} onChange={text=>setReflections(old=>({...old,[p.id]:text}))}/><label className="field"><span>{t('Evidence category','प्रमाण का प्रकार')}</span><select value={category[p.id] || 'activity'} onChange={e => setCategory(c => ({ ...c, [p.id]: e.target.value }))}>{Object.entries(classroomEvidenceCategories).map(([key, value]) => <option key={key} value={key}>{language==='hi'?({activity:'कक्षा की गतिविधियाँ',writing:'विद्यार्थी का लिखित कार्य',remedial:'सुधारात्मक सहायता',portfolio:'विद्यार्थी पोर्टफोलियो / आकलन'}[key]||value):value}</option>)}</select></label><label className="upload-zone"><Upload size={24}/><b>{t('Add classroom photos, videos, written work or PDF','कक्षा के फोटो, वीडियो, लिखित कार्य या PDF जोड़ें')}</b><span>50 MB per file · 100 MB per update · 50 files</span><input type="file" multiple disabled={!uploadsEnabled} accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg" onChange={e => { const selected = Array.from(e.target.files || []); e.target.value = ''; setPending(prev => ({ ...prev, [p.id]: [...prev[p.id] || [], ...selected.map(file => ({ id: crypto.randomUUID(), category: category[p.id] || 'activity', file }))] })); }}/></label>{(pending[p.id] || []).map(f => <div className="teacher-file" key={f.id}><FileText size={15}/><div><b>{f.file.name}</b><small>{evidenceCategories[f.category].label}</small></div><button type="button" className="icon" aria-label={'Remove ' + f.file.name} onClick={() => setPending(prev => ({ ...prev, [p.id]: prev[p.id].filter(x => x.id !== f.id) }))}><Trash2 size={15}/></button></div>)}</div></section>; })}<div className="actions"><button className="button primary" type="submit">{t('Submit classroom evidence','कक्षा के प्रमाण जमा करें')}</button></div></fieldset></form>{lesson.evidenceAt && <p className="hint">Latest evidence submitted: {new Date(/Z$|[+-]\d\d:\d\d$/.test(lesson.evidenceAt) ? lesson.evidenceAt : lesson.evidenceAt + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>}</>}</section>;
}
