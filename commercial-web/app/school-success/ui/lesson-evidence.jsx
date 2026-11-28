'use client';
import WrittenReflection from './written-reflection';
import {classroomEvidenceCategories} from '@/lib/classroom-evidence';
import {closurePrompts} from '@/lib/closure-reflection';
import {parseClosureText,isReflectionTextUrl} from '@/lib/school-success/reflection-text';
import {isGeneratedPreparationPdf} from '@/lib/school-success/lesson-records';
import {successFetch} from '@/lib/school-success/client';
import {mapLimited} from '@/lib/school-success/parallel';
import {shrinkPhoto} from '@/lib/school-success/shrink-photo';
import {planDays} from '@/lib/school-success/day-periods';
import {periodNumberOf} from '@/lib/school-success/period-number';
import {requestJson} from '@/lib/school-success/request-json';
import {transferWrittenReflections} from '@/lib/school-success/storage-upload';
import { useEffect, useRef, useState } from 'react';
import { FileText, Check, Camera, Images, Users, PencilLine, Puzzle, FolderOpen, X, Image as ImageIcon, Video, Mic, Target, BookOpen, ChevronDown, CircleCheck, House, ChevronRight } from 'lucide-react';
import { parsePlanText } from '@/lib/school-success/plan-text';
import { dayLabel } from './lesson-plan-form';
import { submissionSchema } from '@/lib/school-success/teacher-submissions';
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
// The day's number of a lesson's first period (as on Home: the chosen period, else save order); 1 when unknown.
export function firstPeriodNumber(lessons, lessonId) {
    return lessonPeriodNumbers(lessons, lessonId)[0] || 1;
}
// The day's period number of each of a lesson's periods, by their position in the lesson.
export function lessonPeriodNumbers(lessons, lessonId) {
    for (const d of planDays(lessons)) { const hits = d.periods.filter(x => x.lesson.id === lessonId); if (hits.length) { const out = []; for (const x of hits) out[x.index] = x.number; return out; } }
    return [];
}
export function periodLabel(p, i, language = 'en') {
    const section = p.section && p.section !== 'Not Applicable' ? p.section : '';
    return (language === 'hi' ? 'कालांश ' : 'Period ') + (i + 1) + ' · ' + [[p.grade, section].filter(Boolean).join(' '), p.subject].filter(Boolean).join(' · ');
}

export const evidenceTypes = [['activity', Users, 'Classroom activity', 'कक्षा की गतिविधि', 'c1'], ['writing', PencilLine, 'Written work', 'लिखित कार्य', 'c2'], ['remedial', Puzzle, 'Remedial support', 'सुधारात्मक सहायता', 'c3'], ['portfolio', FolderOpen, 'Portfolio / assessment', 'पोर्टफोलियो / आकलन', 'c4']];
const typeLabel = (key, language) => { const t = evidenceTypes.find(e => e[0] === key); return t ? (language === 'hi' ? t[3] : t[2]) : key; };
// What the teacher is about to submit, for the fixed Submit button: "Submit 3 files + reflection".
export function submitSummary(pending, reflections, language = 'en') {
    const files = Object.values(pending || {}).reduce((n, a) => n + (a?.length || 0), 0), wrote = Object.values(reflections || {}).some(v => v?.trim());
    const hi = language === 'hi';
    if (!files && !wrote) return hi ? 'कक्षा के प्रमाण जमा करें' : 'Submit classroom evidence';
    const parts = [files ? (hi ? files + ' फ़ाइल' : files + (files === 1 ? ' file' : ' files')) : '', wrote ? (hi ? 'चिंतन' : 'reflection') : ''].filter(Boolean);
    return (hi ? 'जमा करें · ' : 'Submit ') + parts.join(' + ');
}
// One chosen file, shown as a small picture (photos) or an icon (video, audio, PDF) until it is submitted.
function Thumb({ item, label, onRemove, removeLabel }) {
    const [url, setUrl] = useState(''), type = item.file.type || '';
    useEffect(() => { if (!type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return; const u = URL.createObjectURL(item.file); setUrl(u); return () => URL.revokeObjectURL(u); }, [item.file]);
    const Icon = type.startsWith('video/') ? Video : type.startsWith('audio/') ? Mic : type.startsWith('image/') ? ImageIcon : FileText;
    return <div className={'ev-thumb' + (url ? ' has-image' : '')} title={item.file.name}>{url ? <img src={url} alt={item.file.name}/> : <span className="ev-thumb-icon"><Icon size={24}/><small>{item.file.name}</small></span>}<span className="ev-thumb-tag">{label}</span><button type="button" className="ev-thumb-x" aria-label={removeLabel} onClick={onRemove}><X size={13}/></button></div>;
}

export default function LessonEvidence({ token: initialToken, headers, uploadsEnabled, school, teacher, onSaved, language='en', compactSearch=false, lessonChoices, onPickLesson, initialPeriod, onReadPlan, onHome, nextLesson }) {
    const t=(en,hi)=>language==='hi'?hi:en;
    // The period being worked on. Other periods stay mounted (hidden), so their chosen files and typed reflections
    // are kept and still submitted together.
    const [focus, setFocus] = useState('');
    const [token, setToken] = useState(initialToken), [date, setDate] = useState(today()), [matches, setMatches] = useState(null);
    const [lesson, setLesson] = useState(null), [pending, setPending] = useState({}), [category, setCategory] = useState({}), [conductedOn, setConductedOn] = useState(''), [updateId, setUpdateId] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(''), [error, setError] = useState(''), [receipt, setReceipt] = useState(null), [shared, setShared] = useState(null);
    const [reflections, setReflections] = useState({});
    const uploadedFiles = useRef(new Set());
    // Large photos are resized as soon as they are chosen (see shrink-photo.js), so the upload is smaller and the
    // resizing happens while the teacher is still writing. Keyed by the chosen file's ID; a retry reuses the same result.
    const shrunk = useRef(new Map());
    const uploadable = item => { if (!shrunk.current.has(item.id)) shrunk.current.set(item.id, shrinkPhoto(item.file)); return shrunk.current.get(item.id); };
    async function request(body) {
        try {
            return await requestJson(() => successFetch('/api/school-success/evidence', {method: 'POST', headers: {'Content-Type': 'application/json', ...headers()}, body: JSON.stringify(body)}));
        } catch (error) {
            if (error.fileId) uploadedFiles.current.delete(error.fileId);
            throw error;
        }
    }

    async function find(e) { e.preventDefault(); setError(''); setBusy('Finding saved lessons'); setMatches(null); setLesson(null); setReceipt(null); setShared(null); setToken(''); try {
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
        { setReceipt(null); setShared(null); } try {
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
    // Opens on the period the teacher came from (Read plan → After class), else the first one.
    useEffect(() => { const periods = lesson?.submission?.periods || []; const want = Number.isInteger(initialPeriod) ? periods[initialPeriod] : null; setFocus((want || periods[0])?.id || ''); }, [lessonKey]);
    const dirty = Object.values(pending).some(a => a?.length) || Object.values(reflections).some(v => v?.trim());
    const days = onPickLesson ? evidenceDayChoices(lessonChoices, today()) : [];
    function pickDay(value) {
        if (!value || value === token) return;
        if (dirty && !window.confirm(t('Files or a reflection you added for this lesson have not been submitted. Switch lesson and discard them?','इस पाठ के लिए जोड़ी गई फ़ाइलें या चिंतन अभी जमा नहीं हुए हैं। पाठ बदलकर उन्हें हटाएँ?'))) return;
        onPickLesson(value);
    }
    function addFiles(periodId, list) {
        const selected = Array.from(list || []);
        if (!selected.length) return;
        const items = selected.map(file => ({ id: crypto.randomUUID(), category: category[periodId] || 'activity', file }));
        items.forEach(uploadable);
        setPending(prev => ({ ...prev, [periodId]: [...prev[periodId] || [], ...items] }));
    }
    const first1 = lessonChoices && lesson ? firstPeriodNumber(lessonChoices, lesson.submission?.id) - 1 : 0;
    // A period's number on its day: the chosen period (1–8) when the plan has one (28 November 2026), else as on Home.
    const dayNums = lessonChoices && lesson ? lessonPeriodNumbers(lessonChoices, lesson.submission?.id) : [];
    const numberAt = i => periodNumberOf((lesson?.submission?.periods || [])[i]?.reflection) || dayNums[i] || first1 + i + 1;
    const numbers = l => { const ns = lessonPeriodNumbers(lessonChoices, l.id).filter(Boolean), n = l.periods?.length || 1; return (language === 'hi' ? 'कालांश ' : n > 1 ? 'Periods ' : 'Period ') + (ns.length ? [...ns].sort((x, y) => x - y).join(', ') : 1); };
    const dayOption = l => { const first = l.periods?.[0] || {}; return (dayLabel(l.plannedOn, language) || l.plannedOn) + ' · ' + numbers(l) + ' · ' + [[first.grade, first.section && first.section !== 'Not Applicable' ? first.section : ''].filter(Boolean).join(' '), first.subject].filter(Boolean).join(' · ') + ((l.periods?.length || 0) > 1 ? ' +' + (l.periods.length - 1) : '') + (l.evidence ? ' · ✓ ' + t('evidence added','प्रमाण जमा') : ''); };
    // On any failure the typed reflections and chosen files stay on screen with the same update ID, so a retry
    // resubmits the same update and cannot create a duplicate.
    async function save(e) { e.preventDefault(); if (!lesson || busy)
        return; setError(''); setBusy('Checking classroom update'); try {
        const chosen = Object.entries(pending).flatMap(([periodId,items])=>items.map(f=>({...f,periodId})));
        if (chosen.length) setBusy('Preparing photos');
        const all = await Promise.all(chosen.map(async f => ({ ...f, file: await uploadable(f) })));
        // Written reflections are sent as text; the server saves them as dated, lesson-linked records.
        const written = lesson.submission.periods.filter(p => reflections[p.id]?.trim()).map(p => ({ periodId: p.id, answers: parseClosureText(reflections[p.id]) })).filter(r => r.answers.achievement || r.answers.nextStep);
        if (Object.values(reflections).some(value=>/_{2,}/.test(value))) throw Error(t('Complete the blanks in your written reflection.','चिंतन के खाली स्थान पूरे करें।'));
        if (!all.length && !written.length)
            throw Error(t('Add a classroom evidence file or an after-class reflection before submitting.','जमा करने से पहले कोई फ़ाइल या कक्षा के बाद का चिंतन जोड़ें।'));
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
        // What was shared, for the confirmation screen.
        const periods = lesson.submission.periods, byType = {};
        for (const f of all) byType[f.category] = (byType[f.category] || 0) + 1;
        const sentIds = new Set([...all.map(f => f.periodId), ...written.map(r => r.periodId)]), rest = periods.findIndex(p => !sentIds.has(p.id));
        setShared({ receipt: result, byType, reflections: written.length, plannedOn: lesson.submission.date, token, rest: rest >= 0 ? { index: rest, label: periodLabel(periods[rest], numberAt(rest) - 1, language), topic: periods[rest].topic || '' } : null, periods: periods.filter(p => all.some(f => f.periodId === p.id) || written.some(r => r.periodId === p.id)).map(p => periodLabel(p, first1 + periods.indexOf(p), language)) });
        // A receipt closes this draft even if refreshing the saved lesson fails. Reopening starts a new update.
        setLesson(null);
        setPending({}); setReflections({}); uploadedFiles.current.clear(); shrunk.current.clear();
        setUpdateId(crypto.randomUUID());
        setBusy('');
        void Promise.resolve().then(onSaved).catch(() => setError('Your evidence was saved. Refresh the workspace to see the updated report.'));
    }
    catch (e) {
        setError(e.message + ' ' + t('Your reflection and files are still here; submit again to retry.','आपका चिंतन और फ़ाइलें यहीं हैं; फिर से जमा करें।'));
        setBusy('');
    } }
    const periods = lesson?.submission?.periods || [];
    const when = d => d === today() ? t('Today','आज') : (dayLabel(d, language) || d);
    if (shared && !lesson) return <section className="card ev-shared" role="status">
        <span className="ev-ok"><Check size={40}/></span>
        <h2>{shared.receipt.alreadySaved ? t('Already shared','पहले ही जमा है') : t('Evidence shared','प्रमाण जमा हो गया')}</h2>
        <p>{shared.periods.join(' · ')}{shared.plannedOn ? ' · ' + when(shared.plannedOn) : ''}</p>
        <div className="ev-sum">{Object.entries(shared.byType).map(([k, n]) => <div key={k}><span>{typeLabel(k, language)}</span><b>{n} {t(n === 1 ? 'file' : 'files','फ़ाइल')}</b></div>)}{shared.reflections > 0 && <div><span>{t('After-class reflection','कक्षा के बाद का चिंतन')}</span><b>{t('Saved','सहेजा गया')}</b></div>}<div><span>{t('Receipt','रसीद')}</span><b>{String(shared.receipt.submissionId || '').slice(0, 8)}</b></div></div>
        {shared.rest && onReadPlan ? <><p className="ev-label">{t('Next','आगे')}</p><button type="button" className="ev-next" onClick={() => onReadPlan(shared.token, shared.rest.index)}><span className="ev-pnum">P{numberAt(shared.rest.index)}</span><span className="ev-next-text"><b>{shared.rest.label}</b><small>{shared.rest.topic} · {t('Read plan','योजना पढ़ें')}</small></span><ChevronRight size={18}/></button></>
        : nextLesson && <><p className="ev-label">{t('Next','आगे')}</p><button type="button" className="ev-next" onClick={nextLesson.onOpen}><span className="ev-pnum">{nextLesson.badge}</span><span className="ev-next-text"><b>{nextLesson.title}</b><small>{nextLesson.subtitle}</small></span><ChevronRight size={18}/></button></>}
        <div className="ev-shared-actions">{onHome && <button type="button" className="button" onClick={onHome}><House size={16}/>{t('Back to home','मुख्य पृष्ठ')}</button>}<button type="button" className="button" onClick={() => { setShared(null); void load(); }}><Camera size={16}/>{t('Add more to this lesson','इस पाठ में और जोड़ें')}</button></div>
    </section>;
    return <section className="card ev-card"><div className="card-head"><div><h2>{t('Add evidence','प्रमाण जोड़ें')}</h2><p>{t('Choose the lesson, then add photos, written work or your reflection.','पाठ चुनें, फिर फोटो, लिखित कार्य या चिंतन जोड़ें।')}</p></div></div>
     {days.length > 0 && <label className="field ev-pick"><span>{t('Lesson day','पाठ का दिन')}</span><select value={days.some(l => l.resumeToken === token) ? token : ''} disabled={!!busy} onChange={e => pickDay(e.target.value)}><option value="">{t('Choose the day you taught','पढ़ाने का दिन चुनें')}</option>{days.map(l => <option key={l.id} value={l.resumeToken}>{dayOption(l)}</option>)}</select></label>}
     {(!compactSearch||!token)&&<details className="ts-search" open={!compactSearch&&!days.length}><summary>{t('Can’t find your lesson? Search by planned date','पाठ नहीं मिल रहा? योजना की तिथि से खोजें')}</summary><form onSubmit={find}><label className="field"><span>{t('Planned lesson date','पाठ की नियोजित तिथि')}</span><input type="date" required value={date} onChange={e => { setDate(e.target.value); setMatches(null); setLesson(null); setToken(''); setReceipt(null); }} disabled={!!busy}/></label><button className="button primary" type="submit" disabled={!!busy || !teacher || !school}>{t('Find saved lessons','सहेजे गए पाठ खोजें')}</button><p className="hint">{t('Choose the date used when saving your preparation. Select the matching class, subject and topic below.','योजना सहेजते समय चुनी तिथि चुनें। नीचे कक्षा, विषय और पाठ चुनें।')}</p></form></details>}
     {matches && <div>{matches.length === 0 ? <p role="status">{t('No saved preparations found for this teacher and date. Check the planned date, or save your lesson preparation first.','इस शिक्षक और तिथि के लिए योजना नहीं मिली। तिथि जाँचें या पहले योजना जमा करें।')}</p> : matches.map(m => <div className="teacher-period" key={m.id}>{m.periods.map((p, i) => <p key={i}><b>Period {i + 1} · {p.grade} {p.section} · {p.subject}</b><br />{p.topic}</p>)}<span className="pill green">{lessonStageLabel(m.stage)}</span> <button type="button" className="button" disabled={!!busy} onClick={() => { if (token === m.resumeToken) void load(); else { setLesson(null); setToken(m.resumeToken); } }}>{t('Select lesson / add evidence','पाठ चुनें / प्रमाण जोड़ें')}</button></div>)}</div>}
     {busy && <p role="status" className="ev-busy">{busy}…</p>}{error && <div className="alert error" role="alert">{error}</div>}
     {token && !lesson && !busy && <button className="text-button" type="button" onClick={() => void load()}>{t('Reload saved lesson','सहेजा पाठ फिर खोलें')}</button>}
     {lesson && <form onSubmit={save}><fieldset className="teacher-fields" disabled={!!busy}>
      <div className="ev-lesson-head"><div><span className="ev-day"><CircleCheck size={12}/>{when(lesson.submission.date)}</span><b>{lesson.submission.school}</b></div><span className="pill green">{lessonStageLabel(lesson.stage)}</span></div>
      <label className="field"><span>{t('Actual lesson conducted on','पढ़ाने की वास्तविक तिथि')}</span><input type="date" required max={today()} value={conductedOn} onChange={e => setConductedOn(e.target.value)}/></label>
      {periods.length > 1 && <><p className="ev-label">{t('Period','कालांश')}</p><div className="ev-periods" role="tablist" aria-label={t('Period','कालांश')}>{periods.map((p, i) => { const has = pending[p.id]?.length || reflections[p.id]?.trim(); return <button type="button" role="tab" aria-selected={focus === p.id} key={p.id} className={'ev-period-chip' + (focus === p.id ? ' on' : '')} onClick={() => setFocus(p.id)}><b>{t('Period','कालांश')} {numberAt(i)}{has ? <span className="ev-dot" aria-label={t('added','जोड़ा')}/> : null}</b><small>{[[p.grade, p.section && p.section !== 'Not Applicable' ? p.section : ''].filter(Boolean).join(' '), p.subject].filter(Boolean).join(' · ')}</small></button>; })}</div><p className="hint">{t('Files added to other periods are kept and submitted together.','दूसरे कालांशों में जोड़ी गई फ़ाइलें भी साथ में जमा होंगी।')}</p></>}
      {periods.map((p, index) => { const goal = parsePlanText(p.reflection).find(s => s.key === 'objective'), cat = category[p.id] || 'activity', items = pending[p.id] || [];
        return <section className="ev-period" id={'ev-period-' + p.id} key={p.id} hidden={focus !== p.id && periods.length > 1}>
         <div className="ev-period-head"><b>{periodLabel(p, numberAt(index) - 1, language)}</b><small>{p.topic || t('No topic recorded','विषयवस्तु दर्ज नहीं')}</small>{onReadPlan && <button type="button" className="text-button" onClick={() => onReadPlan(token, index)}><BookOpen size={14}/>{t('Read plan','योजना पढ़ें')}</button>}</div>
         {goal && <div className="ev-goal"><b><Target size={13}/>{t('Your learning outcome','आपका सीखने का प्रतिफल')}</b><p>{goal.text}</p></div>}
         <p className="ev-label">{t('What are you adding?','आप क्या जोड़ रहे हैं?')}</p>
         <div className="ev-types" role="radiogroup" aria-label={t('Evidence type','प्रमाण का प्रकार')}>{evidenceTypes.filter(([k]) => classroomEvidenceCategories[k]).map(([k, Icon, en, hi, c]) => <button type="button" role="radio" aria-checked={cat === k} key={k} className={'ev-type ' + c + (cat === k ? ' on' : '')} onClick={() => setCategory(old => ({ ...old, [p.id]: k }))}><span className="ev-type-icon"><Icon size={17}/></span>{language === 'hi' ? hi : en}</button>)}</div>
         <div className="ev-add">
          <label className={'ev-add-btn primary' + (uploadsEnabled ? '' : ' off')}><Camera size={24}/><b>{t('Take photo','फोटो लें')}</b><small>{t('Opens the camera','कैमरा खुलेगा')}</small><input type="file" accept="image/*" capture="environment" disabled={!uploadsEnabled} onChange={e => { addFiles(p.id, e.target.files); e.target.value = ''; }}/></label>
          <label className={'ev-add-btn' + (uploadsEnabled ? '' : ' off')}><Images size={24}/><b>{t('Choose files','फ़ाइलें चुनें')}</b><small>{t('Photos, video, PDF','फोटो, वीडियो, PDF')}</small><input type="file" multiple disabled={!uploadsEnabled} accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg" onChange={e => { addFiles(p.id, e.target.files); e.target.value = ''; }}/></label>
         </div>
         <p className="hint">50 MB {t('per file','प्रति फ़ाइल')} · 100 MB {t('per update','प्रति बार')} · 50 {t('files','फ़ाइलें')}</p>
         {items.length > 0 && <div className="ev-thumbs">{items.map(f => <Thumb key={f.id} item={f} label={typeLabel(f.category, language)} removeLabel={t('Remove ','हटाएँ ') + f.file.name} onRemove={() => setPending(prev => ({ ...prev, [p.id]: prev[p.id].filter(x => x.id !== f.id) }))}/>)}</div>}
         <details className="ev-fold"><summary><Mic size={18}/><span><b>{t('Add after-class reflection','कक्षा के बाद का चिंतन जोड़ें')}</b><small>{reflections[p.id]?.trim() ? t('Written · tap to edit','लिखा गया · बदलने के लिए छुएँ') : t('Optional · type or speak','वैकल्पिक · लिखें या बोलें')}</small></span><ChevronDown size={18}/></summary><WrittenReflection language={language} key={p.id+':'+updateId} disabled={!!busy} onChange={text=>setReflections(old=>({...old,[p.id]:text}))}/></details>
         <details className="ev-saved"><summary>{t('Saved for this period','इस कालांश में सहेजा गया')}</summary><SavedPeriodRecord lesson={lesson} period={p}/></details>
        </section>; })}
      <div className="ev-submit-bar"><button className="button primary ev-submit" type="submit"><Check size={18}/>{busy ? busy + '…' : submitSummary(pending, reflections, language)}</button></div>
     </fieldset></form>}
     {lesson?.evidenceAt && <p className="hint">{t('Latest evidence submitted','पिछला प्रमाण जमा')}: {new Date(/Z$|[+-]\d\d:\d\d$/.test(lesson.evidenceAt) ? lesson.evidenceAt : lesson.evidenceAt + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>}
    </section>;
}
