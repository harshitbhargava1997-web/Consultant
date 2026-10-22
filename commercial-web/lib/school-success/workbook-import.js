import { importHeader } from './usage-import.js';
export async function readUsageWorkbooks(files) {
    // FileList is live: copy before lazy-loading XLSX or resetting the file input.
    const selected = Array.from(files);
    if (!selected.length)
        throw Error('Choose a workbook');
    const XLSX = await import('xlsx');
    const data = [];
    let size = 0;
    for (const file of selected) {
        size += file.size;
        if (size > 10 * 1024 * 1024)
            throw Error('Choose files totaling at most 10 MB');
        if (!/\.(xlsx|csv)$/i.test(file.name))
            throw Error('Choose .xlsx or .csv files');
        const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
        const name = book.SheetNames.find(n => n.toLowerCase().includes('usermetric')) || book.SheetNames[0];
        if (!name)
            throw Error(file.name + ': no worksheet');
        const cells = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '', blankrows: true });
        const headers = (cells[0] || []).map(importHeader);
        if (!headers.length || new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length)
            throw Error(file.name + ': duplicate or missing column headers');
        for (let i = 1; i < cells.length; i++) {
            if (cells[i].every(v => v === '' || v == null))
                continue;
            const row = { _source_file: file.name, _excel_row: i + 1 };
            headers.forEach((key, j) => { if (key && !key.startsWith('_'))
                row[key] = cells[i][j] ?? ''; });
            data.push(row);
        }
        if (data.length > 20000)
            throw Error('Choose at most 20,000 rows per import');
    }
    if (!data.length)
        throw Error('No data rows found');
    return { rows: data, source: selected.map(f => f.name).join(', ') };
}

