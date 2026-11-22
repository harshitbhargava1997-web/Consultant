// Teacher PINs for School Success school links (server only).
//
// A school link plus a teacher's own 6-digit PIN opens that teacher's portal. PINs are stored only as salted
// scrypt hashes in the School Success settings table (success_config), one record per school + teacher:
//   teacherPin:<sha256(school \0 teacher)>  → {v, version, status:'active'|'reset', hash, salt, failed, lockedUntil, updatedAt, updatedBy}
// No record (or status 'reset') means the teacher signs in with the default PIN and must then create their own.
// `version` increases on every PIN change or reset; sessions carry it, so a change signs out every device.
// The default PIN is 123456 unless an administrator sets a school default (stored hashed).
import {createHash,scrypt,randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';

export const DEFAULT_PIN='123456';
export const LOCK_ATTEMPTS=5,LOCK_MS=15*60*1000,SESSION_MS=30*86400000,CHANGE_TICKET_MS=10*60*1000;
const sha=s=>createHash('sha256').update(s).digest('hex');
export const pinKey=(school,teacher)=>'teacherPin:'+sha(school+'\0'+teacher);
export const defaultKey=school=>'teacherPinDefault:'+sha(school);
export const linkHash=access=>sha('school-link\0'+access);

export function pinProblem(pin){
 if(typeof pin!=='string'||!/^\d{6}$/.test(pin))return 'Use exactly 6 digits.';
 if(pin===DEFAULT_PIN||/^(\d)\1{5}$/.test(pin)||'01234567890'.includes(pin)||'09876543210'.includes(pin))return 'Choose a PIN that is harder to guess.';
 return '';
}
const derive=(pin,salt)=>new Promise((resolve,reject)=>scrypt(pin,Buffer.from(salt,'hex'),32,{N:16384,r:8,p:1},(e,key)=>e?reject(e):resolve(key)));
export async function hashPin(pin){const salt=randomBytes(16).toString('hex');return {salt,hash:(await derive(pin,salt)).toString('hex')};}
export async function verifyPin(pin,stored){
 if(typeof pin!=='string'||!/^\d{6}$/.test(pin)||!stored?.hash||!stored?.salt)return false;
 const key=await derive(pin,stored.salt),want=Buffer.from(stored.hash,'hex');
 return want.length===key.length&&timingSafeEqual(key,want);
}

// success_config as a small compare-and-set store. put(key,value,null) inserts only if absent.
export function configStore(db){
 return {
  async get(key){const {data,error}=await db.from('success_config').select('value,revision').eq('key',key).maybeSingle();if(error)throw Error('503:PIN storage is unavailable. Try again.');return data?{value:JSON.parse(data.value),revision:data.revision}:null;},
  async put(key,value,revision){
   const next=randomUUID(),row={value:JSON.stringify(value),revision:next};
   const q=revision===null?db.from('success_config').upsert({key,...row},{onConflict:'key',ignoreDuplicates:true}).select('key'):db.from('success_config').update(row).eq('key',key).eq('revision',revision).select('key');
   const {data,error}=await q;if(error)throw Error('503:PIN storage is unavailable. Try again.');return Boolean(data?.length);
  }
 };
}

export async function readPin(store,school,teacher){const saved=await store.get(pinKey(school,teacher));return {record:saved?.value||null,revision:saved?saved.revision:null};}
export function pinStatus(record,now=Date.now()){
 if(record?.lockedUntil&&Date.parse(record.lockedUntil)>now)return 'locked';
 return record?.status==='active'?'active':'default';
}
async function defaultPinMatches(store,school,pin){const saved=await store.get(defaultKey(school));return saved?.value?.hash?verifyPin(pin,saved.value):pin===DEFAULT_PIN;}

// Checks a PIN. Wrong attempts are counted; the fifth locks the teacher for 15 minutes.
// Returns {mustChange, version}. Throws 401 (wrong PIN) or 429 (locked).
export async function checkPin({store,school,teacher,pin,now=Date.now()}){
 for(let attempt=0;attempt<3;attempt++){
  const {record,revision}=await readPin(store,school,teacher);
  if(pinStatus(record,now)==='locked')throw Error('429:Too many wrong PINs. Try again after '+Math.ceil((Date.parse(record.lockedUntil)-now)/60000)+' minutes, or ask your school administrator to reset your PIN.');
  const active=record?.status==='active';
  const ok=active?await verifyPin(pin,record):await defaultPinMatches(store,school,pin);
  const version=record?.version||0;
  if(ok){
   if(record?.failed||record?.lockedUntil){if(!await store.put(pinKey(school,teacher),{...record,failed:0,lockedUntil:null},revision))continue;}
   return {mustChange:!active,version};
  }
  const failed=(record?.failed||0)+1,lock=failed>=LOCK_ATTEMPTS;
  const next={v:1,version,status:record?.status||'reset',hash:record?.hash||null,salt:record?.salt||null,...record,failed:lock?0:failed,lockedUntil:lock?new Date(now+LOCK_MS).toISOString():null};
  if(!await store.put(pinKey(school,teacher),next,revision))continue;
  if(lock)throw Error('429:Too many wrong PINs. Try again after 15 minutes, or ask your school administrator to reset your PIN.');
  throw Error('401:That PIN is not correct. '+(LOCK_ATTEMPTS-failed)+' '+(LOCK_ATTEMPTS-failed===1?'try':'tries')+' left.');
 }
 throw Error('409:Please try again.');
}

// Saves a new PIN when the stored version still equals `version` (nothing changed meanwhile). Returns the new version.
export async function setPin({store,school,teacher,pin,version,by,now=Date.now()}){
 const problem=pinProblem(pin);if(problem)throw Error(problem);
 if(await defaultPinMatches(store,school,pin))throw Error('Choose a PIN different from the default PIN.');
 const {record,revision}=await readPin(store,school,teacher);
 if((record?.version||0)!==version)throw Error('409:Your PIN was changed or reset meanwhile. Sign in again.');
 const next={v:1,version:version+1,status:'active',...await hashPin(pin),failed:0,lockedUntil:null,updatedAt:new Date(now).toISOString(),updatedBy:by};
 if(!await store.put(pinKey(school,teacher),next,revision))throw Error('409:Your PIN was changed meanwhile. Sign in again.');
 return next.version;
}
// Administrator reset ("forgot PIN"): back to the default PIN, must create a new one; signs out every device.
export async function resetPin({store,school,teacher,by,now=Date.now()}){
 for(let attempt=0;attempt<3;attempt++){
  const {record,revision}=await readPin(store,school,teacher);
  const next={v:1,version:(record?.version||0)+1,status:'reset',hash:null,salt:null,failed:0,lockedUntil:null,updatedAt:new Date(now).toISOString(),updatedBy:by};
  if(await store.put(pinKey(school,teacher),next,revision))return next.version;
 }
 throw Error('409:Please try again.');
}
export async function setDefaultPin({store,school,pin,by,now=Date.now()}){
 if(typeof pin!=='string'||!/^\d{6}$/.test(pin))throw Error('Use exactly 6 digits.');
 for(let attempt=0;attempt<3;attempt++){
  const saved=await store.get(defaultKey(school));
  const value=pin===DEFAULT_PIN?{v:1,hash:null,salt:null,updatedAt:new Date(now).toISOString(),updatedBy:by}:{v:1,...await hashPin(pin),updatedAt:new Date(now).toISOString(),updatedBy:by};
  if(await store.put(defaultKey(school),value,saved?saved.revision:null))return;
 }
 throw Error('409:Please try again.');
}
export async function hasCustomDefault(store,school){return Boolean((await store.get(defaultKey(school)))?.value?.hash);}
