// Classroom photos straight from a phone camera are often 3–8 MB, which takes a long time to send over a school's
// mobile connection. Before upload, large photos are resized (longest side 2048 px) and saved as JPEG at 85%
// quality: still clear for classroom scenes and student handwriting, usually 300–800 KB. Videos, PDFs, audio and
// small photos are sent unchanged; if resizing fails or would not make the file smaller, the original is sent.
// Resizing also leaves out the camera's hidden details (such as location) that are stored inside photo files.
export const PHOTO_MAX_SIDE=2048,PHOTO_QUALITY=0.85,SHRINK_ABOVE=1024*1024;
const resizable=new Set(['image/jpeg','image/png','image/webp']);
export const jpegName=name=>String(name||'photo').replace(/\.(jpe?g|png|webp)$/i,'')+'.jpg';
export function targetSize(width,height,max=PHOTO_MAX_SIDE){
 const scale=Math.min(1,max/Math.max(width,height));
 return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export async function shrinkPhoto(file,{decode=f=>createImageBitmap(f,{imageOrientation:'from-image'}),makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;}}={}){
 if(!file||!resizable.has(file.type)||file.size<=SHRINK_ABOVE)return file;
 try{
  const bitmap=await decode(file);
  const {width,height}=targetSize(bitmap.width,bitmap.height);
  const canvas=makeCanvas(width,height),ctx=canvas.getContext('2d');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);   // transparent PNG areas become white, not black
  ctx.drawImage(bitmap,0,0,width,height);bitmap.close?.();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',PHOTO_QUALITY));
  if(!blob||!blob.size||blob.size>=file.size)return file;
  return new File([blob],jpegName(file.name),{type:'image/jpeg',lastModified:file.lastModified});
 }catch{return file;}
}
