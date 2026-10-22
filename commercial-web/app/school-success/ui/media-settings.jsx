'use client';
import {successFetch} from '@/lib/school-success/client';
import { useEffect, useState } from 'react';
export default function MediaSettings({ refresh }) {
    const [status, setStatus] = useState(null), [accessKeyId, setAccessKeyId] = useState(''), [secretAccessKey, setSecretAccessKey] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
    useEffect(() => { const controller = new AbortController(); successFetch('/api/school-success/media-settings', { signal: controller.signal, cache: 'no-store' }).then(async (r) => { const d = await r.json(); if (!r.ok)
        throw Error(d.error || 'Could not load media settings'); setStatus(d); }).catch(e => { if (e.name !== 'AbortError')
        setError(e.message); }); return () => controller.abort(); }, []);
    async function save(e) { e.preventDefault(); setBusy(true); setError(''); setSuccess(''); try {
        const r = await successFetch('/api/school-success/media-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessKeyId, secretAccessKey }) });
        const d = await r.json();
        if (!r.ok)
            throw Error(d.error || 'Could not load media settings');
        setAccessKeyId('');
        setSecretAccessKey('');
        setStatus(s => s ? { ...s, configured: true } : s);
        setSuccess('Connection verified and saved. Teacher media uploads are now enabled.');
        try {
            await refresh();
        }
        catch {
            setSuccess('Connection verified and saved. Refresh the portal to update the upload controls.');
        }
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save media settings. Please retry.');
    }
    finally {
        setBusy(false);
    } }
    return <section className="card" style={{ maxWidth: 720 }}><div className="card-head"><div><h2>Teacher media connection</h2><p>Save your Cloudflare R2 credentials to enable photos, videos and voice recordings.</p></div><span className={'pill ' + (status?.configured ? 'green' : 'amber')}>{status ? status.configured ? 'Connected' : 'Setup needed' : 'Checking…'}</span></div><p><b>Bucket:</b> {status?.bucket || 'onelern-media'}</p><p className="hint">Use an R2 key pair with Object Read & Write access to this bucket. Credentials are encrypted on the server and never displayed after saving.</p>{error && <div className="alert error" role="alert">{error}</div>}{success && <div className="alert success" role="status">{success}</div>}<form onSubmit={save} autoComplete="off"><label className="field"><span>R2 Access Key ID</span><input name="r2-access-key" type="password" required autoComplete="off" spellCheck={false} autoCapitalize="none" value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} placeholder={status?.configured ? 'Enter a new pair to replace the saved credentials' : 'Paste your Access Key ID'}/></label><label className="field"><span>R2 Secret Access Key</span><input name="r2-secret-key" type="password" required autoComplete="new-password" spellCheck={false} autoCapitalize="none" value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} placeholder="Paste your Secret Access Key"/></label><button className="button primary" disabled={busy || !status?.canSave} type="submit">{busy ? 'Testing connection…' : 'Save & activate media'}</button></form><p className="hint">Saving tests a temporary file in your bucket and removes it. After a successful save, uploads work immediately.</p></section>;
}

