import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {readUsageWorkbooks} from '../lib/school-success/workbook-import.js';
import {prepareUsageImport} from '../lib/school-success/usage-import.js';
import {usageBatchBytes,usageBatchRows,usageImportBody,usageImportBatches,usagePreviewIdentity,readUsageImportResponse,runUsageImport} from '../lib/school-success/usage-import-batches.js';
const row=i=>({Center:'Test School',FullName:'Teacher '+i,Type:'Book',StartTime:'2026-10-22T09:00:00',EndTime:'2026-10-22T09:10:00',Duration_Min:10,Grade:'',Book:'',_source_file:'Metrics.xlsx',_excel_row:i+2});
function harness(){
 const records=new Map(),requests=[];
 const send=async body=>{
  assert.ok(Buffer.byteLength(body)<=usageBatchBytes);const b=JSON.parse(body);assert.ok(b.data.length<=usageBatchRows);requests.push(b);
  const prepared=prepareUsageImport(b.data,'server-admin'),seen=new Set(),dates=prepared.records.map(r=>r.StartTime.slice(0,10)).sort();
  const result={preview:b.preview,total:prepared.total,newRows:0,inserted:0,skipped:0,enriched:0,rejected:prepared.rejected,period:dates.length?{from:dates[0],to:dates.at(-1)}:null};
  for(const r of prepared.records){
   // Test fixture identity; production retains the existing database RPC.
   const key=r.Center+'|'+r.FullName+'|'+r.StartTime+'|'+r.EndTime+'|'+r.Duration_Min;
   if(records.has(key)||seen.has(key)){
    result.skipped++;
    if(!b.preview&&records.has(key))for(const k of ['Book','Grade','Subject'])if(!records.get(key)[k]&&r[k]){records.get(key)[k]=r[k];result.enriched++;}
   }else{result.newRows++;if(!b.preview){records.set(key,{...r});result.inserted++;}}
   seen.add(key);
  }
  return Response.json(result);
 };
 return {records,requests,send};
}
test('compressed workbook expanding beyond the live upload cap is imported in bounded requests',async()=>{
 const input=Array.from({length:6500},(_,i)=>({...row(i),Book:'पाठ के लिए चित्र और कहानी '.repeat(25)}));
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(input),'UserMetrics');
 const file=new File([XLSX.write(book,{type:'buffer',bookType:'xlsx',compression:true})],'Metrics.xlsx');
 assert.ok(file.size<10*1024*1024);
 const parsed=await readUsageWorkbooks([file]);assert.ok(Buffer.byteLength(usageImportBody(parsed.rows,parsed.source,true))>4500000);
 const db=harness(),progress=[];
 const preview=await runUsageImport({...parsed,preview:true,send:db.send,onProgress:p=>progress.push(p)});
 assert.equal(preview.newRows,6500);assert.equal(db.records.size,0);assert.ok(db.requests.length>1);
 const saved=await runUsageImport({...parsed,preview:false,send:db.send});assert.equal(saved.inserted,6500);assert.equal(db.records.size,6500);
 const repeated=await runUsageImport({...parsed,preview:false,send:db.send});assert.equal(repeated.inserted,0);assert.equal(repeated.skipped,6500);
 assert.equal(progress.at(-1).completed,6500);
});
test('UTF-8 bytes and JSON escaping, rather than row count alone, govern batch size',()=>{
 const input=Array.from({length:200},(_,i)=>({...row(i),Book:'हिंदी "\\\n'.repeat(200)}));
 const source='File "'.repeat(500),batches=usageImportBatches(input,source,false,{maxBytes:20000,maxRows:500});
 assert.deepEqual(batches.flat(),input);assert.ok(batches.length>1);
 for(const batch of batches)assert.ok(Buffer.byteLength(usageImportBody(batch,source,false))<=20000);
 assert.throws(()=>usageImportBatches([{...row(0),Book:'x'.repeat(1100000)}],'file',true),/row 2: this row is too large/);
});
test('preview counts duplicates across batches, while saving retains every original row for enrichment',async()=>{
 const input=Array.from({length:1200},(_,i)=>row(i));input.push({...row(0),Grade:'Grade 2',Book:'Plants',_source_file:'Richer.xlsx',_excel_row:25});
 input[1000]={...input[1000],StartTime:'2026-10-24T09:00:00',EndTime:'2026-10-24T09:10:00'};
 input.push({...row(1200),StartTime:'bad',_source_file:'Bad.xlsx',_excel_row:42});
 const db=harness(),preview=await runUsageImport({rows:input,source:'Multiple files',preview:true,send:db.send});
 assert.equal(preview.total,1202);assert.equal(preview.newRows,1200);assert.equal(preview.skipped,1);assert.equal(preview.rejected.length,1);assert.equal(preview.rejected[0].file,'Bad.xlsx');assert.equal(preview.rejected[0].row,42);
 const saved=await runUsageImport({rows:input,source:'Multiple files',preview:false,send:db.send});
 assert.equal(saved.inserted,1200);assert.equal(saved.skipped,1);assert.equal([...db.records.values()][0].Book,'Plants');assert.equal([...db.records.values()][0].Grade,'Grade 2');
 assert.deepEqual(saved.period,{from:'2026-10-22',to:'2026-10-24'});
});
test('preview identity preserves activity distinctions and no-end-time detail distinctions',()=>{
 const normalize=r=>prepareUsageImport([r],'preview').records[0],key=r=>usagePreviewIdentity(normalize(r));
 assert.equal(key(row(0)),key({...row(0),Type:'Content / Book',Book:'Rich book',Grade:'Grade 3'}));
 assert.notEqual(key(row(0)),key({...row(0),Type:'ebook'}));
 assert.notEqual(key({...row(0),EndTime:'',Book:'Plants'}),key({...row(0),EndTime:'',Book:'Animals'}));
 assert.equal(key({...row(0),Duration_Min:1.005}),key({...row(0),Duration_Min:1.01}));
 assert.notEqual(key({...row(0),Duration_Min:1.004}),key({...row(0),Duration_Min:1.01}));
});
test('non-JSON platform errors produce readable messages rather than a JSON syntax error',async()=>{
 await assert.rejects(()=>readUsageImportResponse(new Response('Request Entity Too Large',{status:413})),/upload limit/);
 await assert.rejects(()=>readUsageImportResponse(new Response('<html>Bad gateway</html>',{status:502})),/HTTP 502/);
 await assert.rejects(()=>readUsageImportResponse(new Response('Sign in',{status:401})),/session expired/);
 await assert.rejects(()=>readUsageImportResponse(Response.json({})),/incomplete response/);
});
test('interrupted imports describe partial progress and retry skips already committed sessions',async()=>{
 const input=Array.from({length:1100},(_,i)=>row(i)),db=harness();let count=0;
 await assert.rejects(()=>runUsageImport({rows:input,preview:false,send:body=>{if(++count===2)throw Error('Connection lost');return db.send(body);}}),/500 of 1,100.*Earlier batches may already be saved/);
 assert.equal(db.records.size,500);
 const retry=await runUsageImport({rows:input,preview:false,send:db.send});assert.equal(retry.inserted,600);assert.equal(retry.skipped,500);assert.equal(db.records.size,1100);
});
test('unexpected server rejection of a preview representative keeps every original correction location',async()=>{
 const first=row(0),duplicate={...row(0),_source_file:'Second.xlsx',_excel_row:99};
 const value=await runUsageImport({rows:[first,duplicate],preview:true,send:async()=>Response.json({total:1,newRows:0,inserted:0,skipped:0,enriched:0,rejected:[{file:first._source_file,row:first._excel_row,reason:'Invalid cell'}]})});
 assert.equal(value.skipped,0);assert.deepEqual(value.rejected.map(r=>[r.file,r.row]),[['Metrics.xlsx',2],['Second.xlsx',99]]);
});
