import {prepareUsageImport} from './usage-import.js';

// Both row count and UTF-8 JSON bytes matter: compressed Excel files can expand considerably.
export const usageBatchBytes=1000000;
export const usageBatchRows=500;
const encoder=new TextEncoder();
const byteLength=value=>encoder.encode(value).length;
export function usageImportBody(rows,source,preview){
 return JSON.stringify({action:'import',format:'usage',data:rows,source:String(source||'UserMetrics').slice(0,2000),preview});
}
export function usageImportBatches(rows,source,preview,{maxBytes=usageBatchBytes,maxRows=usageBatchRows}={}){
 if(!Array.isArray(rows)||!rows.length||rows.length>20000)throw Error('Choose 1–20,000 data rows per import');
 const overhead=byteLength(usageImportBody([],source,preview)),batches=[];
 let batch=[],bytes=overhead;
 for(let i=0;i<rows.length;i++){
  const row=rows[i],size=byteLength(JSON.stringify(row));
  if(overhead+size>maxBytes)throw Error(`${row?._source_file||'Workbook'}, row ${row?._excel_row||i+2}: this row is too large. Reduce its cell contents and retry.`);
  if(batch.length&&(batch.length>=maxRows||bytes+1+size>maxBytes)){batches.push(batch);batch=[];bytes=overhead;}
  bytes+=size+(batch.length?1:0);batch.push(row);
 }
 if(batch.length)batches.push(batch);
 return batches;
}

// Mirrors school_success_usage_key for preview counts across requests.
// Saving always sends every original row; database validation and duplicate checks remain authoritative.
export function usagePreviewIdentity(row){
 const lower=value=>String(value||'').trim().toLowerCase();
 const activity=lower(row.Type).replace(/[^a-z0-9]/g,'');
 const kind=['book','books','bookusage','content','contentusage','contentbook'].includes(activity)?'book':
  ['lessonplan','lessonpreparation','lessondelivery'].includes(activity)?'lessondelivery':activity;
 const second=value=>{if(!value)return null;const n=Date.parse(value+'Z')/1000;return n<0?-Math.round(-n):Math.round(n);};
 const cents=Math.round(Number(row.Duration_Min.toFixed(6).replace('.',''))/10000);
 return JSON.stringify([lower(row.Center||row.Institution),lower(row.FullName),kind,second(row.StartTime),second(row.EndTime),cents,
  ...['Grade','Subject','Book'].map(key=>row.EndTime?'':lower(row[key]))]);
}
function previewRows(rows){
 const seen=new Set(),input=[],duplicates=new Map();
 for(const row of rows){
  const normalized=prepareUsageImport([row],'preview').records[0];
  // Invalid rows still go to the server, which returns their original file and Excel row.
  if(!normalized){input.push(row);continue;}
  const key=usagePreviewIdentity(normalized);
  if(seen.has(key)){
   const group=duplicates.get(key);group.push(row);
  }else{seen.add(key);duplicates.set(key,[]);input.push(row);}
 }
 return {input,duplicates};
}
export async function readUsageImportResponse(response){
 const raw=await response.text();let value;
 try{value=JSON.parse(raw);}catch{}
 if(!response.ok||value?.error){
  const message=response.status===413?'The import request exceeded the upload limit. Refresh this page and retry.':
   response.status===401?'Your session expired. Sign in again, then select the same files.':
   response.status===403?'You do not have permission to import these school records.':
   typeof value?.error==='string'?value.error:`The import could not finish (HTTP ${response.status}). Please retry.`;
  throw Error(message);
 }
 if(!value||!['total','newRows','inserted','skipped','enriched'].every(key=>Number.isInteger(value[key])&&value[key]>=0)||!Array.isArray(value.rejected))
  throw Error('The import returned an incomplete response. Please retry.');
 return value;
}
export async function runUsageImport({rows,source,preview,send,onProgress=()=>{},limits}){
 if(!Array.isArray(rows)||!rows.length||rows.length>20000)throw Error('Choose 1–20,000 data rows per import');
 // Copy metadata so fallback row numbers remain global rather than restarting with each batch.
 const original=rows.map((row,i)=>({...row,_source_file:row?._source_file||'Workbook',_excel_row:row?._excel_row||i+2}));
 const plan=preview?previewRows(original):{input:original,duplicates:new Map()};
 const batches=usageImportBatches(plan.input,source,preview,limits);
 const localSkipped=[...plan.duplicates.values()].reduce((sum,group)=>sum+group.length,0);
 const result={preview,total:original.length,newRows:0,inserted:0,skipped:localSkipped,enriched:0,rejected:[],period:null};
 let completed=localSkipped;
 for(let i=0;i<batches.length;i++){
  onProgress({preview,completed,total:original.length,batch:i+1,batches:batches.length});
  try{
   const value=await readUsageImportResponse(await send(usageImportBody(batches[i],source,preview)));
   if(value.total!==batches[i].length)throw Error('The server did not confirm every row in this batch. Please retry.');
   for(const key of ['newRows','inserted','skipped','enriched'])result[key]+=value[key];
   result.rejected.push(...value.rejected);
   if(value.period){
    result.period={from:result.period&&result.period.from<value.period.from?result.period.from:value.period.from,
     to:result.period&&result.period.to>value.period.to?result.period.to:value.period.to};
   }
   completed+=batches[i].length;
  }catch(error){
   const prefix=preview?'Database check stopped':`Import stopped after ${completed.toLocaleString('en-IN')} of ${original.length.toLocaleString('en-IN')} rows were processed`;
   throw Error(`${prefix}: ${error.message}${preview?'':'. Earlier batches may already be saved. Retry the same files; existing sessions will be skipped.'}`);
  }
 }
 // A duplicate of a server-rejected representative is rejected too, rather than counted as skipped.
 if(preview&&result.rejected.length){
  const rejectedSources=new Map(result.rejected.map(r=>[JSON.stringify([r.file,r.row]),r.reason]));
  for(const row of plan.input){
   const reason=rejectedSources.get(JSON.stringify([row._source_file,row._excel_row]));if(!reason)continue;
   const normalized=prepareUsageImport([row],'preview').records[0];if(!normalized)continue;
   const duplicates=plan.duplicates.get(usagePreviewIdentity(normalized))||[];
   result.skipped-=duplicates.length;
   result.rejected.push(...duplicates.map(r=>({file:r._source_file,row:r._excel_row,reason})));
  }
 }
 onProgress({preview,completed:original.length,total:original.length,batch:batches.length,batches:batches.length});
 return result;
}
