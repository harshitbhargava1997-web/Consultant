export const from='2026-10-22',to='2026-10-24';
const file=(column,name)=>({column,key:column+':'+name,url:'https://media.example.test/'+name});
const common={kind:'submission',school:'Alpha School',teacher:'Asha',recordId:'lesson-1',grade:'LKG',section:'A',subject:'English',topic:'Blending practice',plannedDate:'2026-10-23',reflection:'Children will blend the first sounds independently.',materials:'Picture cards and letter tiles',review:'',version:null};
export function school360Fixture(){return {actor:{role:'admin',isSuperAdmin:true},period:{from,to},calendars:{'Alpha School':['2026-10-23']},
 roster:[{school:'Alpha School',name:'Asha'},{school:'Alpha School',name:'Bina'},{school:'Beta School',name:'Asha'},{school:'Beta School',name:'Devi'}],
 entries:[
  {kind:'school',school:'Alpha School',name:'Alpha School'},{kind:'school',school:'Beta School',name:'Beta School'},{kind:'school',school:'Empty School',name:'Empty School'},
  {id:'u1',kind:'usage',school:'Alpha School',teacher:'Asha',date:from,module:'Lesson Plan',minutes:30},
  {id:'u2',kind:'usage',school:'Alpha School',teacher:'Asha',date:from,module:'Content / Book',minutes:90,topic:'Plants'},
  {id:'u3',kind:'usage',school:'Alpha School',teacher:'Asha',date:from,module:'E-book',minutes:20},
  {id:'u4',kind:'usage',school:'Alpha School',teacher:'Asha',date:from,module:'Additional Materials',minutes:15},
  {id:'u5',kind:'usage',school:'Beta School',teacher:'Asha',date:to,module:'Content / Book',minutes:12},
  {...common,id:'lesson-1:preparation',date:from,stage:'preparation_saved',feedStage:'Lesson preparation',files:[file('Lesson_Plan_Picture','plan.pdf'),file('Voice_Note_Link','voice.wav')]},
  {...common,id:'lesson-1:update-1',date:'2026-10-23',stage:'evidence_submitted',feedStage:'Classroom evidence',files:[file('Video_Evidence_1','activity.jpg'),file('Writing_Sample_Link','writing.pdf')]},
  {...common,id:'lesson-1:update-2',date:to,stage:'evidence_submitted',feedStage:'Classroom evidence',files:[file('Video_Evidence_1','activity.jpg'),file('Phonics_Evidence_Link','phonics.mp4')]},
  {id:'observation',kind:'observation',school:'Alpha School',teacher:'Asha',date:from,subject:'English',strengths:'Observation marker',improvements:'Model blending',actions:'Follow up next week'},
  {...common,id:'outside',recordId:'outside',date:'2026-10-20',files:[file('Video_Evidence_1','outside.jpg')]}
 ],archivedRoster:[{school:'Archived School',name:'Old teacher'},{school:'Alpha School',name:'Former teacher'}],
 archivedEntries:[{kind:'school',school:'Archived School',name:'Archived School'},{id:'old',kind:'usage',school:'Archived School',teacher:'Old teacher',date:from,module:'Content / Book',minutes:100}],
 directory:{archives:[{kind:'school',school:'Archived School',archived:true},{kind:'teacher',school:'Alpha School',teacher:'Former teacher',archived:true}]}};}
