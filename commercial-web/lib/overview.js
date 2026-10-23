// Use an authenticated, RLS-scoped client. No privileged rows are sent to the browser.
async function count(query){const {count,error}=await query;if(error||!Number.isInteger(count))throw Error('Overview counts unavailable');return count;}
async function uniqueIds(makeQuery,key){
 const ids=new Set();
 for(let offset=0;;offset+=500){
  const {data,error}=await makeQuery().range(offset,offset+499);
  if(error)throw Error('Overview counts unavailable');
  for(const row of data||[])if(row[key])ids.add(row[key]);
  if(!data||data.length<500)return ids.size;
 }
}
export async function loadOverviewTotals(db,{isAdmin,schoolIds=[]}){
 if(!isAdmin&&!schoolIds.length)return {schools:0,teachers:0,students:0,consultants:0};
 const scope=query=>isAdmin?query:query.in('school_id',schoolIds);
 const teachers=()=>scope(db.from('literacy_memberships').select('user_id,literacy_schools!inner(id)').eq('role','teacher').is('literacy_schools.archived_at',null)).order('user_id').order('school_id');
 let students=db.from('literacy_students').select('id,literacy_classes!inner(literacy_schools!inner(id))',{count:'exact',head:true}).eq('active',true).is('literacy_classes.literacy_schools.archived_at',null);
 if(!isAdmin)students=students.in('literacy_classes.school_id',schoolIds);
 const [schools,teacherCount,studentCount,consultants]=await Promise.all([
  count(isAdmin?db.from('literacy_schools').select('id',{count:'exact',head:true}).is('archived_at',null):db.from('literacy_schools').select('id',{count:'exact',head:true}).is('archived_at',null).in('id',schoolIds)),
  uniqueIds(teachers,'user_id'),count(students),
  isAdmin?count(db.from('literacy_consultants').select('user_id',{count:'exact',head:true})):uniqueIds(()=>scope(db.from('literacy_consultant_assignments').select('consultant_user_id,literacy_schools!inner(id)').is('literacy_schools.archived_at',null)).order('consultant_user_id').order('school_id'),'consultant_user_id')
 ]);
 return {schools,teachers:teacherCount,students:studentCount,consultants};
}
