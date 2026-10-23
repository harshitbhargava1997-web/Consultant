import { regularFont, boldFont } from './report-fonts.js';
import { compareProfiles } from './report-comparison.js';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { includedMetric } from './reports.js';
import {lessonReportFiles,lessonReportUsage} from '../lesson-groups.js';
export function createReportPdf(profiles, from, to, settings, comparison) {
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
    const heading = (title) => { doc.setFont('Report','bold');doc.setFontSize(12);const lines=doc.splitTextToSize(title,178);room(Math.max(28,lines.length*6+15));text(lines,16,y,12,navy,true);y+=lines.length*6+1; };
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
            heading(group[0].metrics[i].label + ' - consolidated report');
            table(['Teacher', 'Minutes', 'Min / day', ...(i === 1 ? ['Books opened'] : []), ...(hasKpi ? ['Target', 'Status'] : [])], group.map(p => { const m = p.metrics[i]; return [p.name, m.actual.toFixed(1), m.average.toFixed(1), ...(i === 1 ? [new Set(p.books.filter(b => b.title !== 'Title not provided').map(b => b.title)).size] : []), ...(hasKpi ? [m.target.toFixed(0), m.status] : [])]; }));
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
            const previousHeading = `Previous minutes\n${comparison.from}\nto ${comparison.to}`, currentHeading = `Current minutes\n${from}\nto ${to}`;
            const difference = (before, now) => (now - before > 0 ? '+' : '') + (now - before).toFixed(1);
            heading('School usage comparison');
            table(['Resource', previousHeading, currentHeading, 'Change (min)'], [0, 1, 2, 3].filter(i => includedMetric(i, settings)).map(i => { const before = changes.reduce((sum, r) => sum + (r.previous?.metrics[i].actual || 0), 0), now = group.reduce((sum, p) => sum + p.metrics[i].actual, 0); return [group[0].metrics[i].label, before.toFixed(1), now.toFixed(1), difference(before, now)]; }));
            heading('Teacher usage comparison');
            table(['Teacher', previousHeading, currentHeading, 'Change (min)'], changes.map(r => [r.current.name, r.previousTotal.toFixed(1), r.total.toFixed(1), difference(r.previousTotal, r.total)]));
        }
        for (const p of group) {
            doc.addPage();
            y = 20;
            banner('Teacher profile', p.name, `${p.school}  |  ${from} to ${to}  |  ${p.days} working days`);
            if (usageKpis.length) {
                heading('Usage against benchmark');
                table(['Resource', 'Recorded', 'Target', 'Attainment', 'Status'], usageKpis.map(i => { const m = p.metrics[i]; return [m.label, m.actual.toFixed(1) + ' min', m.target.toFixed(0) + ' min', m.percent === null ? '—' : m.percent.toFixed(0) + '%', m.status]; }));
            }
            if (settings.sections.lessonPlan) {
                heading('Lesson preparation - consolidated report');
                table(['Activity', 'Sessions', 'Total minutes'], [['Lesson preparation', p.metrics[0].logs.length, p.metrics[0].actual.toFixed(1)]]);
            }
            heading('Book / chapter breakdown');
            table(['Book / chapter', 'Grade', 'Subject', 'Sessions', 'Minutes'], p.books.map(b => [b.title, b.grade || '—', b.subject || '—', b.sessions, b.minutes.toFixed(1)]));
            for (const i of [2, 3]) {
                if (!includedMetric(i, settings) || (i === 2 && !settings.sections.additionalDetails))
                    continue;
                heading(p.metrics[i].label + ' • session details');
                table(['Date', 'Grade', 'Subject', 'Lesson / resource', 'Minutes'], p.metrics[i].logs.map(r => [r.date, r.grade || '—', r.subject || '—', r.topic || 'Title not provided', Number(r.minutes).toFixed(1)]));
            }
            if (settings.sections.evidence) {
                if (evidenceKpis.length) {
                    heading('Teacher evidence');
                    table(['Category', 'Files', 'Period target', 'Status'], evidenceKpis.map(i => { const e = p.evidence[i]; return [e.label, e.actual, e.target, e.status]; }));
                }
                paragraph('File counts indicate submission coverage only. Open the linked files below to review teaching practice.');
            }
            // Keep the school/teacher consolidated summaries above; details now
            // follow grade, subject, planned date and explicit lesson identity.
            for(const grade of p.lessonGroups||[]){
                const subjects=grade.subjects.map(s=>({...s,lessons:s.lessons.map(l=>({...l,files:lessonReportFiles(l,settings),usage:lessonReportUsage(l,settings)})).filter(l=>l.files.length||l.usage.length)})).filter(s=>s.lessons.length);
                if(!subjects.length)continue;
                room(75);heading('Grade: '+grade.grade);
                for(const subject of subjects){const before=doc.getNumberOfPages();room(60);if(doc.getNumberOfPages()!==before)heading('Grade: '+grade.grade+' (continued)');heading('Subject: '+subject.subject);
                    for(const lesson of subject.lessons){room(45);heading(`${lesson.date} | ${lesson.topic}${lesson.section?' | Section '+lesson.section:''}`);
                        if(lesson.usage.length)table(['Preparation date','Lesson preparation sessions','Minutes'],lesson.usage.map(r=>[r.date,1,Number(r.minutes||0).toFixed(1)]));
                        if(lesson.files.length)table(['Open evidence','Stage / category','Saved / submitted','Taught on'],lesson.files.map((f,i)=>['Open file '+(i+1),f.stage+' / '+f.category,f.date,f.conductedOn||'—']),lesson.files.map(f=>f.url));
                    }
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

