import test from 'node:test';
import assert from 'node:assert/strict';
import {retentionDeadline,pruneResolved} from './retention.mjs';
test('retention preserves everything before deadline, removes only resolved records afterwards',()=>{
 const records={empty:{cart:{}},paid:{checkout:{phase:'PAID',id:'P'},checkoutHistory:[{phase:'CANCELED',id:'C'}]},legacyPaid:{id:'L',paid:true},unknown:{checkout:{phase:'UNKNOWN',id:'U'}},noID:{createKey:'pending'},legacy:{id:'A',paid:false},oldUnknown:{id:'P2',paid:true,previousOrders:[{id:'OLD',paid:false}]}};
 assert.deepEqual(pruneResolved(records,{now:retentionDeadline-1}),[]);assert.deepEqual(pruneResolved(records,{now:retentionDeadline}).sort(),['empty','legacyPaid','paid']);assert.deepEqual(Object.keys(records).sort(),['legacy','noID','oldUnknown','unknown']);
});
test('in-flight records are not pruned and an unresolved order becomes removable only after confirmation',()=>{
 const records={busy:{checkout:{phase:'PAID'}},pending:{checkout:{phase:'UNKNOWN'}}};assert.deepEqual(pruneResolved(records,{now:retentionDeadline,isBusy:id=>id==='busy'}),[]);records.pending.checkout.phase='PAID';assert.deepEqual(pruneResolved(records,{now:retentionDeadline,isBusy:id=>id==='busy'}),['pending']);assert.ok(records.busy);
});
