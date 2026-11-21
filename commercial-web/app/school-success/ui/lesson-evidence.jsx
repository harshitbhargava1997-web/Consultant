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
import { Upload, Trash2, FileText } from 'lucide-react';
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

export default function LessonEvidence({ token: initialToken, headers, uploadsEnabled, school, teacher, onSaved, language='en' }) {
    const t=(en,hi)=>language==='hi'?hi:en;
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
    return <section className="card"><div className="card-head"><div><h2>{t('Submit evidence','प्रमाण जमा करें')}</h2><p>{t('Find the lesson you prepared, then add evidence and your after-class reflection.','अपनी पाठ योजना चुनें, फिर प्रमाण और कक्षा के बाद का चिंतन जोड़ें।')}</p></div></div><form onSubmit={find}><label className="field"><span>{t('Planned lesson date','पाठ की नियोजित तिथि')}</span><input type="date" required value={date} onChange={e => { setDate(e.target.value); setMatches(null); setLesson(null); setToken(''); setReceipt(null); }} disabled={!!busy}/></label><button className="button primary" type="submit" disabled={!!busy || !teacher || !school}>{t('Find saved lessons','सहेजे गए पाठ खोजें')}</button><p className="hint">{t('Choose the date used when saving your preparation. Select the matching class, subject and topic below.','योजना सहेजते समय चुनी तिथि चुनें। नीचे कक्षा, विषय और पाठ चुनें।')}</p></form>{matches && <div>{matches.length === 0 ? <p role="status">{t('No saved preparations found for this teacher and date. Check the planned date, or save your lesson preparation first.','इस शिक्षक और तिथि के लिए योजना नहीं मिली। तिथि जाँचें या पहले योजना जमा करें।')}</p> : matches.map(m => <div className="teacher-period" key={m.id}>{m.periods.map((p, i) => <p key={i}><b>Period {i + 1} · {p.grade} {p.section} · {p.subject}</b><br />{p.topic}</p>)}<span className="pill green">{lessonStageLabel(m.stage)}</span> <button type="button" className="button" disabled={!!busy} onClick={() => { if (token === m.resumeToken)
        void load();
    else {
        setLesson(null);
        setToken(m.resumeToken);
    } }}>{t('Select lesson / add evidence','पाठ चुनें / प्रमाण जोड़ें')}</button></div>)}</div>}{busy && <p role="status">{busy}…</p>}{error && <div className="alert error" role="alert">{error}</div>}{token && <button className="text-button" type="button" disabled={!!busy} onClick={() => void load()}>{t('Reload saved lesson','सहेजा पाठ फिर खोलें')}</button>}{receipt && <div className="alert success" role="status">{receipt.alreadySaved ? 'This update was already saved.' : 'Evidence saved · ' + lessonStageLabel(receipt.stage || lesson?.stage)} · Receipt {receipt.submissionId}</div>}{lesson && <><div className="flex-between"><div><h3>{lesson.submission.school} · {lesson.submission.teacher}</h3><p>Planned lesson date: {lesson.submission.date}</p></div><span className="pill green">{lessonStageLabel(lesson.stage)}</span></div><form onSubmit={save}><fieldset className="teacher-fields" disabled={!!busy}><label className="field"><span>{t('Actual lesson conducted on','पढ़ाने की वास्तविक तिथि')}</span><input type="date" required max={today()} value={conductedOn} onChange={e => setConductedOn(e.target.value)}/></label><p className="hint">{t('Use the day you taught the lesson. The evidence upload time is recorded separately.','जिस दिन पढ़ाया वह तिथि चुनें। प्रमाण जमा करने का समय अलग सहेजा जाता है।')}</p>{lesson.submission.periods.map((p, index) => <section className="teacher-period" key={p.id}><h3>Period {index + 1} · {p.grade} {p.section} · {p.subject}</h3><p><b>{p.topic}</b></p><SavedPeriodRecord lesson={lesson} period={p}/><WrittenReflection language={language} key={p.id+':'+updateId} disabled={!!busy} onChange={text=>setReflections(old=>({...old,[p.id]:text}))}/><label className="field"><span>{t('Evidence category','प्रमाण का प्रकार')}</span><select value={category[p.id] || 'activity'} onChange={e => setCategory(c => ({ ...c, [p.id]: e.target.value }))}>{Object.entries(classroomEvidenceCategories).map(([key, value]) => <option key={key} value={key}>{language==='hi'?({activity:'कक्षा की गतिविधियाँ',writing:'विद्यार्थी का लिखित कार्य',remedial:'सुधारात्मक सहायता',portfolio:'विद्यार्थी पोर्टफोलियो'}[key]||value):value}</option>)}</select></label><label className="upload-zone"><Upload size={24}/><b>{t('Add classroom photos, videos, written work or PDF','कक्षा के फोटो, वीडियो, लिखित कार्य या PDF जोड़ें')}</b><span>50 MB per file · 100 MB per update · 50 files</span><input type="file" multiple disabled={!uploadsEnabled} accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg" onChange={e => { const selected = Array.from(e.target.files || []); e.target.value = ''; setPending(prev => ({ ...prev, [p.id]: [...prev[p.id] || [], ...selected.map(file => ({ id: crypto.randomUUID(), category: category[p.id] || 'activity', file }))] })); }}/></label>{(pending[p.id] || []).map(f => <div className="teacher-file" key={f.id}><FileText size={15}/><div><b>{f.file.name}</b><small>{evidenceCategories[f.category].label}</small></div><button type="button" className="icon" aria-label={'Remove ' + f.file.name} onClick={() => setPending(prev => ({ ...prev, [p.id]: prev[p.id].filter(x => x.id !== f.id) }))}><Trash2 size={15}/></button></div>)}</section>)}<div className="actions"><button className="button primary" type="submit">{t('Submit classroom evidence','कक्षा के प्रमाण जमा करें')}</button></div></fieldset></form>{lesson.evidenceAt && <p className="hint">Latest evidence submitted: {new Date(/Z$|[+-]\d\d:\d\d$/.test(lesson.evidenceAt) ? lesson.evidenceAt : lesson.evidenceAt + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>}</>}</section>;
}
