// Recognition may end on silence even in continuous mode. Never stop audio here.
export function attachSpeechSession(recognition, {active, onUnavailable, onState=()=>{}, onCycle=()=>{}, schedule=setTimeout, cancel=clearTimeout}) {
 let timer, disposed=false, failures=0, fatal=false, finishing=false, finishResolve, finishTimer;
 const unavailable=reason=>{fatal=true;onUnavailable(reason);};
 const begin=()=>{onCycle();onState('Connecting to speech service…');recognition.start();};
 recognition.onstart=()=>{if(!disposed)onState('Listening — speak now');};
 recognition.onerror=event=>{if(disposed||!active())return;if(event.error==='no-speech'||event.error==='aborted')return;if(event.error==='network'&&++failures<=2)return;unavailable(event.error);};
 recognition.onend=()=>{if(finishing){cancel(finishTimer);finishResolve?.();return;}if(disposed||fatal||!active())return;onState('Reconnecting transcription…');timer=schedule(()=>{if(disposed||fatal||!active())return;try{begin();}catch(e){unavailable(e.message||'unavailable');}},failures?Math.min(4000,1000*failures):500);};
 return {start(){try{begin();}catch(e){unavailable(e.message||'unavailable');}},
 finish(){finishing=true;cancel(timer);return new Promise(resolve=>{finishResolve=resolve;finishTimer=schedule(resolve,1500);try{recognition.stop();}catch{cancel(finishTimer);resolve();}});},
 dispose(){disposed=true;cancel(timer);cancel(finishTimer);finishResolve?.();recognition.onstart=null;recognition.onend=null;recognition.onerror=null;recognition.onresult=null;try{recognition.abort();}catch{}}};
}

// Results may be repeated or revised on mobile. Rebuild each recognition cycle
// by index instead of appending every final result event a second time.
export function speechText(initial=''){
 let base=initial,final='',interim='';
 const joined=()=>[base,final].filter(Boolean).join(' ');
 return {cycle(){base=joined();final='';interim='';},read(results){
 const complete=[],preview=[];for(let i=0;i<results.length;i++){const text=String(results[i][0]?.transcript||'').trim();if(text)(results[i].isFinal?complete:preview).push(text);}
 final=complete.join(' ');interim=preview.join(' ');return {text:joined(),interim};
 }};
}
export function speechErrorMessage(reason){
 const messages={'not-allowed':'Allow microphone access in Chrome site settings, then tap Retry transcription.','service-not-allowed':'This browser blocked its speech service. Open the teacher link directly in Chrome and retry.','network':'Chrome could not reach its speech service. Check your internet connection and retry.','audio-capture':'The microphone is unavailable to transcription. Close other apps using the microphone and retry.','language-not-supported':'This speech service does not support the selected language. Stop recording and select another language.','no-speech':'No speech was detected. Speak closer to the microphone and retry.'};
 return messages[reason]||'Transcription is unavailable ('+reason+'). Retry or complete the text using your keyboard microphone after stopping.';
}
