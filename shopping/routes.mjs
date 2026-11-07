import {origin,dataDir} from '../runtime.mjs';
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {catalog} from './catalog.mjs';
import {fresh,snapshot,apply} from './engine.mjs';
import {interpret} from './ai.mjs';
import {createBudget} from './budget.mjs';
import {createCheckoutService,checkoutBlocks,checkoutView} from '../payments/checkout.mjs';
import {paypalApi} from '../payments/paypal.mjs';
import {pruneResolved,retentionDeadline} from '../payments/retention.mjs';
const dir=dataDir;
const stateFile=new URL('shopping-state.json',dir),budgetFile=new URL('ai-budget.json',dir);
const states=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{};
const usageBudget=createBudget(budgetFile);
const locks=new Set(),mem=new Map();
function save(file,data){const tmp=new URL(file.href+'.tmp');writeFileSync(tmp,JSON.stringify(data),{mode:0o600});renameSync(tmp,file);}
let checkout;
function paymentService(){return checkout??=createCheckoutService({api:paypalApi,save:()=>save(stateFile,states),origin});}
export function sweepShopping(){const ids=pruneResolved(states,{isBusy:id=>locks.has(id)});if(ids.length){for(const id of ids)mem.delete(id);save(stateFile,states);usageBudget.forget(ids);}}
function enabled(){return process.env.ACCESSCART_AI_ENABLED==='true'&&!!process.env.OPENAI_API_KEY;}
export async function shoppingRoute(req,res,url,probeDb){
 if(!['/shop','/shop.js','/payment-ui.js','/api/shop/state','/api/shop/chat','/api/shop/reset','/api/shop/checkout/prepare','/api/shop/checkout/check','/api/shop/checkout/cancel'].includes(url.pathname))return false;
 const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return true;};
 if(req.method==='GET'&&['/shop','/shop.js','/payment-ui.js'].includes(url.pathname)){
  res.writeHead(200,{'Content-Type':url.pathname==='/shop'?'text/html; charset=utf-8':'text/javascript; charset=utf-8'});
  res.end(readFileSync(new URL(url.pathname==='/shop'?'shop.html':url.pathname==='/shop.js'?'shop.js':'payment-ui.js',import.meta.url)));return true;
 }
 sweepShopping();
 let sid=req.headers.cookie?.match(/(?:^|; )ac_shop=([a-f0-9-]{36})(?:;|$)/)?.[1];
 if(Date.now()>=retentionDeadline&&(!sid||!states[sid]||!['/api/shop/state','/api/shop/checkout/check'].includes(url.pathname)))return send(410,{error:'The evaluation period has ended. Only confirmation of an existing unresolved payment remains available.'});
 if(!sid||!states[sid]){sid=randomUUID();states[sid]=fresh();save(stateFile,states);}
 res.setHeader('Set-Cookie',`ac_shop=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=15552000${origin.startsWith('https:')?'; Secure':''}`);
 const probeSid=req.headers.cookie?.match(/(?:^|; )ac_probe=([a-f0-9-]{36})(?:;|$)/)?.[1];
 const order=probeDb[probeSid];
 const legacyBlocked=()=>!!order&&(!!order.id&&!order.paid||!!order.createKey&&!order.id);
 const paymentBlocked=()=>legacyBlocked()||checkoutBlocks(states[sid]);
 const blocked=paymentBlocked();
 const s=states[sid];
 const view=()=>{const budget=usageBudget.read();return ({catalog:catalog.map(p=>({...p,stock:s.inventory[p.id]})),cart:snapshot(s),pending:!!s.pending,blocked:paymentBlocked(),legacyBlocked:!!legacyBlocked(),checkout:checkoutView(s),aiReady:enabled()&&!budget.paused&&!budget.lastError,aiStatus:!enabled()?'disabled':budget.paused?'paused':budget.lastError?'permission_error':budget.lastSuccessAt?'verified':'configured',reply:mem.get(sid)?.lastReply||'Welcome. Search for coffee, compare two products, or change your cart. Review your cart before continuing to PayPal Sandbox.'});};
 if(req.method==='GET'&&url.pathname==='/api/shop/state')return send(200,view());
 if(req.method!=='POST')return send(405,{error:'Method not allowed'});
 if(locks.has(sid))return send(409,{error:'A reply is in progress. Please wait.'});
 locks.add(sid);
 try{
  if(url.pathname==='/api/shop/reset'){
   if(blocked)return send(409,{error:'Check the existing payment before starting over. Order records are retained.'});
   Object.assign(s,fresh(),{revision:s.revision+1});mem.delete(sid);save(stateFile,states);return send(200,view());
  }
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'Please use a shorter message.'});}
  let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'Invalid message'});}
  if(url.pathname.startsWith('/api/shop/checkout/')){
   if(legacyBlocked())return send(409,{error:'An earlier Sandbox payment needs confirmation. Use the existing payment status link before starting checkout.'});
   try{
    if(url.pathname.endsWith('/prepare'))await paymentService().prepare(s,body);
    else if(body.attempt!==s.checkout?.attempt)return send(409,{error:'This return is for a different order. Check your current order; do not start a new payment.'});
    else if(url.pathname.endsWith('/cancel'))await paymentService().cancel(s,body.attempt);
    else await paymentService().recover(s);
    return send(200,view());
   }catch(e){return send(409,{error:e.message});}
  }
  const words=body.message;
  if(typeof words!=='string'||!words.trim()||words.length>500)return send(400,{error:'Please enter 1 to 500 characters.'});
  if(!enabled())return send(503,{error:'AI is not connected yet. Your cart has not changed.'});
  const limit=usageBudget.reserve(sid);if(limit)return send(429,{error:limit});
  const m=mem.get(sid)||{history:[],lastReply:''};
  const {cart,inventory,filters,compared,shown,pending,revision}=s;
  // Never send PayPal orders, IDs, request keys or recovery tokens to the AI.
  const a=await interpret(words,{cart,inventory,filters,compared,shown,pending,revision,blocked},m.history);
  usageBudget.success();
  const draft=structuredClone(s);
  const result=apply(draft,a,words,{blocked:paymentBlocked(),lastReply:m.lastReply});
  Object.assign(s,draft);save(stateFile,states);
  m.lastReply=result.reply;m.history.push({user:words,assistant:result.reply});m.history=m.history.slice(-4);mem.set(sid,m);
  return send(200,{...view(),reply:result.reply});
 }catch(e){
  if(e.message?.includes('HTTP 401')||e.message?.includes('HTTP 403')){usageBudget.permissionError();}
  return send(502,{error:e.message?.startsWith('AI ')||e.message?.startsWith('Conversation ')?e.message:'The reply could not be confirmed. Your cart has not changed. Please reload before trying again.'});}
 finally{locks.delete(sid);}
}
