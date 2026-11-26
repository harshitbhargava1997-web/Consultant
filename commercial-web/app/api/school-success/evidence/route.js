import {withRequest} from '@/lib/school-success/server';
import { env } from '@/lib/school-success/environment';
import { actor, database, checkOrigin, failure, assertConsultant } from '@/lib/school-success/server';
import { gateway, publicBase } from '@/lib/school-success/live';
import { currentMediaUrl } from '@/lib/school-success/live-mapping';
import { feedbackKey } from '@/lib/school-success/feedback-notes';
import { reviewerLabel, reviewerFromSignIn, weekLabel } from '@/lib/school-success/lesson-reviews';
import { scopedSubmission, evidencePlan, submissionRecords } from '@/lib/school-success/teacher-submissions';
import { seal, unseal, r2UploadsConfigured, r2Request, loadR2Config } from '@/lib/school-success/r2-evidence';
import { assertResumeAccess, lessonFromRows, assertEvidenceMatches } from '@/lib/school-success/lesson-workflow';
import { reflectionInputSchema, planReflectionDocuments, attachReflectionText, reflectionFetcher, sha256Hex } from '@/lib/school-success/reflection-text';
import {reflectionUploadTicket, storeReflectionDocuments} from '@/lib/school-success/reflection-storage';
import { submissionSchema } from '@/lib/school-success/teacher-submissions';
import {presignUpload} from '@/lib/school-success/r2-upload';
import {mapLimited} from '@/lib/school-success/parallel';
async function handlerPOST(req, timing = {}) {
    try {
        checkOrigin(req);
        // Sign-in check and storage settings are read at the same time; the sign-in result is always checked first.
        const [signedIn, storageConfig] = await Promise.allSettled([actor(req), loadR2Config(env, database())]);
        if (signedIn.status === 'rejected') throw signedIn.reason;
        const a = signedIn.value;
        timing.authMs = Math.round(performance.now() - timing.start);
        // Lesson plans and evidence are submitted by teachers (or consultants on their behalf), not by school leaders.
        assertConsultant(a);
        if (storageConfig.status === 'rejected') throw storageConfig.reason;
        const config = storageConfig.value, body = await req.json();
        timing.action = typeof body?.action === 'string' ? body.action.slice(0, 40) : '';
        const signer = config.SUPABASE_GATEWAY_TOKEN;
        async function resumeGrant(token) { const grant = await unseal(token, signer); assertResumeAccess(grant, a); return grant; }
        async function resumeReceipt(submission, result) { return { ...result, resumeToken: await seal({ kind: 'lesson-resume', id: submission.id, school: submission.school, teacher: submission.teacher, email: a.email, exp: Date.now() + 365 * 86400000 }, signer) }; }
        if (body.action === 'findLessons') {
            const school = a.role === 'admin' ? String(body.school || '') : a.school, teacher = a.role === 'admin' ? String(body.teacher || '') : a.name;
            if (!school || !teacher || typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !Number.isFinite(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0, 10) !== body.date)
                throw Error('Select a teacher and valid planned lesson date');
            const data = await gateway({ action: 'findLessons', school, teacher, date: body.date, actor: a.email });
            const grouped = new Map();
            for (const row of data.rows) {
                if (row.Center !== school || row.FullName !== teacher || row.Uploaded_By !== a.email || row.planned_lesson_on !== body.date || !row.lesson_stage)
                    continue;
                let lesson = grouped.get(row.submission_id);
                if (!lesson) {
                    lesson = { id: row.submission_id, stage: row.lesson_stage, periods: [], resumeToken: await seal({ kind: 'lesson-resume', id: row.submission_id, school, teacher, email: a.email, exp: Date.now() + 365 * 86400000 }, signer) };
                    grouped.set(row.submission_id, lesson);
                }
                lesson.periods.push({ grade: row.Grade, section: row.Section, subject: row.Subject, topic: row.Book });
            }
            return Response.json({ lessons: [...grouped.values()] }, { headers: { 'Cache-Control': 'no-store' } });
        }
        if (body.action === 'myLessons') {
            // The teacher's own home summary: lessons planned in the last 60 days and next 30, which still need
            // evidence, and the review feedback recorded on those lessons. Same scope as findLessons.
            const school = a.role === 'admin' ? String(body.school || '') : a.school, teacher = a.role === 'admin' ? String(body.teacher || '') : a.name;
            if (!school || !teacher)
                throw Error('Select a teacher');
            const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), shift = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
            const data = await gateway({ action: 'teacherLessons', school, teacher, from: shift(-60), to: shift(30), actor: a.email });
            const grouped = new Map(), byRecord = new Map();
            for (const row of data.rows) {
                if (row.Center !== school || row.FullName !== teacher || row.Uploaded_By !== a.email || !row.lesson_stage || !row.submission_id)
                    continue;
                let lesson = grouped.get(row.submission_id);
                if (!lesson) {
                    // order: the first saved record of this lesson, so a day's saves are numbered Period 1, 2, 3… in save order.
                    lesson = { id: row.submission_id, plannedOn: row.planned_lesson_on, order: Number(row.id) || 0, periods: [], resumeToken: await seal({ kind: 'lesson-resume', id: row.submission_id, school, teacher, email: a.email, exp: Date.now() + 365 * 86400000 }, signer) };
                    grouped.set(row.submission_id, lesson);
                }
                const period = { grade: row.Grade || '', section: row.Section || '', subject: row.Subject || '', topic: row.Book || '', evidence: row.lesson_stage === 'evidence_submitted' };
                lesson.periods.push(period);
                byRecord.set(String(row.id), { lesson, period });
            }
            const lessons = [...grouped.values()].map(l => ({ ...l, evidence: l.periods.every(p => p.evidence) }));
            const noted = new Map((data.notes || []).map(n => [String(n.record_id) + '|' + n.key, n.noted_at]));
            const items = (data.reviews || []).filter(r => byRecord.has(String(r.record_id))).map(r => {
                const { lesson, period } = byRecord.get(String(r.record_id)), key = feedbackKey(r);
                const weekly = r.weekly ? { weekStart: r.weekly.weekStart, weekEnd: r.weekly.weekEnd, periods: r.weekly.periods } : null;
                return { lessonId: lesson.id, recordId: String(r.record_id), key, notedAt: noted.get(String(r.record_id) + '|' + key) || '', plannedOn: lesson.plannedOn, grade: period.grade, section: period.section, subject: period.subject, topic: weekly ? 'Weekly review · ' + weekLabel(weekly.weekStart, weekly.weekEnd) : period.topic, text: weekly ? String(r.feedback).split('\n\n').slice(1).join('\n\n') : String(r.feedback), by: reviewerLabel(r.by || reviewerFromSignIn(r.reviewer)), date: r.updated_at || '', resumeToken: lesson.resumeToken, ...(weekly ? { weekly } : {}) };
            });
            // A weekly review is stored once per covered period: the teacher sees it once, noted if any copy is noted.
            const once = new Map();
            for (const f of items) { const k = f.weekly ? 'weekly|' + f.key : f.recordId + '|' + f.key, had = once.get(k); if (!had) once.set(k, f); else if (!had.notedAt && f.notedAt) once.set(k, { ...had, notedAt: f.notedAt }); }
            const feedback = [...once.values()].sort((x, y) => String(y.date).localeCompare(String(x.date)));
            return Response.json({ today, lessons, feedback }, { headers: { 'Cache-Control': 'no-store' } });
        }
        if (body.action === 'noteFeedback') {
            // The signed-in teacher marks one piece of feedback on their own lesson as read.
            if (a.role !== 'school-teacher')
                throw Error('403:Only the teacher can mark their feedback as noted');
            const result = await gateway({ action: 'noteFeedback', recordId: String(body.recordId || ''), key: String(body.key || ''), school: a.school, teacher: a.name, actor: a.email });
            return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
        }
        if (body.action === 'resume') {
            const grant = await resumeGrant(body.resume);
            const data = await gateway({ action: 'readLesson', id: grant.id, school: grant.school, teacher: grant.teacher, actor: a.email });
            const lesson = lessonFromRows(data.rows);
            lesson.files = lesson.files.map(f => ({ ...f, url: currentMediaUrl(f.url, publicBase()) }));
            // Show saved written reflections as text in the selected lesson (never raw JSON).
            await attachReflectionText([{ kind: 'submission', files: lesson.files }], reflectionFetcher({ base: publicBase(), get: (key, url) => r2UploadsConfigured(config) ? r2Request(config, key, 'GET') : fetch(url, { signal: AbortSignal.timeout(8000) }) }));
            // Recorded feedback stays visible to School Success administrators, as in the earlier feed.
            if (a.role === 'admin') {
                const ids = data.rows.map(r => String(r.id)), reviews = await gateway({ action: 'readLessonReviews', ids });
                lesson.feedback = (reviews.rows || []).filter(r => ids.includes(String(r.record_id)) && r.feedback).map(r => ({ periodId: data.rows.find(row => String(row.id) === String(r.record_id)).lesson_period_id, text: r.feedback, date: r.updated_at }));
            }
            return Response.json(lesson, { headers: { 'Cache-Control': 'no-store' } });
        }
        if (body.action === 'prepare') {
            const mode = body.mode || 'legacy';
            if (!['legacy', 'preparation', 'evidence'].includes(mode))
                throw Error('Choose preparation or classroom evidence');
            let submission = scopedSubmission(body.submission, a);
            // File selection excludes JSON. Only a validated, server-built reflection gets a checksum-bound ticket.
            if (submission.files.some(f => /\.json$/i.test(f.name)))
                throw Error('Use PDF, photo, video or audio evidence files');
            const reflectionInput = body.reflections == null ? [] : reflectionInputSchema.parse(body.reflections);
            if (reflectionInput.some(r => !submission.periods.some(p => p.id === r.periodId)))
                throw Error('403:Reflection must belong to a class period of this lesson');
            if (reflectionInput.length && mode !== 'evidence')
                throw Error('Add after-class reflections with classroom evidence.');
            let files = evidencePlan(submission);
            if (files.length && !r2UploadsConfigured(config))
                throw Error('503:File uploads require the R2 upload secrets. You can save a lesson reflection without files.');
            if (mode === 'preparation' && submission.files.some(f => !['voice', 'lesson_plan'].includes(f.category)))
                throw Error('Save preparation first, then add classroom evidence after teaching.');
            if (mode === 'evidence') {
                const grant = await resumeGrant(body.resume);
                if (grant.id !== submission.id)
                    throw Error('403:Lesson access denied');
                const raw = await gateway({ action: 'readLesson', id: grant.id, school: grant.school, teacher: grant.teacher, actor: a.email }), saved = lessonFromRows(raw.rows);
                assertEvidenceMatches(saved.submission, submission);
                if (!/^[a-f0-9-]{36}$/i.test(body.updateId) || !Number.isInteger(body.version))
                    throw Error('Invalid classroom update');
                if (saved.lastUpdateId === body.updateId)
                    return Response.json({ ...saved, saved: true, alreadySaved: true, submissionId: submission.id, periods: submission.periods.length, resumeToken: body.resume });
                if (saved.version !== body.version)
                    throw Error('409:Lesson changed. Reopen the return link before adding evidence.');
                const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
                if (typeof body.conductedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.conductedOn) || !Number.isFinite(Date.parse(body.conductedOn)) || new Date(body.conductedOn).toISOString().slice(0, 10) !== body.conductedOn || body.conductedOn > today)
                    throw Error('Choose the actual date on which the lesson was conducted, up to today.');
            }
            else {
                const existing = await gateway({ action: 'evidenceStatus', id: submission.id, school: submission.school, teacher: submission.teacher, actor: a.email });
                if (existing.saved) {
                    if (mode === 'preparation' && !existing.resumable)
                        throw Error('This receipt belongs to an earlier submission. Start a new preparation.');
                    return Response.json(mode === 'preparation' ? await resumeReceipt(submission, existing) : existing);
                }
            }
            // Written after-class reflections: built deterministically here and rebuilt and verified at commit.
            let reflectionDocs = [];
            if (reflectionInput.length) {
                if (!r2UploadsConfigured(config))
                    throw Error('503:Saving written reflections requires the R2 upload secrets.');
                const planned = await planReflectionDocuments({ submission, reflections: reflectionInput, updateId: body.updateId, conductedOn: body.conductedOn, evidencePlan, submissionSchema });
                submission = planned.submission; reflectionDocs = planned.docs; files = planned.uploads;
            }
            const exp = Date.now() + 60 * 60 * 1000;
            // Bounded plan token: hashes only. The browser resends the submission and reflections at commit.
            const sealedPlan = { kind: 'plan', v: 2, email: a.email, exp, mode, submissionId: submission.id, school: submission.school, teacher: submission.teacher, submissionHash: await sha256Hex(JSON.stringify(submission)),
                ...(mode === 'evidence' ? { resume: body.resume, version: body.version, updateId: body.updateId, conductedOn: body.conductedOn, reflections: reflectionDocs.map(({ id, periodId, sha256, size }) => ({ id, periodId, sha256, size })) } : {}) };
            const reflectionUploads = body.uploadWrittenReflections === true
                ? await Promise.all(reflectionDocs.map(doc => reflectionUploadTicket(config, doc))) : [];
            const uploadFiles = await Promise.all(files.map(async file => ({
                id: file.id, token: await seal({kind: 'file', email: a.email, exp, ...file}, signer),
                ...(body.directUploads === true ? {upload: {
                    url: await presignUpload(config, file.key, file.type), contentType: file.type,
                    file: file.category === 'lesson_plan' && file.id === file.periodId ? 'generated-preparation-pdf' : file.category
                }} : {})
            })));
            return Response.json({ token: await seal(sealedPlan, signer), reflectionUploads, files: uploadFiles }, {headers: {'Cache-Control': 'no-store'}});
        }
        if (body.action === 'commit') {
            const plan = await unseal(body.token, signer);
            if (plan.kind !== 'plan' || plan.email !== a.email)
                throw Error('403:Submission access denied');
            let submission, reflectionDocs = [];
            if (plan.v === 2) {
                // Rebuild the exact prepared submission from the resent body and verify it against the sealed hash.
                const base = scopedSubmission(body.submission, a);
                if (base.files.some(f => /\.json$/i.test(f.name)))
                    throw Error('Use PDF, photo, video or audio evidence files');
                if (plan.mode === 'evidence') {
                    const planned = await planReflectionDocuments({ submission: base, reflections: body.reflections ?? [], updateId: plan.updateId, conductedOn: plan.conductedOn, evidencePlan, submissionSchema });
                    submission = planned.submission; reflectionDocs = planned.docs;
                }
                else {
                    if (Array.isArray(body.reflections) && body.reflections.length)
                        throw Error('Add after-class reflections with classroom evidence.');
                    submission = base;
                }
                const sealed = plan.reflections || [];
                if (await sha256Hex(JSON.stringify(submission)) !== plan.submissionHash || submission.id !== plan.submissionId || reflectionDocs.length !== sealed.length || reflectionDocs.some(d => !sealed.some(x => x.id === d.id && x.periodId === d.periodId && x.sha256 === d.sha256 && x.size === d.size)))
                    throw Error('409:This submission changed after it was prepared. Submit it again.');
            }
            else {
                // Plans sealed before this release carried the submission (no written reflections).
                if (!plan.submission || plan.reflections?.length)
                    throw Error('409:This submission was prepared by an earlier version. Submit it again.');
                submission = scopedSubmission(plan.submission, a);
            }
            if (submission.school !== (plan.school ?? plan.submission?.school) || submission.teacher !== (plan.teacher ?? plan.submission?.teacher))
                throw Error('403:Teacher selection changed. Reopen the original lesson.');
            if (plan.mode === 'evidence') {
                const grant = await resumeGrant(plan.resume);
                if (grant.id !== submission.id)
                    throw Error('403:Lesson access denied');
            }
            const files = evidencePlan(submission);
            // Accepted reflection content is immutable: content-addressed keys, no overwrite (see storeReflectionDocuments).
            const reflectionIds = new Set(reflectionDocs.map(doc => doc.id));
            const checks = await mapLimited([
                () => storeReflectionDocuments(reflectionDocs, { put: (key, text, headers) => r2Request(config, key, 'PUT', text, headers), get: key => r2Request(config, key, 'GET') }),
                ...files.filter(file => !reflectionIds.has(file.id)).map(file => async () => {
                    const r = await r2Request(config, file.key, 'HEAD');
                    if (r.status === 404 || (r.ok && Number(r.headers.get('content-length')) !== file.size))
                        return file.id;
                    if (!r.ok) throw Error('503:The evidence file could not be checked in storage. Retry this submission.');
                })
            ], check => check(), 4);
            const missing = checks.find(Boolean);
            if (missing) return Response.json({error: 'One evidence file needs to be uploaded again.', fileId: missing}, {status: 409, headers: {'Cache-Control':'no-store'}});
            const rows = submissionRecords(submission, a.email, publicBase());
            if (plan.mode === 'evidence')
                return Response.json({ ...await gateway({ action: 'appendLessonEvidence', id: submission.id, actor: a.email, rows, version: plan.version, updateId: plan.updateId, conductedOn: plan.conductedOn }), resumeToken: plan.resume });
            const result = await gateway({ action: plan.mode === 'preparation' ? 'savePreparation' : 'submitEvidence', rows, actor: a.email });
            return Response.json(plan.mode === 'preparation' ? await resumeReceipt(submission, result) : result);
        }
        throw Error('Unsupported submission action');
    }
    catch (e) {
        return failure(e);
    }
}


// One timing line per request for speed checks: the action name, status and milliseconds only (no teacher,
// school, lesson or file details).
export async function POST(req){
 const timing={start:performance.now()};
 const res=await withRequest(req,()=>handlerPOST(req,timing));
 console.info('school-success timing '+JSON.stringify({route:'evidence',action:timing.action||'',status:res.status,authMs:timing.authMs??null,totalMs:Math.round(performance.now()-timing.start)}));
 return res;
}

