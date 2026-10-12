"use client";
import {useEffect,useRef,useState} from "react";
import {Download,FileSpreadsheet,UploadCloud,AlertCircle,CheckCircle2} from "lucide-react";
import {downloadTemplate,readWorkbook,downloadExport,downloadImportResults} from "../lib/spreadsheets";

const TYPES=[
 {id:"classes",name:"Classes",uploadAction:"importClasses",exportAction:"exportClasses"},
 {id:"stakeholders",name:"Stakeholders (staff)",uploadAction:"importPeople",exportAction:"exportPeople"},
 {id:"students",name:"Students",uploadAction:"importStudents",exportAction:"exportStudents"}
];
function counts(results){
 return results.reduce((a,row)=>{a[row.status]=(a[row.status]||0)+1;return a;},{});
}
export default function BulkWorkspace({session,schoolId,schoolName,canExport,canUploadStaff,canUploadStudents,canUploadClasses=false,canManageRoles,fixedKind="",onImported}){
 const [kind,setKind]=useState(fixedKind||"stakeholders");
 const [rows,setRows]=useState([]),[fileName,setFileName]=useState("");
 const [results,setResults]=useState([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const fileInput=useRef(null);
 const item=TYPES.find(t=>t.id===kind);
 useEffect(()=>{if(fixedKind){setKind(fixedKind);return;}
  if(canUploadStaff)setKind("stakeholders");else if(canUploadStudents)setKind("students");else if(canUploadClasses)setKind("classes");
 },[fixedKind,canUploadStaff,canUploadStudents,canUploadClasses]);
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
  if((kind==="stakeholders"&&!canUploadStaff)||(kind==="students"&&!canUploadStudents)||(kind==="classes"&&!canUploadClasses)){setNotice("Bulk upload is not enabled for this role.");return;}
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
   setNotice("Upload finished: "+(saved.length-errors)+" saved or assigned; "+errors+" need attention. Review the results shown below.");
   if(onImported)await onImported();
  }catch(error){setNotice("Upload stopped after "+saved.length+" rows: "+error.message+". Review the processed rows before retrying.");}
  finally{
   setResults([...saved]);setRows([]);setFileName("");
   if(fileInput.current)fileInput.current.value="";
   setBusy(false);
  }
 }
 async function exportData(){
  if(!canExport||!schoolId||busy)return;
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
  try{await downloadTemplate(kind,canManageRoles);setNotice("Excel template downloaded. Read its Instructions sheet before uploading.");}
  catch(error){setNotice(error.message);}
  finally{setBusy(false);}
 }
 async function resultsExport(){
  if(!canExport||!results.length)return;
  setBusy(true);
  try{await downloadImportResults(kind,results,schoolName);}
  catch(error){setNotice(error.message);}
  finally{setBusy(false);}
 }
 const totals=counts(results);
 return <div className="bulk-stack">
  <section className="panel">
   <div className="panel-head"><h2>{canExport?"Bulk upload & export":"Bulk upload"}</h2><span className="eyebrow">EXCEL · SCHOOL-SCOPED</span></div>
   <p className="bulk-intro">Upload {kind==="classes"?"classes":kind==="stakeholders"?"teachers and staff":"students"} using Vision's Excel template. New records stay within the selected school, and the result of every row is shown below. Existing record exports require their own Super Admin-controlled permission.</p>
   {!fixedKind&&<div className="bulk-choice" role="group" aria-label="Choose data type">
    {TYPES.filter(t=>t.id==="classes"?canUploadClasses||canExport:t.id==="stakeholders"?canUploadStaff||canExport:canUploadStudents||canExport).map(t=><button key={t.id} type="button" className={"btn "+(t.id===kind?"primary":"outline")} disabled={busy} aria-pressed={t.id===kind} onClick={()=>setKind(t.id)}>{t.name}</button>)}
   </div>}
   <div className="notice small"><AlertCircle size={17}/><span>Selected school: <strong>{schoolName||"Choose a school from the top bar"}</strong>. Uploads are checked against your role permissions. Teachers can import students only into assigned classes; exports of existing data need separate permission.</span></div>
  </section>
  <div className="two-col">
   <section className="panel">
    <div className="panel-head"><h2><FileSpreadsheet size={19}/> Excel import</h2></div>
    <p className="helper">Download the blank template, enter records on the {kind==="stakeholders"?"Stakeholders":kind==="classes"?"Classes":"Students"} worksheet, then select the completed .xlsx file. Up to 500 rows per upload.</p>
    <button className="btn outline" disabled={busy} onClick={template}><Download size={16}/> Download {kind==="stakeholders"?"stakeholder":kind==="classes"?"class":"student"} template</button>
    <div className="bulk-upload">
     <label htmlFor="bulk-excel-file">Upload completed Excel sheet
      <input id="bulk-excel-file" ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={fileChanged} disabled={busy||!schoolId}/>
     </label>
    </div>
    {rows.length>0&&<div className="bulk-selected"><CheckCircle2 size={17}/><span>{fileName}: <strong>{rows.length} records</strong> ready for import</span></div>}
    <button type="button" className="btn primary" disabled={busy||!schoolId||!rows.length} onClick={upload}><UploadCloud size={16}/>{busy?"Processing…":"Confirm & upload records"}</button>
   </section>
   {canExport&&<section className="panel">
    <div className="panel-head"><h2><Download size={19}/> Download school data</h2></div>
    <p className="helper">Export current {kind==="stakeholders"?"stakeholder names, login emails and roles":"student names, admission numbers, grades, sections and academic years"} for the selected school. No passwords are exported.</p>
    <button className="btn outline" disabled={busy||!schoolId} onClick={exportData}><Download size={16}/> Export {kind==="stakeholders"?"stakeholders":"student roster"} (.xlsx)</button>
   </section>}
   <section className="panel">
    <div className="panel-head"><h2>Upload results</h2></div>
    <div className="bulk-summary">
     <strong>{results.length?results.length+" rows processed":"No import in this session"}</strong>
     {results.length>0&&<><span>{(totals.created||0)+(totals.assigned||0)+(totals.saved||0)} successful · {totals.error||0} errors</span>
     {canExport&&<button className="btn outline" disabled={busy} onClick={resultsExport}><Download size={16}/> Download import results</button>}
     {(totals.error||0)>0&&<div className="rows" role="status">
      {results.filter(r=>r.status==="error").slice(0,80).map((r,i)=><p className="helper" key={i}>Row {r.row_number}: {r.detail}</p>)}
      {(totals.error||0)>80&&<p className="helper">Additional failed rows: {(totals.error||0)-80}. Upload smaller files for easier review.</p>}
     </div>}
     </>}
    </div>
   </section>
  </div>
  {notice&&<div className="notice"><AlertCircle size={17}/><span>{notice}</span></div>}
  {kind==="stakeholders"?<p className="helper">Each new staff account needs a manually assigned initial password in the Excel sheet. Keep that completed sheet private and delete it after provisioning. Existing accounts keep their current passwords. Teachers must still be assigned to classes.</p>
   :<p className="helper">Create all classes and sections first. Existing students are matched using their class and admission number, so preserve admission numbers in future re-uploads.</p>}
 </div>;
}
