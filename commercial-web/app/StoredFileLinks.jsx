'use client';
import {splitStoredFiles} from '@/lib/report-sequence';
export default function StoredFileLinks({files=[],label=f=>f.category||f.name||'Open file'}){
 return splitStoredFiles(files).map((group,i)=><div key={group.label||i}>{group.label&&<h4>{group.label}</h4>}<div className="evidence-files">{group.files.map((f,index)=><a className="file" key={f.path||f.key||f.id||index} href={f.url} target="_blank" rel="noopener noreferrer">{label(f)}</a>)}</div></div>);
}
