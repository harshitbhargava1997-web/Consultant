import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pcmWave,recordingAttachment} from '../lib/lesson-audio.js';
test('repeated section recordings retain one attachment identity without replacing prepared attachments',()=>{
 const prepared={id:'uploaded',category:'voice',file:{name:'Prepared.mp3'}},one={name:'one.wav'},two={name:'two.wav'};
 const first=recordingAttachment([prepared],one,'session-a'),second=recordingAttachment(first,two,'session-b');
 assert.equal(second.length,2);assert.equal(second[0],prepared);assert.equal(second[1].id,'session-a');assert.equal(second[1].file,two);
 assert.equal(recordingAttachment([],two,'other-period')[0].id,'other-period');
});
test('independent audio decoder reads all Start–Stop segments in order from one playable file',()=>{
 const parts=[new Float32Array(1600).fill(.25),new Float32Array(3200).fill(-.5),new Float32Array(1600).fill(.75)],dir=mkdtempSync(join(tmpdir(),'lesson-audio-'));
 try{const path=join(dir,'reflection.wav');writeFileSync(path,Buffer.from(pcmWave(parts)));
  const probe=JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_streams','-of','json',path],{encoding:'utf8'})).streams[0];
  assert.equal(probe.codec_name,'pcm_s16le');assert.equal(probe.channels,1);assert.equal(probe.sample_rate,'16000');assert.equal(Number(probe.duration),.4);
  const decoded=execFileSync('ffmpeg',['-v','error','-i',path,'-f','f32le','-']);assert.equal(decoded.length,6400*4);
  assert(Math.abs(decoded.readFloatLE(800*4)-.25)<.001);assert(Math.abs(decoded.readFloatLE(3200*4)+.5)<.001);assert(Math.abs(decoded.readFloatLE(6000*4)-.75)<.001);
 }finally{rmSync(dir,{recursive:true,force:true});}
 assert.throws(()=>pcmWave([]),/No audio/);
});
