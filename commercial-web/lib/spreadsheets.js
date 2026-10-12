// Spreadsheet helpers are loaded on demand; no spreadsheet parser ships in the initial dashboard bundle.
const XLSX_MIME="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const STAKEHOLDER_FIELDS=["full_name","email","role","initial_password"];
export const STUDENT_FIELDS=["grade","section","academic_year","admission_number","student_name"];
export const CLASS_FIELDS=["grade","section","academic_year"];

async function excel(){
 const library=await import("exceljs");
 return library.default||library;
}
function safeValue(value){
 const text=String(value??"");
 // Safeguard against spreadsheet formula injection in exported user-provided values.
 return /^[=+@-]/.test(text)?"'"+text:text;
}
function filenamePart(value){return String(value||"school").replace(/[^a-z0-9_-]+/gi,"_").slice(0,55);}
function outputName(kind,school,variant){
 return filenamePart(school)+"_"+kind+"_"+variant+"_"+new Date().toISOString().slice(0,10)+".xlsx";
}
function styleSheet(sheet,headers){
 sheet.views=[{state:"frozen",ySplit:1}];
 sheet.getRow(1).values=headers;
 sheet.getRow(1).height=29;
 sheet.getRow(1).eachCell(cell=>{
  cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF134A50"}};
  cell.font={color:{argb:"FFFFFFFF"},bold:true,size:11};
  cell.alignment={vertical:"middle",wrapText:true};
  cell.border={bottom:{style:"medium",color:{argb:"FF127F79"}}};
 });
 sheet.columns=headers.map(key=>({width:key==="full_name"||key==="student_name"?28:key==="initial_password"?28:22,style:{numFmt:"@"}}));
 sheet.autoFilter={from:"A1",to:{row:1,column:headers.length}};
}
function addGuide(book,kind,allowRoles){
 const sheet=book.addWorksheet("Instructions");
 sheet.getColumn(1).width=32;sheet.getColumn(2).width=96;
 sheet.getCell("A1").value="VISION · BULK DATA";
 sheet.mergeCells("A1:B1");sheet.getCell("A1").font={size:17,bold:true,color:{argb:"FF127F79"}};
 sheet.getCell("A2").value=kind==="stakeholders"?"Stakeholder upload template":"Student roster upload template";
 sheet.mergeCells("A2:B2");sheet.getCell("A2").font={size:12,bold:true};
 const lines=kind==="classes"?[
  ["Required columns","grade, section, academic_year"],
  ["Valid grades","Nursery, LKG, UKG, Grade 1, Grade 2, Grade 3, Grade 4"],
  ["Class matching","One unique grade / section / academic year per school"],
  ["Re-upload","Existing matching classes are preserved"],
  ["School selection","Select your school in Vision before uploading"],
  ["Limit","Maximum 500 rows per workbook"]
 ]:kind==="stakeholders"?[
  ["Required columns","full_name, email, role, initial_password (only for new users)"],
  ["Allowed roles",allowRoles?"owner, principal, coordinator, teacher":"teacher only for your school"],
  ["New accounts","Provide a distinct strong initial password; 12–128 characters with uppercase, lowercase, number and symbol"],
  ["Existing accounts","Leave initial_password blank; existing password is never replaced"],
  ["School selection","School is chosen inside Vision, not in the spreadsheet"],
  ["Security","This template contains initial passwords. Treat as confidential; delete the completed file after upload"],
  ["Exports","Downloaded stakeholder lists never include passwords"],
  ["Processing","Uploads report saved and failed rows. Resolve errors and re-upload failed entries"],
  ["Limit","Maximum 500 data rows per uploaded workbook; sent in 100-row batches"]
 ]:[
  ["Required columns","grade, section, academic_year, admission_number, student_name"],
  ["Valid grades","Nursery, LKG, UKG, Grade 1, Grade 2, Grade 3, Grade 4"],
  ["Class match","Classes must already exist in the selected school with exactly matching grade, section and academic year"],
  ["Admission number","Stable unique ID within each class. Strongly recommended; blank values generate a new ID"],
  ["Re-upload","Matching (class, admission_number) updates the student name without creating a duplicate"],
  ["School selection","School is chosen inside Vision, not in the spreadsheet"],
  ["Privacy","Student roster contains personal data. Store and share only with authorized school staff"],
  ["Limit","Maximum 500 data rows per uploaded workbook; sent in 100-row batches"],
  ["Exports","Download the current school roster to retain admission numbers for future imports"]
 ];
 let i=4;
 for(const [label,value] of lines){
  sheet.getCell("A"+i).value=label;sheet.getCell("A"+i).font={bold:true,color:{argb:"FF1A5657"}};
  sheet.getCell("B"+i).value=value;sheet.getCell("B"+i).alignment={wrapText:true,vertical:"middle"};
  sheet.getRow(i).height=31;i++;
 }
}
function workbookData(book,kind,rows){
 const headers=kind==="stakeholders"?STAKEHOLDER_FIELDS.slice(0,-1):kind==="classes"?CLASS_FIELDS:STUDENT_FIELDS;
 const sheet=book.addWorksheet(kind==="stakeholders"?"Stakeholders":kind==="classes"?"Classes":"Students");
 styleSheet(sheet,headers);
 for(const entry of rows){
  sheet.addRow(headers.map(k=>safeValue(entry[k])));
 }
 for(let row=2;row<=sheet.rowCount;row++){
  if(row%2===0)sheet.getRow(row).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFF4FAF8"}};
 }
 return sheet;
}
async function trigger(book,filename){
 const bytes=await book.xlsx.writeBuffer();
 const url=URL.createObjectURL(new Blob([bytes],{type:XLSX_MIME}));
 const link=document.createElement("a");link.href=url;link.download=filename;
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
export async function downloadTemplate(kind,admin){
 const ExcelJS=await excel();const book=new ExcelJS.Workbook();book.creator="Vision School Platform";
 addGuide(book,kind,admin);
 const headers=kind==="stakeholders"?STAKEHOLDER_FIELDS:kind==="classes"?CLASS_FIELDS:STUDENT_FIELDS;
 const sheet=book.addWorksheet(kind==="stakeholders"?"Stakeholders":kind==="classes"?"Classes":"Students");
 styleSheet(sheet,headers);
 if(kind==="stakeholders"){
  for(let r=2;r<=501;r++){
   sheet.getCell("C"+r).dataValidation={type:"list",allowBlank:false,formulae:[admin?'"owner,principal,coordinator,teacher"':'"teacher"']};
  }
 }else{
  for(let r=2;r<=501;r++){
   sheet.getCell("A"+r).dataValidation={type:"list",allowBlank:false,formulae:['"Nursery,LKG,UKG,Grade 1,Grade 2,Grade 3,Grade 4"']};
  }
 }
 return trigger(book,kind+"_upload_template.xlsx");
}
// Some valid Excel workbooks use x:-prefixed SpreadsheetML elements. ExcelJS 4.x
// can fail with an internal "sheets" undefined error on that serialization.
// Normalize XML element prefixes before a second parse, without changing cell data.
async function normalizeSpreadsheetML(arrayBuffer){
 const JSZip=(await import("jszip")).default;
 const archive=await JSZip.loadAsync(arrayBuffer);
 const spreadsheetML="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
 let changed=0;
 const paths=Object.keys(archive.files).filter(name=>name.startsWith("xl/")&&name.endsWith(".xml"));
 if(paths.length>100)throw Error("Excel workbook has too many XML parts.");
 for(const name of paths){
  const entry=archive.files[name];
  if(entry.dir)continue;
  const source=await entry.async("string");
  if(source.length>5_000_000)throw Error("Excel workbook XML part is too large.");
  const prefix='xmlns:x="'+spreadsheetML+'"';
  if(!source.includes(prefix))continue;
  const fixed=source.replaceAll(prefix,'xmlns="'+spreadsheetML+'"')
   .replace(/<(\/?)x:/g,"<$1");
  archive.file(name,fixed);
  changed++;
 }
 if(!changed)return null;
 return archive.generateAsync({type:"uint8array",compression:"DEFLATE"});
}
export async function readWorkbook(file,kind){
 if(!file?.name?.toLowerCase().endsWith(".xlsx"))throw Error("Upload an .xlsx Excel workbook.");
 if(file.size>2*1024*1024)throw Error("Excel file must be under 2 MB.");
 const ExcelJS=await excel();
 let book=new ExcelJS.Workbook();
 const bytes=await file.arrayBuffer();
 try{
  await book.xlsx.load(bytes);
 }catch(originalError){
  let normalized=null;
  try{normalized=await normalizeSpreadsheetML(bytes);}
  catch{throw new Error("This workbook could not be parsed. Please re-save it as an .xlsx file in Microsoft Excel or Google Sheets.");}
  if(!normalized)throw new Error("This workbook could not be parsed. Please re-save it as an .xlsx file in Microsoft Excel or Google Sheets.");
  book=new ExcelJS.Workbook();
  try{await book.xlsx.load(normalized);}
  catch{throw new Error("This workbook could not be parsed. Please re-save it as an .xlsx file in Microsoft Excel or Google Sheets.");}
 }
 const headers=kind==="stakeholders"?STAKEHOLDER_FIELDS:kind==="classes"?CLASS_FIELDS:STUDENT_FIELDS;
 const sheet=book.getWorksheet(kind==="stakeholders"?"Stakeholders":kind==="classes"?"Classes":"Students");
 if(!sheet)throw Error("Spreadsheet worksheet missing. Please use the downloadable Vision template.");
 const available=new Map();
 sheet.getRow(1).eachCell({includeEmpty:false},(cell,column)=>{
  const label=String(cell.text||"").trim().toLowerCase();
  available.set(label,column);
 });
 const missing=headers.filter(name=>!available.has(name));
 if(missing.length)throw Error("Required columns missing: "+missing.join(", "));
 const rows=[];
 sheet.eachRow({includeEmpty:false},(row,rowNumber)=>{
  if(rowNumber===1)return;
  if(rowNumber>1001)throw Error("Upload a maximum of 500 records at a time.");
  const record={row_number:rowNumber};
  let hasData=false;
  for(const header of headers){
   const cell=row.getCell(available.get(header));
   if(cell.formula||cell.sharedFormula)throw Error("Formula cells are not supported (row "+rowNumber+").");
   let value=cell.value;
   if(value&&typeof value==="object"&&"text" in value)value=value.text;
   else if(value&&typeof value==="object"&&"richText" in value)value=value.richText.map(p=>p.text).join("");
   else if(value&&typeof value==="object")value=cell.text;
   record[header]=String(value??"").trim();
   if(record[header])hasData=true;
  }
  if(hasData)rows.push(record);
 });
 if(rows.length===0)throw Error("The spreadsheet has no data rows.");
 if(rows.length>500)throw Error("Upload at most 500 records per spreadsheet.");
 if(kind==="stakeholders"){
  const duplicates=new Set(),unique=new Set();
  rows.forEach(r=>{const email=r.email.toLowerCase();if(unique.has(email))duplicates.add(email);unique.add(email);});
  if(duplicates.size)throw Error("The sheet contains duplicate email addresses. Remove duplicates before uploading.");
 }else{
  const unique=new Set();
  for(const row of rows){
   const key=(kind==="classes"?[row.grade,row.section,row.academic_year]:
      [row.grade,row.section,row.academic_year,row.admission_number]).join("|").toLowerCase();
   if((kind==="classes"||row.admission_number)&&unique.has(key))
    throw Error("Duplicate "+(kind==="classes"?"class":"student admission number")+" in the sheet (row "+row.row_number+").");
   unique.add(key);
  }
 }
 return rows;
}
export async function downloadExport(kind,rows,school){
 const ExcelJS=await excel();const book=new ExcelJS.Workbook();
 book.creator="Vision School Platform";
 workbookData(book,kind,rows);
 return trigger(book,outputName(kind,school,"export"));
}
export async function downloadImportResults(kind,results,school){
 const ExcelJS=await excel();const book=new ExcelJS.Workbook();book.creator="Vision School Platform";
 const sheet=book.addWorksheet("Import Results");
 const headers=["row_number","status","detail"];
 styleSheet(sheet,headers);
 for(const r of results)sheet.addRow([r.row_number,r.status,safeValue(r.detail)]);
 sheet.getColumn(3).width=76;
 return trigger(book,outputName(kind,school,"import_results"));
}
