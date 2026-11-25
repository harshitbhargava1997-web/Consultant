import {withRequest,actor,checkOrigin,failure,assertSchool,schoolTeachers} from '@/lib/school-success/server';
import {service,checked} from '@/lib/school-success/database';
import {configStore} from '@/lib/school-success/teacher-pin';
import {VIDEO_KEY,progressKey,parseYouTubeId,mergeProgress,watched} from '@/lib/school-success/onboarding-video';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
// Teachers' "How to use" video (owner request, 25 November 2026).
//   get       {}               → the video (if set) and, for a signed-in teacher, whether they have watched it
//   progress  {event, percent, played} → a signed-in teacher's own viewing update (open / progress / ended / error)
//   setVideo  {url}            → Super Admin sets (or clears with '') the unlisted YouTube link
//   report    {school}         → Super Admin: every teacher of the school with their viewing record
async function handlePOST(req){
 try{
  checkOrigin(req);
  const a=await actor(req);
  let body;try{body=await req.json();}catch{throw Error('Invalid request');}
  const store=configStore(service());
  const video=(await store.get(VIDEO_KEY))?.value||null;
  if(body.action==='get'){
   const out={videoId:video?.videoId||''};
   if(a.role==='school-teacher'&&a.name&&out.videoId){const p=(await store.get(progressKey(a.school,a.name)))?.value;out.watched=watched(p)&&p.videoId===out.videoId;}
   if(a.isSuperAdmin)out.url=video?.url||'';
   return Response.json(out,{headers:noStore});
  }
  if(body.action==='progress'){
   if(a.role!=='school-teacher'||!a.name)throw Error('403:Only the signed-in teacher can record their viewing');
   if(!video?.videoId)return Response.json({ok:true,watched:false},{headers:noStore});
   if(!['open','progress','ended','error'].includes(body.event))throw Error('Invalid viewing update');
   const key=progressKey(a.school,a.name);
   for(let attempt=0;attempt<4;attempt++){
    const saved=await store.get(key);
    const next=mergeProgress(saved?.value,{school:a.school,teacher:a.name,videoId:video.videoId,event:body.event,percent:body.percent,played:body.played});
    if(await store.put(key,next,saved?saved.revision:null))return Response.json({ok:true,watched:watched(next)},{headers:noStore});
   }
   throw Error('409:Please try again.');
  }
  if(!a.isSuperAdmin)throw Error('403:Only Super Admin can manage the teacher video');
  if(body.action==='setVideo'){
   const url=String(body.url||'').trim();
   if(!url){const saved=await store.get(VIDEO_KEY);if(saved)await store.put(VIDEO_KEY,{videoId:'',url:'',setAt:new Date().toISOString(),setBy:a.email},saved.revision);return Response.json({ok:true,videoId:''},{headers:noStore});}
   const videoId=parseYouTubeId(url);
   if(!videoId)throw Error('Paste a YouTube link, for example https://youtu.be/… or https://www.youtube.com/watch?v=…');
   const saved=await store.get(VIDEO_KEY),value={videoId,url,setAt:new Date().toISOString(),setBy:a.email};
   if(!(await store.put(VIDEO_KEY,value,saved?saved.revision:null)))throw Error('409:The video was just changed. Refresh and try again.');
   return Response.json({ok:true,videoId},{headers:noStore});
  }
  if(body.action==='report'){
   const school=typeof body.school==='string'?body.school:'';assertSchool(a,school);
   const teachers=await schoolTeachers(school),keys=teachers.map(t=>progressKey(school,t));
   const rows=keys.length?await checked(service().from('success_config').select('key,value').in('key',keys)):[];
   const byKey=new Map(rows.map(r=>{try{return [r.key,JSON.parse(r.value)];}catch{return [r.key,null];}}));
   const list=teachers.map((teacher,i)=>{const p=byKey.get(keys[i]);const current=p&&p.videoId===video?.videoId;
    return {teacher,status:!p||!current?'Not opened':watched(p)?'Watched':'Started',maxPercent:current?p.maxPercent:0,watchSeconds:current?p.watchSeconds:0,firstOpenedAt:current?p.firstOpenedAt:null,lastSeenAt:current?p.lastSeenAt:null,completedAt:current?p.completedAt:null};});
   return Response.json({school,videoId:video?.videoId||'',teachers:list},{headers:noStore});
  }
  throw Error('Unsupported request');
 }catch(e){return failure(e);}
}
export async function POST(req){return withRequest(req,()=>handlePOST(req));}
