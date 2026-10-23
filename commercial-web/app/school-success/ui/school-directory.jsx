'use client';
import {successFetch} from '@/lib/school-success/client';
import { useState } from 'react';
import { isArchived } from '@/lib/school-success/directory';
export default function SchoolDirectory({ data, school, query, onChanged, onCRM, onEdit }) {
    const [view, setView] = useState('Active'), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [links, setLinks] = useState({});
    const directory = data.directory || { schools: [], teachers: [], members: [], archives: [] }, archives = directory.archives;
    const matches = (value) => value.toLowerCase().includes(query.toLowerCase());
    async function post(body) { const r = await successFetch('/api/school-success/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok)
        throw Error(d.error || 'Could not update directory'); return d; }
    async function change(target, s, teacher, archived) { setBusy(JSON.stringify([target, s, teacher])); setError(''); setNotice(''); try {
        await post({ action: 'directoryArchive', target, school: s, teacher, archived });
        await onChanged(target, s);
        setLinks({});
        setNotice((teacher || s) + (archived ? ' archived. Historical usage and evidence remain saved.' : ' restored to the active directory.'));
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy('');
    } }
    async function share(s) { setBusy(s); setError(''); try {
        const result = await post({ action: 'schoolLink', school: s });
        setLinks(prev => ({ ...prev, [s]: result.url }));
        setNotice('School link ready. Select and copy it below.');
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy('');
    } }
    const schools = directory.schools.filter((s) => (!school || s === school) && matches(s) && isArchived(archives, s) === (view === 'Archived'));
    const teachers = directory.teachers.filter((t) => (!school || t.school === school) && matches(t.name + ' ' + t.school) && isArchived(archives, t.school, t.name) === (view === 'Archived'));
    return <><section className="card"><div className="tabs">{['Active', 'Archived'].map(v => <button key={v} type="button" className={view === v ? 'selected' : ''} onClick={() => setView(v)}>{v}</button>)}</div><p>Archive schools or teachers who are no longer active. Their records stay saved and are excluded from default usage and Teacher 360° reports.</p><p className="hint">Use Archived to restore them, or Include archived schools and teachers in reports to retrieve their history. Archiving also disables their teacher-form access.</p>{error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert success" role="status">{notice}</p>}</section>
 <div className="school-grid">{schools.map((s) => <section className="card" key={s}><h2>{s}</h2><p>{directory.teachers.filter((t) => t.school === s && !isArchived(archives, s, t.name)).length} active teachers</p><div className="actions">{view === 'Active' && <><button type="button" className="text-button" onClick={() => onCRM(s)}>Open CRM</button><button type="button" className="text-button" disabled={!!busy} onClick={() => void share(s)}>Get teacher link</button></>}<button type="button" className="button" disabled={!!busy} onClick={() => void change('school', s, '', view === 'Active')}>{view === 'Active' ? 'Archive school' : 'Restore school'}</button></div>{links[s] && <label className="field"><span>Shareable school link</span><input readOnly value={links[s]} onFocus={e => e.target.select()}/><a href={links[s]} target="_blank" rel="noopener noreferrer">Open teacher portal</a></label>}</section>)}</div>
 <section className="card"><div className="card-head"><h2>{view === 'Active' ? 'Teachers' : 'Archived teachers'}</h2><span className="pill blue">{teachers.length}</span></div><p className="hint">Teachers from your usage database and the School Success directory are listed together.</p><div className="table-scroll"><table><thead><tr><th>Teacher</th><th>School</th><th>Teacher email</th><th>Actions</th></tr></thead><tbody>{teachers.map((t) => { const members = directory.members.filter((m) => m.school === t.school && m.name === t.name), schoolArchived = isArchived(archives, t.school); return <tr key={JSON.stringify([t.school, t.name])}><td>{t.name}</td><td>{t.school}</td><td>{members.length ? members.map((m) => <div key={m.email}>{m.email}{view === 'Active' && onEdit && <button type="button" className="text-button" onClick={() => onEdit(m)}>Edit teacher</button>}</div>) : 'School link'}</td><td>{schoolArchived ? <span className="hint">Restore the school first</span> : <button type="button" className="button" disabled={!!busy} onClick={() => void change('teacher', t.school, t.name, view === 'Active')}>{view === 'Active' ? 'Archive teacher' : 'Restore teacher'}</button>}</td></tr>; })}</tbody></table></div>{!teachers.length && <p>No {view.toLowerCase()} teachers match this view.</p>}</section></>;
}

