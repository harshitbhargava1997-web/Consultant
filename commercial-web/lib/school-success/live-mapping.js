import { normalizeUsage, usageIdentity, canonical } from './domain.js';
import {feedbackTextWithReviewer,reviewerFromSignIn} from './lesson-reviews.js';
import {feedbackKey} from './feedback-notes.js';
const string = (x) => x == null ? '' : String(x).trim();
// Media addresses used before the school's own media domain. Files stored under them are the same objects in the
// same bucket, so they are presented under the current media address (nothing stored is rewritten).
export const LEGACY_MEDIA_BASES = ['https://pub-584a50ce1c7944dea02be2edbc4188aa.r2.dev'];
export function currentMediaUrl(url, base) {
    const current = String(base || '').replace(/\/$/, '');
    if (!current || typeof url !== 'string') return url;
    for (const legacy of LEGACY_MEDIA_BASES) { const old = legacy.replace(/\/$/, ''); if (old !== current && url.startsWith(old + '/')) return current + url.slice(old.length); }
    return url;
}
export function evidenceUrl(value, base) { const s = string(value); if (!s || ['nan', 'none', 'null'].includes(s.toLowerCase()))
    return ''; if (/^https?:\/\//i.test(s)) {
    try {
        return currentMediaUrl(new URL(s).href, base);
    }
    catch {
        return '';
    }
} if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//'))
    return ''; return base.replace(/\/$/, '') + '/' + s.replace(/^\//, '').split('/').map(encodeURIComponent).join('/'); }
async function hash(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join(''); }
const evidenceFields = ['Voice_Note_Link', 'Lesson_Plan_Picture', 'Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3', 'Writing_Sample_Link', 'Phonics_Evidence_Link', 'Portfolio_Evidence_Link', 'Student_Assessment_Link', 'Event_Pictures_Link'];
export const hasLessonRecord = r => r.Type === 'Classroom Reflection' || evidenceFields.some(k=>string(r[k]) && !['none','nan','null'].includes(string(r[k]).toLowerCase()));
export async function mapLive(raw, publicBase) {
    const entries = [], usage = new Map(), contacts = new Map(), calls = new Map();
    let duplicates = 0, otherActivities = 0;
    const roster = raw.roster || [];
    const schools = new Set();
    for (const r of roster)
        if (r.school)
            schools.add(r.school);

    const reviewsByRecord = new Map();
    // Teachers' "Noted" acknowledgements, by lesson record.
    const notesByRecord = new Map();
    for (const n of raw.notes || []) {
        const id = String(n.record_id);
        if (!notesByRecord.has(id)) notesByRecord.set(id, []);
        notesByRecord.get(id).push({ key: String(n.key), noted_at: n.noted_at, school: n.school });
    }
    // A weekly review covers several periods with one key; one "Noted" on any of them counts for all.
    const weeklyNotes = new Map();
    for (const n of raw.notes || []) if (/^weekly-/.test(String(n.key)) && !weeklyNotes.has(String(n.key))) weeklyNotes.set(String(n.key), n);
    for (const review of raw.reviews || []) {
        const id = String(review.record_id);
        if (!reviewsByRecord.has(id)) reviewsByRecord.set(id, []);
        reviewsByRecord.get(id).push(review);
    }
    for (const r of raw.records || []) {
        const school = string(r.Center) || string(r.Institution), teacher = string(r.FullName) || [r.FirstName, r.LastName].filter(Boolean).join(' ').trim();
        if (school)
            schools.add(school);
        const date = string(r.implementation_date || r.StartTime || r.submitted_at || r.created_at).slice(0, 10);
        try {
            const d = normalizeUsage(r);
            const identity = usageIdentity(d), prior = usage.get(identity);
            if (prior) {
                duplicates++;
                for (const k of ['grade', 'subject', 'topic'])
                    if (!prior[k] && d[k])
                        prior[k] = d[k];
            }
            else
                usage.set(identity, { ...d, id: 'usage:' + r.id, kind: 'usage' });
        }
        catch {
            otherActivities++;
        }
        const files = evidenceFields.flatMap(k => string(r[k]).split(',').flatMap((value, i) => { const url = evidenceUrl(value, publicBase); return url ? [{ key: k + ':' + r.id + ':' + i, column: k, url, name: k.replaceAll('_', ' '), category: k.replaceAll('_', ' ') }] : []; }));
        if (files.length || r.Type === 'Classroom Reflection') {
            const reviews = (reviewsByRecord.get(String(r.id)) || []).filter(v => !v.school || v.school === school);
            const reviewHistory = reviews.filter(v=>string(v.feedback)).map(v=>({text:v.feedback,date:v.updated_at || '',id:v.review_id || 'legacy',key:feedbackKey(v),by:v.by||reviewerFromSignIn(v.reviewer),...(v.root?{root:v.root}:{}),...(v.review?{review:v.review}:{}),...(v.highlights?.length?{highlights:v.highlights}:{}),...(v.edited?{editedBy:v.edited.by,editedAt:v.edited.at,givenAt:v.given_at||''}:{}),...(v.weekly?{weekly:{weekStart:v.weekly.weekStart,weekEnd:v.weekly.weekEnd,grade:v.weekly.grade,section:v.weekly.section,subject:v.weekly.subject,periods:v.weekly.periods,review:v.weekly.review||null}}:{})}))
                .sort((a,b)=>(Date.parse(a.date)||0)-(Date.parse(b.date)||0)||a.id.localeCompare(b.id));
            const reviewedAt = reviewHistory.at(-1)?.date || '';
            const review = reviews.find(v=>!v.review_id);
            const ownNotes = (notesByRecord.get(String(r.id)) || []).filter(n => !n.school || n.school === school);
            const sharedNotes = reviewHistory.filter(h => h.weekly && !ownNotes.some(n => n.key === h.key)).map(h => weeklyNotes.get(h.key)).filter(n => n && (!n.school || n.school === school));
            const feedbackNotes = [...ownNotes, ...sharedNotes].map(({ key, noted_at }) => ({ key, noted_at }));
            const item = { feedbackNotes, id: String(r.id), recordId: String(r.id), kind: 'submission', school, teacher, date, grade: string(r.Grade), section: string(r.Section), subject: string(r.Subject), topic: string(r.Book) || 'Classroom practice', stage: r.lesson_stage || '', plannedDate: r.planned_lesson_on || '', conductedOn: r.conducted_on || '', evidenceAt: r.evidence_submitted_at || '', reflection: string(r.lesson_reflection), materials: string(r.materials_notes), files, review: feedbackTextWithReviewer(reviewHistory), reviewHistory, version: review?.updated_at || null, uploadedBy: r.Uploaded_By, submissionId: r.submission_id, periodId: string(r.lesson_period_id), preparationSavedAt: string(r.preparation_saved_at), lessonSubmittedAt: string(r.submitted_at || r.created_at), reviewedAt };
            if (r.lesson_stage && r.planned_lesson_on) {
                const events = Array.isArray(r.lesson_evidence_history) ? r.lesson_evidence_history : [];
                const eventUrls = new Set(events.flatMap((e) => Object.values(e.files || {}).flatMap(v => string(v).split(',').map(x => evidenceUrl(x, publicBase)).filter(Boolean))));
                const preparationFiles = files.filter(f => ['Voice_Note_Link', 'Lesson_Plan_Picture'].includes(f.column) && !eventUrls.has(f.url));
                const localDay = (v) => v ? new Date(/Z$|[+-]\d\d:\d\d$/.test(v) ? v : v + 'Z').toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '';
                entries.push({ ...item, id: item.id + ':preparation', date: localDay(r.preparation_saved_at) || r.planned_lesson_on, feedStage: 'Lesson preparation', stage: 'preparation_saved', files: preparationFiles });
                if (events.length) {
                    for (const event of events) {
                        const eventFiles = evidenceFields.flatMap(column => string(event.files?.[column]).split(',').filter(Boolean).map((value, i) => ({ key: column + ':' + r.id + ':' + event.id + ':' + i, column, url: evidenceUrl(value, publicBase), name: column.replaceAll('_', ' '), category: column.replaceAll('_', ' ') })));
                        entries.push({ ...item, id: item.id + ':' + event.id, date: localDay(event.at), feedStage: 'Classroom evidence', stage: 'evidence_submitted', conductedOn: event.conductedOn, evidenceEventId: string(event.id), evidenceEventAt: string(event.at), files: eventFiles });
                    }
                }
                const known = new Set([...preparationFiles.map(f => f.url), ...eventUrls]);
                const earlier = files.filter(f => !known.has(f.url));
                if (earlier.length)
                    entries.push({ ...item, id: item.id + ':earlier', date: localDay(r.evidence_submitted_at) || date, feedStage: 'Classroom evidence', files: earlier });
            }
            else
                entries.push(item);
        }
    }
    for (const [school, entities] of Object.entries(raw.legacyContacts?.contacts || {}))
        for (const [entity, d] of Object.entries(entities)) {
            const c = d;
            contacts.set(school + '|' + entity, { kind: 'contact', id: 'contact:' + await hash(school + '|' + entity), school, entity, name: string(c.name), phone: string(c.phone), email: '', version: null });
        }
    for (const d of raw.contacts || [])
        contacts.set(d.school + '|' + d.entity_type, { kind: 'contact', id: 'contact:' + await hash(d.school + '|' + d.entity_type), school: d.school, entity: d.entity_type, name: d.name, phone: d.phone, email: '', version: d.updated_at });
    const call = (id, p, version, archived = false) => ({ kind: 'call', id, version, school: p.School, entity: p['Entity Type'], name: p['Contact Name'], module: p['Module Tab'] || 'School CRM', date: string(p['Call Date']).slice(0, 10), followup: string(p['Next Follow-up Date']).slice(0, 10), notes: p['Discussion Notes'] || '', outcome: p['Call Outcome'] || '', nextAction: p['Next Action'] || '', actionOwner: p['Action Owner'] || '', actionDone: p['Action Done'] === true, status: p.Status || 'Open Action Item', archived, recordType: p['Record Type'] === 'Ticket' ? 'Ticket' : 'Connect call', ticketId: p._ticket_id || '', completedAt: p._completed_at || null });
    const occurrences = new Map();
    for (const p of Array.isArray(raw.legacyCalls) ? raw.legacyCalls : []) {
        const digest = await hash(canonical(p)), ordinal = occurrences.get(digest) || 0;
        occurrences.set(digest, ordinal + 1);
        const id = 'legacy:' + digest + ':' + ordinal;
        calls.set(id, call(id, p, null));
    }
    for (const d of raw.calls || [])
        calls.set(d.id, call(d.id, { ...d.payload, _ticket_id: d.ticket_id, _completed_at: d.completed_at }, d.payload?._web_version || 'created:' + d.created_at, Boolean(d.archived_at)));
    entries.push(...usage.values(), ...contacts.values(), ...calls.values());
    for (const t of raw.tickets || [])
        entries.push({ kind: 'ticket', id: t.id, school: t.school, title: t.title, description: t.description, status: t.status, priority: t.priority, date: t.opened_on, followup: t.next_action_on || '', resolution: t.resolution || '', resolvedAt: t.resolved_at, archived: Boolean(t.archived_at), version: t.version, createdBy: t.created_by, updatedBy: t.updated_by });
    for (const r of raw.visits || [])
        entries.push({ kind: 'observation', id: String(r.id), school: r.school, teacher: r.teacher, date: string(r.visit_date).slice(0, 10), grade: r.class_section || '', subject: r.subject || '', topic: r.topic || '', rubrics: r.rubric_json && typeof r.rubric_json === 'object' ? r.rubric_json : {}, strengths: r.high_points || '', improvements: r.recommendations || '', actions: r.flow_of_class || '', followup: '', readOnly: true, pdfUrl: evidenceUrl(r.pdf_url, publicBase) });
    for (const r of entries)
        if (r.school)
            schools.add(r.school);
    entries.push(...[...schools].map(name => ({ kind: 'school', id: 'school:' + name, name, school: name })));
    return { entries, roster, counts: { sourceRows: (raw.records || []).length, duplicates, otherActivities } };
}

