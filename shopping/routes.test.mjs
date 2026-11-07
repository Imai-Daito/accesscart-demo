// Isolated server test: temporary fake records, no PayPal or OpenAI traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const root=new URL('../',import.meta.url);
test('HTTP shop preserves orders, separates sessions, rejects foreign writes, fails closed without AI',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'accesscart-test-'));
cpSync(new URL('runtime.mjs',root),join(dir,'runtime.mjs'));
 cpSync(new URL('checkout-probe/',root),join(dir,'checkout-probe'),{recursive:true});cpSync(new URL('shopping/',root),join(dir,'shopping'),{recursive:true});
 cpSync(new URL('payments/',root),join(dir,'payments'),{recursive:true});
 mkdirSync(join(dir,'.local'));writeFileSync(join(dir,'.env.local'),'ACCESSCART_AI_ENABLED=false\n');
 const record=JSON.stringify({'11111111-1111-1111-1111-111111111111':{id:'KEEP_THIS',paid:false,status:'PAYER_ACTION_REQUIRED',previousOrders:[{id:'KEEP_OLDER'}]}});
 writeFileSync(join(dir,'.local/checkout-probe.json'),record);
 const child=spawn(process.execPath,['checkout-probe/server.mjs'],{cwd:dir,env:{...process.env,OPENAI_API_KEY:'',ACCESSCART_AI_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Test port 4173 must be free');})]);
  const base='http://127.0.0.1:4173';
  const r=await fetch(base+'/api/shop/state');const cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();assert.equal(data.catalog.length,8);assert.equal(data.aiReady,false);
  const other=await fetch(base+'/api/shop/state');assert.notEqual(other.headers.get('set-cookie').split(';')[0],cookie);
  assert.equal((await fetch(base+'/api/shop/chat',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json',Cookie:cookie},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/shop/chat',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({message:'Add two bags'})})).status,503);
  assert.equal((await fetch(base+'/api/shop/reset',{method:'POST',headers:{Origin:base,Cookie:cookie+'; ac_probe=11111111-1111-1111-1111-111111111111'}})).status,409);
  assert.equal((await fetch(base+'/.env.local')).status,404);
  assert.equal((await fetch(base+'/shop')).status,200);
  assert.equal(readFileSync(join(dir,'.local/checkout-probe.json'),'utf8'),record);
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'exit');}rmSync(dir,{recursive:true,force:true});}
});
