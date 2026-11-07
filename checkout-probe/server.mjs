import {origin,dataDir,port,local} from '../runtime.mjs';
import http from 'node:http';
import {createAccessGate} from './access.mjs';
import {shoppingRoute,sweepShopping} from '../shopping/routes.mjs';
import {pruneResolved,retentionDeadline} from '../payments/retention.mjs';
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const BASE='https://api-m.sandbox.paypal.com',ORIGIN=origin,dir=dataDir;
const file=new URL('checkout-probe.json',dir);
const db=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
function save(){writeFileSync(new URL('checkout-probe.tmp',dir),JSON.stringify(db),{mode:0o600});renameSync(new URL('checkout-probe.tmp',dir),file);}
const gate=createAccessGate({origin:ORIGIN,passphrase:process.env.ACCESSCART_PASSPHRASE,file:new URL('access-sessions.json',dir)});
const locks=new Set();
function sweepLegacy(){if(pruneResolved(db,{isBusy:id=>locks.has(id)}).length)save();}
setInterval(()=>{sweepShopping();sweepLegacy();gate.cleanup();},3600000).unref();
async function api(path,method='GET',body,key){
 const auth=await fetch(BASE+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(process.env.PAYPAL_SANDBOX_CLIENT_ID+':'+process.env.PAYPAL_SANDBOX_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(20000)});
 const a=await auth.json();if(!auth.ok||!a.access_token)throw Error('Sandbox authentication failed');
 const res=await fetch(BASE+path,{method,headers:{Authorization:'Bearer '+a.access_token,'Content-Type':'application/json',Prefer:'return=representation',...(key?{'PayPal-Request-Id':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const data=await res.json();if(!res.ok)throw Error('PayPal request could not be confirmed');return data;
}
function summarize(o){
 const captures=(o.purchase_units||[]).flatMap(u=>u.payments?.captures||[]);
 const completed=captures.filter(c=>c.status==='COMPLETED');
 const paid=o.status==='COMPLETED'&&completed.length===1&&completed[0].amount?.currency_code==='USD'&&completed[0].amount?.value==='33.00';
 return {id:o.id,status:o.status,paid,captureId:paid?completed[0].id:undefined};
}
function approval(o){const url=o.links?.find(l=>['payer-action','approve'].includes(l.rel))?.href;if(!url)return null;const u=new URL(url);return u.protocol==='https:'&&u.hostname==='www.sandbox.paypal.com'?url:null;}
function page(){return readFileSync(new URL('index.html',import.meta.url));}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.method==='GET'&&req.url==='/healthz'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('OK');}
 if(req.headers.host!==new URL(ORIGIN).host)return send(403,{error:'Local access only'});
 const url=new URL(req.url,ORIGIN);
 if(req.method==='POST'&&req.headers.origin!==ORIGIN)return send(403,{error:'Origin rejected'});
 if(!await gate(req,res,url))return;
 if(req.method==='GET'&&['/voice','/voice.js'].includes(url.pathname)){
  res.writeHead(200,{'Content-Type':url.pathname==='/voice'?'text/html; charset=utf-8':'text/javascript; charset=utf-8'});
  return res.end(readFileSync(new URL(url.pathname==='/voice'?'voice.html':'voice.js',import.meta.url)));
 }
 if(await shoppingRoute(req,res,url,db))return;
 if(!['/','/return','/cancel','/api/create','/api/status','/api/capture'].includes(url.pathname))return send(404,{error:'Not found'});
 sweepLegacy();
 let sid=req.headers.cookie?.match(/(?:^|; )ac_probe=([a-f0-9-]{36})(?:;|$)/)?.[1];
 if(Date.now()>=retentionDeadline&&(!sid||!db[sid]))return send(410,{error:'The evaluation period has ended. Resolved order records have been removed.'});
 if(!sid||!db[sid]){sid=randomUUID();db[sid]={};save();res.setHeader('Set-Cookie',`ac_probe=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);}
 const state=db[sid];
 if(req.method==='GET'&&['/','/return','/cancel'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(page());}
 if(!url.pathname.startsWith('/api/'))return send(404,{error:'Not found'});
 if(locks.has(sid))return send(409,{error:'Checking the existing order. Please wait.'});
 locks.add(sid);
 try{
  if(req.method==='POST'&&url.pathname==='/api/create'){
   if(state.id)return send(200,{id:state.id,status:state.status,paid:state.paid,approvalUrl:state.approvalUrl});
   return send(409,{error:'The fixed-price connection test is retired. Review your cart at /shop to start checkout.'});

  }
  if(req.method==='GET'&&url.pathname==='/api/status'){
   if(!state.id)return send(200,{status:state.createKey?'CREATE_UNCONFIRMED':'NOT_STARTED'});
   const o=await api('/v2/checkout/orders/'+encodeURIComponent(state.id));Object.assign(state,summarize(o));save();return send(200,{...summarize(o),approvalUrl:state.approvalUrl});
  }
  if(req.method==='POST'&&url.pathname==='/api/capture'){
   if(!state.id)return send(409,{error:'No order exists'});
   const path='/v2/checkout/orders/'+encodeURIComponent(state.id);
   let o=await api(path);
   if(o.status==='APPROVED'){
    state.captureAttempted=true;save();o=await api(path+'/capture','POST',{},state.captureKey);
   }
   Object.assign(state,summarize(o));save();return send(200,summarize(o));
  }
  return send(404,{error:'Not found'});
 }catch{
  return send(502,{error:'The result could not be confirmed. Check this order again; do not start another payment.'});
 }finally{locks.delete(sid);}
});
server.listen(port,local?'127.0.0.1':'0.0.0.0',()=>console.log('AccessCart local Sandbox probe: '+ORIGIN));
