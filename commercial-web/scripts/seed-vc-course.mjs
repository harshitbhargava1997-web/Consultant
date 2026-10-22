// Generate idempotent content SQL. Review and run through the authorised database connection.
import {VC_UNITS,vcCombinations} from '../lib/vcCourse.js';
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const rows=[];
for(const u of VC_UNITS){
 const base={grade:'LKG',summary:`VC Blending Course · Unit ${u.number} · Short ${u.vowel.toUpperCase()}. Teacher preparation, interactive grid, worksheets and review open inside Vision.`,objective:`Recall short ${u.vowel} as in ${u.anchor}; join vowel then consonant; independently read ${u.core.join(', ')} and retain the skill in a later session.`,preparation:`Check ${u.vowel} and all consonants in the selected examples first. Prepare letter cards, two counters and a cover card. Use the screen or printed sheets. Letter-card building is accepted; handwriting depends on readiness.`,check_understanding:'Observe sound recall, blending, independent reading and encoding separately. Emerging: sounds or sound order insecure. Developing: joins with a cue or inconsistently. Proficient for this unit: reads core combinations independently in mixed order and retains the skill after a gap. Record not-observed separately. Use the assessment module for official teacher and student records.',resource_url:''};
 const teaching=`Phase 1: recall sounds in mixed order. Phase 2: model ${u.core[0][0]} + ${u.core[0][1]} → ${u.core[0]}, then practise together and check one learner alone. Phase 3: remove action and pointing prompts and recheck later. Model clean sounds without an added uh. The teacher supplies phoneme models. ${u.note}`;
 const practice=`Core: ${u.core.join(', ')}. Grid: ${vcCombinations(u).map(w=>`${w} (${u.words.includes(w)?'word':'practice chunk'})`).join('; ')}. ${u.meaning} Optional CVC transfer after VC is secure: ${u.bridge}. Revisit each individual sound; the VC chunk is not one phoneme.`;
 const worksheets=`Sheet 1: hear and find. Dictate short ${u.vowel}, /m/, /n/, /t/ in order; learner chooses the matching symbol. Sheet 2: touch, join and read ${u.core.join(', ')}, then ${[...u.core].reverse().join(', ')} without dots. Sheet 3 A: read ${[u.core[1],u.core[2],u.core[0]].join(', ')}. B: dictate ${u.core.join(', ')} for selection. C: dictate ${[...u.core].reverse().join(', ')} for building. Accept oral responses, pointing and letter cards. Record writing separately.`;
 for(const [suffix,type,demonstration,activity,offset] of [
  ['Teacher Lesson','lesson_plan',teaching,practice,1],
  ['Printable Worksheets','worksheet',worksheets,practice,2],
  ['Teacher Readiness and Review','activity','Before teaching, check the teacher models accurate clean sounds, joins left to right, explains word versus chunk, checks individual responses and separates reading from writing evidence.','Practice checklist: recall vowel and consonants; read each core combination; build dictated combinations; retain the skill in a later session. Choose Independent, With help, Not yet or Not observed. Revisit the smallest gap.',3]
 ]) rows.push({...base,title:`VC Unit ${u.number} — Short ${u.vowel.toUpperCase()} — ${suffix}`,content_type:type,demonstration,practice:activity,sequence:200+u.number*10+offset});
}
const fields=Object.keys(rows[0]);
console.log(`begin;
create temporary table vc_content_seed on commit drop as
select * from jsonb_to_recordset(${q(JSON.stringify(rows))}::jsonb) as r(${fields.map(f=>f+' '+(f==='sequence'?'integer':'text')).join(',')});
update public.literacy_digital_content d set
${fields.filter(f=>f!=='title'&&f!=='grade').map(f=>f+'=s.'+f).join(',')},
competency_id=(select id from literacy_competencies where grade='LKG' and title='VC blending' limit 1),updated_at=now()
from vc_content_seed s where d.title=s.title and d.grade=s.grade;
insert into public.literacy_digital_content (${fields.join(',')},competency_id,target_roles,status,created_by,published_at)
select ${fields.map(f=>'s.'+f).join(',')},
(select id from literacy_competencies where grade='LKG' and title='VC blending' limit 1),
array['consultant','owner','principal','coordinator','teacher']::text[],'published',
(select user_id from literacy_platform_admins order by user_id limit 1),now()
from vc_content_seed s where not exists(select 1 from literacy_digital_content d where d.title=s.title and d.grade=s.grade);
commit;
select title,status,sequence,resource_url from literacy_digital_content where title like 'VC Unit %' and grade='LKG' order by sequence;`);
