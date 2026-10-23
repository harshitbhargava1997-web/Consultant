// Tenant scope is applied to the database request, before any rows are downloaded.
const quoted=value=>'"'+String(value).replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
export function readScope(a,records=false){
 if(!a.allowedSchools)return {};
 if(!a.allowedSchools.length)throw Error('403:No assigned schools');
 const list='('+a.allowedSchools.map(quoted).join(',')+')';
 if(!records)return {school:'in.'+list};
 // URLSearchParams encodes scalar equality values. Quotes belong inside IN lists,
 // while adding them to an eq value would make them part of the teacher name.
 if(a.role!=='admin')return {Center:'eq.'+a.school,FullName:'eq.'+a.name,Uploaded_By:'eq.'+a.email};
 // Keep the original Center -> Institution fallback for older usage imports.
 return {and:'(or(Center.in.'+list+',and(Center.is.null,Institution.in.'+list+'),and(Center.eq."",Institution.in.'+list+')))'};
}

export function recordQuery(from,to,a){
 const start=from+'T00:00:00',end=to+'T23:59:59.999999';
 const eventStart=new Date(from+'T00:00:00+05:30').toISOString().replace('Z',''),eventEnd=new Date(to+'T23:59:59.999+05:30').toISOString().replace('Z','');
 return {or:'(and(StartTime.gte.'+start+',StartTime.lte.'+end+'),and(preparation_saved_at.gte.'+eventStart+',preparation_saved_at.lte.'+eventEnd+'),and(planned_lesson_on.lte.'+to+',evidence_submitted_at.gte.'+eventStart+'))',...readScope(a,true)};
}

export async function readAllPages(readPage,{pageSize=1000,maxRows=100000,concurrency=4}={}){
 const first=await readPage(0,true),result=[...first.rows];
 if(first.count!==null&&first.count>maxRows)throw Error('Too many records; narrow the date range');
 if(first.rows.length<pageSize)return result;
 for(let offset=pageSize;offset<maxRows;offset+=pageSize*concurrency){
  if(first.count!==null&&offset>=first.count)break;
  const offsets=Array.from({length:concurrency},(_,i)=>offset+i*pageSize).filter(n=>n<maxRows&&(first.count===null||n<first.count));
  const pages=await Promise.all(offsets.map(n=>readPage(n,false)));
  for(const page of pages){result.push(...page.rows);if(page.rows.length<pageSize)return result;}
 }
 if(first.count===null&&result.length===maxRows)throw Error('Too many records; narrow the date range');
 return result;
}
