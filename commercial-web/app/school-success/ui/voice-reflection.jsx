'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { formatReflection, reflectionPrompts, reflectionSectionLimit } from '@/lib/school-success/teacher-flow';
export default function VoiceReflection({ disabled, onChange, onRecording, onFile }) {
    const [parts, setParts] = useState({}), [target, setTarget] = useState('objective'), [language, setLanguage] = useState('en-IN'), [recording, setRecording] = useState(false), [interim, setInterim] = useState(''), [error, setError] = useState(''), [starting, setStarting] = useState(false), [supported, setSupported] = useState(null);
    const values = useRef(parts), recognizer = useRef(null), callbacks = useRef({ onChange, onRecording, onFile }), media = useRef(null), stream = useRef(null);
    callbacks.current = { onChange, onRecording, onFile };
    useEffect(() => { const w = window; setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)); return () => { const r = recognizer.current; if (r) {
        r.onresult = null;
        r.onend = null;
        r.onerror = null;
        r.abort();
        callbacks.current.onRecording(false);
    } if (media.current) {
        media.current.onstop = null;
        if (media.current.state === 'recording')
            media.current.stop();
    } stream.current?.getTracks().forEach(t => t.stop()); }; }, []);
    function publish(key, text) { const next = { ...values.current, [key]: text }; values.current = next; setParts(next); callbacks.current.onChange(formatReflection(next), next.materials || ''); }
    async function start() { if (starting || recording)
        return; setStarting(true); callbacks.current.onRecording(true); setError(''); setInterim(''); try {
        const w = window, Constructor = w.SpeechRecognition || w.webkitSpeechRecognition;
        if (!Constructor)
            throw Error('Live transcription is unavailable in this browser. Use your phone keyboard microphone in the reflection fields, or type your reflection.');
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
            throw Error('Voice recording is unavailable in this browser. Type your reflection and attach a voice note below.');
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.current = audio;
        const recorder = new MediaRecorder(audio);
        media.current = recorder;
        const chunks = [];
        recorder.ondataavailable = e => { if (e.data.size)
            chunks.push(e.data); };
        recorder.onstop = async () => { audio.getTracks().forEach(t => t.stop()); const type = recorder.mimeType, ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'; if (chunks.length)
            await callbacks.current.onFile(new File(chunks, 'Reflection-' + target + '.' + ext, { type })); audio.getTracks().forEach(t => t.stop()); setRecording(false); callbacks.current.onRecording(false); };
        recorder.start();
        const r = new Constructor();
        recognizer.current = r;
        r.lang = language;
        r.continuous = true;
        r.interimResults = true;
        const key = target;
        let base = values.current[key] || '', final = '';
        r.onresult = event => { let preview = ''; for (let i = event.resultIndex; i < event.results.length; i++) {
            const text = String(event.results[i][0].transcript || '').trim();
            if (event.results[i].isFinal)
                final += (final ? ' ' : '') + text;
            else
                preview += (preview ? ' ' : '') + text;
        } if (final)
            publish(key, [base, final].filter(Boolean).join(' ').slice(0, reflectionSectionLimit)); setInterim(preview); };
        r.onerror = event => { setError(event.error === 'not-allowed' ? 'Microphone permission was denied. Allow microphone access, or use the keyboard microphone / type below.' : 'Transcription stopped (' + event.error + '). Your captured text is kept; retry or edit it below.'); };
        r.onend = () => { setInterim(''); if (recorder.state === 'recording')
            recorder.stop(); };
        r.start();
        setRecording(true);
        callbacks.current.onRecording(true);
    }
    catch (e) {
        setError(e.message);
        if (media.current?.state === 'recording')
            media.current.stop();
        stream.current?.getTracks().forEach(t => t.stop());
        setRecording(false);
        callbacks.current.onRecording(false);
    }
    finally {
        setStarting(false);
    } }
    return <div className="teacher-evidence"><h3>1. Lesson planning & reflection</h3><p className="hint">Prepare for your lesson by describing what you will teach, why, the materials you will use and how you will check learning. Choose each section to dictate or write your planning notes, then review the text before submitting.</p><div className="form-grid"><label className="field"><span>Speaking language</span><select disabled={recording} value={language} onChange={e => setLanguage(e.target.value)}><option value="en-IN">English (India)</option><option value="hi-IN">Hindi</option></select></label><label className="field"><span>Reflection section</span><select disabled={recording} value={target} onChange={e => setTarget(e.target.value)}>{reflectionPrompts.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><button className="button primary" type="button" disabled={starting || disabled && !recording || supported === false} onClick={() => recording ? recognizer.current?.stop() : start()}>{recording ? <Square size={16}/> : <Mic size={16}/>} {recording ? 'Stop voice reflection' : 'Start voice reflection'}</button>{recording && <p role="status">Listening… {interim}</p>}{supported === false && <p className="hint">Live transcription is unavailable here. Tap a field and use your phone keyboard’s microphone, or type your reflection.</p>}{error && <p className="negative" role="alert">{error}</p>}<p className="hint">Voice transcription uses your browser’s speech service and may require internet. Your recording and transcribed text are saved together. Review the filled section before submitting; your lesson preparation PDF will include the text and links to the recordings.</p>{reflectionPrompts.map(([key, label]) => <label className="field" key={key}><span>{label}</span><textarea rows={2} maxLength={reflectionSectionLimit} disabled={recording} value={parts[key] || ''} onChange={e => publish(key, e.target.value)} placeholder={key === 'objective' ? 'What should students learn, and why?' : key === 'materials' ? 'Which teaching-learning materials, books, digital content or physical resources will you use?' : key === 'teacher' ? 'How will you teach? Which resources will you use?' : key === 'student' ? 'What will students do?' : key === 'practice' ? 'Course Book / Workbook pages, classwork and homework' : 'How will you check learning? What needs to happen next?'}/></label>)}<details><summary>Preview the consolidated reflection</summary><p style={{ whiteSpace: 'pre-wrap' }}>{formatReflection(parts) || 'Your reflection will appear here as you speak or type.'}</p></details></div>;
}

