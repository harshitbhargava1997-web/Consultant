import {createClient} from '@supabase/supabase-js';
export function service(){
 if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('503:School Success database is not configured for this deployment');
 return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function checked(query){const {data,error}=await query;if(error)throw Error('503:Database operation failed: '+error.message);return data;}
function operation(sql,args){
 const q=sql.replace(/\s+/g,' ').trim();
 if(q.startsWith('INSERT')&&q.includes('INTO portal_config')){let key,value;if(q.includes("VALUES('reportSettings',?)")){key='reportSettings';[value]=args;}else [key,value]=args;return {op:q.startsWith('INSERT OR IGNORE')?'configInsert':'configPut',key,value};}
 if(q.startsWith('UPDATE portal_config'))return {op:'configUpdate',value:args[0],key:args[1],revision:args[2]};
 if(q.startsWith('INSERT')&&q.includes('INTO portal_members'))return {op:'memberPut',email:args[0],school:args[1],name:args[2]};
 if(q.startsWith('INSERT')&&q.includes('INTO portal_entries'))return {op:'entryInsert',id:args[0],kind:args[1],school:args[2],owner:args[3],payload:args[4],updated:args[5]};
 if(q.startsWith('UPDATE portal_entries'))return {op:'entryUpdate',payload:args[0],school:args[1],updated:args[2],id:args[3],version:args[4]};
 if(q.startsWith('INSERT')&&q.includes('INTO portal_audit'))return {op:'auditInsert',id:args[0],actor:args[1],action:args[2],record:args[3],created:args[4]};
 throw Error('Unsupported local database write');
}
export function localDatabase(){
 const db=service();
 const execute=async ops=>checked(db.rpc('vision_success_local_batch',{p_ops:ops}));
 return {
  prepare(sql){let args=[];return {
   bind(...values){args=values;return this;},
   async all(){let query;if(sql.includes('FROM portal_config')){query=db.from('success_config').select('key,value,revision');const like=sql.match(/key LIKE '([^']+)'/);const literal=sql.match(/key='([^']+)'/);if(like)query=query.like('key',like[1]);else if(literal||sql.includes('key=?'))query=query.eq('key',literal?.[1]||args[0]);}
    else if(sql.includes('FROM portal_members')){query=db.from('success_members').select('*').order('school').order('name');if(sql.includes('email=?'))query=query.eq('email',args[0]);}
    else if(sql.includes('FROM portal_entries')){query=db.from('success_entries').select('*');if(sql.includes("kind='school'"))query=query.eq('kind','school');if(sql.includes('id=?'))query=query.eq('id',args[0]);}
    else throw Error('Unsupported local database read');return {results:await checked(query)};},
   async first(){return (await this.all()).results[0]||null;},
   async run(){const rows=await execute([operation(sql,args)]);return rows[0];},
   _operation(){return operation(sql,args);}
  };},
  async batch(statements){return execute(statements.map(s=>s._operation()));}
 };
}
