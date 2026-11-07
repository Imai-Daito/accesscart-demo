'use strict';
const el=id=>document.getElementById(id);
const start=el('start'),stop=el('stop'),send=el('send'),text=el('transcript');
const read=el('read'),silence=el('silence'),auto=el('read-aloud');
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
const synth=window.speechSynthesis;
let active=null,limitTimer=null,finishTimer=null,stoppedAt=null;
let speechGeneration=0,utterance=null;
let hasReply=false,busy=false,aiAvailable=false;
const notify=message=>{el('status').textContent=message;};
function idle(){
 clearTimeout(limitTimer);clearTimeout(finishTimer);active=null;
 start.disabled=!Recognition||busy||!aiAvailable;stop.disabled=true;send.disabled=busy;text.disabled=busy;
 read.disabled=!synth||!hasReply;
}
function quiet(){speechGeneration++;if(synth)synth.cancel();utterance=null;}
function speak(){
 if(!synth){notify('Read aloud is unavailable. Read the reply as text.');return;}
 if(active||!hasReply)return;
 quiet();const generation=speechGeneration;
 utterance=new SpeechSynthesisUtterance(el('reply').textContent);utterance.lang='en-US';
 const voice=synth.getVoices().find(v=>v.lang.toLowerCase().startsWith('en'));
 if(voice)utterance.voice=voice;
 utterance.onstart=()=>{if(generation===speechGeneration)notify('Reading aloud. Choose Stop speaking to stop.');};
 utterance.onend=()=>{if(generation===speechGeneration){utterance=null;notify('Reading finished.');}};
 utterance.onerror=()=>{if(generation===speechGeneration){utterance=null;notify('Read aloud could not finish. You can read the reply as text.');}};
 synth.speak(utterance);
}
const dollars=c=>'$'+(c/100).toFixed(2)+' USD';
function display(data){
 aiAvailable=data.aiReady;start.disabled=!Recognition||busy||!!active||!aiAvailable;
 el('cart').textContent=data.cart.lines.length?data.cart.lines.map(p=>`${p.name}, ${p.form}: ${p.quantity} bag(s) at ${dollars(p.priceCents)} each.`).join(' ')+` Subtotal ${dollars(data.cart.subtotalCents)}. Shipping ${dollars(data.cart.shippingCents)}. Total ${dollars(data.cart.totalCents)}.`:'Your cart is empty. No shipping charged.';
 el('ai-state').textContent=({verified:'The last AI request succeeded.',configured:'AI is configured. Send a message to check the connection.',permission_error:'AI access is unavailable because its permission check failed. Your cart is retained. Ask the demo owner to check access before retrying.',paused:'AI is paused at the local usage limit. Existing payment status remains available.',disabled:'AI is not connected yet.'})[data.aiStatus]||'AI connection status is unknown.';
 if(data.blocked)el('ai-state').textContent+=data.legacyBlocked?' An earlier payment needs confirmation. Use the existing Sandbox payment link.':' A checkout is in progress. Cart changes and Start over are blocked. Use Check this payment again above.';
 el('reset').disabled=busy||data.blocked;
 el('catalog').replaceChildren(...data.catalog.map(p=>{const li=document.createElement('li');li.textContent=`${p.name}, ${p.form}, ${p.weightGrams} grams. ${dollars(p.priceCents)} per bag. ${p.acidity} acidity. ${p.roast} roast. ${p.flavor}. Stock: ${p.stock}.`;return li;}));
 el('reply').textContent=data.reply;hasReply=true;read.disabled=!synth;
}
async function request(path,body){
 const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Please try again.');return data;
}
async function respond(value){
 const words=value.trim();if(!words){notify('Please say or type a message.');return;}
 if(busy)return;
 quiet();busy=true;idle();el('reset').disabled=true;notify('Thinking. Your message is being interpreted.');
 try{
  const data=await request('/api/shop/chat',{message:words});display(data);
  const li=document.createElement('li');li.textContent='You: '+words+' Assistant: '+data.reply;el('history').append(li);
  notify('Reply ready. Your cart is shown below.');if(auto.checked)speak();
 }catch(e){notify(e.message);}
 finally{busy=false;idle();try{display(await request('/api/shop/state'));}catch{el('reset').disabled=true;}}
}
el('reset').onclick=async()=>{
 if(busy||active)return;quiet();busy=true;idle();el('reset').disabled=true;
 try{display(await request('/api/shop/reset',{}));el('history').replaceChildren();text.value='';notify('Shopping conversation, cart and demo inventory reset. Existing order records and usage limits are retained.');}catch(e){notify(e.message);}finally{busy=false;idle();try{display(await request('/api/shop/state'));}catch{el('reset').disabled=true;}}
};
function finishListening(){
 if(!active||stoppedAt!==null)return;
 stoppedAt=performance.now();stop.disabled=true;notify('Processing speech. You can type if recognition does not finish.');
 const recognition=active;
 // Do not leave text entry blocked if the recognition service never responds.
 finishTimer=setTimeout(()=>{
  if(active!==recognition)return;
  idle();recognition.abort();notify('Speech recognition timed out. Please type your message or try again.');
 },10000);
 try{recognition.stop();}catch{idle();notify('Speech recognition stopped. Please type your message.');}
}
start.onclick=()=>{
 if(active||busy||!Recognition||!aiAvailable)return;
 quiet();stoppedAt=null;el('latency').textContent='Not measured yet.';
 const recognition=new Recognition();active=recognition;
 recognition.lang='en-US';recognition.continuous=false;recognition.interimResults=false;
 start.disabled=true;stop.disabled=false;send.disabled=true;text.disabled=true;read.disabled=true;
 notify('Starting microphone. If asked, allow microphone and speech recognition to run this test.');
 let finalWords='',draftWords='';
 const finalParts=new Map();
 let opened=false,heardSpeech=false;
 const progress=()=>{el('progress').textContent='Microphone: '+(opened?'opened':'waiting')+'. Speech: '+(heardSpeech?'detected':'not detected yet')+'. Recognized text: '+(draftWords?'received':'not received yet')+'.';};
 el('recognition-result').textContent='Waiting for a new speech recognition result.';
 progress();
 recognition.onstart=()=>{if(active===recognition)notify('Listening. Say your shopping request, then choose Stop listening.');};
 recognition.onaudiostart=()=>{if(active===recognition){opened=true;progress();}};
 recognition.onspeechstart=()=>{if(active===recognition){heardSpeech=true;progress();}};
 recognition.onresult=event=>{
  if(active!==recognition)return;
  // Preserve final results if a later event contains no new finalized words.
  const results=Array.from(event.results);
  results.forEach((r,index)=>{const words=r[0]?.transcript?.trim();if(r.isFinal&&words)finalParts.set(index,words);});
  finalWords=[...finalParts.entries()].sort((a,b)=>a[0]-b[0]).map(([,words])=>words).join(' ').slice(0,500);
  const received=results.map(r=>r[0]?.transcript||'').join(' ').trim().slice(0,500);
  if(received)draftWords=received;
  const visible=received||finalWords||draftWords;
  if(visible){
   text.value=visible;
   el('recognition-result').textContent=finalWords?'Speech recognition returned confirmed text.':'Speech recognition returned a draft. Review the words before using them.';
   if(stoppedAt!==null)el('latency').textContent=((performance.now()-stoppedAt)/1000).toFixed(2)+' seconds';
  }
  progress();
 };
 recognition.onerror=event=>{
  if(active!==recognition)return;
  const messages={'not-allowed':'Microphone or speech recognition permission was denied. You can type your message below.','service-not-allowed':'Speech recognition is unavailable. Check Safari and Siri settings, or use text.','audio-capture':'No microphone is available. Use text or check your microphone.','no-speech':'No speech was detected. Try again or type your message.','network':'Speech recognition could not connect. Please use text.','language-not-supported':'English speech recognition is unavailable. Please use text.'};
  idle();recognition.abort();notify(messages[event.error]||'Speech recognition could not finish. Please use text or try again.');
 };
 recognition.onend=()=>{
  if(active!==recognition)return;
  idle();
  if(finalWords)respond(finalWords);
  else if(draftWords)notify('A speech draft is shown in the text box. Review it, then choose Use this text.');
  else{el('recognition-result').textContent='Speech recognition returned no text.';notify('No words received from speech recognition. Try again or type your message.');}
 };
 limitTimer=setTimeout(finishListening,20000);
 try{recognition.start();}catch{idle();notify('Speech recognition could not start. Please use text or try Safari.');}
};
stop.onclick=finishListening;
el('form').onsubmit=event=>{event.preventDefault();if(!active&&!busy)respond(text.value);};
auto.onchange=()=>{if(!auto.checked){quiet();notify('App read aloud is off. Replies remain available as text for VoiceOver.');}};
read.onclick=speak;
silence.onclick=()=>{quiet();notify('Read aloud stopped.');};
function suspend(){quiet();if(active){const recognition=active;idle();recognition.abort();notify('Listening stopped because you left this page.');}}
window.addEventListener('pagehide',suspend);
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});
el('support').textContent='Speech recognition: '+(Recognition?'available':'unavailable')+'. Read aloud: '+(synth?'available':'unavailable')+'. English (US).';
start.disabled=true;read.disabled=true;silence.disabled=!synth;auto.disabled=!synth;
notify(Recognition?'Ready. Choose Start listening or type your message.':'Speech recognition is unavailable in this browser. Try Safari, or type your message below.');

request('/api/shop/state').then(display).catch(()=>notify('The shop could not load. Please reload this page.'));
