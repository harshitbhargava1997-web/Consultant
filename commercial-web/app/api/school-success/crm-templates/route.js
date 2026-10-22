import {withRequest} from '@/lib/school-success/server';
import { actor, database, checkOrigin, failure } from '@/lib/school-success/server';
import { defaultTemplates, templateSchema } from '@/lib/school-success/crm-templates';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
async function handlerGET(req) { try {
    const a = await actor(req);
    if (a.role !== 'admin')
        throw Error('403:Admin required');
    const rows = await database().prepare("SELECT value FROM portal_config WHERE key LIKE 'crmTemplate:%'").all();
    const merged = new Map(defaultTemplates.map(t => [t.id, t]));
    for (const row of rows.results) {
        const t = JSON.parse(String(row.value));
        merged.set(t.id, t);
    }
    return Response.json({ templates: [...merged.values()] }, { headers });
}
catch (e) {
    return failure(e);
} }
async function handlerPOST(req) {
    try {
        checkOrigin(req);
        const a = await actor(req);
        if (a.role !== 'admin')
            throw Error('403:Admin required');
        const raw = await req.text();
        if (raw.length > 30000)
            throw Error('Template is too large');
        const b = JSON.parse(raw), t = templateSchema.parse(b.template), expected = String(b.revision || ''), revision = crypto.randomUUID(), value = JSON.stringify({ ...t, revision }), db = database(), key = 'crmTemplate:' + t.id;
        const result = expected ? await db.prepare("UPDATE portal_config SET value=? WHERE key=? AND json_extract(value,'$.revision')=?").bind(value, key, expected).run() : await db.prepare('INSERT OR IGNORE INTO portal_config(key,value) VALUES(?,?)').bind(key, value).run();
        if (!result.meta.changes)
            throw Error('409:This template was changed elsewhere. Reload templates before saving. Your current text is still in the editor.');
        return Response.json({ template: { ...t, revision } }, { headers });
    }
    catch (e) {
        return failure(e);
    }
}


export async function GET(req){return withRequest(req,()=>handlerGET(req));}

export async function POST(req){return withRequest(req,()=>handlerPOST(req));}

