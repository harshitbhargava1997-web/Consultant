const key = 'crmFreshStartV1';
export async function ensureCrmArchive(db, loadRows) {
    const read = () => db.prepare('SELECT value FROM portal_config WHERE key=?').bind(key).first();
    const existing = await read();
    if (existing)
        return JSON.parse(existing.value);
    const rows = await loadRows(), snapshot = { createdAt: new Date().toISOString(), ids: rows.filter(r => r.kind === 'call').map(r => r.id) };
    await db.prepare('INSERT OR IGNORE INTO portal_config(key,value) VALUES(?,?)').bind(key, JSON.stringify(snapshot)).run();
    const saved = await read();
    if (!saved)
        throw Error('503:Could not preserve the previous CRM history');
    return JSON.parse(saved.value);
}
export function applyCrmArchive(rows, snapshot) { const ids = new Set(snapshot.ids); return rows.map(r => r.kind === 'call' && ids.has(r.id) ? { ...r, archived: true, historical: true } : r); }

