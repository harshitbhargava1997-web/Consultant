// Recording segments must be decoded before combining: concatenating complete
// WebM/MP4 containers can leave only the first segment playable.
export const RECORDING_SLOT='lesson-recording';
export function recordingAttachment(files,file,id){
 const existing=files.find(f=>f.slot===RECORDING_SLOT);
 return [...files.filter(f=>f.slot!==RECORDING_SLOT),{id:existing?.id||id,slot:RECORDING_SLOT,category:'voice',file}];
}
export function pcmWave(segments,sampleRate=16000){
 const samples=segments.reduce((n,s)=>n+s.length,0);
 if(!samples)throw Error('No audio was captured. Please record again.');
 if(samples*2+44>50*1024*1024)throw Error('The combined recording exceeds 50 MB. Remove it and record a shorter reflection.');
 const bytes=new ArrayBuffer(44+samples*2),v=new DataView(bytes);
 const word=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
 word(0,'RIFF');v.setUint32(4,36+samples*2,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,samples*2,true);
 let offset=44;for(const segment of segments)for(const sample of segment){const n=Math.max(-1,Math.min(1,Number.isFinite(sample)?sample:0));v.setInt16(offset,Math.round(n*(n<0?32768:32767)),true);offset+=2;}
 return bytes;
}
export async function decodeRecording(file){
 const Context=window.AudioContext||window.webkitAudioContext;
 if(!Context)throw Error('This browser cannot combine recordings. Use a supported browser or attach a prepared recording.');
 const ctx=new Context({sampleRate:16000});
 try{const decoded=await ctx.decodeAudioData(await file.arrayBuffer());
  // Offline rendering normalizes browser-native rates and stereo to mono.
  const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  const render=new Offline(1,Math.ceil(decoded.duration*16000),16000),source=render.createBufferSource();source.buffer=decoded;source.connect(render.destination);source.start();
  const result=await render.startRendering();return new Float32Array(result.getChannelData(0));
 }finally{await ctx.close();}
}
