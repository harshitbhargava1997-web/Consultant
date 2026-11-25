'use client';
// The page address as School Success reads it. On a short school link (schoolsuccess.in/sunrise-4821) the address
// bar stays short; the page is given the school link behind it, and this adds it as if it were in the address.
let shortLink=null;
export function setShortLink(link){if(link&&typeof link.access==='string')shortLink={access:link.access,school:link.school||''};}
export function linkParams(){
 let p;try{p=new URLSearchParams(location.search);}catch{p=new URLSearchParams();}
 if(shortLink&&!p.has('access')){p.set('access',shortLink.access);if(!p.has('school'))p.set('school',shortLink.school);if(!p.has('view'))p.set('view','teacher');}
 return p;
}
