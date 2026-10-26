'use client';
import {successFetch} from '@/lib/school-success/client';
import { useState } from 'react';
import { Upload, Download, CheckCircle } from 'lucide-react';
import { readUsageWorkbooks } from '@/lib/school-success/workbook-import';
import {runUsageImport} from '@/lib/school-success/usage-import-batches';
import { csv } from '@/lib/school-success/domain';
function download(name, content, type = 'text/csv') { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export default function UsageImport({ refresh, entries, members, onPeriod }) {
    const [fileCount,setFileCount]=useState(0);
    const [rows, setRows] = useState([]), [names, setNames] = useState(''), [result, setResult] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
    async function call(preview,input=rows,source=names){
        return runUsageImport({rows:input,source,preview,
            send:body=>successFetch('/api/school-success/portal',{method:'POST',headers:{'Content-Type':'application/json'},body}),
            onProgress:({completed,total,batch,batches})=>setBusy((preview?'Checking':'Saving')+' rows: '+completed.toLocaleString('en-IN')+' / '+total.toLocaleString('en-IN')+' · Batch '+batch+' of '+batches)
        });
    }
    async function choose(files) { if (!files?.length)
        return; setBusy('Reading workbooks'); setRows([]); setResult(null); setError(''); setNames(''); setFileCount(files.length); try {
        const { rows: data, source } = await readUsageWorkbooks(files);
        setRows(data);
        setNames(source);
        setBusy('Checking existing database records');
        setResult(await call(true, data, source));
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy('');
    } }
    async function commit() { setBusy('Saving new records'); setError(''); try {
        const value = await call(false);
        setResult(value);
        try {
            await refresh();
        }
        catch {
            setError('Import completed. Refresh the page to reload the latest reports.');
        }
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setBusy('');
    } }
    return <div className="grid-main"><section className="card"><div className="card-head"><div><h2>Import user metrics</h2><p>Upload one or more Excel or CSV exports. Existing sessions are skipped, including overlapping summary and detailed exports.</p></div><Upload size={20}/></div><label className="upload-zone"><Upload size={28}/><b>{fileCount ? `${fileCount} ${fileCount===1?'file':'files'} selected` : 'Choose UserMetrics workbooks'}</b>{names && <small title={names}>{names.length>200?names.slice(0,197)+'…':names}</small>}<span>Multiple files · .xlsx / .csv · 10 MB total · 20,000 rows</span><input type="file" multiple accept=".xlsx,.csv" disabled={!!busy} onChange={e => { const selected = Array.from(e.target.files || []); e.target.value = ''; void choose(selected); }}/></label>{busy && <p role="status" aria-live="polite">{busy}… Keep this page open until complete.</p>}{error && <p className="negative" role="alert">{error}</p>}{result && <div className="import-preview"><h3>{result.preview ? 'Database check complete' : 'Import complete'}</h3><div className="metric-grid"><article className="metric-card"><span>{result.preview ? 'New rows to import' : 'Inserted'}</span><strong>{result.preview ? result.newRows : result.inserted}</strong></article><article className="metric-card"><span>Duplicates skipped</span><strong>{result.skipped}</strong></article><article className="metric-card"><span>Rows needing correction</span><strong>{result.rejected.length}</strong></article></div>{result.period && <p>Workbook period: {result.period.from} to {result.period.to}. <button className="text-button" disabled={!!busy} onClick={() => void onPeriod(result.period.from, result.period.to).catch(e => setError(e.message))}>View this period</button></p>}{result.preview && result.newRows === 0 && result.skipped > 0 && <p className="positive">All valid sessions are already in the database. No new rows are needed.</p>}<p>{result.total} rows checked{!result.preview && result.enriched > 0 ? ` · Missing details filled on ${result.enriched} existing records` : ''}.</p>{result.preview ? <><p>Only valid new records will be saved. Duplicate checks run again when you import.</p><button className="button primary" disabled={!!busy || result.newRows + result.skipped === 0} onClick={() => void commit()}><CheckCircle size={17}/>Import valid rows</button></> : <p className="positive">Saved to your existing database. Uploading these files again will skip the same sessions.</p>}{result.rejected.length > 0 && <><button className="button" onClick={() => download('usermetrics-rows-needing-correction.csv', csv(result.rejected))}><Download size={16}/>Download rejected rows</button><div className="table-scroll"><table><thead><tr><th>File</th><th>Excel row</th><th>Issue</th></tr></thead><tbody>{result.rejected.slice(0, 20).map((r, i) => <tr key={i}><td>{r.file}</td><td>{r.row}</td><td>{r.reason}</td></tr>)}</tbody></table></div>{result.rejected.length > 20 && <p>Showing the first 20. Download the full list above.</p>}</>}</div>}</section><aside><section className="card tint"><h2>How duplicate checks work</h2><p>Sessions are matched by school, teacher, activity, start/end times and duration. The filename and uploader do not create a new record.</p><p>Missing book, grade and subject details can be filled from a richer export without adding the same session again.</p><p>Original activity types are preserved. Book, E-book and Additional Materials remain separate in reports.</p></section><section className="card"><h2>Workbook format</h2><p>Use the original UserMetrics worksheet. School comes from Center, with Institution as a fallback. Teacher names can use FullName or FirstName and LastName.</p><p>Include Type, StartTime, EndTime where available, and a duration column: Duration (HH:MM:SS), Duration (Minutes) or Duration_Min.</p><button className="text-button" onClick={() => download('usermetrics-template.csv', csv([{ Institution: 'Your organisation', Center: 'Your school', FirstName: 'Teacher', LastName: 'Name', Role: 'teacher', Type: 'lessonDelivery', StartTime: '2026-10-20T09:00:00', EndTime: '2026-10-20T09:10:00', 'Duration (HH:MM:SS)': '00:10:00', Grade: '', Subject: '', Book: '' }]))}>Download usage template</button></section><section className="card"><h2>Your data, portable</h2><p>Download the records currently loaded for the selected report period, including your access roster.</p><button className="button" onClick={() => download('school-success-loaded-records.json', JSON.stringify({ exported: new Date().toISOString(), entries, members }, null, 2), 'application/json')}><Download size={16}/>Download loaded records</button></section></aside></div>;
}

