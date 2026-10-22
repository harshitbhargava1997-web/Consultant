import { z } from 'zod';
export const moduleNames = ['Lesson Plan', 'Content / Book', 'Additional Materials', 'E-book'];
export const moduleLabels = ['Lesson preparation', 'Book usage', 'Additional Materials', 'E-books'];
export const evidenceNames = ['Activity files', 'Writing samples', 'LP / Audio notes', 'Phonics evidence', 'Portfolio artifacts'];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
export const reportSettingsSchema = z.object({ quantitative: z.boolean(), qualitative: z.boolean(), daily: z.tuple([z.number().min(0).max(60), z.number().min(0).max(120), z.number().min(0).max(120), z.number().min(0).max(120)]), evidence: z.array(z.number().int().min(0).max(100)).length(5), excludeSundays: z.boolean(), useSchoolCalendars: z.boolean(), holidays: z.array(day).max(366), sections: z.object({ lessonPlan: z.boolean(), additional: z.boolean(), ebooks: z.boolean(), evidence: z.boolean(), additionalDetails: z.boolean(), observations: z.boolean() }) });
export const defaultReportSettings = { quantitative: true, qualitative: true, daily: [10, 30, 30, 30], evidence: [3, 3, 3, 2, 1], excludeSundays: true, useSchoolCalendars: true, holidays: [], sections: { lessonPlan: true, additional: true, ebooks: true, evidence: true, additionalDetails: false, observations: false } };
export const teacherKey = (school, name) => JSON.stringify([school, name]);
export function eligibleDays(from, to, holidays = [], excludeSundays = true) { let count = 0; const excluded = new Set(holidays); for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1))
    if ((!excludeSundays || d.getUTCDay() !== 0) && !excluded.has(d.toISOString().slice(0, 10)))
        count++; return count; }
export function metricStatus(actual, target, enabled, days) { if (!days)
    return 'Scheduled break'; if (!enabled || target <= 0)
    return actual > 0 ? 'Activity logged' : 'No activity logged'; return actual >= target ? 'Met benchmark' : actual > 0 ? 'Below benchmark' : 'No recorded usage'; }
export function teacherRoster(entries, roster) { const map = new Map(); for (const r of [...roster, ...entries.filter(r => r.teacher).map(r => ({ school: r.school, name: r.teacher }))])
    if (r.school && r.name) {
        const key = teacherKey(r.school, r.name);
        map.set(key, { school: r.school, name: r.name, key });
    } return [...map.values()].sort((a, b) => a.school.localeCompare(b.school) || a.name.localeCompare(b.name)); }
export function buildProfiles(entries, roster, from, to, settings, calendars = {}) {
    // Consultant observations are opt-in and stay separate from teacher-submitted evidence.
    const period = entries.filter(r => (r.kind === 'usage' || r.kind === 'submission' || settings.sections.observations && r.kind === 'observation') && r.date >= from && r.date <= to);
    return teacherRoster(entries.filter(r => r.kind !== 'observation' || settings.sections.observations), roster).map(t => {
        const rows = period.filter(r => r.school === t.school && r.teacher === t.name), usage = rows.filter(r => r.kind === 'usage'), submissions = rows.filter(r => r.kind === 'submission'), observations = rows.filter(r => r.kind === 'observation');
        const holidays = [...settings.holidays, ...(settings.useSchoolCalendars ? (calendars[t.school] || []) : [])], days = eligibleDays(from, to, holidays, settings.excludeSundays);
        const metrics = moduleNames.map((module, i) => { const logs = usage.filter(r => r.module === module), actual = logs.reduce((s, r) => s + Number(r.minutes || 0), 0), target = settings.quantitative ? settings.daily[i] * days : 0; return { module, label: moduleLabels[i], actual, target, average: days ? actual / days : 0, percent: target > 0 ? actual / target * 100 : null, status: metricStatus(actual, target, settings.quantitative, days), logs }; });
        const byColumn = new Map();
        for (const r of submissions)
            for (const f of r.files || []) {
                const column = f.column || String(f.key).split(':')[0];
                if (!byColumn.has(column))
                    byColumn.set(column, new Map());
                const url = f.url || '';
                if (url)
                    byColumn.get(column).set(url, { ...f, date: r.date, grade: r.grade, subject: r.subject, topic: r.topic, column });
            }
        const unique = (cols) => [...new Map(cols.flatMap(c => [...(byColumn.get(c) || new Map()).entries()])).values()];
        const groups = [unique(['Video_Evidence_1', 'Video_Evidence_2', 'Video_Evidence_3']), unique(['Writing_Sample_Link']), [...unique(['Lesson_Plan_Picture']), ...unique(['Voice_Note_Link'])], unique(['Phonics_Evidence_Link']), unique(['Portfolio_Evidence_Link'])];
        const evidence = groups.map((files, i) => ({ label: evidenceNames[i], actual: files.length, target: settings.qualitative ? settings.evidence[i] : 0, files, status: !days ? 'Scheduled break' : !settings.qualitative || !settings.evidence[i] ? 'Not applicable' : files.length >= settings.evidence[i] ? 'Met target' : 'Needs follow-up' }));
        const applicable = evidence.filter(e => e.target > 0), evidenceStatus = !days || !applicable.length ? 'Not applicable' : applicable.every(e => e.actual >= e.target) ? 'Met selected targets' : 'Needs follow-up';
        const bookGroups = new Map();
        for (const r of usage.filter(r => r.module === 'Content / Book')) {
            const k = JSON.stringify([r.topic || 'Title not provided', r.grade || '', r.subject || '']);
            const old = bookGroups.get(k) || { title: r.topic || 'Title not provided', grade: r.grade || '', subject: r.subject || '', minutes: 0, sessions: 0 };
            old.minutes += r.minutes;
            old.sessions++;
            bookGroups.set(k, old);
        }
        const preparationGroups = new Map();
        for (const r of usage.filter(r => r.module === 'Lesson Plan')) {
            const key = JSON.stringify([r.topic || 'Title not provided', r.grade || '', r.subject || '']);
            const item = preparationGroups.get(key) || { title: r.topic || 'Title not provided', grade: r.grade || '', subject: r.subject || '', sessions: 0, minutes: 0 };
            item.sessions++;
            item.minutes += Number(r.minutes || 0);
            preparationGroups.set(key, item);
        }
        return { ...t, days, holidays, metrics, evidence, evidenceStatus, observations, preparations: [...preparationGroups.values()].sort((a, b) => b.minutes - a.minutes), usage, books: [...bookGroups.values()].sort((a, b) => b.minutes - a.minutes), events: unique(['Event_Pictures_Link']) };
    });
}
export function includedMetric(index, settings) { return index === 1 || index === 0 && settings.sections.lessonPlan || index === 2 && settings.sections.additional || index === 3 && settings.sections.ebooks; }
export function reportRows(profiles) { return profiles.map(p => Object.fromEntries([['School', p.school], ['Teacher', p.name], ['Working days', p.days], ...p.metrics.flatMap(m => [[m.label + ' minutes', Number(m.actual.toFixed(2))], [m.label + ' target', m.target], [m.label + ' attainment %', m.percent === null ? 'Not applicable' : Number(m.percent.toFixed(1))], [m.label + ' status', m.status]]), ...p.evidence.flatMap(e => [[e.label + ' count', e.actual], [e.label + ' target', e.target], [e.label + ' status', e.status]]), ['Evidence status', p.evidenceStatus]])); }

