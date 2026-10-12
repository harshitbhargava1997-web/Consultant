export const PERMISSION_ROLES=["consultant","owner","principal","coordinator","teacher"];
export const PERMISSION_GROUPS=[
 {title:"School & accounts",items:[
  {key:"schools.view",label:"View school directory",description:"View schools already assigned; never grants access to another school"},
  {key:"users.manage",label:"Manage school users",description:"Create and assign staff, scoped to authorized schools"},
  {key:"consultants.manage",label:"Manage consultant assignments",description:"Assign or remove consultants within authorized schools"}
 ]},
 {title:"Student & class operations",items:[
  {key:"classes.view",label:"View classes and student rosters",description:"Teacher access remains limited to assigned classes"},
  {key:"classes.manage",label:"Create classes",description:"Create classes in authorized schools"},
  {key:"classes.import",label:"Bulk upload classes",description:"Import grade, section and academic-year records from an Excel sheet"},
  {key:"students.manage",label:"Add or remove individual students",description:"Removal keeps assessment history"},
  {key:"teachers.assign",label:"Assign teachers to classes",description:"Manage class assignments"},
  {key:"staff.import",label:"Bulk upload stakeholder accounts",description:"Does not grant rights to export account data"},
  {key:"students.import",label:"Bulk upload student rosters",description:"Teachers can import only into assigned classes"},
  {key:"data.export",label:"Export student and stakeholder records",description:"Sensitive: includes downloaded existing school data"}
 ]},
 {title:"Assessments & learning",items:[
  {key:"assessments.view",label:"View assessment history",description:"Within accessible classes"},
  {key:"assessments.create",label:"Conduct literacy assessments",description:"Within accessible classes"},
  {key:"teacher_reviews.create",label:"Assess teacher competencies",description:"Within authorized school classes"},
  {key:"reports.view",label:"View progress reports",description:"Individual student learning trends"},
  {key:"competencies.view",label:"View published competency library",description:"Read-only competency visibility"},
  {key:"competencies.edit",label:"Edit shared competencies",description:"High impact: changes the shared curriculum across all schools"}
 ]},
 {title:"Teacher training & certification",items:[
  {key:"training.access",label:"Access published training modules",description:"View assigned courses, PDFs, videos, MOOCs and learning activities"},
  {key:"training.complete",label:"Complete courses and submit exercises",description:"Record own learning and quiz scores; cannot mark other users complete"},
  {key:"training.certificates",label:"Earn and view course certificates",description:"Certificates are issued only after the required units and exercises are completed"},
  {key:"training.deliver",label:"Deliver teacher training sessions",description:"Record school-based teacher training, observations and follow-up actions"},
  {key:"training.review",label:"Review school staff training progress",description:"View school-assigned teachers' course progress without exporting data"}
 ]},
 {title:"Implementation & school support",items:[
  {key:"consultants.support",label:"View school support and training history",description:"School-level monitoring"},
  {key:"consultants.log",label:"Log school support and training",description:"Consultant-role activity logging"},
  {key:"implementation.view",label:"View teacher implementation module",description:"Module is still being developed"},
  {key:"observations.view",label:"View classroom observations module",description:"Module is still being developed"}
 ]}
];
export const PERMISSION_KEYS=PERMISSION_GROUPS.flatMap(g=>g.items.map(x=>x.key));
export const ALL_PERMISSION_ENTRIES=PERMISSION_GROUPS.flatMap(g=>g.items);
export function allowed(grants,key,isAdmin=false){return isAdmin||grants?.includes(key);}
