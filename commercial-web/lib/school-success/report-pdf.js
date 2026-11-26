import { regularFont, boldFont } from './report-fonts.js';
import { compareProfiles } from './report-comparison.js';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { includedMetric } from './reports.js';
import {reportEvidenceGroups} from '../report-sequence.js';
import {formatReportDuration as duration} from './report-units.js';
// Files that belong in lesson documentation rather than the usage report: generated preparation PDFs,
// audio recordings and after-class reflections. They are not deleted; they stay in lesson records.
export const LESSON_DOCUMENTATION_ONLY = ['Lesson plans submitted', 'After-class reflections', 'Audio recordings (previous portal)'];
// options.lessonDocs(profile) -> [{grade, section, subject, lessons, url}] adds the lesson-documentation summary.
export function createReportPdf(profiles, from, to, settings, comparison, options = {}) {
    if (!profiles.length)
        throw Error('Select at least one teacher');
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    doc.addFileToVFS('Report-Regular.ttf', regularFont);
    doc.addFont('Report-Regular.ttf', 'Report', 'normal');
    doc.addFileToVFS('Report-Bold.ttf', boldFont);
    doc.addFont('Report-Bold.ttf', 'Report', 'bold');
    const navy = '#163a43', teal = '#147d73';
    let y = 20;
    const text = (s, x, top, size = 10, color = navy, bold = false) => { doc.setCharSpace(0); doc.setFont('Report', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color); doc.text(s, x, top); };
    const room = (height) => { if (y + height > 276) {
        doc.addPage();
        y = 22;
    } };
    const heading = (title) => { room(28); text(title, 16, y, 12, navy, true); y += 7; };
    const paragraph = (s) => { doc.setFont('Report', 'normal'); doc.setFontSize(9); const lines = doc.splitTextToSize(s, 178); for (const line of lines) {
        room(5);
        text(line, 16, y, 9, '#51616a');
        y += 4.5;
    } y += 3; };
    // links: URLs for column linkColumn, or {columnIndex: URLs} for several link columns.
    const table = (head, body, links, linkColumn = 0, columnStyles) => { const linkMap = Array.isArray(links) ? (linkColumn ? { [linkColumn]: links } : { 0: links }) : (links || {}); if (!body.length) {
        paragraph('No records in this review period.');
        return;
    } room(20); autoTable(doc, { startY: y, head: [head], body: body.length ? body : [['No records in this review period', ...head.slice(1).map(() => '')]], margin: { left: 16, right: 16, top: 22, bottom: 20 }, styles: { font: 'Report', fontSize: 8, cellPadding: 2.6, textColor: '#243e48', overflow: 'linebreak' }, headStyles: { fillColor: navy, textColor: '#ffffff', fontStyle: 'bold' }, alternateRowStyles: { fillColor: '#f1f7f6' }, ...(columnStyles ? { columnStyles } : {}), rowPageBreak: 'avoid', didParseCell: data => { if (data.section === 'body' && linkMap[data.column.index]) { data.cell.styles.textColor = teal; data.cell.styles.fontStyle = 'bold'; } }, didDrawCell: data => { const url = data.section === 'body' && linkMap[data.column.index]?.[data.row.index]; if (url)
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url }); } }); y = doc.lastAutoTable.finalY + 9; };
    const banner = (kicker, title, subtitle) => { doc.setFillColor(navy); doc.rect(0, 0, 210, 8, 'F'); text('ONELERN  /  SCHOOL SUCCESS', 16, 19, 9, teal, true); text(kicker.toUpperCase(), 16, 32, 9, '#647780', true); doc.setFont('Report', 'bold'); doc.setFontSize(23); const lines = doc.splitTextToSize(title, 178); text(lines, 16, 43, 23, navy, true); y = 45 + lines.length * 8; paragraph(subtitle); doc.setDrawColor('#c6ded9'); doc.line(16, y, 194, y); y += 10; };
    // Academic reviews (owner decision, 26 November 2026): lessons in these dates reviewed one by one or in a weekly
    // review, and each weekly review's ratings and focus for next week. Review notes stay in lesson documentation.
    function academicReviews(r) {
        heading('Academic reviews');
        table(['Lessons in these dates', 'Reviewed', 'Awaiting review', 'Reviewed one by one', 'Covered by a weekly review'], [[r.lessons, r.reviewed, r.awaiting, r.single, r.weeklyCovered]]);
        if (r.weekly.length) table(['Week', 'Class · subject', 'Planning', 'Execution', 'Focus for next week', 'Reviewed by'], r.weekly.map(w => [w.week, w.cls + ' (' + w.periods + (w.periods === 1 ? ' period)' : ' periods)'), w.planning, w.execution, w.focus || '—', w.by || '—']));
        else paragraph('No weekly review covers these dates.');
        paragraph('A lesson counts as reviewed when it has an Academic Review, given one period at a time or in a weekly review, whenever it was given. The full review notes are in the lesson documentation.');
    }
    const usageKpis = [0, 1, 2, 3].filter(i => settings.quantitative && settings.daily[i] > 0 && includedMetric(i, settings));
    const evidenceKpis = [0, 1, 2, 3, 4, 5].filter(i => settings.qualitative && settings.sections.evidence && settings.evidence[i] > 0);
    const schools = [...new Set(profiles.map(p => p.school))];
    for (const school of schools) {
        if (school !== schools[0])
            doc.addPage();
        y = 20;
        const group = profiles.filter(p => p.school === school);
        banner('School overview', school, `${from} to ${to}  |  ${group.length} teachers  |  ${group[0].days} working days`);
        const holidays = [...new Set(group.flatMap(p => p.holidays))].filter(d => d >= from && d <= to);
        paragraph('Excluded holiday dates: ' + (holidays.join(', ') || 'None') + '.');
        for (const i of [0, 1, 2, 3]) {
            if (!includedMetric(i, settings))
                continue;
            const hasKpi = usageKpis.includes(i);
            heading(group[0].metrics[i].label + ' - consolidated report');
            table(['Teacher', 'Time', 'Time / day', ...(i === 1 ? ['Books opened'] : []), ...(hasKpi ? ['Target', 'Status'] : [])], group.map(p => { const m = p.metrics[i]; return [p.name, duration(m.actual), duration(m.average), ...(i === 1 ? [new Set(p.books.filter(b => b.title !== 'Title not provided').map(b => b.title)).size] : []), ...(hasKpi ? [duration(m.target), m.status] : [])]; }));
        }
        if (evidenceKpis.length) {
            heading('Evidence submission overview');
            table(['Teacher', ...evidenceKpis.map(i => group[0].evidence[i].label)], group.map(p => [p.name, ...evidenceKpis.map(i => `${p.evidence[i].actual} / ${p.evidence[i].target}`)]));
        }
        if (settings.qualitative && settings.sections.evidence && group.some(p => p.reviews)) {
            heading('Academic reviews');
            table(['Teacher', 'Lessons', 'Reviewed', 'Awaiting review', 'Weekly reviews'], group.map(p => { const r = p.reviews || { lessons: 0, reviewed: 0, awaiting: 0, weekly: [] }; return [p.name, r.lessons, r.reviewed, r.awaiting, r.weekly.length]; }));
        }
        if (comparison) {
            doc.addPage();
            y = 20;
            banner('Period comparison', school, 'School usage at a glance');
            const changes = compareProfiles(group, comparison);
            const previousHeading = `Previous time\n${comparison.from}\nto ${comparison.to}`, currentHeading = `Current time\n${from}\nto ${to}`;
            const difference = (before, now) => (now - before > 0 ? '+' : '') + duration(now - before);
            heading('School usage comparison');
            table(['Resource', previousHeading, currentHeading, 'Change in time'], [0, 1, 2, 3].filter(i => includedMetric(i, settings)).map(i => { const before = changes.reduce((sum, r) => sum + (r.previous?.metrics[i].actual || 0), 0), now = group.reduce((sum, p) => sum + p.metrics[i].actual, 0); return [group[0].metrics[i].label, duration(before), duration(now), difference(before, now)]; }));
            heading('Teacher usage comparison');
            table(['Teacher', previousHeading, currentHeading, 'Change in time'], changes.map(r => [r.current.name, duration(r.previousTotal), duration(r.total), difference(r.previousTotal, r.total)]));
        }
        for (const p of group) {
            doc.addPage();
            y = 20;
            banner('Teacher profile', p.name, `${p.school}  |  ${from} to ${to}  |  ${p.days} working days`);
            if (usageKpis.length) {
                heading('Usage against benchmark');
                table(['Resource', 'Recorded', 'Target', 'Attainment', 'Status'], usageKpis.map(i => { const m = p.metrics[i]; return [m.label, duration(m.actual), duration(m.target), m.percent === null ? '—' : m.percent.toFixed(0) + '%', m.status]; }));
            }
            if (settings.sections.lessonPlan) {
                heading('Lesson preparation - consolidated report');
                table(['Activity', 'Sessions', 'Preparation time'], [['Lesson preparation', p.metrics[0].logs.length, duration(p.metrics[0].actual)]]);
            }
            const groups = options.lessonDocs?.(p) || [];
            if (options.lessonDocs && settings.sections.documentation !== false) {
                heading('Lesson documentation');
                if (!groups.length) paragraph('No lesson plans or classroom evidence were recorded in this review period.');
                else {
                    const cls = g => [g.grade, g.section && g.section !== 'Not Applicable' ? 'Section\u00a0' + g.section : ''].filter(Boolean).join('\n') || '—', period = from === to ? from : from + ' to ' + to;
                    paragraph('Lessons are grouped by class, section and subject. Each link opens the complete lesson report for this teacher and period, saved when this report was created: lesson plans, classroom photos, student writing, attachments, recordings, dated reflections and feedback.');
                    table(['Class / section', 'Subject', 'Reporting period', 'Lessons documented', 'Lesson documentation'], groups.map(g => [cls(g), g.subject || '—', period, String(g.lessons), 'Open lesson documentation\u00a0↗'].map(String)), groups.map(g => g.url), 4, { 0: { cellWidth: 32 }, 1: { cellWidth: 29 }, 2: { cellWidth: 29 }, 3: { cellWidth: 30, halign: 'center' }, 4: { cellWidth: 58 } });
                }
            }
            if (settings.sections.book !== false) {
                heading('Book / chapter breakdown');
                table(['Book / chapter', 'Grade', 'Subject', 'Sessions', 'Time'], p.books.map(b => [b.title, b.grade || '—', b.subject || '—', b.sessions, duration(b.minutes)]));
            }
            for (const i of [2, 3]) {
                if (!includedMetric(i, settings) || (i === 2 && !settings.sections.additionalDetails))
                    continue;
                heading(p.metrics[i].label + ' • session details');
                table(['Date', 'Grade', 'Subject', 'Lesson / resource', 'Time'], p.metrics[i].logs.map(r => [r.date, r.grade || '—', r.subject || '—', r.topic || 'Title not provided', duration(r.minutes)]));
            }
            if (settings.sections.evidence) {
                if (evidenceKpis.length) {
                    heading('Teacher evidence');
                    table(['Category', 'Files', 'Period target', 'Status'], evidenceKpis.map(i => { const e = p.evidence[i]; return [e.label, e.actual, e.target, e.status]; }));
                }
                const gated = options.lessonDocsAccess === 'link' || options.lessonDocsAccess === 'signin';
                const classKey = f => JSON.stringify([f.grade, f.section, f.subject].map(v => String(v || '').trim()));
                const byClass = new Map(groups.map(group => [classKey(group), group]));
                function evidenceUrl(file) {
                    if (!gated) return file.url;
                    const url = byClass.get(classKey(file))?.fileLink?.(file.url);
                    if (!url) throw Error('The file for ' + [p.name, file.grade, file.section, file.subject, file.date].filter(Boolean).join(' · ') + ' could not be linked to its lesson. Refresh the selected period and export again.');
                    return url;
                }
                const fileOrder=['Classroom activities','Student written work','Remedial support','Student portfolio / assessment','Phonics evidence (previous portal)','Event pictures (previous portal)'];
                const order=label=>{const i=fileOrder.indexOf(label);return i<0?fileOrder.length:i;};
                for (const e of reportEvidenceGroups(p).sort((a,b)=>order(a.label)-order(b.label)))
                    if (e.files.length && !LESSON_DOCUMENTATION_ONLY.includes(e.label)) {
                        heading(e.label);
                        const action = gated && e.label === 'Classroom activities' ? 'Open activity' : gated && e.label === 'Student written work' ? 'Open writing sample' : 'Open file';
                        // Without lesson documentation no file is linked, so no report exposes direct storage links.
                        const linked = settings.sections.documentation !== false;
                        table([linked ? 'Open evidence' : 'Evidence', 'Date', 'Grade / subject', 'Lesson / topic'], e.files.map((f, i) => [(linked ? action : e.label) + ' ' + (i + 1), f.date, [f.grade, f.subject].filter(Boolean).join(' / '), f.topic]), linked ? e.files.map(evidenceUrl) : undefined);
                    }
            }
            if (settings.qualitative && settings.sections.evidence && p.reviews) academicReviews(p.reviews);
            if (settings.sections.observations) {
                heading('Classroom observation report');
                if (!p.observations.length)
                    paragraph('No consultant observations recorded in this review period.');
                else for (const v of p.observations)
                    table(['Consultant observation', 'Details'], [['Date / subject / topic', [v.date, v.subject, v.topic].filter(Boolean).join(' / ')], ['Strengths', v.strengths || '—'], ['Areas for growth', v.improvements || '—'], ['Agreed actions', v.actions || '—'], ...Object.entries(v.rubrics || {}).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)])]);
            }
        }
    }
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setDrawColor('#d8e4e2');
        doc.line(16, 281, 194, 281);
        text('SCHOOL SUCCESS  |  Private academic review', 16, 287, 8, '#677c82');
        text(`${i} / ${total}`, 194, 287, 8, '#677c82');
    }
    doc.setProperties({ title: 'Teacher 360 Academic Review', subject: `${from} to ${to}`, creator: 'School Success' });
    return doc;
}

