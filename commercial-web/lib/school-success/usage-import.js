const aliases = { institution: 'Institution', school: 'Institution', schoolname: 'Institution', center: 'Center', centre: 'Center', firstname: 'FirstName', lastname: 'LastName', fullname: 'FullName', teacher: 'FullName', teachername: 'FullName', role: 'Role', designation: 'Role', type: 'Type', module: 'Type', activitytype: 'Type', starttime: 'StartTime', date: 'StartTime', endtime: 'EndTime', durationminutes: 'Duration (Minutes)', durationmin: 'Duration_Min', durationhhmmss: 'Duration (HH:MM:SS)', grade: 'Grade', subject: 'Subject', book: 'Book', topic: 'Book' };
export function importHeader(value) { const name = String(value ?? '').trim(); return aliases[name.toLowerCase().replace(/[^a-z0-9]/g, '')] || name; }
const clean = (value) => value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
function timestamp(value, required) { if (value === '' || value == null) {
    if (required)
        throw Error('Missing start time');
    return null;
} if (typeof value === 'number')
    value = new Date(Math.round((value - 25569) * 86400000)); if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()))
        throw Error('Invalid date');
    return value.toISOString().replace('Z', '');
} const raw = clean(value); if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(raw))
    throw Error('Use an ISO date/time or an Excel date cell'); const date = new Date(raw.length === 10 ? raw + 'T00:00:00Z' : /[Zz]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z'); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw.slice(0, 10) && !/[Zz]|[+-]\d{2}:\d{2}$/.test(raw))
    throw Error('Invalid date'); return date.toISOString().replace('Z', ''); }
function duration(r) {
    const raw = r['Duration (HH:MM:SS)'];
    if (raw !== undefined && raw !== null && raw !== '') {
        if (typeof raw === 'number' && Number.isFinite(raw))
            return raw * 1440;
        if (raw instanceof Date)
            return raw.getUTCHours() * 60 + raw.getUTCMinutes() + raw.getUTCSeconds() / 60;
        const match = clean(raw).match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
        if (match && Number(match[2]) < 60 && Number(match[3]) < 60)
            return Number(match[1]) * 60 + Number(match[2]) + (Number(match[3]) + Number('0.' + (match[4] || '0'))) / 60;
    }
    for (const key of ['Duration_Min', 'Duration (Minutes)'])
        if (r[key] !== undefined && r[key] !== null && clean(r[key]) !== '') {
            const n = Number(r[key]);
            if (Number.isFinite(n))
                return n;
        }
    throw Error('Missing or invalid duration');
}
export function prepareUsageImport(input, actor) {
    if (!Array.isArray(input) || !input.length || input.length > 20000)
        throw Error('Choose 1–20,000 data rows per import');
    const records = [], rejected = [];
    input.forEach((original, index) => {
        const source = clean(original?._source_file).slice(0, 250) || 'Workbook', row = Number(original?._excel_row) || index + 2;
        try {
            if (!original || typeof original !== 'object' || Array.isArray(original))
                throw Error('Invalid row');
            const r = {};
            for (const [key, value] of Object.entries(original)) {
                const mapped = importHeader(key);
                if (Object.hasOwn(r, mapped))
                    throw Error('Duplicate mapped column: ' + mapped);
                r[mapped] = value;
            }
            const institution = clean(r.Institution), center = clean(r.Center), teacher = clean(r.FullName) || clean([r.FirstName, r.LastName].filter(Boolean).join(' ')), type = clean(r.Type);
            if (!(center || institution) || !teacher || /^unknown teacher$/i.test(teacher))
                throw Error('Missing school or teacher');
            if (!type || type.length > 100 || /classroom.?reflection/i.test(type))
                throw Error('Missing or unsupported usage activity type');
            const start = timestamp(r.StartTime, true), end = timestamp(r.EndTime, false), minutes = duration(r);
            if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440)
                throw Error('Duration must be between 0 and 1440 minutes');
            if (end && end < start)
                throw Error('End time is before start time');
            const record = { Institution: institution || center, Center: center, FirstName: clean(r.FirstName), LastName: clean(r.LastName), FullName: teacher, Role: clean(r.Role) || 'teacher', Type: type, Grade: clean(r.Grade), Subject: clean(r.Subject), Book: clean(r.Book), StartTime: start, EndTime: end, Duration_Min: Math.round(minutes * 1e6) / 1e6, Uploaded_By: actor, State_Zone: 'Madhya Pradesh (MP)', _source_file: source, _excel_row: row };
            if (Object.values(record).some(v => typeof v === 'string' && v.length > 2000))
                throw Error('Cell exceeds 2,000 characters');
            records.push(record);
        }
        catch (e) {
            rejected.push({ file: source, row, reason: e.message });
        }
    });
    return { records, rejected, total: input.length };
}

