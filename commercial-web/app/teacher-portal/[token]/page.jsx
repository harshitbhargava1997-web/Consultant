import TeacherPortalWorkspace from '@/app/TeacherPortalWorkspace';
export const metadata={title:'Vision | Teacher lesson preparation',referrer:'no-referrer'};
export default async function PublicTeacherPortal({params}){const {token}=await params;return <main className="vision-teacher-public"><header>VISION · Teacher Portal</header><TeacherPortalWorkspace publicToken={token}/></main>;}
