import {withRequest} from '@/lib/school-success/server';
import { ensureCrmArchive, applyCrmArchive } from '@/lib/school-success/crm-archive';
import { loadArchives, isArchived, archiveKey } from '@/lib/school-success/directory';
import { env } from '@/lib/school-success/environment';
import { r2UploadsConfigured, loadR2Config } from '@/lib/school-success/r2-evidence';
import { ticketSchema } from '@/lib/school-success/crm';
import { reportSettingsSchema, defaultReportSettings } from '@/lib/school-success/reports';
import { gateway, publicBase } from '@/lib/school-success/live';
import { mapLive } from '@/lib/school-success/live-mapping';
import { actor, database, checkOrigin, failure, assertSchool, schoolTeachers, streamJson } from '@/lib/school-success/server';
import { schemas } from '@/lib/school-success/domain';
export const dynamic = 'force-dynamic';
async function hash(s) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(x => x.toString(16).padStart(2, '0')).join(''); }
async function handlerGET(req) {
    try {
        const started=performance.now(),a=await actor(req),authDone=performance.now(),db=database(),url=new URL(req.url),today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
        const from=url.searchParams.get('from')||today.slice(0,8)+'01',to=url.searchParams.get('to')||today,admin=a.role==='admin';
        const rawTask=gateway({action:'read',from,to}),mappedTask=rawTask.then(raw=>mapLive(raw,publicBase()));
        const [mapped,localRows,saved,allMemberRows,archiveRows,config,crmArchive]=await Promise.all([
         mappedTask,admin?db.prepare("SELECT * FROM portal_entries WHERE kind='school'").all():{results:[]},
         admin?db.prepare("SELECT value FROM portal_config WHERE key='reportSettings'").first():null,
         admin?db.prepare('SELECT * FROM portal_members ORDER BY school,name').all():{results:[]},
         loadArchives(db),loadR2Config(env,db),admin?ensureCrmArchive(db,async()=>(await mappedTask).entries):{ids:[]}
        ]);
        const raw=await rawTask,dataDone=performance.now();
        const local=localRows.results.map(r=>({...JSON.parse(r.payload),id:r.id,kind:r.kind,version:r.version}));
        const allEntries=[...applyCrmArchive(mapped.entries,crmArchive).filter(r=>r.kind!=='submission'||r.date>=from&&r.date<=to),...local.filter(r=>!a.allowedSchools||a.allowedSchools.includes(r.school))];
        const parsed = reportSettingsSchema.safeParse(saved ? JSON.parse(saved.value) : null);
        const reportSettings = parsed.success ? parsed.data : defaultReportSettings;
        const calendars = Object.fromEntries((raw.calendars || []).map((r) => [r.school, Array.isArray(r.calendar_dates) ? r.calendar_dates : []]));
        const allMembers=allMemberRows.results.filter(r=>!a.allowedSchools||a.allowedSchools.includes(r.school));
        const archives = archiveRows.filter(r=>!a.allowedSchools||a.allowedSchools.includes(r.school)), active = (r) => !isArchived(archives, r.school || r.name, r.teacher || '');
        const entries = allEntries.filter(active), members = allMembers.filter((r) => !isArchived(archives, r.school, r.name));
        const roster = [...new Map([...mapped.roster, ...allMembers].map((r) => [JSON.stringify([r.school, r.name]), { school: r.school, name: r.name }])).values()];
        const activeRoster = roster.filter(r => !isArchived(archives, r.school, r.name));
        const directory = a.role === 'admin' ? { archives, schools: [...new Set([...allEntries.map(r => r.school || r.name), ...roster.map(r => r.school), ...archives.map(r => r.school)])].filter(Boolean).sort(), teachers: [...new Map([...roster, ...archives.filter(r => r.kind === 'teacher').map(r => ({ school: r.school, name: r.teacher }))].map(r => [JSON.stringify([r.school, r.name]), r])).values()], members: allMembers } : undefined;
        return streamJson({ actor: {...a,allowedSchools:undefined,userId:undefined}, entries: a.role === 'admin' ? entries : entries.filter(r => (r.kind === 'school' && (r.school || r.name) === a.school) || (r.kind === 'submission' && r.school === a.school && r.teacher === a.name && (a.role !== 'school-teacher' || r.uploadedBy === a.email))), members, directory, crmArchive: a.role === 'admin' ? { createdAt: crmArchive.createdAt, count: crmArchive.ids.length } : undefined, archivedEntries: a.role === 'admin' ? allEntries.filter(r => !active(r)) : undefined, archivedRoster: a.role === 'admin' ? roster.filter(r => isArchived(archives, r.school, r.name)) : undefined, roster: a.role === 'admin' ? activeRoster : a.role === 'school-teacher' ? a.teachers.map((name) => ({ name, school: a.school })) : [], source: 'Vision · School Success', period: { from, to }, counts: a.role === 'admin' ? mapped.counts : undefined, reportSettings: a.role === 'admin' ? reportSettings : undefined, calendars: a.role === 'admin' ? calendars : undefined, uploadsEnabled: r2UploadsConfigured(config), mediaPublicBase: publicBase(), teacherSubmissionsEnabled: true, importsEnabled: a.role === 'admin' }, { headers: { 'Cache-Control': 'no-store','Server-Timing':`auth;dur=${(authDone-started).toFixed(1)}, data;dur=${(dataDone-authDone).toFixed(1)}, total;dur=${(performance.now()-started).toFixed(1)}` } });
    }
    catch (e) {
        return failure(e);
    }
}
async function handlerPOST(req) {
    try {
        checkOrigin(req);
        const a = await actor(req), db = database();
        const b = await req.json();
        const now = new Date().toISOString();
        if(a.allowedSchools&&b.kind==='school')throw Error('403:Only Super Admin may add schools');
        if(b.data?.school)assertSchool(a,b.data.school);if(b.school)assertSchool(a,b.school);
        if(b.action==='member'&&!a.isSuperAdmin)throw Error('403:Only Super Admin may change access');
        if (b.action === 'directoryArchive') {
            if (a.role !== 'admin')
                throw Error('403:Admin required');
            if (!['school', 'teacher'].includes(b.target) || typeof b.school !== 'string' || !b.school.trim() || b.school.length > 1000 || typeof b.archived !== 'boolean' || b.target === 'teacher' && (typeof b.teacher !== 'string' || !b.teacher.trim() || b.teacher.length > 1000))
                throw Error('Choose a school or teacher to archive or restore');
            const value = { kind: b.target, school: b.school.trim(), teacher: b.target === 'teacher' ? b.teacher.trim() : '', archived: b.archived, updatedAt: now, updatedBy: a.email };
            const key = archiveKey(value.kind, value.school, value.teacher);
            await db.batch([db.prepare('INSERT INTO portal_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, JSON.stringify(value)), db.prepare('INSERT INTO portal_audit(id,actor,action,record,created) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), a.email, b.archived ? 'archive-directory' : 'restore-directory', key, now)]);
            return Response.json({ ok: true, ...value });
        }
        if (b.action === 'schoolLink') {
            if (a.role !== 'admin')
                throw Error('403:Admin required');
            if(typeof b.school!=='string'||!b.school.trim()||b.school.length>1000)throw Error('Choose a School Success school');
            const school = b.school, archives = await loadArchives(db);
            if (isArchived(archives, school))
                throw Error('403:Restore this school before sharing its teacher link');
            const teachers=await schoolTeachers(school,archives);
            if (!teachers.length)
                throw Error('No active teachers found for this school');
            const saved = await db.prepare('SELECT value FROM portal_config WHERE key=?').bind('schoolLinkToken:' + school).first();
            const token = saved?.value || crypto.randomUUID();
            await db.batch([db.prepare('INSERT INTO portal_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('schoolLink:' + token, JSON.stringify({ school, teachers,scope:'school-success' })), db.prepare('INSERT INTO portal_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('schoolLinkToken:' + school, token)]);
            return Response.json({ url: new URL('/school-success?' + new URLSearchParams({ school, access: token, view: 'teacher' }), req.url).href }, { headers: { 'Cache-Control': 'no-store' } });
        }
        if (b.action === 'reportSettings') {
            if (a.role !== 'admin')
                throw Error('403:Admin required');
            const settings = reportSettingsSchema.parse(b.data);
            await db.prepare("INSERT INTO portal_config(key,value) VALUES('reportSettings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(settings)).run();
            return Response.json({ ok: true });
        }
        if (b.action === 'member') {
            if (a.role !== 'admin')
                throw Error('403:Admin required');
            const { email, name, school } = b.data;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name?.trim() || !school?.trim())
                throw Error('Valid email, name and school are required');
            await db.prepare("INSERT INTO portal_members(email,role,school,name) VALUES(?,'teacher',?,?) ON CONFLICT(email) DO UPDATE SET school=excluded.school,name=excluded.name").bind(email.toLowerCase().trim(), school.trim(), name.trim()).run();
            return Response.json({ ok: true });
        }
        if (b.action === 'import') {
            if (a.role !== 'admin')
                throw Error('403:Admin required');
            if (b.format !== 'usage' || !Array.isArray(b.data) || b.data.length < 1 || b.data.length > 20000 || typeof b.preview !== 'boolean')
                throw Error('Choose 1–20,000 usage rows and validate before importing');
            return Response.json(await gateway({ action: 'importUsage', rows: b.data, source: String(b.source || 'UserMetrics').slice(0, 2000), preview: b.preview, actor: a.email }));
        }
        if (a.role !== 'admin')
            throw Error('403:Admin required');
        if (b.kind === 'call' || b.kind === 'ticket') {
            const snapshot = await ensureCrmArchive(db, async () => { const raw = await gateway({ action: 'read', from: now.slice(0, 10), to: now.slice(0, 10) }); return (await mapLive(raw, publicBase())).entries; });
            if (b.kind === 'call' && b.id && snapshot.ids.includes(b.id))
                throw Error('Historical conversation notes are archived and read-only. Create a new connect call.');
        }
        if (b.kind === 'ticket') {
            const data = ticketSchema.parse(b.data);
            return Response.json(await gateway({ action: 'ticket', id: b.id, version: b.version, data, actor: a.email }));
        }
        const kind = b.kind;
        if (kind === 'submission') {
            await gateway({ action: 'review', id: b.data?.recordId || b.id, data: b.data, actor: a.email });
            return Response.json({ ok: true });
        }
        const schema = schemas[kind];
        if (!schema)
            throw Error('Unsupported record');
        const data = schema.parse(b.data);
        if (kind === 'call' && data.outcome) {
            data.status = data.outcome === 'Connected' ? 'Successfully Resolved' : 'Open Action Item';
            if (data.outcome !== 'Connected' && !data.followup)
                throw Error('Set the next call date');
            if (data.nextAction && (!data.actionOwner || !data.followup))
                throw Error('Add a responsible person and date for the next action');
        }
        if (kind === 'call' && data.status === 'Successfully Resolved' && data.date > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))
            throw Error('A completed call cannot have a future date');
        if (['contact', 'call', 'observation'].includes(kind)) {
            return Response.json(await gateway({ action: kind, id: kind === 'contact' ? undefined : b.id, version: b.version, data, actor: a.email }));
        }
        if (kind !== 'school')
            throw Error('Usage entry is paused until original database import is connected');
        const id = b.id || crypto.randomUUID();
        const prev = await db.prepare('SELECT * FROM portal_entries WHERE id=?').bind(id).first();
        if (prev && prev.kind !== kind)
            throw Error('Record type mismatch');
        if (prev && Number(b.version) !== prev.version)
            throw Error('409:This record changed. Refresh before saving.');
        const statement = prev ? db.prepare('UPDATE portal_entries SET payload=?,school=?,version=version+1,updated=? WHERE id=? AND version=?').bind(JSON.stringify(data), data.school || data.name, now, id, prev.version) : db.prepare('INSERT OR IGNORE INTO portal_entries(id,kind,school,owner,payload,updated) VALUES(?,?,?,?,?,?)').bind(id, kind, data.school || data.name, a.email, JSON.stringify(data), now);
        const result = await statement.run();
        if (!result.meta.changes)
            throw Error('409:Another user updated this record. Refresh and retry.');
        await db.prepare('INSERT INTO portal_audit(id,actor,action,record,created) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), a.email, prev ? 'update' : 'create', id, now).run();
        return Response.json({ ok: true, id });
    }
    catch (e) {
        return failure(e);
    }
}


export async function GET(req){return withRequest(req,()=>handlerGET(req));}

export async function POST(req){return withRequest(req,()=>handlerPOST(req));}

