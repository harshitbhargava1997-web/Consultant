// A saved "continue this lesson" link from this browser: on the full school link (/school-success?…) or on a
// short school link (/sunrise-public-school-4821?…), same site only.
import {SHORT_ID} from './short-link-id.js';
export function savedLessonUrl(url,origin){
 try{const u=new URL(url);return u.origin===origin&&!!u.search&&(u.pathname==='/school-success'||SHORT_ID.test(u.pathname.slice(1)));}catch{return false;}
}
