import {request as httpRequest} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
// Use native HTTP to model a TLS proxy preserving the external Host header.
// Browser Fetch does not allow callers to set Host.
const fetch=(url,options={})=>new Promise((resolve,reject)=>{
 const req=httpRequest(url,{method:options.method||'GET',headers:options.headers},res=>{
  let body='';res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>{const value=res.headers[key.toLowerCase()];return Array.isArray(value)?value.join(', '):value||null;}},json:async()=>JSON.parse(body)}));
 });req.on('error',reject);req.end(options.body);
});
const root=new URL('../',import.meta.url);
test('public deployment: origin, secure gate, health, durable storage, private data isolation across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'accesscart-public-')),disk=join(dir,'persistent');mkdirSync(disk);cpSync(new URL('runtime.mjs',root),join(dir,'runtime.mjs'));for(const folder of ['shopping','payments','checkout-probe'])cpSync(new URL(folder+'/',root),join(dir,folder),{recursive:true});
 const origin='https://accesscart.example.org',base='http://127.0.0.1:4187',secret='test-only-passphrase';
 writeFileSync(join(dir,'.env.local'),`ACCESSCART_DATA_DIR=${disk}\nACCESSCART_PASSPHRASE=${secret}\nACCESSCART_AI_ENABLED=false\nPORT=4187\n`);
 let child;
 async function start(){child=spawn(process.execPath,['checkout-probe/server.mjs'],{cwd:dir,env:{...process.env,ACCESSCART_ORIGIN:'',RENDER_EXTERNAL_URL:origin},stdio:['ignore','pipe','pipe']});await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Public test server failed');})]);}
 async function stop(){if(child?.exitCode===null&&child.signalCode===null){const e=once(child,'exit');child.kill();await e;}}
 try{
  await start();assert.equal((await fetch(base+'/healthz')).status,200);assert.equal((await fetch(base+'/api/shop/state',{headers:{Host:'forged.example'}})).status,403);
  assert.equal((await fetch(base+'/api/shop/state',{headers:{Host:'accesscart.example.org'}})).status,401);
  const gatePage=await fetch(base+'/shop',{headers:{Host:'accesscart.example.org'}});assert.equal(gatePage.headers.get('referrer-policy'),'same-origin');
  for(const badOrigin of [undefined,'null'])assert.equal((await fetch(base+'/access',{method:'POST',headers:{Host:'accesscart.example.org',...(badOrigin?{Origin:badOrigin}:{})},body:'passphrase='+secret})).status,403);
  assert.equal((await fetch(base+'/access',{method:'POST',headers:{Host:'accesscart.example.org',Origin:'https://attacker.example'},body:'passphrase='+secret})).status,403);
  const login=await fetch(base+'/access',{method:'POST',redirect:'manual',headers:{Host:'accesscart.example.org',Origin:origin},body:'passphrase='+secret});assert.equal(login.status,303);const access=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/Secure/);
  const page=await fetch(base+'/api/shop/state',{headers:{Host:'accesscart.example.org',Cookie:access}});assert.equal(page.status,200);const shopper=page.headers.get('set-cookie').split(';')[0];assert.match(page.headers.get('set-cookie'),/Secure/);const cookies=access+'; '+shopper;
  assert.ok(existsSync(join(disk,'shopping-state.json')));assert.equal(existsSync(join(dir,'.local/shopping-state.json')),false);
  const before=readFileSync(join(disk,'shopping-state.json'),'utf8');await stop();await start();const after=await fetch(base+'/api/shop/state',{headers:{Host:'accesscart.example.org',Cookie:cookies}});assert.equal(after.status,200);assert.equal(after.headers.get('set-cookie').split(';')[0],shopper);assert.equal(readFileSync(join(disk,'shopping-state.json'),'utf8'),before);
 }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});
