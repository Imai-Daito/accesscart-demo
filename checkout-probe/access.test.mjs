import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createAccessGate} from './access.mjs';
const request=(method='GET',cookie='',value='')=>({method,headers:{cookie},socket:{remoteAddress:'test'},async *[Symbol.asyncIterator](){yield 'passphrase='+encodeURIComponent(value);}});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code,headers){this.code=code;Object.assign(this.headers,headers);},end(body){this.body=body;}});
test('public mode refuses insecure origin or weak passphrase',()=>{const file=new URL('file:///tmp/unused-accesscart.json');assert.throws(()=>createAccessGate({origin:'https://example.org',passphrase:'short',file}));assert.throws(()=>createAccessGate({origin:'http://example.org',passphrase:'x'.repeat(20),file}));});
test('public gate protects APIs, authenticates securely, persists access without storing raw passphrase/token and expires',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'accesscart-access-'));const file=pathToFileURL(join(dir,'sessions.json'));const origin='https://example.org';const passphrase='private-demo-passphrase';let now=0;
 try{
  const gate=createAccessGate({origin,passphrase,file,now:()=>now});let res=response();assert.equal(await gate(request(),res,new URL(origin+'/api/shop/state')),false);assert.equal(res.code,401);
  res=response();await gate(request('POST','','wrong'),res,new URL(origin+'/access'));assert.equal(res.code,403);
  res=response();await gate(request('POST','',passphrase),res,new URL(origin+'/access'));assert.equal(res.code,303);assert.match(res.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
  const cookie=res.headers['Set-Cookie'].split(';')[0];const saved=readFileSync(file,'utf8');assert.equal(saved.includes(passphrase),false);assert.equal(saved.includes(cookie.split('=')[1]),false);
  assert.equal(await createAccessGate({origin,passphrase,file,now:()=>now})(request('GET',cookie),response(),new URL(origin+'/shop')),true);
  now+=13*3600000;res=response();assert.equal(await gate(request('GET',cookie),res,new URL(origin+'/api/shop/state')),false);assert.equal(res.code,401);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('repeated wrong passphrases are throttled',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'accesscart-access-'));try{const gate=createAccessGate({origin:'https://example.org',passphrase:'x'.repeat(20),file:pathToFileURL(join(dir,'a.json'))});let res;for(let n=0;n<6;n++){res=response();await gate(request('POST','','bad'),res,new URL('https://example.org/access'));}assert.equal(res.code,429);}finally{rmSync(dir,{recursive:true,force:true});}
});
