'use client';
import AfterClassReflection from '../../AfterClassReflection';
import {closureFiles} from '@/lib/closure-reflection';
import {successFetch} from '@/lib/school-success/client';
import { useEffect, useState } from 'react';
import { Upload, Trash2, FileText } from 'lucide-react';
import { evidenceCategories, submissionSchema } from '@/lib/school-success/teacher-submissions';
import { lessonStageLabel } from '@/lib/school-success/lesson-workflow';
import { downloadPractice, teachingPracticeText } from '@/lib/school-success/teacher-flow';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export default function LessonEvidence({ token: initialToken, headers, uploadsEnabled, school, teacher, onSaved, onRecording }) {
    const [token, setToken] = useState(initialToken), [date, setDate] = useState(today()), [matches, setMatches] = useState(null);
    const [lesson, setLesson] = useState(null), [pending, setPending] = useState({}), [category, setCategory] = useState({}), [conductedOn, setConductedOn] = useState(''), [updateId, setUpdateId] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(''), [error, setError] = useState(''), [receipt, setReceipt] = useState(null);
    const [reflections,setReflections]=useState({}),[recordings,setRecordings]=useState([]);
    async function request(body) { const r = await successFetch('/api/school-success/evidence', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok)
        throw Error(d.error || 'Could not update this lesson'); return d; }
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
    async function save(e) { e.preventDefault(); if (!lesson || busy || recordings.length)
        return; setError(''); setBusy('Checking classroom update'); try {
        const all = [...Object.entries(pending).flatMap(([periodId,items])=>items.map(f=>({...f,periodId}))), ...await closureFiles({periods:lesson.submission.periods,reflections,school,teacher,date:lesson.submission.date,conductedOn,updateId})];
        if (!all.length)
            throw Error('Add a classroom evidence file or an after-class reflection before submitting.');
        const submission = submissionSchema.parse({ ...lesson.submission, files: all.map(f => ({ id: f.id, periodId:f.periodId, category: f.category, name: f.file.name, size: f.file.size })) });
        const prepared = await request({ action: 'prepare', mode: 'evidence', resume: token, submission, version: lesson.version, updateId, conductedOn });
        let result = prepared;
        if (!prepared.saved) {
            for (let i = 0; i < prepared.files.length; i++) {
                const f = prepared.files[i], actual = all.find(x => x.id === f.id);
                if (!actual)
                    throw Error('A selected file is missing. Choose it again.');
                setBusy(`Uploading classroom evidence ${i + 1} of ${prepared.files.length}`);
                const r = await successFetch('/api/school-success/evidence/upload', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/octet-stream', 'X-Evidence-Token': f.token }, body: actual.file });
                if (!r.ok) {
                    const d = await r.json();
                    throw Error(d.error || 'Upload failed');
                }
            }
            setBusy('Saving classroom update');
            result = await request({ action: 'commit', token: prepared.token });
        }
        setReceipt(result);
        await load(true);
        await onSaved();
    }
    catch (e) {
        setError(e.message);
        setBusy('');
    } }
    function download() { if (!lesson)
        return; const s = lesson.submission; const returnUrl = new URL(location.href); returnUrl.searchParams.set('resume', token); returnUrl.searchParams.set('teacher', teacher); returnUrl.searchParams.set('view', 'teacher'); downloadPractice(teachingPracticeText(s.school, s.teacher, lesson.conductedOn || s.date, s.periods.map((p) => ({ ...p, files: lesson.files.filter((f) => f.periodId === p.id) })), s.id) + '\n\nPlanned lesson date: ' + s.date + '\nStatus: ' + lessonStageLabel(lesson.stage) + '\nPrivate return link: ' + returnUrl.href); }
    return <section className="card"><div className="card-head"><div><h2>2. Classroom implementation evidence</h2><p>Select your planned lesson date, then add evidence after teaching.</p></div></div><form onSubmit={find}><label className="field"><span>Planned lesson date</span><input type="date" required value={date} onChange={e => { setDate(e.target.value); setMatches(null); setLesson(null); setToken(''); setReceipt(null); }} disabled={!!busy||recordings.length>0}/></label><button className="button primary" type="submit" disabled={!!busy || !teacher || !school}>Find saved lessons</button><p className="hint">Choose the date used when saving your preparation. Select the matching class, subject and topic below.</p></form>{matches && <div>{matches.length === 0 ? <p role="status">No saved preparations found for this teacher and date. Check the planned date, or save your lesson preparation first.</p> : matches.map(m => <div className="teacher-period" key={m.id}>{m.periods.map((p, i) => <p key={i}><b>Period {i + 1} · {p.grade} {p.section} · {p.subject}</b><br />{p.topic}</p>)}<span className="pill green">{lessonStageLabel(m.stage)}</span> <button type="button" className="button" disabled={!!busy||recordings.length>0} onClick={() => { if (token === m.resumeToken)
        void load();
    else {
        setLesson(null);
        setToken(m.resumeToken);
    } }}>Select lesson / add evidence</button></div>)}</div>}{busy && <p role="status">{busy}…</p>}{error && <div className="alert error" role="alert">{error}</div>}{token && <button className="text-button" type="button" disabled={!!busy||recordings.length>0} onClick={() => void load()}>Reload saved lesson</button>}{receipt && <div className="alert success" role="status">{receipt.alreadySaved ? 'This update was already saved.' : lessonStageLabel(receipt.stage || lesson?.stage)} · Receipt {receipt.submissionId}</div>}{lesson && <><div className="flex-between"><div><h3>{lesson.submission.school} · {lesson.submission.teacher}</h3><p>Planned lesson date: {lesson.submission.date}</p></div><span className="pill green">{lessonStageLabel(lesson.stage)}</span></div><form onSubmit={save}><fieldset className="teacher-fields" disabled={!!busy}><label className="field"><span>Actual lesson conducted on</span><input type="date" required max={today()} value={conductedOn} onChange={e => setConductedOn(e.target.value)}/></label><p className="hint">Use the day you taught the lesson. The evidence upload time is recorded separately.</p>{lesson.submission.periods.map((p, index) => <section className="teacher-period" key={p.id}><h3>Period {index + 1} · {p.grade} {p.section} · {p.subject}</h3><p><b>{p.topic}</b></p><details><summary>Saved lesson preparation</summary><p style={{ whiteSpace: 'pre-wrap' }}>{p.reflection || 'No written notes recorded.'}</p></details><div className="evidence-files">{lesson.files.filter((f) => f.periodId === p.id).map((f, i) => <a className="file" href={f.url} key={f.url + ':' + i} target="_blank" rel="noopener noreferrer"><FileText size={15}/>{f.category}</a>)}</div><AfterClassReflection key={p.id+':'+updateId} disabled={!!busy||recordings.length>0||!uploadsEnabled} onChange={text=>setReflections(old=>({...old,[p.id]:text}))} onRecording={active=>{setRecordings(ids=>active?[...new Set([...ids,p.id])]:ids.filter(id=>id!==p.id));onRecording?.(active);}} onFile={file=>setPending(old=>({...old,[p.id]:[...(old[p.id]||[]),{id:crypto.randomUUID(),category:'closure',file:new File([file],'After-class-'+file.name,{type:file.type})}]}))}/><label className="field"><span>Evidence category</span><select value={category[p.id] || 'activity'} onChange={e => setCategory(c => ({ ...c, [p.id]: e.target.value }))}>{Object.entries(evidenceCategories).filter(([key]) => key !== 'voice').map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><label className="upload-zone"><Upload size={24}/><b>Add classroom photos, videos, written work or PDF</b><span>50 MB per file · 100 MB per update · 50 files</span><input type="file" multiple disabled={!uploadsEnabled} accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg" onChange={e => { const selected = Array.from(e.target.files || []); e.target.value = ''; setPending(prev => ({ ...prev, [p.id]: [...prev[p.id] || [], ...selected.map(file => ({ id: crypto.randomUUID(), category: category[p.id] || 'activity', file }))] })); }}/></label>{(pending[p.id] || []).map(f => <div className="teacher-file" key={f.id}><FileText size={15}/><div><b>{f.file.name}</b><small>{evidenceCategories[f.category].label}</small></div><button type="button" className="icon" aria-label={'Remove ' + f.file.name} onClick={() => setPending(prev => ({ ...prev, [p.id]: prev[p.id].filter(x => x.id !== f.id) }))}><Trash2 size={15}/></button></div>)}</section>)}<div className="actions"><button className="button" type="button" onClick={download}>Download lesson & evidence links</button><button className="button primary" type="submit" disabled={recordings.length>0}>Submit classroom evidence</button></div></fieldset></form>{lesson.evidenceAt && <p className="hint">Latest evidence submitted: {new Date(/Z$|[+-]\d\d:\d\d$/.test(lesson.evidenceAt) ? lesson.evidenceAt : lesson.evidenceAt + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>}</>}</section>;
}

