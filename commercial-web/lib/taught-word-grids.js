// Vision teaching groups, relative to phonics explicitly taught. These are not Dolch categories.
const regular='in it and big can down for funny go help jump little look make me my not play red run see three up we yellow am at on he she ate be black brown but came did eat get good like must new no now out ran ride saw say so soon that this too under well went white will with yes I blue our'.split(' ');
const cues={
 a:'Its letter name is heard in isolation; in speech it often has a weak vowel.',
 is:'Final s sounds like z.',away:'The first a often has a weak vowel; ay is the regular part.',
 come:'The o is short despite final e.',find:'The i is long before nd.',here:'Teach ere as a unit in this word.',
 one:'Listen for the initial w sound.',said:'ai represents the vowel in bed.',the:'th is voiced; the vowel changes in connected speech.',
 to:'o sounds like oo in moon.',two:'w is silent and o sounds like oo in moon.',where:'Compare ere in where and here.',
 you:'Teach ou in this word alongside the initial y sound.',all:'Teach the vowel before ll.',are:'Learn the spelling are as a whole pattern.',
 do:'o sounds like oo in moon.',four:'Compare our in four and our.',have:'The a stays short before final e.',
 into:'Blend in, then recall the spelling of to.',please:'The final se sounds like z.',pretty:'The first e sounds like short i.',
 there:'Compare there with where.',they:'ey represents the vowel in day.',want:'Listen to the vowel after w in your pronunciation.',
 was:'Notice the vowel and final s sounding like z.',what:'Listen to the vowel after wh in your pronunciation.',who:'wh represents h; o sounds like oo in moon.'
};
export function wordType(word){return Object.hasOwn(cues,word)?'tricky':regular.includes(word)?'phonetic':'unclassified';}
export function wordCue(word){return cues[word]||'';}
export function fiveSets(items){const out=[];for(let i=0;i<items.length;i+=5){const fresh=items.slice(i,i+5);out.push([...fresh,...items.slice(0,Math.min(i,5-fresh.length))]);}return out;}
export const gridFamilies={'consonant-digraph':'Consonant digraphs','vowel-digraph':'Vowel digraphs','consonant-blend':'Consonant blends'};
