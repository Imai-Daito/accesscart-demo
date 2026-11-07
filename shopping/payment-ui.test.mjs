import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('payment-ui.js',import.meta.url),'utf8');
async function page({phase='UNKNOWN',query=''}={}){
 let time=0,next=0;const timers=new Map(),nodes=new Map(),calls=[];
 const element=id=>{if(!nodes.has(id))nodes.set(id,{checked:false,hidden:false,disabled:false,textContent:'',setAttribute(){},removeAttribute(k){delete this[k];},focus(){}});return nodes.get(id);};
 const data={cart:{revision:0,lines:[{id:'harbor-ground',name:'Harbor Blend',form:'ground',quantity:1,priceCents:1600}],totalCents:2100},blocked:phase!=='PAID',legacyBlocked:false,checkout:{attempt:'current',id:'ORDER12345678',phase,cart:{lines:[{name:'Harbor Blend',form:'ground',quantity:1,priceCents:1600}],subtotalCents:1600,shippingCents:500,totalCents:2100},canCancel:false,approvalUrl:null}};
 const context={document:{getElementById:element},location:{search:query},history:{replaceState(){}},URLSearchParams,Date:{now:()=>time},window:{addEventListener(){}},dollars:c=>'$'+(c/100).toFixed(2),quiet(){},display(){},setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:time+delay});return id;},clearTimeout(id){timers.delete(id);},async request(path,body){calls.push({path,body});return structuredClone(data);}};
 vm.runInNewContext(code,context);const flush=()=>new Promise(setImmediate);await flush();
 const advance=async ms=>{const end=time+ms;while(true){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;const [id,t]=due;timers.delete(id);time=t.at;await t.fn();await flush();}time=end;await flush();};
 return {nodes,element,calls,context,data,advance,flush};
}
test('unknown payment polls same attempt for about 30 seconds, then manual check; never creates another order',async()=>{
 const p=await page();await p.advance(32000);const n=p.calls.length;assert.equal(p.calls.filter(c=>c.path.endsWith('/check')).length,8);assert.match(p.element('payment-status').textContent,/still unconfirmed/);
 assert.equal(p.element('payment-check').hidden,false);assert.equal(p.element('payment-check').disabled,false);await p.advance(60000);assert.equal(p.calls.length,n);
 await p.element('payment-check').onclick();assert.equal(p.calls.length,n+1);for(const c of p.calls.filter(c=>c.body))assert.equal(c.body.attempt,'current');assert.equal(p.calls.some(c=>c.path.endsWith('/prepare')),false);
});
test('old return cannot capture or cancel a different current order',async()=>{
 for(const query of ['?checkout=old','?cancel=old']){const p=await page({query});assert.equal(p.calls.length,1);assert.match(p.element('payment-status').textContent,/older or different/);await p.advance(60000);assert.equal(p.calls.length,1);}
});
test('cart revision change clears prior purchase consent and paid revisit does not make requests',async()=>{
 const p=await page({phase:'PAID'});assert.equal(p.calls.length,1);p.element('purchase-consent').checked=true;p.context.display({...p.data,cart:{...p.data.cart,revision:1}});assert.equal(p.element('purchase-consent').checked,false);await p.advance(60000);assert.equal(p.calls.length,1);
});
