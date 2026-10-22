const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const expected='TRANSFER_HASH',expires='TRANSFER_EXPIRY';
const source='https://hddqakqtfhvhjpmwdkqv.supabase.co/functions/v1/vision-success-export';
const tables=['portal_school_plans','classroom_observations','portal_actions','portal_action_history','portal_evidence_reviews','portal_import_runs','portal_contacts','portal_tickets','portal_call_logs','teacher_records'];
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function request(path:string,method='GET',data?:unknown,extra={}){const r=await fetch(base+path,{method,headers:{...headers,...extra},body:data===undefined?undefined:JSON.stringify(data)});if(!r.ok)throw Error('Target database error '+r.status+': '+(await r.text()).slice(0,250));const text=await r.text();return text?JSON.parse(text):null;}
const encoder=new TextEncoder(),digest=(s:string)=>crypto.subtle.digest('SHA-256',encoder.encode(s));
const encode=(b:Uint8Array)=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
const decode=(s:string)=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function encrypt(value:unknown,secret:string,aad:string){const iv=crypto.getRandomValues(new Uint8Array(12)),k=await crypto.subtle.importKey('raw',await digest(secret),{name:'AES-GCM'},false,['encrypt']);return JSON.stringify({iv:encode(iv),ciphertext:encode(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},k,encoder.encode(JSON.stringify(value)))))});}
Deno.serve(async req=>{const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});try{
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');const actual=[...new Uint8Array(await digest(token))].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(req.method!=='POST'||actual!==expected||Date.now()>Date.parse(expires))return json({error:'Unauthorized or expired migration'},403);
 const b=await req.json();
 if(b.action==='config'){
  const r=await fetch('https://school-success-portal.harshitbhargava1997.chatgpt.site/api/vision-export',{method:'POST',headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('D1 export failed '+r.status);const envelope=await r.json();
  const k=await crypto.subtle.importKey('raw',await digest(token),{name:'AES-GCM'},false,['decrypt']);const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv),additionalData:encoder.encode('vision-school-success-export-v1')},k,decode(envelope.ciphertext));const payload=JSON.parse(new TextDecoder().decode(raw));
  const target={portal_config:'success_config',portal_entries:'success_entries',portal_members:'success_members',portal_audit:'success_audit'};
  const counts:Record<string,number>={};
  for(const [table,dest] of Object.entries(target)){let rows=payload.tables[table]||[];if(table==='portal_config')rows=rows.filter((row:any)=>row.key!=='owner'&&!row.key.startsWith('schoolLink:')&&!row.key.startsWith('schoolLinkToken:')&&row.key!=='r2CredentialsEncryptedV1').map((row:any)=>{let revision='';try{revision=JSON.parse(row.value).revision||'';}catch{}return {...row,revision};});for(let i=0;i<rows.length;i+=200)await request('/rest/v1/'+dest,'POST',rows.slice(i,i+200),{Prefer:'resolution=ignore-duplicates'});counts[table]=rows.length;}
  const media=payload.media;
  if(media.R2_ACCESS_KEY_ID&&media.R2_SECRET_ACCESS_KEY){const value=await encrypt({accessKeyId:media.R2_ACCESS_KEY_ID,secretAccessKey:media.R2_SECRET_ACCESS_KEY,updatedAt:new Date().toISOString()},token,'r2CredentialsEncryptedV1');await request('/rest/v1/success_config','POST',[{key:'r2CredentialsEncryptedV1',value},{key:'r2BaseConfig',value:JSON.stringify(Object.fromEntries(['R2_ENDPOINT_URL','R2_BUCKET_NAME','R2_PUBLIC_BASE_URL'].map(k=>[k,media[k]||''])))}],{Prefer:'resolution=ignore-duplicates'});}
  await request('/rest/v1/success_import_state','POST',[{key:'sourceSnapshot',value:envelope},{key:'config',value:{counts,exportedAt:payload.exportedAt,importedAt:new Date().toISOString(),freshLinks:true}}],{Prefer:'resolution=merge-duplicates'});return json({counts,mediaConfigured:Boolean(media.R2_ACCESS_KEY_ID&&media.R2_SECRET_ACCESS_KEY)});
 }
 if(b.action==='page'){
  if(!tables.includes(b.table)||!Number.isInteger(b.offset)||b.offset<0||b.offset>1000000)throw Error('Invalid page');
  const r=await fetch(source,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({table:b.table,offset:b.offset})});const result=await r.json();if(!r.ok)throw Error(result.error);
  if(result.rows.length)await request('/rest/v1/'+b.table,'POST',result.rows,{Prefer:'resolution=ignore-duplicates'});
  const value={offset:b.offset+result.rows.length,total:result.total,complete:b.offset+result.rows.length>=result.total};await request('/rest/v1/success_import_state','POST',{key:'table:'+b.table,value},{Prefer:'resolution=merge-duplicates'});return json(value);
 }
 if(b.action==='legacy'){
  for(const name of ['school_crm_data.json','school_call_logs_store.json']){const r=await fetch(source,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'legacy',name})});const result=await r.json();if(!r.ok)throw Error(result.error);await request('/rest/v1/success_import_state','POST',{key:'legacy:'+name,value:result.value},{Prefer:'resolution=merge-duplicates'});}return json({ok:true});
 }
 if(b.action==='finish'){await request('/rest/v1/rpc/vision_success_reset_sequences','POST',{});await request('/rest/v1/success_import_state','POST',{key:'complete',value:{at:new Date().toISOString()}},{Prefer:'resolution=merge-duplicates'});return json({ok:true});}
 throw Error('Unsupported migration step');
}catch(e){return json({error:String((e as Error).message)},400)}});
