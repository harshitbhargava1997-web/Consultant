// "Noted": a teacher's acknowledgement that they have read one piece of feedback on their lesson (owner-approved,
// 24 November 2026). One immutable success_entries row per feedback version and lesson record; the first "Noted"
// is kept, so a retry or a second tap changes nothing. Edited legacy feedback (same record, new date) is a new
// version and can be noted again.
import {lessonRecordId} from './lesson-reviews.js';
const kind = 'feedback-noted';
const prefix = id => kind + '-' + id + '-';
// The feedback a note refers to: a rubric review by its own ID, legacy feedback by its last update time.
export function feedbackKey(review) {
 return review?.review_id ? String(review.review_id) : 'legacy:' + String(review?.updated_at || '');
}
// Short, stable text hash (not a security control) so the row ID stays within the existing ID format.
function digest(text) {
 let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
 for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13); }
 return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export const noteId = (recordId, key) => prefix(recordId) + digest(String(key));
export async function readNotes(recordIds, scope, all) {
 const ids = [...new Set(recordIds.map(String))].filter(id => lessonRecordId.safeParse(id).success), out = [];
 for (let i = 0; i < ids.length; i += 60) {
  const batch = ids.slice(i, i + 60);
  const rows = await all('success_entries', 'id', { ...scope, select: 'id,school,payload,updated', kind: 'eq.' + kind, or: '(' + batch.map(id => 'id.like.' + prefix(id) + '*').join(',') + ')' });
  for (const row of rows) {
   let p; try { p = JSON.parse(row.payload); } catch { continue; }
   const recordId = row.id.match(/^feedback-noted-(\d+)-/)?.[1];
   if (!batch.includes(recordId) || String(p.recordId) !== recordId || row.id !== noteId(recordId, p.key)) continue;
   out.push({ record_id: recordId, school: row.school, key: String(p.key), noted_at: p.notedAt || row.updated });
  }
 }
 return out;
}
export async function appendNote({ recordId, school, teacher, key, owner }, request) {
 const id = noteId(recordId, key), notedAt = new Date().toISOString();
 const row = { id, school, kind, owner, payload: JSON.stringify({ recordId: String(recordId), key: String(key), teacher, notedAt }), updated: notedAt };
 const inserted = await request('/rest/v1/success_entries?on_conflict=id&select=id,payload', 'POST', row, { Prefer: 'resolution=ignore-duplicates,return=representation' });
 if (inserted?.length) return { noted: true, notedAt };
 const [existing] = await request('/rest/v1/success_entries?' + new URLSearchParams({ id: 'eq.' + id, school: 'eq.' + school, kind: 'eq.' + kind, select: 'payload,updated' }));
 if (!existing) throw Error('Could not save that you noted this feedback. Please try again.');
 let p = {}; try { p = JSON.parse(existing.payload); } catch { }
 return { noted: true, notedAt: p.notedAt || existing.updated, alreadyNoted: true };
}
// Latest note on any of a lesson's visible feedback items, and whether every item has been noted.
export function noteSummary(reviews, notes) {
 const keys = new Set((notes || []).map(n => n.key)), matched = (notes || []).filter(n => reviews.some(r => r.key === n.key));
 if (!reviews.length || !matched.length) return null;
 return { notedAt: matched.map(n => n.noted_at || n.notedAt).sort().at(-1), all: reviews.every(r => keys.has(r.key)) };
}
