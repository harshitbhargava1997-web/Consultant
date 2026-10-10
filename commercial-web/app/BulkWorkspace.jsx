"use client";
import {useEffect,useRef,useState} from "react";
import {Download,FileSpreadsheet,UploadCloud,AlertCircle,CheckCircle2} from "lucide-react";
import {downloadTemplate,readWorkbook,downloadExport,downloadImportResults} from "../lib/spreadsheets";

const TYPES=[
 {id:"stakeholders",name:"Stakeholders (staff)",uploadAction:"importPeople",exportAction:"exportPeople"},
 {id:"students",name:"Students",uploadAction:"importStudents",exportAction:"exportStudents"}
];
function counts(results){
 return results.reduce((a,row)=>{a[row.status]=(a[row.status]||0)+1;return a;},{});
}
export default function BulkWorkspace({session,schoolId,schoolName,isAdmin,onImported}){
 const [kind,setKind]=useState("stakeholders");
 const [rows,setRows]=useState([]),[fileName,setFileName]=useState("");
 const [results,setResults]=useState([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const fileInput=useRef(null);
 const item=TYPES.find(t=>t.id===kind);
 useEffect(()=>{
  setRows([]);setResults([]);setNotice("");setFileName("");
  if(fileInput.current)fileInput.current.value="";
 },[kind,schoolId]);
 async function callApi(action,payload={}){
  const res=await fetch("/api/bulk",{
   method:"POST",cache:"no-store",
   headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
   body:JSON.stringify({action,schoolId,...payload})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.error||"The bulk service returned an error.");
  return data;
 }
 async function fileChanged(e){
  const file=e.target.files?.[0];
  setRows([]);setResults([]);setNotice("");setFileName("");
  if(!file)return;
  setBusy(true);
  try{
   const entries=await readWorkbook(file,kind);
   setRows(entries);setFileName(file.name);
   setNotice(entries.length+" spreadsheet rows validated for upload. Review the school selection before confirming.");
  }catch(error){setNotice(error.message);if(fileInput.current)fileInput.current.value="";}
  finally{setBusy(false);}
 }
 async function upload(){
  if(!schoolId||!rows.length||busy)return;
  if(!window.confirm("Import "+rows.length+" "+item.name.toLowerCase()+" records into "+schoolName+"? Rows already processed may be saved even if later rows fail."))return;
  const saved=[];setBusy(true);setNotice("");
  const batchSize=kind==="stakeholders"?5:100;
  try{
   for(let at=0;at<rows.length;at+=batchSize){
    const payload=rows.slice(at,at+batchSize);
    const res=await callApi(item.uploadAction,{rows:payload});
    saved.push(...(res.results||[]));
    setResults([...saved]);
    setNotice("Processed "+saved.length+" of "+rows.length+" rows...");
   }
   const errors=saved.filter(r=>r.status==="error").length;
   setNotice("Upload finished: "+(saved.length-errors)+" saved or assigned; "+errors+" need attention. Download the results to review each row.");
   if(onImported)await onImported();
  }catch(error){setNotice("Upload stopped after "+saved.length+" rows: "+error.message+". Download the results before retrying.");}
  finally{
   setResults([...saved]);setRows([]);setFileName("");
   if(fileInput.current)fileInput.current.value="";
   setBusy(false);
  }
 }
 async function exportData(){
  if(!schoolId||busy)return;
  setBusy(true);setNotice("");
  try{
   const data=await callApi(item.exportAction);
   await downloadExport(kind,data.rows||[],schoolName);
   setNotice("Exported "+(data.rows||[]).length+" "+item.name.toLowerCase()+" records. Passwords are not included.");
  }catch(error){setNotice(error.message);}
  finally{setBusy(false);}
 }
 async function template(){
  if(busy)return;
  setBusy(true);setNotice("");
  try{await downloadTemplate(kind,isAdmin);setNotice("Excel template downloaded. Read its Instructions sheet before uploading.");}
  catch(error){setNotice(error.message);}
  finally{setBusy(false);}
 }
 async function resultsExport(){
  if(!results.length)return;
  setBusy(true);
  try{await downloadImportResults(kind,results,schoolName);}
  catch(error){setNotice(error.message);}
  finally{setBusy(false);}
 }
 const totals=counts(results);
 return <div className="bulk-stack">
  <section className="panel">
   <div className="panel-head"><h2>Bulk upload & download</h2><span className="eyebrow">EXCEL · SCHOOL-SCOPED</span></div>
   <p className="bulk-intro">Register and export school staff or students in Excel format. All uploads are restricted to the selected school, and upload results identify each unsuccessful row.</p>
   <div className="bulk-choice" role="group" aria-label="Choose data type">
    {TYPES.map(t=><button key={t.id} type="button" className={"btn "+(t.id===kind?"primary":"outline")} disabled={busy} aria-pressed={t.id===kind} onClick={()=>setKind(t.id)}>{t.name}</button>)}
   </div>
   <div className="notice small"><AlertCircle size={17}/><span>Selected school: <strong>{schoolName||"Choose a school from the top bar"}</strong>. Only the Platform Super Admin can import owner, principal or coordinator roles. School leaders may import teachers and students for their own school.</span></div>
  </section>
  <div className="two-col">
   <section className="panel">
    <div className="panel-head"><h2><FileSpreadsheet size={19}/> Excel import</h2></div>
    <p className="helper">Download the blank template, enter records on the {kind==="stakeholders"?"Stakeholders":"Students"} worksheet, then select the completed .xlsx file. Up to 500 rows per upload.</p>
    <button className="btn outline" disabled={busy} onClick={template}><Download size={16}/> Download {kind==="stakeholders"?"stakeholder":"student"} template</button>
    <div className="bulk-upload">
     <label htmlFor="bulk-excel-file">Upload completed Excel sheet
      <input id="bulk-excel-file" ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={fileChanged} disabled={busy||!schoolId}/>
     </label>
    </div>
    {rows.length>0&&<div className="bulk-selected"><CheckCircle2 size={17}/><span>{fileName}: <strong>{rows.length} records</strong> ready for import</span></div>}
    <button type="button" className="btn primary" disabled={busy||!schoolId||!rows.length} onClick={upload}><UploadCloud size={16}/>{busy?"Processing…":"Confirm & upload records"}</button>
   </section>
   <section className="panel">
    <div className="panel-head"><h2><Download size={19}/> Download school data</h2></div>
    <p className="helper">Export current {kind==="stakeholders"?"stakeholder names, login emails and roles":"student names, admission numbers, grades, sections and academic years"} for the selected school. No passwords are exported.</p>
    <button className="btn outline" disabled={busy||!schoolId} onClick={exportData}><Download size={16}/> Export {kind==="stakeholders"?"stakeholders":"student roster"} (.xlsx)</button>
    <div className="bulk-summary">
     <strong>Import results</strong>
     <span>{results.length?results.length+" rows processed":"No import in this session"}</span>
     {results.length>0&&<><span>{(totals.created||0)+(totals.assigned||0)+(totals.saved||0)} successful · {totals.error||0} errors</span>
      <button className="btn outline" disabled={busy} onClick={resultsExport}><Download size={16}/> Download row-by-row results</button></>}
    </div>
   </section>
  </div>
  {notice&&<div className="notice"><AlertCircle size={17}/><span>{notice}</span></div>}
  {kind==="stakeholders"?<p className="helper">Each new staff account needs a manually assigned initial password in the Excel sheet. Keep that completed sheet private and delete it after provisioning. Existing accounts keep their current passwords. Teachers must still be assigned to classes.</p>
   :<p className="helper">Create all classes and sections first. Existing students are matched using their class and admission number, so preserve admission numbers in future re-uploads.</p>}
 </div>;
}
