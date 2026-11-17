// Where to return after Vision sign-in. Only same-origin paths on an explicit allowlist are accepted,
// so a crafted ?next= cannot send users to another site or an arbitrary page.
const ALLOWED_PATHS=['/school-success']; // plus /school-success/report/<snapshot id>
export function safeReturnPath(value,origin){
 try{
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||value.includes('\\'))return '';
  const url=new URL(value,origin);
  const allowed=ALLOWED_PATHS.includes(url.pathname)||/^\/school-success\/report\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(url.pathname);
  return url.origin===origin&&allowed?url.pathname+url.search:'';
 }catch{return '';}
}
