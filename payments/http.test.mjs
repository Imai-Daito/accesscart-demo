import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fresh} from '../shopping/engine.mjs';
const root=new URL('../',import.meta.url);
test('checkout HTTP: serialized duplicate requests, cold restart, legacy isolation, AI privacy and paused-AI recovery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'accesscart-checkout-'));
cpSync(new URL('runtime.mjs',root),join(dir,'runtime.mjs'));
 for(const folder of ['shopping','checkout-probe','payments'])cpSync(new URL(folder+'/',root),join(dir,folder),{recursive:true});
 mkdirSync(join(dir,'.local'));
 const sid='22222222-2222-2222-2222-222222222222';const second='33333333-3333-3333-3333-333333333333';const legacy='11111111-1111-1111-1111-111111111111';
 const s=fresh();s.cart={'harbor-ground':1};const t=fresh();t.cart={'cedar-beans':1};
 writeFileSync(join(dir,'.local/shopping-state.json'),JSON.stringify({[sid]:s,[second]:t}));
 const record=JSON.stringify({[legacy]:{id:'KEEP_LEGACY',paid:false,status:'PAYER_ACTION_REQUIRED'}});writeFileSync(join(dir,'.local/checkout-probe.json'),record);
 writeFileSync(join(dir,'.env.local'),'ACCESSCART_AI_ENABLED=true\nOPENAI_API_KEY=fake-only\n');
 // Replace all remote API traffic in this subprocess. Keep the Node HTTP server real.
 writeFileSync(join(dir,'fake-api.mjs'),`
 import {writeFileSync} from 'node:fs';
 let order;
 globalThis.fetch=async(url,opts={})=>{
  const response=data=>({ok:true,json:async()=>structuredClone(data)});
  if(url.endsWith('/oauth2/token'))return response({access_token:'fake'});
  if(url.endsWith('/chat/completions')){
   writeFileSync('.local/ai-input.json',opts.body);
   return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'set',ids:['harbor-ground'],quantity:2,form:null,filters:{acidity:null,form:null,maxPriceCents:null},question:''})}}]});
  }
  if(url.endsWith('/v2/checkout/orders')){
   const body=JSON.parse(opts.body);await new Promise(resolve=>setTimeout(resolve,100));
   order={id:'ORDER12345678',intent:'CAPTURE',status:'PAYER_ACTION_REQUIRED',purchase_units:body.purchase_units,links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=ORDER12345678'}]};
   writeFileSync('.local/remote.json',JSON.stringify(order));return response(order);
  }
  if(url.endsWith('/capture')){
   order??=JSON.parse((await import('node:fs')).readFileSync('.local/remote.json','utf8'));
   order.status='COMPLETED';order.purchase_units[0].payments={captures:[{id:'CAPTURE123',status:'COMPLETED',amount:order.purchase_units[0].amount}]};writeFileSync('.local/remote.json',JSON.stringify(order));return response(order);
  }
  if(url.endsWith('/ORDER12345678')){
   order??=JSON.parse((await import('node:fs')).readFileSync('.local/remote.json','utf8'));
   if(order.status!=='COMPLETED')order.status='APPROVED';return response(order);
  }
  throw Error('Unexpected network call');
 };
 `);
 let child;
 async function start(){child=spawn(process.execPath,['--import','./fake-api.mjs','checkout-probe/server.mjs'],{cwd:dir,env:{...process.env,ACCESSCART_ORIGIN:'',ACCESSCART_PASSPHRASE:''},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Could not start test server');})]);}
 async function stop(){if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}}
 const base='http://127.0.0.1:4173';
 const post=(path,body={},cookie='ac_shop='+sid)=>fetch(base+'/api/shop/'+path,{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const view=async(cookie='ac_shop='+sid)=>(await fetch(base+'/api/shop/state',{headers:{Cookie:cookie}})).json();
 try{
  await start();
  assert.equal((await post('checkout/prepare',{confirmed:false,revision:0})).status,409);
  const a=post('checkout/prepare',{confirmed:true,revision:0});const b=post('checkout/prepare',{confirmed:true,revision:0});
  const pair=await Promise.all([a,b]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);
  const prepared=await view();assert.equal(prepared.checkout.cart.totalCents,2100);assert.equal(prepared.blocked,true);
  assert.equal((await post('reset')).status,409);
  assert.equal((await post('checkout/check',{attempt:'wrong'})).status,409);
  assert.equal((await post('checkout/cancel',{attempt:'wrong'})).status,409);
  assert.equal((await post('checkout/check',{attempt:prepared.checkout.attempt},'ac_shop='+second)).status,409);
  const chat=await post('chat',{message:'Make it two bags.'});assert.equal(chat.status,200);assert.equal((await chat.json()).cart.lines[0].quantity,1);
  const aiInput=readFileSync(join(dir,'.local/ai-input.json'),'utf8');assert.equal(aiInput.includes('ORDER12345678'),false);assert.equal(aiInput.includes(prepared.checkout.attempt),false);assert.equal(aiInput.includes('createKey'),false);
  assert.equal((await post('checkout/prepare',{confirmed:true,revision:0},'ac_shop='+second+'; ac_probe='+legacy)).status,409);
  await stop();writeFileSync(join(dir,'.local/ai-budget.json'),JSON.stringify({reservedYen:1000,calls:200,paused:true}));await start();
  const paid=await post('checkout/check',{attempt:prepared.checkout.attempt});assert.equal(paid.status,200);const result=await paid.json();assert.equal(result.checkout.phase,'PAID');assert.equal(result.cart.lines.length,0);assert.equal(result.catalog.find(p=>p.id==='harbor-ground').stock,3);
  assert.equal((await post('chat',{message:'cart'})).status,429);
  await post('checkout/check',{attempt:prepared.checkout.attempt});assert.equal((await view()).catalog.find(p=>p.id==='harbor-ground').stock,3);
  await post('reset');const reset=await view();assert.equal(reset.checkout.phase,'PAID');assert.equal(reset.aiStatus,'paused');assert.equal(reset.catalog.find(p=>p.id==='harbor-ground').stock,4);
  assert.equal(readFileSync(join(dir,'.local/checkout-probe.json'),'utf8'),record);
 }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
