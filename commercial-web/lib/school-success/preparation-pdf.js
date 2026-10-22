import { jsPDF } from 'jspdf';
// Browser canvas shapes Hindi and English using the device's fonts before embedding.
// Audio remains in storage; the PDF carries clickable links to the recordings.
export async function preparationPdf(input, makeCanvas = () => document.createElement('canvas')) {
    if (typeof document !== 'undefined') {
        const font = new FontFace('LessonHindi', 'url(/fonts/Lesson-Devanagari.ttf)');
        await font.load();
        document.fonts.add(font);
        await document.fonts.ready;
    }
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const width = 1240, height = 1754, margin = 94;
    let canvas = makeCanvas();
    canvas.width = width;
    canvas.height = height;
    let ctx = canvas.getContext('2d');
    let y = 0, page = 0;
    let links = [];
    function begin() { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#246c58'; ctx.fillRect(0, 0, width, 24); y = 108; links = []; }
    function finish() { if (page++)
        pdf.addPage(); ctx.font = '22px LessonHindi, sans-serif'; ctx.fillStyle = '#657970'; ctx.fillText('OneLern | Lesson preparation', margin, height - 64); ctx.fillText(String(page), width - margin - 24, height - 64); pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297); for (const link of links)
        pdf.link(margin / width * 210, (link.y - 25) / height * 297, 170, 7, { url: link.url }); }
    function line(text, bold = false, size = 28) { if (y > height - 150) {
        finish();
        begin();
    } ctx.font = `${bold ? 'bold ' : ''}${size}px LessonHindi, sans-serif`; ctx.fillStyle = bold ? '#164438' : '#243a32'; ctx.fillText(text, margin, y); y += size * 1.55; }
    function paragraph(text, bold = false, size = 28) { ctx.font = `${bold ? 'bold ' : ''}${size}px LessonHindi, sans-serif`; for (const raw of text.split('\n')) {
        if (!raw) {
            y += 16;
            continue;
        }
        let row = '';
        for (const word of raw.split(/\s+/)) {
            const trial = row ? row + ' ' + word : word;
            if (ctx.measureText(trial).width > width - margin * 2 && row) {
                line(row, bold, size);
                row = word;
            }
            else
                row = trial;
        }
        if (row)
            line(row, bold, size);
    } y += 14; }
    begin();
    paragraph('LESSON PREPARATION', true, 38);
    paragraph(input.school, true, 30);
    paragraph(input.teacher + ' | Planned lesson: ' + input.date);
    paragraph([input.grade, input.section, input.subject].filter(Boolean).join(' / '), true);
    paragraph(input.topic, true, 30);
    paragraph(input.reflection || 'No written reflection recorded.');
    if (input.materials && !input.reflection.includes(input.materials)) {
        paragraph('Teaching-learning materials', true);
        paragraph(input.materials);
    }
    if (input.audioUrls.length) {
        paragraph('Voice recordings', true);
        input.audioUrls.forEach((url, i) => { if (y > height - 150) {
            finish();
            begin();
        } links.push({ y, url }); line('Open voice recording ' + (i + 1), true); });
        paragraph('Tap a recording link to listen. An internet connection is required.', false, 23);
    }
    finish();
    pdf.setProperties({ title: input.topic + ' - Lesson preparation', author: input.teacher });
    return pdf.output('arraybuffer');
}

