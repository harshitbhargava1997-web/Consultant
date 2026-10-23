const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export async function activeSchoolError(db,schoolId){
 if(!UUID.test(schoolId||''))return {error:'Select a valid school.',status:400};
 const {data,error}=await db.from('literacy_schools').select('id,archived_at').eq('id',schoolId).maybeSingle();
 if(error)return {error:'Unable to verify school status.',status:503};
 return !data||data.archived_at?{error:'School is deleted or unavailable. Ask Super Admin to restore it.',status:404}:null;
}
export async function changeSchoolStatus(db,actor,schoolId,archived){
 if(!actor.isAdmin)return {error:'Only the Platform Super Admin may delete or restore schools.',status:403};
 if(!UUID.test(schoolId||''))return {error:'Select a valid school.',status:400};
 const {data,error}=await db.from('literacy_schools').update({archived_at:archived?new Date().toISOString():null,archived_by:archived?actor.user.id:null}).eq('id',schoolId).select('id,name,archived_at').maybeSingle();
 if(error)return {error:'School status could not be updated.',status:503};
 return data?{school:data,message:archived?'School deleted from active workspaces. Historical records are retained.':'School restored with its existing records.'}:{error:'School not found.',status:404};
}
