'use client';
import {successFetch} from '@/lib/school-success/client';
import { useState } from 'react';
export default function SchoolSharingLinks({ schools }) {
    const [links, setLinks] = useState({}), [query, setQuery] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
    async function prepare(school) { setBusy(school); setError(''); setNotice(''); try {
        const r = await successFetch('/api/school-success/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'schoolLink', school }) });
        const d = await r.json();
        if (!r.ok)
            throw Error(d.error || 'Could not prepare this school link');
        setLinks(current => ({ ...current, [school]: d.url }));
        setNotice('Link ready for ' + school + '. Copy it below and share it with school management.');
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy('');
    } }
    async function copy(school) { try {
        await navigator.clipboard.writeText(links[school]);
        setNotice('Copied the link for ' + school + '.');
    }
    catch {
        setNotice('Select the link text below and copy it using your phone’s menu.');
    } }
    return <section className="card"><details><summary><b>School management sharing links</b> · {schools.length} schools</summary><p>Each school has its own link. Management can select a teacher from that school and complete the reflection and evidence form.</p><p className="hint">No sign-in is required for these school forms. Share each link only with its school; it allows selection of that school’s teachers.</p><label className="field"><span>Find a school</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search school name"/></label>{error && <p role="alert" className="negative">{error}</p>}{notice && <p role="status">{notice}</p>}<div style={{ maxHeight: 420, overflowY: 'auto' }}>{schools.filter(s => s.toLowerCase().includes(query.toLowerCase())).map(s => <article key={s} className="conversation"><div className="flex-between"><b>{s}</b><button type="button" className="button" disabled={!!busy} onClick={() => void prepare(s)}>{busy === s ? 'Preparing…' : links[s] ? 'Refresh teacher list' : 'Get school link'}</button></div>{links[s] && <><label className="field"><span>Shareable link for {s}</span><input readOnly value={links[s]} onFocus={e => e.target.select()}/></label><div className="actions"><button type="button" className="button" onClick={() => void copy(s)}>Copy link</button><a className="button" href={links[s]} target="_blank" rel="noopener noreferrer">Open school form</a></div></>}</article>)}</div></details></section>;
}

