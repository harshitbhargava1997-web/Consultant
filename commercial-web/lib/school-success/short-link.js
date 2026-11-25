// Short school links (owner decision, 25 November 2026): schoolsuccess.in/<school-name>-<4-digit code> opens the
// same teacher page as the full school link. Each school gets its own auto-generated code, different from every
// other school's. The full link keeps working. Stored in the School Success settings table (success_config):
//   shortLink:<id>          → {access, school, createdAt}      id = "<slug>-<code>", e.g. "sunrise-public-school-4821"
//   shortLinkFor:<access>   → {id}                             one short link per school link
//   shortCode:<code>        → {id}                             keeps every school's code different
import {randomInt} from 'node:crypto';
import {SHORT_ID,isShortId} from './short-link-id.js';
export {SHORT_ID,isShortId};
const SLUG_MAX=34;
// "St. Mary's Sr. Sec. School, Jaipur" → "st-marys-sr-sec-school-jaipur" (cut at a word, at most 34 characters).
export function shortSlug(school){
 const words=String(school||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/['’]/g,'').split(/[^a-z0-9]+/).filter(Boolean);
 let slug='';
 for(const w of words){const next=slug?slug+'-'+w:w;if(next.length>SLUG_MAX){if(!slug)slug=w.slice(0,SLUG_MAX);break;}slug=next;}
 return slug||'school';
}
export const shortUrl=(origin,id)=>new URL('/'+id,origin).href;
// The school's short link ID, created once. `code` is injectable for tests.
export async function ensureShortLink(store,{access,school},{code=()=>randomInt(1000,10000),now=()=>new Date().toISOString()}={}){
 const existing=(await store.get('shortLinkFor:'+access))?.value?.id;
 if(isShortId(existing))return existing;
 const slug=shortSlug(school);
 for(let attempt=0;attempt<40;attempt++){
  const c=String(code()),id=slug+'-'+c;
  if(!isShortId(id))continue;
  if(!(await store.put('shortCode:'+c,{id},null)))continue;          // code already used by another school
  await store.put('shortLink:'+id,{access,school,createdAt:now()},null);
  if(await store.put('shortLinkFor:'+access,{id},null))return id;
  return (await store.get('shortLinkFor:'+access))?.value?.id||id;   // another administrator created it at the same moment
 }
 throw Error('503:Could not create a short link. Please try again.');
}
// The full school link behind a short link ID, or null.
export async function resolveShortLink(store,id){
 if(!isShortId(id))return null;
 const v=(await store.get('shortLink:'+id))?.value;
 return v&&typeof v.access==='string'&&/^[a-f0-9-]{36}$/i.test(v.access)?{access:v.access,school:String(v.school||'')}:null;
}
