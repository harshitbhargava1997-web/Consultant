// Recognition may end on silence even in continuous mode. Never stop audio here.
export function attachSpeechSession(recognition, {active, onUnavailable, schedule=setTimeout, cancel=clearTimeout}) {
 let timer, disposed=false, failures=0, fatal=false;
 const unavailable=reason=>{fatal=true;onUnavailable(reason);};
 recognition.onerror=event=>{if(disposed||!active())return;if(event.error==='no-speech'||event.error==='aborted')return;if(event.error==='network'&&++failures<=2)return;unavailable(event.error);};
 recognition.onend=()=>{if(disposed||fatal||!active())return;timer=schedule(()=>{if(disposed||fatal||!active())return;try{recognition.start();}catch(e){unavailable(e.message||'unavailable');}},400);};
 return {start(){try{recognition.start();}catch(e){unavailable(e.message||'unavailable');}},dispose(){disposed=true;cancel(timer);recognition.onend=null;recognition.onerror=null;recognition.onresult=null;try{recognition.abort();}catch{}}};
}
