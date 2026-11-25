'use client';
// The signed-in teacher for the school link open in this browser. The session token is issued by the server after
// the teacher's PIN is checked; it is valid for 30 days or until the PIN changes, and is removed on Log out.
import {linkParams} from './link-params.js';
const KEY='school-success:teacher-session';
const accessParam=()=>{try{return linkParams().get('access')||'';}catch{return '';}};
export function teacherSession(access=accessParam()){
 try{const s=JSON.parse(localStorage.getItem(KEY)||'null');return s&&s.access===access&&typeof s.teacher==='string'&&typeof s.token==='string'?s:null;}catch{return null;}
}
export function saveTeacherSession(teacher,token,access=accessParam()){try{localStorage.setItem(KEY,JSON.stringify({access,teacher,token}));}catch{}}
export function clearTeacherSession(){try{localStorage.removeItem(KEY);}catch{}}
