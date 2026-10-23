import { regularFont, boldFont } from './report-fonts.js';
import { compareProfiles } from './report-comparison.js';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { includedMetric } from './reports.js';
import {reportEvidenceGroups} from '../report-sequence.js';
import {reportTime} from './report-units.js';
import {reportPresentation, profileUsageChart, schoolUsageChart, bookUsageChart, comparisonChart, schoolComparisonChart, chartMaximum, chartNumber} from './report-charts.js';
export function createReportPdf(profiles, from, to, settings, comparison) {
    if (!profiles.length)
        throw Error('Select at least one teacher');
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    doc.addFileToVFS('Report-Regular.ttf', regularFont);
    doc.addFont('Report-Regular.ttf', 'Report', 'normal');
    doc.addFileToVFS('Report-Bold.ttf', boldFont);
    doc.addFont('Report-Bold.ttf', 'Report', 'bold');
    const navy = '#163a43', teal = '#147d73';
    const presentation = reportPresentation(settings), time = reportTime(settings);
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
    const table = (head, body, links) => { if (!body.length) {
        paragraph('No records in this review period.');
        return;
    } room(20); autoTable(doc, { startY: y, head: [head], body: body.length ? body : [['No records in this review period', ...head.slice(1).map(() => '')]], margin: { left: 16, right: 16, top: 22, bottom: 20 }, styles: { font: 'Report', fontSize: 8, cellPadding: 2.6, textColor: '#243e48', overflow: 'linebreak' }, headStyles: { fillColor: navy, textColor: '#ffffff', fontStyle: 'bold' }, alternateRowStyles: { fillColor: '#f1f7f6' }, rowPageBreak: 'avoid', didDrawCell: data => { if (links && data.section === 'body' && data.column.index === 0 && links[data.row.index])
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: links[data.row.index] }); } }); y = doc.lastAutoTable.finalY + 9; };
    const banner = (kicker, title, subtitle) => { doc.setFillColor(navy); doc.rect(0, 0, 210, 8, 'F'); text('ONELERN  /  SCHOOL SUCCESS', 16, 19, 9, teal, true); text(kicker.toUpperCase(), 16, 32, 9, '#647780', true); doc.setFont('Report', 'bold'); doc.setFontSize(23); const lines = doc.splitTextToSize(title, 178); text(lines, 16, 43, 23, navy, true); y = 45 + lines.length * 8; paragraph(subtitle); doc.setDrawColor('#c6ded9'); doc.line(16, y, 194, y); y += 10; };
    const chart = model => {
        if (!model.rows.length) { heading(model.title); paragraph('No records in this review period.'); return; }
        const maximum = chartMaximum(model);
        const layout = row => {
            doc.setFont('Report', 'normal'); doc.setFontSize(9);
            const label = doc.splitTextToSize(row.label, 178), note = row.note ? doc.splitTextToSize(row.note, 178) : [];
            const series = model.series.filter(s => row[s.key] !== undefined);
            return {label, note, series, height: label.length * 4.5 + note.length * 4 + series.length * 6 + 10};
        };
        const begin = continued => {
            room(32 + layout(model.rows[0]).height); heading(model.title + (continued ? ' (continued)' : ''));
            text(model.unit + ' | Scale starts at zero', 16, y, 8, '#51616a'); y += 6;
            let legendHeight = 5;
            model.series.forEach((series, i) => {
                const x = 16 + i * 89;
                doc.setFillColor(series.color); doc.rect(x, y - 2.5, 4, 3, 'F'); text(series.label, x + 6, y, 8);
                if (series.detail) { const lines = doc.splitTextToSize(series.detail, 80); text(lines, x, y + 4.5, 7, '#51616a'); legendHeight = Math.max(legendHeight, 5 + lines.length * 4); }
            });
            y += legendHeight + 3;
            for (const [fraction, x] of [[0, 47], [.5, 108], [1, 170]]) text(chartNumber(maximum * fraction), x, y, 7, '#51616a');
            y += 5;
        };
        begin(false);
        for (const row of model.rows) {
            const {label, note, series, height} = layout(row);
            const before = doc.getNumberOfPages(); room(height);
            if (doc.getNumberOfPages() !== before) begin(true);
            text(label, 16, y, 9, navy, true); y += label.length * 4.5;
            if (note.length) { text(note, 16, y, 8, '#51616a'); y += note.length * 4; }
            for (const s of series) {
                const value = Number(row[s.key]) || 0;
                text(s.label, 16, y + 2, 7);
                doc.setFillColor('#e8efee'); doc.rect(47, y - 1, 123, 3.6, 'F');
                if (value > 0) { doc.setFillColor(s.color); doc.rect(47, y - 1, 123 * value / maximum, 3.6, 'F'); }
                text(chartNumber(value), 174, y + 2, 8, navy, true); y += 6;
            }
            y += 6;
        }
        y += 3;
    };
    const usageKpis = [0, 1, 2, 3].filter(i => settings.quantitative && settings.daily[i] > 0 && includedMetric(i, settings));
    const evidenceKpis = [0, 1, 2, 3, 4].filter(i => settings.qualitative && settings.sections.evidence && settings.evidence[i] > 0);
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
            if (presentation.tables) {
                heading(group[0].metrics[i].label + ' - consolidated report');
                table(['Teacher', time.label, time.label + ' / day', ...(i === 1 ? ['Books opened'] : []), ...(hasKpi ? ['Target (' + time.short + ')', 'Status'] : [])], group.map(p => { const m = p.metrics[i]; return [p.name, time.format(m.actual), time.format(m.average), ...(i === 1 ? [new Set(p.books.filter(b => b.title !== 'Title not provided').map(b => b.title)).size] : []), ...(hasKpi ? [time.format(m.target), m.status] : [])]; }));
            }
            if (presentation.charts) chart(schoolUsageChart(group, i, settings));
        }
        if (evidenceKpis.length) {
            heading('Evidence submission overview');
            table(['Teacher', ...evidenceKpis.map(i => group[0].evidence[i].label)], group.map(p => [p.name, ...evidenceKpis.map(i => `${p.evidence[i].actual} / ${p.evidence[i].target}`)]));
        }
        if (comparison) {
            doc.addPage();
            y = 20;
            banner('Period comparison', school, 'School usage at a glance');
            const changes = compareProfiles(group, comparison);
            const previousHeading = `Previous ${time.unit}\n${comparison.from}\nto ${comparison.to}`, currentHeading = `Current ${time.unit}\n${from}\nto ${to}`;
            const difference = (before, now) => (now - before > 0 ? '+' : '') + time.format(now - before);
            if (presentation.tables) {
                heading('School usage comparison');
                table(['Resource', previousHeading, currentHeading, 'Change (' + time.short + ')'], [0, 1, 2, 3].filter(i => includedMetric(i, settings)).map(i => { const before = changes.reduce((sum, r) => sum + (r.previous?.metrics[i].actual || 0), 0), now = group.reduce((sum, p) => sum + p.metrics[i].actual, 0); return [group[0].metrics[i].label, time.format(before), time.format(now), difference(before, now)]; }));
                heading('Teacher usage comparison');
                table(['Teacher', previousHeading, currentHeading, 'Change (' + time.short + ')'], changes.map(r => [r.current.name, time.format(r.previousTotal), time.format(r.total), difference(r.previousTotal, r.total)]));
            }
            if (presentation.charts) { chart(schoolComparisonChart(group, changes, comparison, from, to, settings)); chart(comparisonChart(changes, comparison, from, to, settings)); }
        }
        for (const p of group) {
            doc.addPage();
            y = 20;
            banner('Teacher profile', p.name, `${p.school}  |  ${from} to ${to}  |  ${p.days} working days`);
            if (presentation.tables && usageKpis.length) {
                heading('Usage against benchmark');
                table(['Resource', 'Recorded (' + time.short + ')', 'Target (' + time.short + ')', 'Attainment', 'Status'], usageKpis.map(i => { const m = p.metrics[i]; return [m.label, time.format(m.actual), time.format(m.target), m.percent === null ? '—' : m.percent.toFixed(0) + '%', m.status]; }));
            }
            if (presentation.charts) chart(profileUsageChart(p, settings));
            if (settings.sections.lessonPlan) {
                heading('Lesson preparation - consolidated report');
                if (presentation.tables) table(['Activity', 'Sessions', 'Total ' + time.unit], [['Lesson preparation', p.metrics[0].logs.length, time.format(p.metrics[0].actual)]]);
                else paragraph(`${p.metrics[0].logs.length} preparation session${p.metrics[0].logs.length === 1 ? '' : 's'} | ${time.format(p.metrics[0].actual)} ${time.unit}`);
            }
            if (presentation.tables) { heading('Book / chapter breakdown'); table(['Book / chapter', 'Grade', 'Subject', 'Sessions', time.label], p.books.map(b => [b.title, b.grade || '—', b.subject || '—', b.sessions, time.format(b.minutes)])); }
            if (presentation.charts) chart(bookUsageChart(p, settings));
            for (const i of [2, 3]) {
                if (!includedMetric(i, settings) || (i === 2 && !settings.sections.additionalDetails))
                    continue;
                if (presentation.tables) { heading(p.metrics[i].label + ' • session details'); table(['Date', 'Grade', 'Subject', 'Lesson / resource', time.label], p.metrics[i].logs.map(r => [r.date, r.grade || '—', r.subject || '—', r.topic || 'Title not provided', time.format(r.minutes)])); }
                if (presentation.charts) chart({title: p.metrics[i].label + ' - session details', unit: time.label, short: time.short, series: [{key: 'actual', label: 'Recorded', color: teal}], rows: p.metrics[i].logs.map(r => ({label: [r.date, r.grade, r.subject, r.topic || 'Title not provided'].filter(Boolean).join(' | '), actual: time.value(r.minutes)}))});
            }
            if (settings.sections.evidence) {
                if (evidenceKpis.length) {
                    heading('Teacher evidence');
                    table(['Category', 'Files', 'Period target', 'Status'], evidenceKpis.map(i => { const e = p.evidence[i]; return [e.label, e.actual, e.target, e.status]; }));
                }
                paragraph('File counts indicate submission coverage only. Open the linked files below to review teaching practice.');
                const fileOrder=['Lesson preparation PDFs','Audio recordings','Activity files','Writing samples','Phonics evidence'];
                const order=label=>{const i=fileOrder.indexOf(label);return i<0?fileOrder.length:i;};
                for (const e of reportEvidenceGroups(p).sort((a,b)=>order(a.label)-order(b.label)))
                    if (e.files.length) {
                        heading(e.label);
                        table(['Open evidence', 'Date', 'Grade / subject', 'Lesson / topic'], e.files.map((f, i) => ['Open file ' + (i + 1), f.date, [f.grade, f.subject].filter(Boolean).join(' / '), f.topic]), e.files.map(f => f.url));
                    }
            }
            if (settings.sections.observations) {
                heading('Classroom observation report');
                if (!p.observations.length)
                    paragraph('No consultant observations recorded in this review period.');
                for (const v of p.observations)
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

