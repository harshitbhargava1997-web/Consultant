// Day status in the Planner (owner decision, 28 November 2026): Present (default), Half day, Absent, School
// examination, Summer / Winter / Festival vacation, National holiday; principals can correct a teacher's day.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dayStatusInput,cleanStatus,dayStatusId,parseRow,resolveDays,readDayStatuses,appendDayStatus,statusLabel,shortLabel,teacherTag,NO_PLAN,MAX_RANGE_DAYS} from '../lib/school-success/day-status.js';

const S='Sunrise Public School',T='Asha Verma',R='11111111-1111-4111-8111-111111111111';
const ok=v=>dayStatusInput.safeParse({requestId:R,...v});
const row=(status,teacher,by,updated,req=crypto.randomUUID())=>({id:dayStatusId(S,teacher,status.from,status.to,req),school:S,kind:'day-status',owner:'x@example.com',updated,payload:JSON.stringify({teacher,...status,by})});
const teacherBy={name:T,role:'Teacher'},principal={name:'Meera Rao',role:'Principal'};

test('day status input: single days, ranges and required details', () => {
 assert.equal(ok({from:'2026-12-01',to:'2026-12-01',status:'absent'}).success,true);
 assert.equal(ok({from:'2026-12-01',to:'2026-12-03',status:'absent'}).success,false,'absent is one day at a time');
 assert.equal(ok({from:'2026-12-01',to:'2026-12-01',status:'half-day'}).success,false,'half day needs the half');
 assert.equal(ok({from:'2026-12-01',to:'2026-12-01',status:'half-day',half:'second'}).success,true);
 assert.equal(ok({from:'2026-12-07',to:'2026-12-16',status:'exam'}).success,false,'exam needs its type');
 for(const exam of ['unit','periodic','term','half-yearly','annual'])assert.equal(ok({from:'2026-12-07',to:'2026-12-16',status:'exam',exam}).success,true,exam);
 assert.equal(ok({from:'2026-12-26',to:'2027-01-05',status:'winter'}).success,true);
 assert.equal(ok({from:'2026-12-05',to:'2026-12-01',status:'winter'}).success,false,'From after To');
 assert.equal(ok({from:'2026-05-01',to:'2026-08-15',status:'summer'}).success,false,'more than '+MAX_RANGE_DAYS+' days');
 assert.equal(ok({from:'2026-11-09',to:'2026-11-13',status:'festival',name:'Diwali'}).success,true);
 assert.equal(ok({from:'2026-12-18',to:'2026-12-18',status:'other'}).success,false,'an additional holiday needs a name');
 assert.equal(ok({from:'2026-12-18',to:'2026-12-19',status:'other',name:'Sports day'}).success,true);
 assert.equal(ok({from:'2026-02-30',to:'2026-02-30',status:'absent'}).success,false,'not a real date');
 assert.equal(ok({from:'2026-12-01',to:'2026-12-01',status:'holiday'}).success,false,'unknown status');
 assert.equal(ok({from:'2026-12-01',to:'2026-12-01',status:'absent',extra:1}).success,false,'no unknown fields');
 assert.deepEqual(cleanStatus({from:'2026-12-01',to:'2026-12-01',status:'absent',half:'first',exam:'unit',name:'X',note:'Fever'}),{from:'2026-12-01',to:'2026-12-01',status:'absent',note:'Fever'});
 assert.deepEqual([...NO_PLAN].sort(),['absent','exam','festival','national','other','summer','winter']);
});

test('stored rows: only rows whose id matches their teacher and dates are read', () => {
 const good=row({from:'2026-12-01',to:'2026-12-01',status:'absent'},T,teacherBy,'2026-12-01T03:00:00Z');
 assert.equal(parseRow(good).status,'absent');
 assert.equal(parseRow(good).byTeacher,true);
 assert.equal(parseRow({...good,payload:good.payload.replace(T,'Someone Else')}),null,'teacher changed inside the payload');
 assert.equal(parseRow({...good,payload:good.payload.replace('"from":"2026-12-01"','"from":"2026-11-30"')}),null,'dates changed inside the payload');
 assert.equal(parseRow({...good,school:'Other School'}),null,'row moved to another school');
 assert.equal(parseRow({...good,payload:'{'}),null);
});

test('latest status per day wins; a principal correction keeps the teacher mark', () => {
 const rows=[
  row({from:'2026-11-30',to:'2026-11-30',status:'absent'},T,teacherBy,'2026-11-30T03:00:00Z'),
  row({from:'2026-11-30',to:'2026-11-30',status:'half-day',half:'second',note:'Came after lunch'},T,principal,'2026-11-30T10:40:00Z'),
  row({from:'2026-12-03',to:'2026-12-04',status:'festival',name:'Guru Nanak Jayanti'},T,teacherBy,'2026-11-29T08:00:00Z'),
  row({from:'2026-12-04',to:'2026-12-04',status:'present'},T,teacherBy,'2026-12-04T02:00:00Z'),
  row({from:'2026-12-02',to:'2026-12-02',status:'absent'},'Ravi Kumar',principal,'2026-12-02T09:00:00Z')
 ].map(parseRow);
 const days=resolveDays(rows,'2026-11-30','2026-12-05'),get=(t,d)=>days.find(x=>x.teacher===t&&x.date===d);
 const mon=get(T,'2026-11-30');
 assert.equal(mon.status,'half-day');assert.equal(mon.half,'second');assert.equal(mon.changedByLeader,true);
 assert.deepEqual(mon.by,principal);assert.equal(mon.teacherMark.status,'absent');assert.equal(mon.note,'Came after lunch');
 assert.equal(get(T,'2026-12-03').status,'festival');assert.equal(get(T,'2026-12-03').name,'Guru Nanak Jayanti');
 assert.equal(get(T,'2026-12-04').status,'present','a later single day inside a range replaces it for that day');
 assert.equal(get(T,'2026-12-01'),undefined,'no stored status: Present');
 const ravi=get('Ravi Kumar','2026-12-02');assert.equal(ravi.changedByLeader,true);assert.equal(ravi.teacherMark,null,'principal marked with no teacher mark');
 assert.ok(days.every(d=>!('id' in d)&&!('owner' in d)&&!('school' in d)),'no ids or sign-ins leave the server');
 // The teacher marks again after the correction: their new mark is the day's status.
 const again=resolveDays([...rows,parseRow(row({from:'2026-11-30',to:'2026-11-30',status:'absent'},T,teacherBy,'2026-11-30T12:00:00Z'))],'2026-11-30','2026-11-30')[0];
 assert.equal(again.status,'absent');assert.equal(again.changedByLeader,false);assert.equal(again.teacherMark,null);
});

test('reading narrows by id range and teacher; saving is append-only and idempotent', async () => {
 const stored=[
  row({from:'2026-12-26',to:'2027-01-05',status:'winter'},T,teacherBy,'2026-12-20T05:00:00Z'),
  row({from:'2026-12-28',to:'2026-12-28',status:'absent'},'Ravi Kumar',teacherBy,'2026-12-28T05:00:00Z'),
  row({from:'2026-11-02',to:'2026-11-02',status:'absent'},T,teacherBy,'2026-11-02T05:00:00Z')
 ];
 let asked;
 const all=async(table,order,scope)=>{asked={table,order,scope};return stored;};
 const mine=await readDayStatuses({school:S,teacher:T,from:'2027-01-01',to:'2027-01-07'},all);
 assert.equal(asked.table,'success_entries');assert.equal(asked.scope.kind,'eq.day-status');assert.equal(asked.scope.school,'eq.'+S);
 assert.equal(asked.scope.and,'(id.gte.day-status-2026-10-01,id.lte.day-status-2027-01-07-~)');
 assert.deepEqual(mine.map(d=>d.date),['2027-01-01','2027-01-02','2027-01-03','2027-01-04','2027-01-05']);
 const school=await readDayStatuses({school:S,from:'2026-12-28',to:'2026-12-28'},all);
 assert.deepEqual(school.map(d=>d.teacher+' '+d.status),['Asha Verma winter','Ravi Kumar absent']);

 const saved=[],request=async(path,method,body)=>{
  if(method==='POST'){if(saved.some(r=>r.id===body.id))return [];saved.push(body);return [{id:body.id}];}
  const id=new URLSearchParams(path.split('?')[1]).get('id').slice(3);return saved.filter(r=>r.id===id);
 };
 const input={from:'2026-12-01',to:'2026-12-01',status:'absent',note:'Fever',requestId:R};
 assert.deepEqual(await appendDayStatus({school:S,teacher:T,owner:'link-a@school-portal.invalid',by:teacherBy,input},request),{saved:true});
 assert.equal(saved[0].id,'day-status-2026-12-01-2026-12-01-'+teacherTag(S,T)+'-'+R);
 assert.equal(saved[0].kind,'day-status');
 assert.deepEqual(JSON.parse(saved[0].payload),{teacher:T,from:'2026-12-01',to:'2026-12-01',status:'absent',note:'Fever',by:teacherBy});
 assert.deepEqual(await appendDayStatus({school:S,teacher:T,owner:'link-a@school-portal.invalid',by:teacherBy,input},request),{saved:true,alreadySaved:true});
 await assert.rejects(appendDayStatus({school:S,teacher:T,owner:'link-a@school-portal.invalid',by:teacherBy,input:{...input,status:'present',note:''}},request),/already saved differently/);
 await assert.rejects(appendDayStatus({school:S,teacher:T,owner:'o',by:teacherBy,input:{...input,status:'exam'}},request));
 assert.equal(saved.length,1,'nothing overwritten');
});

test('labels for the planner and the week grid', () => {
 assert.equal(statusLabel({status:'half-day',half:'first'}),'Half day · First half');
 assert.equal(statusLabel({status:'exam',exam:'half-yearly'}),'School examination · Half-yearly');
 assert.equal(statusLabel({status:'festival',name:'Diwali'}),'Festival vacation · Diwali');
 assert.equal(statusLabel({status:'winter'},'hi'),'शीतावकाश');
 assert.equal(shortLabel({status:'half-day',half:'second'}),'Half day · 2nd');
 assert.equal(shortLabel({status:'exam',exam:'unit'}),'Exam · Unit test');
 assert.equal(shortLabel({status:'national'}),'National holiday');
 assert.equal(shortLabel({status:'festival',name:'Diwali'}),'Diwali');
 assert.equal(shortLabel({status:'other',name:'Sports day'}),'Sports day');
 assert.equal(statusLabel({status:'other',name:'Sports day'}),'Additional holiday · Sports day');
});

test('route: teachers save only their own day; staff and leaders only for teachers of their schools', () => {
 const src=readFileSync(new URL('../app/api/school-success/day-status/route.js',import.meta.url),'utf8');
 assert.match(src,/a\.role==='school-teacher'[\s\S]*school:a\.school,teacher:a\.name/,'a teacher\'s school and name come from the PIN session, not the request');
 assert.match(src,/assertSchool\(a,school\)/);
 assert.match(src,/schoolTeachers\(school\)\)\.includes\(teacher\)/);
 assert.match(src,/checkOrigin\(req\)/);
 assert.doesNotMatch(src,/owner:a\.email[\s\S]*Response\.json\(\{[^}]*owner/,'sign-ins are not returned');
});
