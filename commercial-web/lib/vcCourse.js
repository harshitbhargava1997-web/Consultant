export const VC_COLUMNS=["m","n","t","p","b","s"];
export const VC_UNITS=[
 {vowel:"a",number:1,anchor:"apple",core:["am","an","at"],words:["am","an","at"],meaning:"Teacher reads: I am here; an apple; at school. These phrases explain meaning; they are not independent sentence-reading tasks.",bridge:"m + at → mat; c + at → cat",note:"Leave as for later: its s commonly spells /z/."},
 {vowel:"e",number:2,anchor:"egg",core:["em","en","et"],words:[],meaning:"These are practice chunks, not standalone vocabulary words. Do not invent meanings or ask for picture matching. Show meaningful transfer later in met, pen and pet.",bridge:"m + et → met; p + en → pen; p + et → pet",note:"Short e has few useful familiar standalone VC words. Assess sound joining with explicitly labelled chunks."},
 {vowel:"i",number:3,anchor:"ink",core:["in","it","im"],words:["in","it"],meaning:"Teacher reads: in the box; it is here. im is a practice chunk only.",bridge:"p + in → pin; s + it → sit; h + im → him",note:"Leave is for later: its s commonly spells /z/. Contrast short i with short e using teacher modelling."},
 {vowel:"o",number:4,anchor:"orange",core:["on","ot","op"],words:["on"],meaning:"Teacher reads: on the table. ot and op are practice chunks only.",bridge:"p + ot → pot; h + op → hop; m + op → mop",note:"Use short o, not the letter-name sound. Leave of for separate teaching because of its unusual sound-spelling pattern."},
 {vowel:"u",number:5,anchor:"up",core:["up","us","um"],words:["up","us"],meaning:"Teacher reads: stand up; come with us. um is used only as a practice chunk here.",bridge:"c + up → cup; b + us → bus; s + um → sum",note:"Use short u as in up, not the letter name you. Revisit all five short vowels in mixed practice."}
];
export const vcCombinations=unit=>VC_COLUMNS.map(c=>unit.vowel+c).filter(w=>w!=="as"&&w!=="is");
export function getVcItem(item){
 if(item?.grade!=="LKG")return null;
 const match=/^VC Unit ([1-5]) — Short ([AEIOU]) — (Teacher Lesson|Printable Worksheets|Teacher Readiness and Review)$/.exec(item.title||"");
 if(!match)return null;
 const unit=VC_UNITS.find(u=>u.number===Number(match[1])&&u.vowel===match[2].toLowerCase());
 return unit?{unit,panel:match[3]==="Printable Worksheets"?"worksheets":match[3]==="Teacher Readiness and Review"?"review":"prepare"}:null;
}
