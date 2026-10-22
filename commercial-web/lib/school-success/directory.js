export const archiveKey = (kind, school, teacher = '') => 'directoryArchive:' + JSON.stringify([kind, school, kind === 'teacher' ? teacher : '']);
export function isArchived(archives, school, teacher = '') { return archives.some(a => a.archived && a.school === school && (a.kind === 'school' || a.kind === 'teacher' && a.teacher === teacher)); }
export async function loadArchives(db) { const result = await db.prepare("SELECT value FROM portal_config WHERE key LIKE 'directoryArchive:%'").all(); return result.results.map((r) => JSON.parse(r.value)); }
export function reportDirectorySource(data, archives, includeArchived = false) { const entries = [...data.entries || [], ...data.archivedEntries || []], roster = [...data.roster || [], ...data.archivedRoster || []]; return { entries: includeArchived ? entries : entries.filter(r => !isArchived(archives, r.school || r.name, r.teacher || '')), roster: includeArchived ? roster : roster.filter(r => !isArchived(archives, r.school, r.name)) }; }

