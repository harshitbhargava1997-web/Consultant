'use client';
import {useState} from 'react';
import {Search,ArrowRight} from 'lucide-react';
export const guide={
 overview:['Your workspace','Choose what you want to work on today.'],
 training:['Find teaching content','Choose a class to find activities and resources for your next lesson.'],
 implementation:['Prepare a lesson','Plan a class period or return to a saved lesson to add evidence.'],
 'assessment-structure':['Check learning','Explore the skills, then choose a teacher review or student assessment.'],
 reports:['See learning progress','Choose a report to see what is going well and what needs practice.'],
 competencies:['Explore literacy skills','Explore the progression of reading and writing skills across classes.'],
 'implementation-history':['Find lesson evidence','Look up earlier preparations and classroom submissions.'],
 observations:['Review classroom practice','Explore classroom observations and feedback.'],
 schools:['Manage schools','Find a school or update its details.'],
 users:['Find people and classes','Manage school logins, staff, students and classes.'],
 accounts:['Manage a login','Change your own sign-in password.'],
 permissions:['Set role access','Choose which tools each stakeholder role can use.'],
 consultant:['Support a school','Open support tools for your assigned schools.'],
 'school-success':['Open School Success','Continue to the separate school implementation workspace.']
};
export function LearningArt(){return <svg className="vision-learning-art" aria-hidden="true" viewBox="0 0 210 96"><path d="M2 79Q35 39 67 64T145 46T207 35" fill="none" stroke="#cca362" strokeWidth="2" strokeDasharray="4 5"/><circle cx="158" cy="41" r="34" fill="#ffda8e"/><g transform="rotate(-9 88 54)" stroke="#204d4b" strokeWidth="3.5" strokeLinejoin="round"><path d="M42 32q21-7 46 4 25-13 48-6v46q-23-6-47 6-26-12-47-5Z" fill="#ef9676"/><path d="M39 25q25-6 48 7 26-13 47-8v45q-22-5-46 7-22-12-49-6Z" fill="#fff7dd"/><path d="m87 32 1 44m-35-32 21 3m-21 9 18 3m29-15 18-5" fill="none"/></g><path d="m170 15 3 6 7 2-6 4-1 7-5-5-7 1 3-7-3-6Z" fill="#805b9c"/></svg>}
export function TaskFinder({items,open,expanded=false}){
 const [query,set]=useState('');const clean=query.trim().toLowerCase();
 const choices=items.filter(x=>x.id!=='overview'&&[x.label,...(guide[x.id]||[])].join(' ').toLowerCase().includes(clean));
 const body=<><label className="vision-search"><Search size={18} aria-hidden="true"/><input aria-label="Search available tasks" placeholder="Search, for example: lesson, student, password" value={query} onChange={e=>set(e.target.value)}/></label><div className="vision-tiles">{choices.map(({id,label,icon:Icon})=><button type="button" key={id} className="vision-tile" onClick={()=>open(id)}><i><Icon size={21}/></i><span><strong>{guide[id]?.[0]||label}</strong><small>{label}</small></span><ArrowRight size={16}/></button>)}</div>{!choices.length&&<p role="status">No matching tools. Try another word or <button type="button" onClick={()=>set('')}>show all tools</button>.</p>}</>;
 return expanded?<section className="vision-find"><h2>What would you like to do?</h2>{body}</section>:<details className="vision-find"><summary>Find another task</summary>{body}</details>;
}
