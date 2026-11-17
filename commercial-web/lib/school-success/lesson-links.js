// Durable links from Teacher 360° usage PDFs to the matching lesson documentation.
//
// A link only pre-fills the lesson-documentation filters. It carries no token or credential and
// grants nothing: the page loads data through the authenticated /api/school-success/portal read,
// which applies each user's School Success module grant on the server. A school outside that
// grant simply returns no records and the page says the documentation is unavailable.
export const LESSON_DOCS_VIEW='lesson-docs';
const MAX_TEXT=200,MAX_DAYS=100;
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;

export function lessonDocumentationUrl(origin,{school,teacher,grade='',section='',subject='',from,to,includeArchived=false}){
 const url=new URL('/school-success',origin);
 url.search=new URLSearchParams({view:LESSON_DOCS_VIEW,docSchool:school,docTeacher:teacher,docClass:grade,docSection:section,docSubject:subject,from,to,...(includeArchived?{docArchived:'1'}:{})}).toString();
 return url.href;
}

// Returns validated filters, or null when the link is not a well-formed lesson-documentation link.
export function parseLessonDocumentationLink(search){
 const p=new URLSearchParams(search);
 if(p.get('view')!==LESSON_DOCS_VIEW)return null;
 // Any over-long value invalidates the link; it never falls back to a wider filter.
 if(['docSchool','docTeacher','docClass','docSection','docSubject'].some(key=>(p.get(key)||'').length>MAX_TEXT))return null;
 const school=p.get('docSchool'),teacher=p.get('docTeacher'),grade=p.get('docClass')??'',section=p.get('docSection')??'',subject=p.get('docSubject')??'',from=p.get('from'),to=p.get('to');
 if(!school||!teacher||!validDay(from)||!validDay(to)||from>to)return null;
 if((Date.parse(to)-Date.parse(from))/86400000>MAX_DAYS-1)return null;
 return {school,teacher,grade,section,subject,from,to,includeArchived:p.get('docArchived')==='1'};
}

export {safeReturnPath} from '../return-path.js';
