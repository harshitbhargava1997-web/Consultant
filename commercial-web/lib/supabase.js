import { createClient } from "@supabase/supabase-js";

export function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
}
export const LEVELS = ["Nursery","LKG","UKG","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5"];
export const RATINGS = ["Not Assessed","Emerging","Developing","Independent"];
export const RATING_LABELS = {
  "Not Assessed": "Not checked",
  "Emerging": "Cannot do yet",
  "Developing": "Can do with help",
  "Independent": "Can do independently"
};
export const ASSESSMENT_MODES = [
  {value:"complete",label:"Complete assessment",detail:"Check all applicable competencies"},
  {value:"random",label:"Random assessment",detail:"Software selects a balanced sample"},
  {value:"targeted",label:"Targeted assessment",detail:"Recheck competencies needing support"}
];
export const MANAGERS = ["owner","principal","coordinator"];
export function skillProgress(competencies, results, enrolledGrade) {
  const levels = LEVELS.slice(0, LEVELS.indexOf(enrolledGrade) + 1);
  let highest = null;
  let consecutive = true;
  const byLevel = levels.map(level => {
    const skills = competencies.filter(c => c.grade === level && c.active !== false);
    const assessed = skills.map(s => results[s.id]).filter(r => r && r !== "Not Assessed");
    const coverage = skills.length ? assessed.length / skills.length : 0;
    const independence = assessed.length ? assessed.filter(x => x === "Independent").length / assessed.length : 0;
    const mastered = skills.length > 0 && coverage >= 0.8 && independence >= 0.8;
    if (consecutive && mastered) highest = level;
    else consecutive = false;
    return { level, count: skills.length, assessed: assessed.length,
      coverage: Math.round(coverage * 100), independence: Math.round(independence * 100), mastered };
  });
  return { highest, byLevel };
}
export function parseCsv(input) {
  const rows = [], line = []; let cell = "", quoted = false;
  for(let i=0;i<input.length;i++){
    const c=input[i]; if(c==='"' && input[i+1]==='"' && quoted){cell+='"';i++;}
    else if(c==='"'){quoted=!quoted;}
    else if(c===',' && !quoted){line.push(cell);cell="";}
    else if((c==='\n'||c==='\r') && !quoted){if(c==='\r'&&input[i+1]==='\n')i++;
      line.push(cell); if(line.some(v=>v.trim())) rows.push([...line]);line.length=0;cell="";}
    else cell+=c;
  }
  line.push(cell);if(line.some(v=>v.trim()))rows.push([...line]);
  if(quoted)throw Error("CSV contains an unclosed quoted field.");
  const [header,...body]=rows; if(!header) return [];
  const keys=header.map(v=>v.replace(/^\uFEFF/,"").trim().toLowerCase());
  if(!keys.includes("student_name"))throw Error("CSV requires student_name column.");
  return body.map(row=>Object.fromEntries(keys.map((k,i)=>[k,(row[i]||"").trim()])));
}
