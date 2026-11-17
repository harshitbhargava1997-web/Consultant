// Browser-only helpers for lesson documentation PDFs: Devanagari text shaping through the
// canvas, and optional evidence thumbnails. Images are fetched from the same stored URLs the
// user can already open; nothing is uploaded, cached server-side or made public here.
const PT=0.3528;
// Latin glyphs come from the same DejaVu Sans the PDF text uses; Devanagari falls back to Noto.
const FONT_STACK='LessonReportSans, LessonHindi, "Noto Sans Devanagari", sans-serif';
let fontReady=null;
export function loadLessonFont(){
 if(typeof document==='undefined'||typeof FontFace==='undefined')return Promise.resolve();
 if(!fontReady)fontReady=(async()=>{
  const {regularFont,boldFont}=await import('./report-fonts.js');
  const bytes=b64=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer;
  const faces=[new FontFace('LessonHindi','url(/fonts/Lesson-Devanagari.ttf)'),new FontFace('LessonReportSans',bytes(regularFont),{weight:'400'}),new FontFace('LessonReportSans',bytes(boldFont),{weight:'700'})];
  for(const face of await Promise.all(faces.map(f=>f.load())))document.fonts.add(face);
  await document.fonts.ready;
 })().catch(error=>{fontReady=null;throw error;});
 return fontReady;
}
// Draws text with the browser's shaping engine and returns PNG lines sized in millimetres.
export function canvasRaster(makeCanvas=()=>document.createElement('canvas'),pxPerMm=11.8){
 const measureCanvas=makeCanvas(),measure=measureCanvas.getContext('2d'),cache=new Map();
 const css=(size,bold)=>`${bold?'700':'400'} ${size*PT*pxPerMm}px ${FONT_STACK}`;
 const width=(text,size,bold)=>{measure.font=css(size,bold);return measure.measureText(text).width/pxPerMm;};
 const graphemes=text=>typeof Intl!=='undefined'&&Intl.Segmenter?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(x=>x.segment):Array.from(text);
 function breakWord(token,maxWidth,size,bold){const parts=[];let part='';for(const g of graphemes(token)){if(part&&width(part+g,size,bold)>maxWidth){parts.push(part);part=g;}else part+=g;}if(part)parts.push(part);return parts;}
 return {
  width,
  wrap(text,maxWidth,size,bold){
   const lines=[];
   for(const paragraph of String(text).split('\n')){
    if(!paragraph.trim()){lines.push('');continue;}
    let row='';
    for(const token of paragraph.split(/\s+/).filter(Boolean)){
     // An unbroken token wider than the line is split between grapheme clusters, never inside one.
     for(const word of width(token,size,bold)>maxWidth?breakWord(token,maxWidth,size,bold):[token]){
      const trial=row?row+' '+word:word;
      if(row&&width(trial,size,bold)>maxWidth){lines.push(row);row=word;}else row=trial;
     }
    }
    if(row)lines.push(row);
   }
   return lines;
  },
  line(text,size,bold,color){
   const key=JSON.stringify([text,size,bold,color]);if(cache.has(key))return cache.get(key);
   const h=size*PT*1.45,w=width(text,size,bold)+size*PT*0.3,canvas=makeCanvas();
   canvas.width=Math.max(1,Math.ceil(w*pxPerMm));canvas.height=Math.max(1,Math.ceil(h*pxPerMm));
   const ctx=canvas.getContext('2d');ctx.font=css(size,bold);ctx.fillStyle=color;ctx.textBaseline='alphabetic';
   ctx.fillText(text,0,h*0.71*pxPerMm);
   const result={data:canvas.toDataURL('image/png'),width:canvas.width/pxPerMm,height:h};cache.set(key,result);return result;
  }
 };
}
// Fetches up to `limit` images, downscaled to JPEG thumbnails. Failures fall back to links.
export async function loadEvidenceImages(urls,{limit=120,maxPx=1000,timeout=15000,concurrency=4,onProgress}={}){
 const list=[...new Set(urls)].slice(0,limit),images=new Map();let done=0;
 async function one(url){
  try{
   const response=await fetch(url,{mode:'cors',credentials:'omit',signal:AbortSignal.timeout(timeout)});
   if(!response.ok)return;
   const blob=await response.blob();if(!/^image\//.test(blob.type)&&!/\.(jpe?g|png|webp)(\?|$)/i.test(url))return;
   const bitmap=await createImageBitmap(blob);
   const scale=Math.min(1,maxPx/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
   images.set(url,{data:canvas.toDataURL('image/jpeg',0.82),width:canvas.width,height:canvas.height,format:'JPEG'});
  }catch{/* unreachable or blocked image: keep the link only */}
  finally{done++;onProgress?.(done,list.length);}
 }
 for(let i=0;i<list.length;i+=concurrency)await Promise.all(list.slice(i,i+concurrency).map(one));
 return images;
}
