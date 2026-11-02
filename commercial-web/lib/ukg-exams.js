export const formOf = item => /^ukg-form-([bc])-/.exec(item.code || '')?.[1] || 'a';
export const blendGroups = {all:'All blends',l:'L-blends',r:'R-blends',s:'S-blends',other:'Other blends'};
export function inBlendGroup(pattern,group){
 if(group==='all')return true;
 if(group==='s')return pattern.startsWith('s');
 if(group==='l'||group==='r')return pattern.endsWith(group);
 return !pattern.startsWith('s')&&!/[lr]$/.test(pattern);
}
export function examItems(items,family,form,group){
 return items.filter(w=>w.family===family&&formOf(w)===form&&(family!=='consonant-blend'||inBlendGroup(w.grapheme,group)));
}
export const patternOf=item=>(item.code||'').replace(/^ukg-form-[bc]-/,'');
export function priorPatternRatings(history,items,competencyId){
 const keys=new Map(items.map(w=>[w.id,patternOf(w)])), prior=new Map();
 // The assessment history is newest first. Keep distinct sounds such as both th entries.
 for(const row of history){const pattern=keys.get(row.item_id);if(row.competency_id!==competencyId||!pattern)continue;
 for(const dim of row.observation_dimension&&row.observation_dimension!=='overall'?[row.observation_dimension]:['sound','reading']){
 const key=pattern+'::'+dim;if(!prior.has(key))prior.set(key,row.rating);
 }}
 return prior;
}
