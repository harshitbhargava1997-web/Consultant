import { actor, assertSchool } from './server';
import { service, checked } from './database';
import { prepareUsageImport } from './usage-import.js';
import {readScope,recordQuery,readAllPages} from './read-query.js';
// Only the private Site server holds the bearer token. No browser keys or arbitrary SQL.
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
async function request(path, method = 'GET', body, extra = {}, metadata=false) { const r = await fetch(base + path, { method,cache:'no-store', headers: { ...headers,...metadata?{Prefer:'count=exact'}:{}, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok)
    throw Error('Database request failed: ' + r.status + ' ' + (await r.text()).slice(0, 400)); const text = await r.text(),data=text?JSON.parse(text):null;
    const total=r.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];return metadata?{rows:data,count:total===undefined?null:Number(total)}:data; }
async function all(table,order,scope={}){return readAllPages(async(offset,metadata)=>{const result=await request('/rest/v1/'+table+'?'+new URLSearchParams({select:'*',order,...scope,limit:'1000',offset:String(offset)}),'GET',undefined,{},metadata);return metadata?result:{rows:result,count:null};});}
async function hash(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function storage(name) { const saved = await service().from('success_import_state').select('value').eq('key', 'legacy:' + name).maybeSingle(); if (saved.error)
    throw saved.error; return saved.data?.value || (name === 'school_crm_data.json' ? { contacts: {} } : []); }
async function unusedLegacyStorage(name) { const r = await fetch(base + '/storage/v1/object/teacher_uploads/' + name, { headers }); if (r.status === 404)
    return name === 'school_crm_data.json' ? { contacts: {} } : []; if (!r.ok)
    throw Error('Legacy CRM storage read failed: ' + r.status); return r.json(); }
async function rawGateway(req) {
    try {
        if (req.method !== 'POST')
            return json({ error: 'POST required' }, 405);
        const b = await req.json();
        if (b.action === 'read') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(b.from) || !/^\d{4}-\d{2}-\d{2}$/.test(b.to))
                return json({ error: 'Date range required' }, 400);
            if (![b.from, b.to].every(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s) || b.from > b.to)
                return json({ error: 'Invalid date range' }, 400);
            if (new Date(b.to).getTime() - new Date(b.from).getTime() > 99 * 86400000)
                return json({ error: 'Select at most 100 days' }, 400);
            const a=await actor(),teacher=a.role!=='admin',scope=readScope(a);
            const [records,roster,contacts,calls,visits,reviews,legacyContacts,legacyCalls,calendars,tickets]=await Promise.all([
             teacher&&!a.name?[]:all('teacher_records','id',recordQuery(b.from,b.to,a)),
             teacher?a.teachers.map(name=>({name,school:a.school})):request('/rest/v1/rpc/school_success_roster','POST',{}),
             teacher?[]:all('portal_contacts','school,entity_type',scope),teacher?[]:all('portal_call_logs','id',scope),
             teacher?[]:all('classroom_observations','id',scope),teacher?[]:all('portal_evidence_reviews','record_id',scope),
             teacher?{contacts:{}}:storage('school_crm_data.json'),teacher?[]:storage('school_call_logs_store.json'),
             teacher?[]:all('portal_school_plans','school',scope),teacher?[]:all('portal_tickets','created_at.desc',scope)
            ]);
            return json({ records, roster, contacts, calls, visits, reviews, legacyContacts, legacyCalls, calendars, tickets });
        }
        if (b.action === 'evidenceStatus') {
            if (!/^[a-f0-9-]{36}$/i.test(b.id) || !b.actor || !b.school || !b.teacher)
                throw Error('Invalid submission receipt');
            const rows = await request('/rest/v1/teacher_records?submission_id=eq.' + b.id + '&select=submission_id,Center,FullName,Uploaded_By,implementation_id,lesson_stage,lesson_version');
            if (rows.some(r => r.Uploaded_By !== b.actor || r.Center !== b.school || r.FullName !== b.teacher))
                return json({ error: 'Submission access denied' }, 403);
            return json({ saved: rows.length > 0, submissionId: b.id, periods: rows.length, alreadySaved: rows.length > 0, resumable: rows.length > 0 && rows.every(r => r.lesson_stage), version: rows[0]?.lesson_version || 0 });
        }
        if (b.action === 'findLessons') {
            if (!b.actor || !b.school || !b.teacher || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isFinite(Date.parse(b.date)) || new Date(b.date).toISOString().slice(0, 10) !== b.date)
                throw Error('Select a teacher and valid planned lesson date');
            const q = new URLSearchParams({ select: 'submission_id,Center,FullName,Uploaded_By,planned_lesson_on,lesson_stage,Grade,Section,Subject,Book', Center: 'eq.' + b.school, FullName: 'eq.' + b.teacher, Uploaded_By: 'eq.' + b.actor, planned_lesson_on: 'eq.' + b.date, lesson_stage: 'not.is.null', order: 'id', limit: '1000' });
            const rows = await request('/rest/v1/teacher_records?' + q);
            if (rows.length >= 1000)
                throw Error('Too many lessons for this date. Contact your administrator.');
            return json({ rows: rows.filter(r => r.Center === b.school && r.FullName === b.teacher && r.Uploaded_By === b.actor && r.planned_lesson_on === b.date && r.lesson_stage && r.submission_id) });
        }
        if (b.action === 'readLesson') {
            if (!/^[a-f0-9-]{36}$/i.test(b.id) || !b.actor || !b.school || !b.teacher)
                throw Error('Invalid lesson access');
            const rows = await request('/rest/v1/teacher_records?submission_id=eq.' + b.id + '&select=*&order=id');
            if (!rows.length || rows.some(r => r.Uploaded_By !== b.actor || r.Center !== b.school || r.FullName !== b.teacher || !r.lesson_stage))
                return json({ error: 'Lesson access denied' }, 403);
            return json({ rows });
        }
        if (b.action === 'savePreparation') {
            if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 10 || !b.actor)
                throw Error('Use 1 to 10 class periods');
            return json(await request('/rest/v1/rpc/school_success_save_preparation', 'POST', { p_rows: b.rows, p_actor: b.actor }));
        }
        if (b.action === 'appendLessonEvidence') {
            if (!/^[a-f0-9-]{36}$/i.test(b.id) || !/^[a-f0-9-]{36}$/i.test(b.updateId) || !Number.isInteger(b.version) || !b.actor || !Array.isArray(b.rows) || b.rows.length < 1 || b.rows.length > 10)
                throw Error('Invalid lesson update');
            return json(await request('/rest/v1/rpc/school_success_append_lesson_evidence', 'POST', { p_submission: b.id, p_actor: b.actor, p_update: b.updateId, p_version: b.version, p_conducted: b.conductedOn, p_rows: b.rows }));
        }
        if (b.action === 'submitEvidence') {
            if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 10 || !b.actor)
                throw Error('Use 1 to 10 class periods');
            return json(await request('/rest/v1/rpc/school_success_submit_evidence', 'POST', { p_rows: b.rows, p_actor: b.actor }));
        }
        if (b.action === 'importUsage') {
            if (typeof b.preview !== 'boolean' || typeof b.actor !== 'string')
                throw Error('Invalid import request');
            const prepared = prepareUsageImport(b.rows, b.actor);
            const result = await request('/rest/v1/rpc/school_success_import_usage', 'POST', { p_rows: prepared.records, p_actor: b.actor, p_source: String(b.source || 'UserMetrics').slice(0, 2000), p_preview: b.preview });
            const dates = prepared.records.map(r => String(r.StartTime).slice(0, 10)).sort();
            return json({ ...result, total: prepared.total, period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null, rejected: [...prepared.rejected, ...(result.rejected || [])] });
        }
        if (b.action === 'contact') {
            const d = b.data;
            if (!d || !d.school || !['Principal', 'Owner', 'Coordinator'].includes(d.entity) || !d.name || !d.phone)
                throw Error('Invalid contact');
            const payload = { school: d.school, entity_type: d.entity, name: d.name, phone: d.phone, updated_at: new Date().toISOString() };
            if (b.version) {
                const rows = await request('/rest/v1/portal_contacts?school=eq.' + encodeURIComponent(d.school) + '&entity_type=eq.' + encodeURIComponent(d.entity) + '&updated_at=eq.' + encodeURIComponent(b.version), 'PATCH', payload, { Prefer: 'return=representation' });
                if (!rows.length)
                    return json({ error: 'Record changed; refresh before saving' }, 409);
            }
            else
                await request('/rest/v1/portal_contacts', 'POST', payload, { Prefer: 'return=representation' });
            return json({ ok: true });
        }
        if (b.action === 'ticket') {
            const d = b.data;
            if (!d?.school || !d.title?.trim() || d.title.length > 200 || !d.description?.trim() || !['Open', 'In Progress', 'Resolved'].includes(d.status) || !['Low', 'Normal', 'High', 'Urgent'].includes(d.priority) || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.status === 'Resolved' && !d.resolution?.trim() || d.status !== 'Resolved' && !/^\d{4}-\d{2}-\d{2}$/.test(d.followup))
                throw Error('Invalid ticket; include the next action or resolution notes');
            const id = b.id || crypto.randomUUID();
            if (!/^[a-f0-9-]{36}$/i.test(id))
                throw Error('Invalid ticket ID');
            let previous = null;
            if (b.id) {
                const rows = await request('/rest/v1/portal_tickets?id=eq.' + id + '&select=*');
                previous = rows[0];
                if (!previous || previous.school !== d.school)
                    throw Error('Ticket school cannot change');
                if (!Number.isInteger(b.version) || b.version !== previous.version)
                    return json({ error: 'Record changed; refresh before saving' }, 409);
            }
            const record = { id, school: d.school, title: d.title.trim(), description: d.description.trim(), status: d.status, priority: d.priority, opened_on: d.date, next_action_on: d.followup || null, resolution: d.resolution || '', resolved_at: d.status === 'Resolved' ? (previous?.resolved_at || new Date().toISOString()) : null, archived_at: d.archived ? (previous?.archived_at || new Date().toISOString()) : null, version: previous ? previous.version + 1 : 1, created_by: previous?.created_by || b.actor, updated_by: b.actor, updated_at: new Date().toISOString() };
            if (previous) {
                const rows = await request('/rest/v1/portal_tickets?id=eq.' + id + '&version=eq.' + b.version, 'PATCH', record, { Prefer: 'return=representation' });
                if (!rows.length)
                    return json({ error: 'Record changed; refresh before saving' }, 409);
            }
            else
                await request('/rest/v1/portal_tickets', 'POST', record);
            return json({ ok: true, id });
        }
        if (b.action === 'call') {
            const d = b.data;
            if (!d?.school || !d.notes || !['Open Action Item', 'In Progress', 'Successfully Resolved'].includes(d.status))
                throw Error('Invalid call');
            if (d.outcome) {
                if (!['Not attempted', 'Connected', 'No answer', 'Callback requested', 'Rescheduled'].includes(d.outcome))
                    throw Error('Invalid call outcome');
                d.status = d.outcome === 'Connected' ? 'Successfully Resolved' : 'Open Action Item';
                if (d.outcome !== 'Connected' && !d.followup)
                    throw Error('Set the next call date');
                if (d.nextAction && (!d.actionOwner || !d.followup))
                    throw Error('Next action needs an owner and date');
            }
            const id = b.id || crypto.randomUUID();
            if (!/^[a-zA-Z0-9:_-]{1,180}$/.test(id))
                throw Error('Invalid record ID');
            if (d.recordType !== undefined && !['Connect call', 'Ticket'].includes(d.recordType))
                throw Error('Choose Connect call or Ticket');
            const payload = { School: d.school, 'Record Type': d.recordType || 'Connect call', 'Entity Type': d.entity, 'Contact Name': d.name, 'Module Tab': d.module, 'Call Date': d.date, 'Next Follow-up Date': d.followup, 'Discussion Notes': d.notes, 'Call Outcome': d.outcome || '', 'Next Action': d.nextAction || '', 'Action Owner': d.actionOwner || '', 'Action Done': d.actionDone === true, Status: d.status, _web_version: crypto.randomUUID() };
            if (d.ticketId) {
                if (!/^[a-f0-9-]{36}$/i.test(d.ticketId))
                    throw Error('Invalid linked ticket');
                const ticket = await request('/rest/v1/portal_tickets?id=eq.' + d.ticketId + '&school=eq.' + encodeURIComponent(d.school) + '&select=id');
                if (!ticket.length)
                    throw Error('Linked ticket must belong to the same school');
            }
            let previous = null;
            if (b.id) {
                const rows = await request('/rest/v1/portal_call_logs?id=eq.' + encodeURIComponent(id) + '&select=completed_at');
                previous = rows[0];
            }
            const record = { id, school: d.school, payload, ticket_id: d.ticketId || null, completed_at: d.status === 'Successfully Resolved' ? (previous?.completed_at || new Date().toISOString()) : null, archived_at: d.archived ? new Date().toISOString() : null };
            if (b.version) {
                const rows = await request('/rest/v1/portal_call_logs?id=eq.' + encodeURIComponent(id) + (String(b.version).startsWith('created:') ? '&payload->>_web_version=is.null&created_at=eq.' + encodeURIComponent(b.version.slice(8)) : '&payload->>_web_version=eq.' + encodeURIComponent(b.version)), 'PATCH', record, { Prefer: 'return=representation' });
                if (!rows.length)
                    return json({ error: 'Record changed; refresh before saving' }, 409);
            }
            else
                await request('/rest/v1/portal_call_logs', 'POST', record, { Prefer: 'return=representation' });
            return json({ ok: true, id });
        }
        if (b.action === 'observation') {
            const d = b.data;
            if (!d?.school || !d.teacher || !d.date)
                throw Error('Invalid observation');
            const row = { school: d.school, teacher: d.teacher, class_section: d.grade, subject: d.subject, topic: d.topic, visit_date: d.date, rubric_json: d.rubrics, high_points: d.strengths, recommendations: d.improvements + '\n\nAgreed actions: ' + d.actions + '\nFollow-up: ' + d.followup, academic_mentor: b.actor };
            if (b.id)
                throw Error('Existing observations are read-only here; use Streamlit to edit them until conflict handling is migrated');
            await request('/rest/v1/classroom_observations', 'POST', row);
            return json({ ok: true });
        }
        if (b.action === 'review') {
            const d = b.data;
            if (!/^\d+$/.test(String(b.id)) || !d?.school || !d.teacher)
                throw Error('Invalid review');
            await request('/rest/v1/portal_evidence_reviews?on_conflict=record_id', 'POST', { record_id: String(b.id), school: d.school, teacher: d.teacher, status: 'Reviewed', feedback: d.review || '', next_step: '', reviewer: b.actor, updated_at: new Date().toISOString() }, { Prefer: 'resolution=merge-duplicates' });
            return json({ ok: true });
        }
        return json({ error: 'Unsupported operation' }, 400);
    }
    catch (e) {
        return json({ error: String(e.message) }, String(e.message).includes('Lesson changed') ? 409 : 400);
    }
}
export async function gateway(body) {
    const a = await actor();
    if (body.action !== 'read') {
        const school = body.school || body.data?.school || body.rows?.[0]?.Center;
        if (school)
            assertSchool(a, school);
        if (a.role !== 'admin' && ['importUsage', 'contact', 'call', 'ticket', 'observation', 'review'].includes(body.action))
            throw Error('403:Administrative access required');
        if (body.action === 'importUsage' && a.allowedSchools) {
            for (const row of body.rows) {
                const source = row.Center || row.Institution || row.school;
                assertSchool(a, source);
            }
        }
        if (body.rows)
            for (const row of body.rows) {
                assertSchool(a, row.Center);
                if (a.role !== 'admin' && (row.Center !== a.school || row.FullName !== a.name))
                    throw Error('403:Teacher record mismatch');
            }
        if (body.id && ['call', 'ticket', 'review'].includes(body.action)) {
            const table = body.action === 'call' ? 'portal_call_logs' : body.action === 'ticket' ? 'portal_tickets' : 'teacher_records';
            const record = await checked(service().from(table).select('*').eq('id', body.id).maybeSingle());
            if (record) {
                assertSchool(a, record.school || record.Center);
                if (school && (record.school || record.Center) !== school)
                    throw Error('403:Record school cannot change');
            }
        }
    }
    const response = await rawGateway(new Request('https://internal.vision/gateway', { method: 'POST', body: JSON.stringify(body) }));
    const value = await response.json();
    if (!response.ok)
        throw Error((response.status === 409 ? '409:' : '') + (value.error || 'Database request failed'));
    if (body.action === 'read') {
        const visible = s => !a.allowedSchools || a.allowedSchools.includes(s);
        for (const field of ['roster', 'contacts', 'calls', 'visits', 'reviews', 'calendars', 'tickets'])
            value[field] = (value[field] || []).filter(r => visible(r.school));
        value.records = (value.records || []).filter(r => visible(r.Center || r.Institution) && (a.role === 'admin' || (r.Center === a.school && r.FullName === a.name && r.Uploaded_By === a.email)));
        value.legacyContacts = { contacts: Object.fromEntries(Object.entries(value.legacyContacts?.contacts || {}).filter(([s]) => visible(s))) };
        value.legacyCalls = (value.legacyCalls || []).filter(r => visible(r.School));
        if (a.role !== 'admin') {
            value.roster = value.roster.filter(r => r.school === a.school);
            for (const f of ['contacts', 'calls', 'visits', 'reviews', 'calendars', 'tickets', 'legacyCalls'])
                value[f] = [];
            value.legacyContacts = { contacts: {} };
        }
    }
    return value;
}
export function publicBase() { return process.env.SUCCESS_R2_PUBLIC_BASE_URL || 'https://pub-584a50ce1c7944dea02be2edbc4188aa.r2.dev'; }

