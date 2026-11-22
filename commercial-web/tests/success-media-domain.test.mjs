// Moving media to the school's own domain: files stored under the earlier r2.dev address are the same objects,
// so they are presented under the current media address everywhere evidence is read. Nothing stored changes.
import test from 'node:test';import assert from 'node:assert/strict';
import {mapLive,currentMediaUrl,LEGACY_MEDIA_BASES} from '../lib/school-success/live-mapping.js';
import {evidenceKeyFromUrl} from '../lib/school-success/report-shares.js';
import {buildLessonRecords} from '../lib/school-success/lesson-records.js';
import {checkReportEvidence} from '../lib/school-success/lesson-snapshots.js';
import * as fixture from './fixtures/lesson-records.mjs';
const LEGACY=LEGACY_MEDIA_BASES[0],NEW='https://media.schoolsuccess.in';
// The same lesson records, stored with full addresses on the earlier r2.dev media address.
const legacyRaw=()=>{const raw=fixture.raw();raw.records=JSON.parse(JSON.stringify(raw.records).split(fixture.base).join(LEGACY));return raw;};

test('earlier media addresses move to the current media address; other addresses are untouched',()=>{
 assert.equal(currentMediaUrl(LEGACY+'/schools/Alpha%20School/teachers/Asha/a.jpg',NEW),NEW+'/schools/Alpha%20School/teachers/Asha/a.jpg');
 assert.equal(currentMediaUrl(LEGACY+'/x.jpg',NEW+'/'),NEW+'/x.jpg','trailing slash on the base');
 assert.equal(currentMediaUrl(LEGACY+'/x.jpg',LEGACY),LEGACY+'/x.jpg','no change while the earlier address is still current');
 assert.equal(currentMediaUrl('https://example.org/x.jpg',NEW),'https://example.org/x.jpg','other websites are never rewritten');
 assert.equal(currentMediaUrl(LEGACY+'.evil.test/x.jpg',NEW),LEGACY+'.evil.test/x.jpg','only the exact earlier address');
});

test('lessons stored with earlier addresses read, link and report exactly like new ones under the media domain',async()=>{
 const mapped=await mapLive(legacyRaw(),NEW),files=mapped.entries.flatMap(e=>e.files||[]).map(f=>f.url).filter(Boolean);
 assert.ok(files.length>3);
 assert.ok(files.every(u=>!u.startsWith(LEGACY)),'no earlier addresses reach the screens or reports');
 assert.ok(files.filter(u=>u.startsWith(NEW+'/')).length>3);
 // Every file is recognised as the school's own media storage, with the same storage key as before.
 const before=await mapLive(fixture.raw(),fixture.base);
 const keys=u=>evidenceKeyFromUrl(u,NEW);
 assert.deepEqual(files.map(keys).sort(),before.entries.flatMap(e=>e.files||[]).map(f=>f.url).filter(Boolean).map(u=>evidenceKeyFromUrl(u,fixture.base)).sort());
 // The consolidated-report check finds no file "outside media storage".
 const lessons=buildLessonRecords(mapped.entries.filter(e=>e.kind==='submission'),fixture.from,fixture.to);
 assert.ok(lessons.length);assert.doesNotThrow(()=>checkReportEvidence(lessons,NEW));
 assert.throws(()=>checkReportEvidence(lessons,'https://other-media.example.test'),/media storage/,'the check itself still works');
});

test('with no media domain configured, nothing changes',async()=>{
 const mapped=await mapLive(legacyRaw(),LEGACY),files=mapped.entries.flatMap(e=>e.files||[]).map(f=>f.url).filter(Boolean);
 assert.ok(files.length&&files.every(u=>!u.startsWith(NEW)));
 assert.ok(files.filter(u=>u.startsWith(LEGACY+'/')).length>3);
});
