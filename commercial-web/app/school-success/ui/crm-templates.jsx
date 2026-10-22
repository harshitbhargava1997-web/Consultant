'use client';
import {successFetch} from '@/lib/school-success/client';
import { useEffect, useState } from 'react';
import { defaultTemplates, fillTemplate, missingFields } from '@/lib/school-success/crm-templates';
export default function CRMTemplates({ entries, school }) {
    const [templates, setTemplates] = useState([]), [item, setItem] = useState(null), [dirty, setDirty] = useState(false), [language, setLanguage] = useState('English'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [values, setValues] = useState({ school, consultant: 'Harshit Bhargava', stakeholder: '', summary: '', action: '', owner: '', followup: '', usage: '', issue: '', training: '', focus: '' }), [role, setRole] = useState('Principal'), [call, setCall] = useState(''), [message, setMessage] = useState('');
    async function load() { setError(''); try {
        const r = await successFetch('/api/school-success/crm-templates'), d = await r.json();
        if (!r.ok)
            throw Error(d.error);
        setTemplates(d.templates);
        if (!item)
            setItem(d.templates[0]);
    }
    catch (e) {
        setError(e.message);
    } }
    useEffect(() => { load(); }, []);
    function choose(t) { if (dirty && !window.confirm('Discard unsaved template edits?'))
        return; setItem({ ...t }); setLanguage(t.language); setDirty(false); setCall(''); setMessage(''); setNotice(''); }
    function edit(key, text) { setItem(t => t ? { ...t, [key]: text } : null); setDirty(true); }
    function value(key, text) { setValues(v => ({ ...v, [key]: text })); setCall(''); setMessage(''); }
    async function save(copy = false) { if (!item)
        return; setBusy(true); setError(''); try {
        const template = copy ? { ...item, id: crypto.randomUUID(), name: item.name + ' (copy)' } : item;
        const r = await successFetch('/api/school-success/crm-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template, revision: copy ? '' : item.revision || '' }) }), d = await r.json();
        if (!r.ok)
            throw Error(d.error);
        setTemplates(ts => [...ts.filter(t => t.id !== d.template.id), d.template]);
        setItem(d.template);
        setDirty(false);
        setNotice('Template saved for future calls and discussions.');
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } }
    const schools = [...new Set(entries.filter(r => r.kind === 'school').map(r => r.school || r.name))].sort();
    const contact = entries.find(r => r.kind === 'contact' && r.school === values.school && r.entity === role), phone = String(contact?.phone || '').replace(/\D/g, ''), waPhone = phone.length === 10 ? '91' + phone : phone;
    const unresolved = missingFields(message), recent = entries.filter(r => r.kind === 'call' && !r.archived && r.school === values.school).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    function generate() { if (!item)
        return; const english = item.language === 'English', focus = role === 'Owner' ? (english ? 'Overall implementation, school priorities and support needed.' : 'Overall implementation, school priorities aur support ki zarurat.') : role === 'Coordinator' ? (english ? 'Teacher preparation, classroom use and practical implementation support.' : 'Teacher preparation, classroom use aur practical implementation support.') : (english ? 'School progress, teacher participation and concerns requiring attention.' : 'School progress, teacher participation aur dhyan dene layak concerns.'); const context = { ...values, stakeholder: values.stakeholder || contact?.name || '', focus: values.focus || focus }; setCall(fillTemplate(item.call, context)); setMessage(fillTemplate(item.whatsapp, context)); setNotice('Drafts prepared. Review and edit them before use.'); }
    async function copy(text) { try {
        await navigator.clipboard.writeText(text);
        setNotice('Copied.');
    }
    catch {
        setError('Copy was unavailable. Select the text and copy it manually.');
    } }
    return <section className="card"><h2>Call scripts & WhatsApp templates</h2><p>Choose a purpose and language. Save reusable wording here, then prepare an editable draft for a school.</p>{error && <p role="alert" className="alert error">{error}</p>}{notice && <p role="status" className="alert success">{notice}</p>}<div className="form-grid"><label className="field"><span>Language</span><select value={language} onChange={e => { const t = templates.find(t => t.language === e.target.value && t.name === item?.name) || templates.find(t => t.language === e.target.value); if (t)
        choose(t); }}><option>English</option><option>Hinglish</option></select></label><label className="field"><span>Template</span><select value={item?.id || ''} onChange={e => { const t = templates.find(t => t.id === e.target.value); if (t)
        choose(t); }}>{!item && <option>Loading templates…</option>}{templates.filter(t => t.language === language).map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label></div><button type="button" className="text-button" onClick={() => { if (dirty && !window.confirm('Reload saved templates and discard unsaved edits?'))
        return; setItem(null); setDirty(false); successFetch('/api/school-success/crm-templates').then(async (r) => { const d = await r.json(); if (!r.ok)
        throw Error(d.error); setTemplates(d.templates); setItem(d.templates.find((t) => t.id === item?.id) || d.templates[0]); }).catch(e => setError(e.message)); }}>Reload saved templates</button>
 {item && <><details><summary>Edit reusable template {dirty ? '• Unsaved changes' : ''}</summary><fieldset disabled={busy} className="teacher-fields"><label className="field"><span>Template name</span><input value={item.name} maxLength={120} onChange={e => edit('name', e.target.value)}/></label>{['call', 'whatsapp'].map(key => <label className="field" key={key}><span>{key === 'call' ? 'Call script' : 'WhatsApp template'}</span><textarea rows={10} maxLength={12000} value={item[key]} onChange={e => edit(key, e.target.value)}/></label>)}<p className="hint">Reusable fields: {'{school}, {stakeholder}, {consultant}, {summary}, {action}, {owner}, {followup}, {usage}, {issue}, {training}, {focus}'}. Keep these in the saved template; fill the actual details below.</p><div className="actions"><button type="button" className="button primary" onClick={() => save()} disabled={!dirty || !item.name.trim() || !item.call.trim() || !item.whatsapp.trim()}>Save template</button><button type="button" className="button" onClick={() => save(true)}>Save as new version</button><button type="button" className="text-button" disabled={!defaultTemplates.some(t => t.id === item.id)} onClick={() => { const t = defaultTemplates.find(t => t.id === item.id); if (t) {
            setItem({ ...t, revision: item.revision });
            setDirty(true);
        } }}>Load original wording</button></div></fieldset></details>
 <h3>Prepare for a school</h3><div className="form-grid"><label className="field"><span>School</span><select value={values.school} onChange={e => { const s = e.target.value, c = entries.find(r => r.kind === 'contact' && r.school === s && r.entity === role); setValues(v => ({ ...v, school: s, stakeholder: c?.name || '', summary: '', action: '', owner: '', followup: '', issue: '', usage: '', training: '' })); setCall(''); setMessage(''); }}><option value="">Select school</option>{schools.map(s => <option key={s}>{s}</option>)}</select></label><label className="field"><span>Stakeholder role</span><select value={role} onChange={e => { setRole(e.target.value); value('stakeholder', entries.find(r => r.kind === 'contact' && r.school === values.school && r.entity === e.target.value)?.name || ''); }}>{['Principal', 'Owner', 'Coordinator'].map(r => <option key={r}>{r}</option>)}</select></label>{[['stakeholder', 'Stakeholder name'], ['consultant', 'Your name']].map(([key, label]) => <label className="field" key={key}><span>{label}</span><input value={values[key] || ''} placeholder={key === 'stakeholder' ? contact?.name || '' : ''} onChange={e => value(key, e.target.value)}/></label>)}</div><label className="field"><span>Use notes from a saved call</span><select value="" onChange={e => { const r = recent.find(r => r.id === e.target.value); if (r) {
            setValues(v => ({ ...v, stakeholder: r.name || '', summary: r.notes || '', action: r.nextAction || '', owner: r.actionOwner || '', followup: r.followup || '' }));
            setRole(r.entity || 'Principal');
            setCall('');
            setMessage('');
        } }}><option value="">Select a call, or enter details below</option>{recent.map(r => <option key={r.id} value={r.id}>{r.date} · {r.name} · {r.outcome || 'Call'}</option>)}</select></label>
 <div className="form-grid">{[['summary', 'Actual discussion update'], ['action', 'Agreed next action'], ['owner', 'Responsible person'], ['followup', 'Follow-up date / time'], ['usage', 'Usage update'], ['issue', 'Ticket / issue'], ['training', 'Training / visit'], ['focus', 'Discussion focus (or use role default)']].filter(([key]) => key === 'summary' || key === 'action' || key === 'owner' || key === 'followup' || item.call.includes('{' + key + '}') || item.whatsapp.includes('{' + key + '}')).map(([key, label]) => <label className="field" key={key}><span>{label}</span><textarea rows={2} value={values[key] || ''} onChange={e => value(key, e.target.value)}/></label>)}</div><p className="hint">Use actual updates only. If no support is required, say so in the summary and remove any unnecessary action lines from the draft.</p><button type="button" className="button primary" onClick={generate}>Prepare editable drafts</button>
 {call && <label className="field"><span>Call script for this discussion</span><textarea rows={12} value={call} onChange={e => setCall(e.target.value)}/><button type="button" className="button" onClick={() => copy(call)}>Copy call script</button></label>}{message && <><label className="field"><span>WhatsApp draft — review before sharing</span><textarea rows={12} value={message} onChange={e => setMessage(e.target.value)}/></label>{unresolved.length > 0 && <p className="hint">Fill or remove these fields before sharing: {unresolved.join(', ')}</p>}<div className="actions"><button type="button" className="button" disabled={!!unresolved.length} onClick={() => copy(message)}>Copy WhatsApp message</button>{!unresolved.length && waPhone.length >= 10 && waPhone.length <= 15 && <a className="button primary" target="_blank" rel="noopener noreferrer" href={'https://wa.me/' + waPhone + '?text=' + encodeURIComponent(message)}>Review in WhatsApp</a>}</div><p className="hint">Draft edits apply to this conversation. To reuse wording, edit and save the template above. Opening WhatsApp does not send the message.</p></>}
 </>}
 </section>;
}

