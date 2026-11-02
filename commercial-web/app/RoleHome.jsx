'use client';
import {useState} from 'react';
import {ArrowRight,BookOpen,ClipboardList,Users,BarChart3,Eye,FolderOpen,Compass} from 'lucide-react';
import './role-home.css';
const teacherActions=[
 ['training','Teach','Open teaching content','Find a resource for the class you are teaching.',BookOpen],
 ['implementation','Plan','Prepare a lesson','Plan a period or return after class to add evidence.',ClipboardList,'','implementation.submit'],
 ['assessment-structure','Assess','Check a student’s learning','Choose a student and record what they can do.',Users,'student','assessments.create'],
 ['reports','Assess','View learning progress','See how learning has changed over time.',BarChart3],
 ['implementation-history','Plan','Find past submissions','Reopen earlier lesson preparations and evidence.',FolderOpen]
];
const leaderActions=[
 ['assessment-structure','Review','Review a teacher','Observe how a teacher demonstrates a literacy skill.',Eye,'teacher','teacher_reviews.create'],
 ['reports','Review','See learning progress','Open teacher and student progress reports.',BarChart3],
 ['implementation-history','Review','Check lesson evidence','Explore lesson preparations and classroom submissions.',ClipboardList],
 ['users','Manage','Open school directory','Find staff, classes and students.',Users],
 ['training','Resources','Explore teaching content','See the resources available for classroom teaching.',BookOpen],
 ['assessment-structure','Review','Check a student’s learning','Open a student assessment.',Compass,'student','assessments.create']
];
function Illustration({leader}){
 return <svg viewBox="0 0 290 164" aria-hidden="true" className="vh-art"><circle cx="184" cy="77" r="65" fill="#fde1a2"/><path d="M13 145Q65 93 132 121T289 107V164H13Z" fill="#85b8aa"/><g stroke="#183d43" strokeWidth="4" strokeLinejoin="round">{leader?<><path d="M70 141V75h119v66" fill="#f6c991"/><path d="m57 77 73-48 73 48Z" fill="#e18861"/><path d="M114 142v-36h31v36" fill="#366867"/><path d="M84 90h15v16H84zm77 0h15v16h-15z" fill="#fff8d8"/></>:<><path d="m44 70 69-11q18 0 28 13 20-17 45-18l54-3-17 75q-42-1-88 18-31-18-75-12Z" fill="#ef9c72"/><path d="M39 61q60-17 99 5 31-23 98-25l-18 75q-51 0-84 20-39-20-78-16Z" fill="#fff4cb"/><path d="m138 67-4 67m-63-55q27-5 49 4m-46 10q23-3 41 4m43-20q24-12 52-14" fill="none"/></>}</g><circle cx="44" cy="34" r="6" fill="#e98966"/><path d="m253 18 4 10 10 4-10 4-4 10-4-10-10-4 10-4Z" fill="#fff8d8"/></svg>;
}
export default function RoleHome({role,school,availableNav,can,open,children}){
 const leader=role==='principal', [filter,setFilter]=useState('All');
 const allowed=new Set(availableNav.map(n=>n.id));
 const actions=(leader?leaderActions:teacherActions).filter(([id,,,,,,grant])=>allowed.has(id)&&(!grant||can(grant)));
 const first=actions[0], categories=['All',...new Set(actions.map(a=>a[1]))];
 const go=a=>open(a[0],a[5]);
 return <section className={'vh-home '+(leader?'vh-leader':'vh-teacher')}><div className="vh-hero"><div><small>{leader?'SCHOOL LEADERSHIP':'CLASSROOM WORKSPACE'} · {school}</small><h2>{leader?'Your school at a glance':'Ready for class?'}</h2><p>{leader?'Review teaching, follow student progress and plan school support.':'Find your lesson, prepare a period or check learning.'}</p>{first&&<button className="vh-primary" onClick={()=>go(first)}>{first[2]} <ArrowRight size={18}/></button>}</div><Illustration leader={leader}/></div>
 {leader&&<div className="vh-totals">{children}</div>}
 <h2>{leader?'School actions':'My classroom tools'}</h2>{actions.length>0?<><div className="vh-filters" aria-label="Filter dashboard actions">{categories.map(c=><button key={c} aria-pressed={filter===c} onClick={()=>setFilter(c)}>{c}</button>)}</div><div className="vh-cards">{actions.filter(a=>filter==='All'||a[1]===filter).map(a=>{const Icon=a[4];return <button key={a[0]+a[2]} onClick={()=>go(a)} className="vh-card"><span className="vh-icon"><Icon size={24}/></span><strong>{a[2]}</strong><span>{a[3]}</span><ArrowRight className="vh-arrow" size={18}/></button>})}</div></>:<p>Your school administrator can enable tools for this account.</p>}
 <details className="vh-help"><summary>New to Vision? Start here</summary><p>{leader?'Select your school at the top. Choose Review to find teacher observations or reports.':'Check the school name at the top. Choose a classroom tool, then select your class or lesson.'} Use Overview in the menu to return here.</p></details>{!leader&&<details className="vh-help"><summary>View school totals</summary>{children}</details>}</section>;
}
