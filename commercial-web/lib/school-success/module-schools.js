import {service,checked} from './database';
// Every school known to the School Success directory (roster, members, school entries and archived schools).
export async function moduleSchools(){
 const db=service();
 const [roster,members,local,archives]=await Promise.all([
  checked(db.rpc('school_success_roster')),
  checked(db.from('success_members').select('school')),
  checked(db.from('success_entries').select('school').eq('kind','school')),
  checked(db.from('success_config').select('value').like('key','directoryArchive:%'))
 ]);
 return [...new Set([...roster,...members,...local,...archives.map(r=>JSON.parse(r.value))].map(r=>r.school).filter(Boolean))].sort();
}
