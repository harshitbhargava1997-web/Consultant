// "How to use" video for teachers (owner request, 25 November 2026). Super Admin sets an unlisted YouTube link;
// teachers watch it after signing in with their PIN, and their viewing is recorded for Super Admin.
// Stored in the School Success settings table (success_config), like teacher PINs:
//   onboardingVideo                                  → {videoId, url, setAt, setBy}
//   videoProgress:<sha256(school \0 teacher)>        → {v, school, teacher, videoId, firstOpenedAt, lastSeenAt,
//                                                       maxPercent, watchSeconds, completedAt}
import {createHash} from 'node:crypto';
export const VIDEO_KEY='onboardingVideo';
export const progressKey=(school,teacher)=>'videoProgress:'+createHash('sha256').update(school+'\0'+teacher).digest('hex');
export const COMPLETE_PERCENT=95;
// The 11-character video ID from any usual YouTube link (watch, youtu.be, shorts, embed) or the bare ID.
export function parseYouTubeId(input){
 const s=String(input||'').trim();
 if(/^[\w-]{11}$/.test(s))return s;
 let u;try{u=new URL(s);}catch{return '';}
 const host=u.hostname.replace(/^www\.|^m\./,'');
 let id='';
 if(host==='youtu.be')id=u.pathname.slice(1).split('/')[0];
 else if(['youtube.com','youtube-nocookie.com','music.youtube.com'].includes(host)){
  if(u.pathname==='/watch')id=u.searchParams.get('v')||'';
  else{const m=u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);id=m?m[1]:'';}
 }
 return /^[\w-]{11}$/.test(id)?id:'';
}
// One viewing update from the teacher's player. Watch time grows by the seconds actually played since the last
// update (capped, so a wrong clock cannot inflate it); the percentage only goes up; finishing is recorded once.
export function mergeProgress(prev,{school,teacher,videoId,event,percent=0,played=0},now=new Date().toISOString()){
 const base=prev&&prev.videoId===videoId?prev:{v:1,school,teacher,videoId,firstOpenedAt:now,maxPercent:0,watchSeconds:0,completedAt:null};
 const pct=Math.max(0,Math.min(100,Number(percent)||0)),add=Math.max(0,Math.min(120,Number(played)||0));
 const maxPercent=Math.max(base.maxPercent||0,event==='ended'?100:pct);
 return {...base,school,teacher,lastSeenAt:now,maxPercent:Math.round(maxPercent),watchSeconds:Math.round((base.watchSeconds||0)+add),
  completedAt:base.completedAt||(maxPercent>=COMPLETE_PERCENT?now:null)};
}
export const watched=p=>Boolean(p?.completedAt);
