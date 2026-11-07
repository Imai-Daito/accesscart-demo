import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
const hash=value=>createHash('sha256').update(value).digest();
export function createAccessGate({origin,passphrase,file,now=()=>Date.now()}){
 const local=origin==='http://127.0.0.1:4173';
 if(!local&&(!origin.startsWith('https://')||!passphrase||passphrase.length<16))throw Error('Public mode requires HTTPS and a private passphrase of at least 16 characters.');
 const attempts=new Map();
 const load=()=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
 function save(sessions){const tmp=new URL(file.href+'.tmp');writeFileSync(tmp,JSON.stringify(sessions),{mode:0o600});renameSync(tmp,file);}
 const digest=passphrase?hash(passphrase):null;
 const form=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AccessCart · Demo access</title><main><h1>AccessCart demo access</h1><p>Fictional coffee. PayPal Sandbox only. No real charge or delivery.</p><form method="post" action="/access"><label for="passphrase">Demo passphrase</label><input id="passphrase" name="passphrase" type="password" required autocomplete="current-password"><button>Enter demo</button></form></main></html>`;
 const gate=async function(req,res,url){
  if(local)return true;
  const send=(status,message)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(message);return false;};
  const token=req.headers.cookie?.match(/(?:^|; )ac_access=([a-f0-9]{64})(?:;|$)/)?.[1];
  const sessions=load();const key=token?hash(token).toString('hex'):null;
  if(key&&sessions[key]?.expires>now())return true;
  if(url.pathname==='/access'&&req.method==='POST'){
   const ip=req.socket.remoteAddress||'unknown';const rate=attempts.get(ip)||{start:now(),count:0};if(now()-rate.start>60000){rate.start=now();rate.count=0;}rate.count++;if(attempts.size>1000)attempts.clear();attempts.set(ip,rate);
   if(rate.count>5)return send(429,'Too many access attempts. Please wait one minute.');
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(413,'Passphrase entry is too long.');}
   const value=new URLSearchParams(raw).get('passphrase')||'';
   if(!timingSafeEqual(hash(value),digest))return send(403,'The passphrase did not match. Go back and try again.');
   const next=randomBytes(32).toString('hex'),latest=load();for(const [k,v] of Object.entries(latest))if(v.expires<=now())delete latest[k];
   latest[hash(next).toString('hex')]={expires:now()+12*3600000};save(latest);
   res.setHeader('Set-Cookie',`ac_access=${next}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`);res.writeHead(303,{Location:'/shop'});res.end();return false;
  }
  // Native form POSTs under no-referrer send Origin: null. Keep the real
  // same-origin value for login while still suppressing cross-origin referrers.
  if(req.method==='GET'&&!url.pathname.startsWith('/api/')){res.setHeader('Referrer-Policy','same-origin');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(form);return false;}
  return send(401,'Enter the demo passphrase before using the app.');
 };
 gate.cleanup=()=>{const sessions=load();let changed=false;for(const [key,value] of Object.entries(sessions))if(value.expires<=now()){delete sessions[key];changed=true;}if(changed)save(sessions);};
 return gate;
}
