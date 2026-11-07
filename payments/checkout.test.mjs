import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,snapshot} from '../shopping/engine.mjs';
import {checkoutBlocks,checkoutView,createCheckoutService} from './checkout.mjs';
function fixture(){
 let time=100000,commits=0,createCalls=0,captureCalls=0,failCreate=false,failCapture=false,getFailure=false;
 const s=fresh();s.cart={'harbor-ground':1};
 const remote=new Map(),createKeys=new Map(),captureKeys=new Set();
 const api=async(path,method='GET',body,key)=>{
  if(path==='/v2/checkout/orders'){
   createCalls++;let id=createKeys.get(key);
   if(!id){id='ORDER'+String(remote.size+1).padStart(8,'0');createKeys.set(key,id);remote.set(id,{id,intent:'CAPTURE',status:'PAYER_ACTION_REQUIRED',purchase_units:structuredClone(body.purchase_units),links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token='+id}]});}
   if(failCreate){failCreate=false;throw Error('Lost create response');}return structuredClone(remote.get(id));
  }
  const id=path.split('/')[4],o=remote.get(id);if(!o)throw Error('Not found');
  if(method==='GET'){if(getFailure)throw Error('Network down');return structuredClone(o);}
  if(path.endsWith('/capture')){
   if(!captureKeys.has(key)){captureKeys.add(key);captureCalls++;o.status='COMPLETED';o.purchase_units[0].payments={captures:[{id:'CAPTURE'+id,status:'COMPLETED',amount:structuredClone(o.purchase_units[0].amount)}]};}
   if(failCapture){failCapture=false;throw Error('Lost capture response');}return structuredClone(o);
  }
  throw Error('Unexpected API request');
 };
 const save=()=>{commits++;};const service=createCheckoutService({api,save,origin:'http://127.0.0.1:4173',now:()=>time});
 return {s,service,remote,api,save,approve:()=>{remote.get(s.checkout.id).status='APPROVED';},get counts(){return {createCalls,captureCalls,commits};},loseCreate:()=>{failCreate=true;},loseCapture:()=>{failCapture=true;},offline:()=>{getFailure=true;},advance:ms=>{time+=ms;}};
}
const prepare=f=>f.service.prepare(f.s,{confirmed:true,revision:f.s.revision,totalCents:1});
test('explicit review and current revision required; empty cart cannot create',async()=>{
 const f=fixture();await assert.rejects(f.service.prepare(f.s,{}));await assert.rejects(f.service.prepare(f.s,{confirmed:true,revision:99}));f.s.cart={};await assert.rejects(prepare(f));assert.equal(f.counts.createCalls,0);
});
test('server catalog totals ignore browser price; immutable order snapshot',async()=>{
 const f=fixture();await prepare(f);assert.equal(f.s.checkout.cart.totalCents,2100);assert.equal(f.remote.get(f.s.checkout.id).purchase_units[0].amount.value,'21.00');
 f.s.cart['harbor-ground']=2;assert.equal(f.s.checkout.cart.lines[0].quantity,1);assert.ok(checkoutBlocks(f.s));
});
test('duplicate prepare returns the same order and unique create/capture keys',async()=>{
 const f=fixture();await prepare(f);const id=f.s.checkout.id;await prepare(f);assert.equal(f.s.checkout.id,id);assert.equal(f.counts.createCalls,1);assert.notEqual(f.s.checkout.createKey,f.s.checkout.captureKey);
});
test('unapproved order is never captured and inventory is unchanged',async()=>{
 const f=fixture();await prepare(f);await f.service.recover(f.s);assert.equal(f.counts.captureCalls,0);assert.equal(f.s.inventory['harbor-ground'],4);
});
test('approved payment confirmed with exact amounts, inventory debited once',async()=>{
 const f=fixture();await prepare(f);f.approve();await f.service.recover(f.s);assert.equal(f.s.checkout.phase,'PAID');assert.equal(f.s.inventory['harbor-ground'],3);assert.deepEqual(f.s.cart,{});
 await f.service.recover(f.s);await prepare(f);assert.equal(f.counts.captureCalls,1);assert.equal(f.counts.createCalls,1);assert.equal(f.s.inventory['harbor-ground'],3);assert.equal(checkoutBlocks(f.s),false);
});
test('lost create response reuses identical request key and snapshot',async()=>{
 const f=fixture();f.loseCreate();await prepare(f);assert.equal(f.s.checkout.phase,'UNKNOWN');const key=f.s.checkout.createKey;assert.equal(f.s.checkout.id,undefined);
 await prepare(f);assert.equal(f.counts.createCalls,1);await f.service.recover(f.s);assert.equal(f.remote.size,1);assert.equal(f.s.checkout.createKey,key);assert.equal(f.s.checkout.phase,'AWAITING_APPROVAL');
});
test('lost capture response recovers original payment with no second debit',async()=>{
 const f=fixture();await prepare(f);f.approve();f.loseCapture();await f.service.recover(f.s);assert.equal(f.s.checkout.phase,'UNKNOWN');assert.equal(f.s.inventory['harbor-ground'],4);
 await f.service.recover(f.s);assert.equal(f.s.checkout.phase,'PAID');assert.equal(f.counts.captureCalls,1);assert.equal(f.s.inventory['harbor-ground'],3);
});
test('restart after lost capture restores saved snapshot and same request identity',async()=>{
 const f=fixture();await prepare(f);f.approve();f.loseCapture();await f.service.recover(f.s);
 const restored=JSON.parse(JSON.stringify(f.s));const restarted=createCheckoutService({api:f.api,save:f.save,origin:'http://127.0.0.1:4173'});
 await restarted.recover(restored);assert.equal(restored.checkout.phase,'PAID');assert.equal(restored.inventory['harbor-ground'],3);assert.equal(f.counts.captureCalls,1);
});
test('a failed GET remains unknown and blocks replacement irrespective of elapsed time',async()=>{
 const f=fixture();await prepare(f);f.offline();await f.service.recover(f.s);f.advance(10*86400000);await prepare(f);assert.equal(f.s.checkout.phase,'UNKNOWN');assert.ok(checkoutBlocks(f.s));assert.equal(f.counts.createCalls,1);
});
test('create recovery outside safe idempotency window never posts a new order',async()=>{
 const f=fixture();f.loseCreate();await prepare(f);f.advance(6*3600000);await f.service.recover(f.s);assert.equal(f.counts.createCalls,1);assert.equal(f.s.checkout.phase,'UNKNOWN');
});
test('wrong total, currency, order identity or marker never captures',async()=>{
 for(const corrupt of [o=>o.purchase_units[0].amount.value='0.01',o=>o.purchase_units[0].amount.currency_code='EUR',o=>o.id='DIFFERENT',o=>o.purchase_units[0].custom_id='OTHER']){
  const f=fixture();await prepare(f);f.approve();corrupt(f.remote.get(f.s.checkout.id));await f.service.recover(f.s);assert.equal(f.s.checkout.phase,'UNKNOWN');assert.equal(f.counts.captureCalls,0);
 }
});
test('wrong capture amount and pending capture never count as paid',async()=>{
 for(const [value,status] of [['1.00','COMPLETED'],['21.00','PENDING']]){
  const f=fixture();await prepare(f);const o=f.remote.get(f.s.checkout.id);o.status='COMPLETED';o.purchase_units[0].payments={captures:[{id:'C',status,amount:{currency_code:'USD',value}}]};
  await f.service.recover(f.s);assert.equal(f.s.checkout.phase,'UNKNOWN');assert.equal(f.s.inventory['harbor-ground'],4);assert.equal(checkoutView(f.s).paid,false);
 }
});
test('cancel unapproved checkout retains cart and delayed approval cannot capture it',async()=>{
 const f=fixture();await prepare(f);const attempt=f.s.checkout.attempt;await f.service.cancel(f.s,attempt);assert.equal(f.s.checkout.phase,'CANCELED');assert.equal(f.s.cart['harbor-ground'],1);
 f.approve();await f.service.recover(f.s);assert.equal(f.counts.captureCalls,0);assert.equal(f.s.checkout.phase,'CANCELED');await prepare(f);assert.equal(f.s.checkoutHistory[0].phase,'CANCELED');assert.equal(f.remote.size,2);
});
test('approved order cannot be canceled; completion wins',async()=>{
 const f=fixture();await prepare(f);f.approve();await f.service.cancel(f.s,f.s.checkout.attempt);assert.equal(f.s.checkout.phase,'PAID');assert.equal(f.counts.captureCalls,1);
});
test('mismatched old attempt never cancels a current order',async()=>{
 const f=fixture();await prepare(f);await assert.rejects(f.service.cancel(f.s,'old-attempt'));assert.equal(f.s.checkout.phase,'AWAITING_APPROVAL');
});
test('new cart after paid order preserves immutable history and separate keys',async()=>{
 const f=fixture();await prepare(f);f.approve();await f.service.recover(f.s);const old=structuredClone(f.s.checkout);
 f.s.cart={'cedar-beans':1};f.s.revision++;await prepare(f);assert.deepEqual(f.s.checkoutHistory[0],old);assert.notEqual(f.s.checkout.createKey,old.createKey);assert.equal(f.s.checkout.cart.totalCents,2000);
});
test('public checkout view never exposes recovery request keys',async()=>{
 const f=fixture();await prepare(f);const view=checkoutView(f.s);assert.equal(view.createKey,undefined);assert.equal(view.captureKey,undefined);assert.equal(view.cart.totalCents,snapshot(f.s).totalCents);
});

test('a nonempty new cart can start checkout even after revision counters used in old records',async()=>{
 const f=fixture();await prepare(f);f.approve();await f.service.recover(f.s);f.s.cart={'cedar-beans':1};f.s.revision=f.s.checkout.finishedRevision;
 await prepare(f);assert.equal(f.counts.createCalls,2);assert.equal(f.s.checkout.cart.lines[0].id,'cedar-beans');
});
