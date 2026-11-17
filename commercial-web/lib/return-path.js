// Where to return after Vision sign-in. Only same-origin paths on an explicit allowlist are accepted,
// so a crafted ?next= cannot send users to another site or an arbitrary page.
const ALLOWED_PATHS=['/school-success'];
export function safeReturnPath(value,origin){
 try{
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||value.includes('\\'))return '';
  const url=new URL(value,origin);
  return url.origin===origin&&ALLOWED_PATHS.includes(url.pathname)?url.pathname+url.search:'';
 }catch{return '';}
}
