// Secrets arrive over stdin only. Output contains counts and statuses, never records.
import readline from 'node:readline';
const rl=readline.createInterface({input:process.stdin});
console.log('Ready for migration credentials on stdin.');
for await(const line of rl){const {key}=JSON.parse(line);rl.close();
 const call=async body=>{const r=await fetch('https://amtjvwroaennfypurkji.supabase.co/functions/v1/vision-success-import',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
 console.log(JSON.stringify({config:await call({action:'config'})}));
 for(const table of ['portal_school_plans','classroom_observations','portal_actions','portal_action_history','portal_evidence_reviews','portal_import_runs','portal_contacts','portal_tickets','portal_call_logs','teacher_records']){let offset=0;while(true){const value=await call({action:'page',table,offset});offset=value.offset;if(value.complete){console.log(JSON.stringify({table,rows:offset}));break;}}}
 await call({action:'legacy'});await call({action:'finish'});console.log('Independent Vision import completed.');break;
}
