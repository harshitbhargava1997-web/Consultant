'use client';
import {successFetch} from '@/lib/school-success/client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Mic, Square, CheckCircle, BookOpen, FileText } from 'lucide-react';
import VoiceReflection from './voice-reflection';
import SchoolSharingLinks from './school-sharing-links';
import LessonEvidence from './lesson-evidence';
import { lessonStageLabel } from '@/lib/school-success/lesson-workflow';
import { teacherGrades, teacherSections, teacherSubjects, teachingPracticeText, downloadPractice } from '@/lib/school-success/teacher-flow';
import { submissionSchema, submissionRecords } from '@/lib/school-success/teacher-submissions';
const day = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const newPeriod = () => ({ id: crypto.randomUUID(), grade: '', section: 'A', subject: '', topic: '', reflection: '', materials: '', category: 'activity', files: [] });
function VoiceRecorder({ disabled, onFile, onRecording }) { const [recording, setRecording] = useState(false), [error, setError] = useState(''); const recorder = useRef(null), stream = useRef(null); useEffect(() => () => { if (recorder.current?.state === 'recording') {
    recorder.current.stop();
    onRecording(false);
} stream.current?.getTracks().forEach(t => t.stop()); }, []); async function start() { setError(''); try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
        throw Error('Recording is unavailable here. Choose an audio file instead.');
    stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    const r = new MediaRecorder(stream.current);
    recorder.current = r;
    const chunks = [];
    r.ondataavailable = e => { if (e.data.size)
        chunks.push(e.data); };
    r.onstop = () => { const type = r.mimeType, ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'; onFile(new File(chunks, 'voice-reflection.' + ext, { type })); stream.current?.getTracks().forEach(t => t.stop()); setRecording(false); onRecording(false); };
    r.start();
    setRecording(true);
    onRecording(true);
}
catch (e) {
    setError(e.message);
} } return <><button className="button" type="button" disabled={disabled} onClick={() => recording ? recorder.current?.stop() : void start()}>{recording ? <Square size={16}/> : <Mic size={16}/>} {recording ? 'Stop recording' : 'Record voice reflection'}</button>{recording && <span role="status"> Recording…</span>}{error && <p className="negative">{error}</p>}</>; }
export default function TeacherPortal({ data, school, refresh }) {
    const admin = data.actor.role === 'admin', schoolLink = data.actor.role === 'school-teacher', roster = data.roster || [];
    const schools = [...new Set([...roster.map(r => r.school), ...(data.entries || []).map((r) => r.school || r.name)])].filter(Boolean).sort();
    const [selectedSchool, setSchool] = useState(admin ? school || schools[0] || '' : data.actor.school), [teacher, setTeacher] = useState(admin ? '' : data.actor.name), [date, setDate] = useState(day()), [periods, setPeriods] = useState(() => [newPeriod()]), [submissionId, setId] = useState(() => crypto.randomUUID()), [recordingIds, setRecordingIds] = useState([]), [busy, setBusy] = useState(''), [error, setError] = useState(''), [receipt, setReceipt] = useState(null), [lastDownload, setLastDownload] = useState(''), [mode, setMode] = useState('preparation'), [resumeToken, setResumeToken] = useState(''), [savedLinks, setSavedLinks] = useState([]);
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
    useEffect(() => { const pending = sessionStorage.getItem('school-success:teacher-pending-submission'); if (pending && /^[a-f0-9-]{36}$/i.test(pending))
        setId(pending); }, []);
    const teachers = [...new Set(roster.filter(r => r.school === selectedSchool).map(r => r.name))].sort();
    const teacherValue = admin ? teacher : schoolLink ? data.actor.name : data.actor.name;
    const contextHeaders = () => { const access = new URLSearchParams(location.search).get('access'); return access ? { 'X-School-Link': access, 'X-Teacher': encodeURIComponent(teacherValue) } : {}; };
    async function selectTeacher(name, nextMode = 'preparation') { const url = new URL(location.href); url.searchParams.set('teacher', name); url.searchParams.delete('resume'); historyReplace(url); setMode(nextMode); setResumeToken(''); setPeriods([newPeriod()]); setId(crypto.randomUUID()); setReceipt(null); sessionStorage.removeItem('school-success:teacher-pending-submission'); try {
        await refresh();
    }
    catch (e) {
        setError(e.message);
    } }
    function historyReplace(url) { window.history.replaceState(null, '', url.href); }
    const history = (data.entries || []).filter((r) => r.kind === 'submission' && r.school === selectedSchool && (!teacherValue || r.teacher === teacherValue));
    function update(id, key, value) { setPeriods(rows => rows.map(p => p.id === id ? { ...p, [key]: value } : p)); }
    function addFiles(id, category, files) { setPeriods(rows => rows.map(p => p.id === id ? { ...p, files: [...p.files, ...files.map(file => ({ id: crypto.randomUUID(), category, file }))] } : p)); }
    async function request(body) { const r = await successFetch('/api/school-success/evidence', { method: 'POST', headers: { 'Content-Type': 'application/json', ...contextHeaders() }, body: JSON.stringify(body) }); const result = await r.json(); if (!r.ok)
        throw Error(result.error || 'Could not save the submission'); return result; }
    async function submit(e) { e.preventDefault(); if (busy)
        return; setError(''); setReceipt(null); setBusy('Checking your submission'); sessionStorage.setItem('school-success:teacher-pending-submission', submissionId); try {
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
        const plan = await request({ action: 'prepare', mode: 'preparation', submission });
        let result = plan;
        if (!plan.saved) {
            const allFiles = [...periods.flatMap(p => p.files), ...generated];
            for (let i = 0; i < plan.files.length; i++) {
                const file = plan.files[i], actual = allFiles.find(f => f.id === file.id);
                if (!actual)
                    throw Error('A selected file is missing. Choose it again.');
                setBusy(`Uploading evidence ${i + 1} of ${plan.files.length}`);
                const response = await successFetch('/api/school-success/evidence/upload', { method: 'POST', headers: { 'X-Evidence-Token': file.token, 'Content-Type': 'application/octet-stream', ...contextHeaders() }, body: actual.file });
                if (!response.ok) {
                    const value = await response.json();
                    throw Error(value.error || 'Evidence upload failed');
                }
            }
            setBusy('Saving your class periods');
            result = await request({ action: 'commit', token: plan.token });
        }
        const returnUrl = new URL(location.href);
        returnUrl.searchParams.set('resume', result.resumeToken);
        returnUrl.searchParams.set('teacher', teacherValue);
        returnUrl.searchParams.set('view', 'teacher');
        const saved = { ...result, url: returnUrl.href, school: selectedSchool, teacher: teacherValue, date };
        setLastDownload(teachingPracticeText(selectedSchool, teacherValue, date, periods, result.submissionId) + '\n\nPrivate return link: ' + returnUrl.href);
        setReceipt(saved);
        const links = [saved, ...savedLinks.filter(l => l.submissionId !== result.submissionId)].slice(0, 30);
        setSavedLinks(links);
        try {
            localStorage.setItem('school-success:teacher-lesson-links-v1', JSON.stringify(links));
        }
        catch { }
        setPeriods([newPeriod()]);
        setId(crypto.randomUUID());
        sessionStorage.removeItem('school-success:teacher-pending-submission');
        try {
            await refresh();
        }
        catch {
            setError('Your submission is saved. Refresh the page to update the history.');
        }
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save. Retry using this receipt ID: ' + submissionId);
    }
    finally {
        setBusy('');
    } }
    return <div className="teacher-workspace"><section className="teacher-banner"><div><span className="eyebrow">REFLECT • SHARE • GROW</span><h2>Share your classroom journey.</h2><p>Record each class period, reflect on the lesson and share evidence of student learning.</p></div><BookOpen className="teacher-art" size={88} strokeWidth={1}/></section>
 {admin && <SchoolSharingLinks schools={[...new Set(roster.map(r => r.school))].filter(Boolean).sort()}/>}
 {!data.uploadsEnabled && <div className="alert" role="status">Lesson details and written reflections are active. Photo, video and voice uploads are awaiting the administrator’s media-storage connection.</div>}
 {receipt && <section className="card"><div className="card-head"><h2><CheckCircle size={20}/> {receipt.alreadySaved ? 'Preparation already saved' : 'Preparation saved'}</h2><span className="pill green">{receipt.periods} period(s)</span></div><p>Receipt: <code>{receipt.submissionId}</code></p><p className="hint">To add evidence after teaching, open your school link, select your name and choose the planned lesson date. You can also use this direct return link.</p><label className="field"><span>Return to this lesson</span><input readOnly value={receipt.url} onFocus={e => e.target.select()}/></label><a className="button primary" href={receipt.url}>Return to this lesson / add evidence</a><button className="button" type="button" onClick={() => downloadPractice(lastDownload)}>Download submitted reflection & receipt</button></section>}
 <div className="tabs"><button className={mode === 'preparation' ? 'selected' : ''} type="button" disabled={!!busy || recordingIds.length > 0} onClick={() => { const url = new URL(location.href); url.searchParams.delete('resume'); historyReplace(url); setMode('preparation'); }}>1. Prepare a lesson</button><button className={mode === 'evidence' ? 'selected' : ''} type="button" disabled={!!busy || recordingIds.length > 0} onClick={() => setMode('evidence')}>2. Add classroom evidence</button></div>
 {savedLinks.some(l => l.school === selectedSchool && l.teacher === teacherValue) && <section className="card"><details><summary>Saved lessons on this device</summary>{savedLinks.filter(l => l.school === selectedSchool && l.teacher === teacherValue).map(l => <p key={l.submissionId}><a href={l.url}>{l.date} · {l.teacher} · Return to saved preparation</a></p>)}</details></section>}
 {mode === 'evidence' ? <><section className="card"><div className="form-grid">{admin ? <label className="field"><span>School</span><select value={selectedSchool} onChange={e => { setSchool(e.target.value); setTeacher(''); setResumeToken(''); }}>{schools.map(s => <option key={s}>{s}</option>)}</select></label> : <div className="field"><span>School</span><b>{selectedSchool}</b></div>}{admin || schoolLink ? <label className="field"><span>Teacher</span><select value={teacherValue} onChange={e => { if (schoolLink)
            void selectTeacher(e.target.value, 'evidence');
        else {
            setTeacher(e.target.value);
            setResumeToken('');
        } }}><option value="">Select teacher</option>{teachers.map(t => <option key={t}>{t}</option>)}</select></label> : <div className="field"><span>Teacher</span><b>{teacherValue}</b></div>}</div></section><LessonEvidence key={selectedSchool + '|' + teacherValue + '|' + resumeToken} token={resumeToken} headers={contextHeaders} uploadsEnabled={data.uploadsEnabled} school={selectedSchool} teacher={teacherValue} onSaved={refresh}/></> : <form className="card" id="teacher-submission-form" onSubmit={submit}><div className="card-head"><div><h2>Prepare your lesson</h2><p>Save up to 10 class periods, then return after teaching to add evidence.</p></div></div><fieldset disabled={!!busy} className="teacher-fields"><div className="form-grid">{admin ? <><label className="field"><span>School</span><select required disabled={recordingIds.length > 0} value={selectedSchool} onChange={e => { setSchool(e.target.value); setTeacher(''); }}><option value="">Select school</option>{schools.map(s => <option key={s}>{s}</option>)}</select></label><label className="field"><span>Teacher</span>{teachers.length ? <select required disabled={recordingIds.length > 0} value={teacherValue} onChange={e => setTeacher(e.target.value)}><option value="">Select teacher</option>{teachers.map(t => <option key={t}>{t}</option>)}</select> : <input required value={teacher} onChange={e => setTeacher(e.target.value)}/>}</label></> : schoolLink ? <><div className="field"><span>School</span><b>{selectedSchool}</b></div><label className="field"><span>Teacher</span><select required disabled={recordingIds.length > 0} value={teacherValue} onChange={e => void selectTeacher(e.target.value)}><option value="">Select teacher</option>{teachers.map(t => <option key={t}>{t}</option>)}</select></label></> : <div className="field"><span>School / teacher</span><b>{selectedSchool} · {teacherValue}</b></div>}<label className="field"><span>Planned lesson date</span><input type="date" required value={date} onChange={e => setDate(e.target.value)}/></label></div>
 {periods.map((p, index) => <section className="teacher-period" key={p.id}><div className="card-head"><h3>Period {index + 1}</h3>{periods.length > 1 && <button className="text-button" type="button" disabled={recordingIds.length > 0} onClick={() => setPeriods(rows => rows.filter(r => r.id !== p.id))}><Trash2 size={15}/>Remove period</button>}</div><div className="form-grid"><label className="field"><span>Class</span><select required value={p.grade} onChange={e => update(p.id, 'grade', e.target.value)}><option value="">Select class</option>{teacherGrades.map(g => <option key={g}>{g}</option>)}</select></label><label className="field"><span>Section</span><select value={p.section} onChange={e => update(p.id, 'section', e.target.value)}>{teacherSections.map(s => <option key={s}>{s}</option>)}</select></label><label className="field"><span>Subject</span><select required value={p.subject} onChange={e => update(p.id, 'subject', e.target.value)}><option value="">Select subject</option>{teacherSubjects.map(s => <option key={s}>{s}</option>)}</select></label></div><label className="field"><span>Lesson plan number & topic / chapter</span><input required maxLength={1000} value={p.topic} onChange={e => update(p.id, 'topic', e.target.value)} placeholder="Example: LP 12 — Plants around us"/></label><VoiceReflection onFile={file => addFiles(p.id, 'voice', [file])} disabled={!!busy || recordingIds.length > 0} onRecording={active => setRecordingIds(ids => active ? [...new Set([...ids, p.id + '-speech'])] : ids.filter(id => id !== p.id + '-speech'))} onChange={(reflection, materials) => setPeriods(rows => rows.map(row => row.id === p.id ? { ...row, reflection, materials } : row))}/><div className="teacher-evidence"><h3>Lesson planning voice reflection</h3><p className="hint">Record how you plan to teach the lesson, or attach a voice note you have prepared. Your voice note and written planning notes are saved together when you submit.</p><VoiceRecorder disabled={!data.uploadsEnabled || !!busy || recordingIds.some(id => id.endsWith('-speech'))} onRecording={active => setRecordingIds(ids => active ? [...new Set([...ids, p.id])] : ids.filter(id => id !== p.id))} onFile={file => addFiles(p.id, 'voice', [file])}/><label className="field"><span>Or attach a voice recording</span><input type="file" accept=".mp3,.m4a,.wav,.ogg,.webm,.mp4" disabled={!data.uploadsEnabled} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; addFiles(p.id, 'voice', files); }}/></label>{p.files.filter(f => f.category === 'voice').map(f => <div className="teacher-file" key={f.id}><FileText size={16}/><div><b>{f.file.name}</b><small>Voice reflection · {(f.file.size / 1024 / 1024).toFixed(1)} MB</small></div><button type="button" className="icon" aria-label={'Remove ' + f.file.name} onClick={() => update(p.id, 'files', p.files.filter(x => x.id !== f.id))}><Trash2 size={15}/></button></div>)}</div>
            </section>)}
 <div className="actions"><button className="button" type="button" onClick={() => downloadPractice(teachingPracticeText(selectedSchool, teacherValue, date, periods))}>Download reflection draft</button><button className="button" type="button" disabled={periods.length >= 10} onClick={() => setPeriods(rows => [...rows, newPeriod()])}><Plus size={17}/>Add class period</button><button className="button primary" type="submit" disabled={!selectedSchool || !teacherValue || recordingIds.length > 0}>{recordingIds.length ? 'Stop voice recording before saving' : busy || 'Save lesson preparation'}</button></div></fieldset>{busy && <p role="status">{busy}…</p>}{error && <p className="negative" role="alert">{error}</p>}</form>}

 {<section className="card"><div className="card-head"><div><h2>{admin ? 'Teacher evidence' : 'My Evidence'}</h2><p>Loaded period: {data.period?.from} to {data.period?.to}</p></div><span className="pill blue">{history.length} feed entry / entries</span></div>{!history.length && <p className="hint">No submissions in the loaded period. Your new submissions will appear here after saving.</p>}{history.slice().sort((a, b) => b.date.localeCompare(a.date)).map((r) => <article className="conversation" key={r.id}><div className="flex-between"><b>{r.grade}{r.section ? ' · ' + r.section : ''} · {r.subject}</b><small>{r.date}</small></div><h3>{r.topic}</h3>{r.stage && <span className="pill blue">{r.feedStage || lessonStageLabel(r.stage)}</span>}<p className="hint">Planned lesson: {r.plannedDate || r.date}{r.conductedOn ? ' · Taught on: ' + r.conductedOn : ''}</p><button type="button" className="text-button" onClick={() => downloadPractice(teachingPracticeText(r.school, r.teacher, r.date, [r]))}>Download reflection & evidence links</button>{r.reflection && <p style={{ whiteSpace: 'pre-wrap' }}>{r.reflection}</p>}{r.materials && !r.reflection?.includes('Teaching-learning materials / resources\n') && <p><b>Materials: </b>{r.materials}</p>}<div className="evidence-files">{r.files?.map((f, i) => <a className="file" key={f.key + ':' + i} href={f.url} target="_blank" rel="noopener noreferrer"><FileText size={16}/>{f.category}</a>)}</div>{r.review && <p><b>Feedback: </b>{r.review}</p>}</article>)}</section>}</div>;
}

