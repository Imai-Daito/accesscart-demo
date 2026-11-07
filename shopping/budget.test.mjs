import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBudget} from './budget.mjs';
test('budget persists, reserves before requests, preserves owner pause across late replies and never resets by month',()=>{
 const dir=mkdtempSync(join(tmpdir(),'accesscart-budget-'));const path=join(dir,'budget.json');const file=pathToFileURL(path);let now=1;
 try{
  const b=createBudget(file,{now:()=>now});assert.equal(b.reserve('a'),null);assert.equal(b.read().reservedYen,5);
  const owner=b.read();owner.paused=true;writeFileSync(path,JSON.stringify(owner));b.success();assert.equal(b.read().paused,true);
  now+=40*86400000;assert.match(createBudget(file).reserve('a'),/paused/);assert.equal(b.read().reservedYen,5);
  owner.paused=false;owner.reservedYen=995;writeFileSync(path,JSON.stringify(owner));assert.equal(b.reserve('b'),null);assert.equal(b.read().reservedYen,1000);assert.equal(b.read().paused,true);assert.match(b.reserve('c'),/paused/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('per-browser request limits survive reset/restart while other sessions are independent',()=>{
 const dir=mkdtempSync(join(tmpdir(),'accesscart-budget-'));const file=pathToFileURL(join(dir,'budget.json'));let now=1;
 try{const b=createBudget(file,{now:()=>now});for(let n=0;n<25;n++)assert.equal(b.reserve('a'),null);assert.match(createBudget(file,{now:()=>now}).reserve('a'),/browser/);assert.equal(b.reserve('b'),null);now+=3600001;assert.equal(b.reserve('a'),null);assert.equal(b.read().users.a.total,26);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('first cloud start carries the prior reservation, and restart cannot reset it',()=>{
 const dir=mkdtempSync(join(tmpdir(),'accesscart-budget-'));const file=pathToFileURL(join(dir,'budget.json'));
 try{const b=createBudget(file,{initialReservedYen:195});assert.equal(b.reserve('cloud'),null);assert.equal(b.read().reservedYen,200);assert.equal(createBudget(file,{initialReservedYen:0}).read().reservedYen,200);assert.throws(()=>createBudget(file,{initialReservedYen:1001}));}finally{rmSync(dir,{recursive:true,force:true});}
});
