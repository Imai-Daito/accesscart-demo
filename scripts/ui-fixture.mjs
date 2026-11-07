// Disposable UI fixture: fake API, fake cart and separate localhost cookie domain.
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const root=new URL('../',import.meta.url),dir=mkdtempSync(join(tmpdir(),'accesscart-ui-'));
cpSync(new URL('runtime.mjs',root),join(dir,'runtime.mjs'));
for(const folder of ['shopping','checkout-probe','payments'])cpSync(new URL(folder+'/',root),join(dir,folder),{recursive:true});
function adapt(folder){for(const e of readdirSync(folder,{withFileTypes:true})){const p=join(folder,e.name);if(e.isDirectory())adapt(p);else if(/\.(mjs|js|html)$/.test(p)){let s=readFileSync(p,'utf8').replaceAll('http://127.0.0.1:4173','http://localhost:4186').replace('server.listen(4173','server.listen(4186');if(p.endsWith('shop.html'))s=s.replace('<main>','<main><p><strong>MOCK API · AUTOMATED UI TEST · NO REAL PAYMENT</strong></p>');writeFileSync(p,s);}}}
adapt(dir);mkdirSync(join(dir,'.local'));writeFileSync(join(dir,'.env.local'),'OPENAI_API_KEY=fake-only\nACCESSCART_AI_ENABLED=true\nACCESSCART_ORIGIN=http://localhost:4186\nPORT=4186\n');
writeFileSync(join(dir,'mock.mjs'),`
let order;
globalThis.fetch=async(url,opts={})=>{
 const response=data=>({ok:true,json:async()=>structuredClone(data)});
 if(url.endsWith('/chat/completions'))return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'add',ids:['harbor-ground'],quantity:1,form:null,filters:{acidity:null,form:null,maxPriceCents:null},question:''})}}]});
 if(url.endsWith('/oauth2/token'))return response({access_token:'fake'});
 if(url.endsWith('/v2/checkout/orders')){const b=JSON.parse(opts.body);order={id:'ORDER12345678',status:'PAYER_ACTION_REQUIRED',intent:'CAPTURE',purchase_units:b.purchase_units,links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=MOCK_ONLY'}]};return response(order);}
 if(url.endsWith('/capture')){order.status='COMPLETED';order.purchase_units[0].payments={captures:[{id:'MOCK_CAPTURE',status:'COMPLETED',amount:order.purchase_units[0].amount}]};return response(order);}
 if(url.endsWith('/ORDER12345678')){if(order.status!=='COMPLETED')order.status='APPROVED';return response(order);}
 throw Error('UI fixture blocked unexpected network request');
};
`);
const child=spawn(process.execPath,['--import','./mock.mjs','checkout-probe/server.mjs'],{cwd:dir,stdio:'inherit'});
const cleanup=()=>{child.kill();rmSync(dir,{recursive:true,force:true});};process.on('SIGTERM',()=>{cleanup();process.exit();});process.on('SIGINT',()=>{cleanup();process.exit();});child.on('exit',()=>{rmSync(dir,{recursive:true,force:true});});
