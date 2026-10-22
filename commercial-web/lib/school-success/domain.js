import { z } from 'zod';
export const statuses = ['Open Action Item', 'In Progress', 'Successfully Resolved'];
const str = z.string().trim().min(1).max(1000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid date');
export const schemas = {
    school: z.object({ name: str, state: z.string().max(200).default(''), city: z.string().max(200).default('') }),
    contact: z.object({ school: str, entity: z.enum(['Principal', 'Owner', 'Coordinator']), name: str, phone: z.string().trim().regex(/^\+?[\d\s()-]{10,20}$/, 'Enter a valid phone number'), email: z.union([z.string().email(), z.literal('')]).default('') }),
    call: z.object({ school: str, entity: z.enum(['Principal', 'Owner', 'Coordinator']), name: str, module: z.string().max(200).default('School CRM'), date, followup: z.union([date, z.literal('')]), notes: str, outcome: z.enum(['Not attempted', 'Connected', 'No answer', 'Callback requested', 'Rescheduled']).optional(), nextAction: z.string().trim().max(1000).default(''), actionOwner: z.string().trim().max(200).default(''), actionDone: z.boolean().default(false), status: z.enum(statuses), archived: z.boolean().default(false), recordType: z.enum(['Connect call', 'Ticket']).default('Connect call'), ticketId: z.union([z.string().uuid(), z.literal('')]).default('') }),
    usage: z.object({ school: str, teacher: str, date, module: z.enum(['Lesson Plan', 'Content / Book', 'E-book', 'Additional Materials']), minutes: z.number().finite().min(0).max(1440), grade: z.string().default(''), subject: z.string().default(''), topic: z.string().default(''), start: z.string().default(''), end: z.string().default('') }),
    submission: z.object({ school: str, teacher: str, date, grade: str, section: z.string().max(40).default(''), subject: str, topic: str, reflection: z.string().max(10000).default(''), materials: z.string().max(2000).default(''), files: z.array(z.object({ key: str, name: str, category: str })).max(30).default([]), review: z.string().max(5000).default('') }),
    observation: z.object({ school: str, teacher: str, date, grade: str, subject: str, topic: str, rubrics: z.record(z.enum(['A', 'B', 'C'])), strengths: str, improvements: str, actions: str, followup: date })
};
export function normalizeUsage(r) {
    const pick = (...keys) => keys.map(k => r[k]).find(v => v !== undefined && v !== null && v !== '');
    const school = String(pick('school', 'Center', 'School', 'Institution') ?? '').trim();
    const teacher = String(pick('teacher', 'FullName', 'Full Name') ?? [r.FirstName, r.LastName].filter(Boolean).join(' ')).trim();
    let raw = pick('date', 'implementation_date', 'StartTime', 'Start Time');
    if (typeof raw === 'number')
        raw = new Date(Math.round((raw - 25569) * 86400000)).toISOString();
    if (raw instanceof Date)
        raw = raw.toISOString();
    const day = String(raw ?? '').slice(0, 10);
    const duration = pick('Duration (HH:MM:SS)');
    let minutes = Number(pick('minutes', 'Duration_Min', 'Duration (Minutes)'));
    if (typeof duration === 'string' && /^\d+:\d{2}:\d{2}$/.test(duration)) {
        const [h, m, s] = duration.split(':').map(Number);
        if (m > 59 || s > 59)
            throw Error('Invalid duration');
        minutes = h * 60 + m + s / 60;
    }
    if (typeof duration === 'number')
        minutes = duration * 1440;
    const type = String(pick('module', 'Type', 'Module', 'Activity Type') ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let module = type.includes('lesson') ? 'Lesson Plan' : type.includes('additional') || type.includes('answer') || type.includes('supplementary') || type.includes('extramaterial') ? 'Additional Materials' : ['ebook', 'ebooks', 'electronicbook', 'electronicbooks', 'digitalbook', 'digitalbooks'].includes(type) ? 'E-book' : ['content', 'book', 'contentbook', 'bookusage', 'contentusage'].includes(type) ? 'Content / Book' : null;
    if (!module)
        throw Error('Unknown module: ' + type);
    return schemas.usage.parse({ school, teacher, date: day, module, minutes, grade: String(pick('grade', 'Grade') ?? ''), subject: String(pick('subject', 'Subject') ?? ''), topic: String(pick('topic', 'Book') ?? ''), start: String(pick('start', 'StartTime', 'Start Time') ?? ''), end: String(pick('end', 'EndTime', 'End Time') ?? '') });
}
export function canonical(x) { if (Array.isArray(x))
    return '[' + x.map(canonical).join(',') + ']'; if (x && typeof x === 'object')
    return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}'; return JSON.stringify(x); }
export function workingDays(from, to, excluded = []) { let n = 0; for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1))
    if (d.getUTCDay() !== 0 && !excluded.includes(d.toISOString().slice(0, 10)))
        n++; return n; }
export function csv(rows) { if (!rows.length)
    return ''; const keys = [...new Set(rows.flatMap(Object.keys))]; const cell = (v) => { let s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); if (/^[=+@\-\t\r]/.test(s))
    s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }; return [keys.map(cell).join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\r\n'); }
export function usageIdentity(d) {
    const time = (v) => { if (!v)
        return ''; const n = Date.parse(v); return Number.isNaN(n) ? v : new Date(Math.round(n / 1000) * 1000).toISOString(); };
    return d.module === 'Content / Book' && d.start && d.end ? canonical({ school: d.school.trim().toLowerCase(), teacher: d.teacher.trim().toLowerCase(), module: d.module, start: time(d.start), end: time(d.end), minutes: Math.round(d.minutes * 100) / 100 }) : canonical(d);
}

