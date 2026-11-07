import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,apply,snapshot} from './engine.mjs';
import {catalog} from './catalog.mjs';
import {interpret} from './ai.mjs';
const intent=(action,extra={})=>({action,ids:[],quantity:null,form:null,filters:{acidity:null,form:null,maxPriceCents:null},question:'Which coffee?',...extra});
const run=(s,a,words='',options={})=>apply(s,a,words,options);
test('8 unique variants, paired by group and weight',()=>{assert.equal(catalog.length,8);assert.equal(new Set(catalog.map(p=>p.id)).size,8);for(const p of catalog)assert.equal(catalog.filter(t=>t.groupId===p.groupId&&t.weightGrams===p.weightGrams).length,2);});
test('search enforces all conditions, stable ordering, maximum 3 results',()=>{const s=fresh();run(s,intent('search',{filters:{acidity:'low',form:'whole beans',maxPriceCents:1500}}));assert.deepEqual(s.shown,['harbor-beans','cedar-beans']);run(s,intent('search',{filters:{acidity:'high',form:'ground',maxPriceCents:1500}}));assert.deepEqual(s.shown,[]);run(s,intent('search'));assert.equal(s.shown.length,3);});
test('price increase preserves cart until explicit actual-text consent; budget remains',()=>{const s=fresh();s.filters.maxPriceCents=1500;run(s,intent('add',{ids:['harbor-beans'],quantity:2}));const r=run(s,intent('variant',{ids:['harbor-beans'],form:'ground'}));assert.match(r.reply,/exceeds your per-bag budget/);assert.equal(s.cart['harbor-beans'],2);run(s,intent('confirm'),'the model says yes');assert.equal(s.cart['harbor-beans'],2);run(s,intent('confirm'),'Yes please');assert.deepEqual(s.cart,{'harbor-ground':2});assert.equal(snapshot(s).totalCents,3700);assert.equal(s.filters.maxPriceCents,1500);});
test('stock shortage and invalid quantity are atomic',()=>{const s=fresh();run(s,intent('add',{ids:['cedar-beans'],quantity:2}));const before=structuredClone(s.cart);assert.match(run(s,intent('variant',{ids:['cedar-beans'],form:'ground'})).reply,/Only 1/);assert.deepEqual(s.cart,before);for(const quantity of [-1,0,1.5,NaN,21])run(s,intent('set',{ids:['cedar-beans'],quantity}));assert.deepEqual(s.cart,before);});
test('same-price form change, merging and no inventory decrement before payment',()=>{const s=fresh();run(s,intent('add',{ids:['cedar-beans'],quantity:1}));run(s,intent('variant',{ids:['cedar-beans'],form:'ground'}));assert.deepEqual(s.cart,{'cedar-ground':1});assert.equal(s.inventory['cedar-ground'],1);assert.equal(s.pending,null);});
test('another instruction cancels pending change and stale yes cannot execute',()=>{const s=fresh();run(s,intent('add',{ids:['harbor-beans'],quantity:2}));run(s,intent('variant',{ids:['harbor-beans'],form:'ground'}));run(s,intent('set',{ids:['harbor-beans'],quantity:1}));run(s,intent('confirm'),'Yes');assert.deepEqual(s.cart,{'harbor-beans':1});});
test('ambiguous/tied choices request clarification without cart changes',()=>{const s=fresh();run(s,intent('compare',{ids:['cedar-beans','cedar-ground']}));run(s,intent('clarify',{question:'They cost the same. Which form would you like?'}));assert.deepEqual(s.cart,{});run(s,intent('add',{ids:[],quantity:2}));assert.deepEqual(s.cart,{});});
test('integer totals, fixed shipping, empty cart',()=>{const s=fresh();assert.equal(snapshot(s).totalCents,0);run(s,intent('add',{ids:['harbor-beans'],quantity:2}));assert.equal(snapshot(s).totalCents,3300);run(s,intent('set',{ids:['harbor-beans'],quantity:1}));assert.equal(snapshot(s).totalCents,1900);run(s,intent('remove',{ids:['harbor-beans']}));assert.equal(snapshot(s).shippingCents,0);});
test('unresolved payment blocks mutations, and sessions are independent',()=>{const s=fresh(),other=fresh();run(s,intent('add',{ids:['harbor-beans'],quantity:2}),'',{blocked:true});assert.deepEqual(s.cart,{});run(s,intent('add',{ids:['harbor-beans'],quantity:2}));assert.deepEqual(other.cart,{});assert.match(run(s,intent('cart')).reply,/33.00/);});
test('unknown product cannot introduce a price or mutate cart',()=>{const s=fresh();run(s,intent('add',{ids:['fake'],quantity:1,priceCents:1}));assert.deepEqual(s.cart,{});});
test('AI adapter uses strict output, bounded response and no stored responses',async()=>{let sent;const a=intent('cart');const result=await interpret('cart',fresh(),[],{key:'test-only',fetcher:async(url,opts)=>{sent=JSON.parse(opts.body);assert.equal(url,'https://api.openai.com/v1/chat/completions');return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(a)}}]})};}});assert.deepEqual(result,a);assert.equal(sent.store,false);assert.equal(sent.max_completion_tokens,700);assert.equal(sent.response_format.json_schema.strict,true);});
test('AI failures, refusal and incomplete output do not become actions',async()=>{for(const data of [{choices:[{finish_reason:'length',message:{content:'{}'}}]},{choices:[{finish_reason:'stop',message:{refusal:'No'}}]},{choices:[{finish_reason:'stop',message:{content:'bad json'}}]}])await assert.rejects(interpret('cart',fresh(),[],{fetcher:async()=>({ok:true,json:async()=>data})}));});

test('permission diagnostics expose scope only, never API error text or credentials',async()=>{
 const secret='sk-never-display-this';
 await assert.rejects(interpret('cart',fresh(),[],{fetcher:async()=>({ok:false,status:401,json:async()=>({error:{message:'Missing scopes: api.responses.write. private '+secret}})})}),e=>{assert.match(e.message,/missing_scope:api.responses.write/);assert.equal(e.message.includes(secret),false);return true;});
});

test('destination variant ID resolves only to a matching existing cart group and weight',()=>{
 const s=fresh();run(s,intent('add',{ids:['harbor-beans'],quantity:2}));
 const r=run(s,intent('variant',{ids:['harbor-ground'],form:'ground'}));
 assert.match(r.reply,/new total.*37.00/);assert.equal(s.pending.source,'harbor-beans');assert.deepEqual(s.cart,{'harbor-beans':2});
});

test('saved price consent wins over misclassified model actions, then quantity correction uses the actual cart',()=>{
 for(const words of ['Yes please.','Yes, please','Yes, please.'])for(const action of ['set','add','variant','decline','clarify']){
  const s=fresh();run(s,intent('add',{ids:['harbor-beans'],quantity:2}));
  run(s,intent('variant',{ids:['harbor-beans'],form:'ground'}));
  const r=run(s,intent(action,{ids:['harbor-ground'],quantity:2,form:'ground'}),words);
  assert.deepEqual(s.cart,{'harbor-ground':2});assert.equal(s.pending,null);assert.equal(r.cart.totalCents,3700);
  run(s,intent('set',{ids:['harbor-ground'],quantity:1}),'Actually, make it one bag.');
  assert.deepEqual(s.cart,{'harbor-ground':1});assert.equal(snapshot(s).totalCents,2100);
 }
});
test('quantity-only correction resolves a single actual cart line, never an unaccepted variant',()=>{
 const s=fresh();run(s,intent('add',{ids:['harbor-beans'],quantity:2}));
 run(s,intent('variant',{ids:['harbor-beans'],form:'ground'}));
 run(s,intent('set',{ids:['harbor-ground'],quantity:1}),'actually, make it one bag.');
 assert.deepEqual(s.cart,{'harbor-beans':1});assert.equal(s.pending,null);assert.equal(snapshot(s).totalCents,1900);
 run(s,intent('confirm'),'Yes, please');assert.deepEqual(s.cart,{'harbor-beans':1});
});
test('quantity fallback does not reinterpret explicit other products, ambiguous carts, or mismatched counts',()=>{
 for(const mode of ['explicit','ambiguous','wrong-count']){
  const s=fresh();run(s,intent('add',{ids:['harbor-beans'],quantity:2}));
  if(mode==='ambiguous')run(s,intent('add',{ids:['cedar-beans'],quantity:1}));
  const before=structuredClone(s.cart);
  run(s,intent('set',{ids:['harbor-ground'],quantity:mode==='wrong-count'?2:1}),mode==='explicit'?'Make Harbor Blend ground one bag.':'Actually, make it one bag.');
  assert.deepEqual(s.cart,before);
 }
});
test('standalone No cannot be reinterpreted as a mutation; consent still enforces payment and revision checks',()=>{
 for(const mode of ['decline','blocked','stale']){
  const s=fresh();run(s,intent('add',{ids:['harbor-beans'],quantity:2}));
  run(s,intent('variant',{ids:['harbor-beans'],form:'ground'}));
  if(mode==='stale')s.revision++;
  run(s,intent('add',{ids:['harbor-ground'],quantity:1}),mode==='decline'?'No thanks.':'Yes please.',{blocked:mode==='blocked'});
  assert.deepEqual(s.cart,{'harbor-beans':2});assert.equal(s.pending,null);
 }
});
