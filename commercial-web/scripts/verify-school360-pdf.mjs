import {mkdirSync,writeFileSync} from 'node:fs';
import {school360Fixture,from,to} from '../tests/fixtures/school360.js';
import {buildSchoolPortfolio} from '../lib/school-success/school-portfolio.js';
import {createSchoolPortfolioPdf} from '../lib/school-success/school-portfolio-pdf.js';
const data=school360Fixture(),model=buildSchoolPortfolio(data,from,to);
mkdirSync('tmp/school360-qa',{recursive:true});
const schools=Array.from({length:28},(_,i)=>({...model.schools[i%3],name:String(i+1).padStart(2,'0')+' · Sample School with a Long Name '+i}));
for(const [name,options] of [['portfolio',{schools,settings:model.settings,from,to}],['school',{schools:[model.schools[0]],settings:model.settings,from,to,detail:true,includeEvidence:true,includeObservations:true,rawObservations:data.entries}]]){
 const pdf=createSchoolPortfolioPdf(options);writeFileSync('tmp/school360-qa/'+name+'.pdf',Buffer.from(pdf.output('arraybuffer')));console.log(name+': '+pdf.getNumberOfPages()+' pages');
}
