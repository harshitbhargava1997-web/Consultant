// Short school link: schoolsuccess.in/<school-name>-<code> opens that school's teacher page (owner decision,
// 25 November 2026). Anything else at this level is "not found", as before.
import {notFound} from 'next/navigation';
import Portal from '../school-success/ui/portal';
import {service} from '@/lib/school-success/database';
import {configStore} from '@/lib/school-success/teacher-pin';
import {isShortId,resolveShortLink} from '@/lib/school-success/short-link';
import '../school-success/success.css';
export const dynamic='force-dynamic';
export const metadata={title:'School Success · Teacher portal',robots:{index:false,follow:false}};
export default async function ShortSchoolLink({params}){
 const {code}=await params;
 const id=String(code||'').toLowerCase();
 if(!isShortId(id))notFound();
 const link=await resolveShortLink(configStore(service()),id).catch(()=>null);
 if(!link)notFound();
 return <div className="success-app"><Portal shortLink={link}/></div>;
}
