import {withRequest} from '@/lib/school-success/server';
import { env } from '@/lib/school-success/environment';
import { actor, database, checkOrigin, failure } from '@/lib/school-success/server';
import { gateway, publicBase } from '@/lib/school-success/live';
import { scopedSubmission, evidencePlan, submissionRecords } from '@/lib/school-success/teacher-submissions';
import { seal, unseal, r2UploadsConfigured, r2Request, loadR2Config } from '@/lib/school-success/r2-evidence';
import { assertResumeAccess, lessonFromRows, assertEvidenceMatches } from '@/lib/school-success/lesson-workflow';
async function handlerPOST(req) {
    try {
        checkOrigin(req);
        const a = await actor(req), config = await loadR2Config(env, database()), body = await req.json();
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
        if (body.action === 'resume') {
            const grant = await resumeGrant(body.resume);
            const data = await gateway({ action: 'readLesson', id: grant.id, school: grant.school, teacher: grant.teacher, actor: a.email });
            return Response.json(lessonFromRows(data.rows), { headers: { 'Cache-Control': 'no-store' } });
        }
        if (body.action === 'prepare') {
            const mode = body.mode || 'legacy';
            if (!['legacy', 'preparation', 'evidence'].includes(mode))
                throw Error('Choose preparation or classroom evidence');
            const submission = scopedSubmission(body.submission, a), files = evidencePlan(submission);
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
            const exp = Date.now() + 60 * 60 * 1000;
            return Response.json({ token: await seal({ kind: 'plan', email: a.email, exp, submission, mode, ...(mode === 'evidence' ? { resume: body.resume, version: body.version, updateId: body.updateId, conductedOn: body.conductedOn } : {}) }, signer), files: await Promise.all(files.map(async (file) => ({ id: file.id, token: await seal({ kind: 'file', email: a.email, exp, ...file }, signer) }))) });
        }
        if (body.action === 'commit') {
            const plan = await unseal(body.token, signer);
            if (plan.kind !== 'plan' || plan.email !== a.email)
                throw Error('403:Submission access denied');
            const submission = scopedSubmission(plan.submission, a);
            if (submission.school !== plan.submission.school || submission.teacher !== plan.submission.teacher)
                throw Error('403:Teacher selection changed. Reopen the original lesson.');
            if (plan.mode === 'evidence') {
                const grant = await resumeGrant(plan.resume);
                if (grant.id !== submission.id)
                    throw Error('403:Lesson access denied');
            }
            const files = evidencePlan(submission);
            for (const file of files) {
                const r = await r2Request(config, file.key, 'HEAD');
                if (!r.ok || Number(r.headers.get('content-length')) !== file.size)
                    throw Error('Evidence upload is incomplete. Retry this submission.');
            }
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


export async function POST(req){return withRequest(req,()=>handlerPOST(req));}

