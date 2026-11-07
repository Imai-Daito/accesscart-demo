// Judging ends 2026-12-15 08:00 PST; retain recovery records seven more days.
// Reconfirm this date if the official competition schedule changes.
export const retentionDeadline=Date.parse('2026-12-22T16:00:00Z');
export function unresolved(record){
 if(!record||typeof record!=='object')return false;
 if(record.phase)return !['PAID','CANCELED','FAILED'].includes(record.phase);
 if(record.checkout&&unresolved(record.checkout))return true;
 for(const field of ['checkoutHistory','previousOrders'])if(record[field]?.some(unresolved))return true;
 if(record.id)return record.paid!==true&&record.status!=='VOIDED';
 return !!record.createKey;
}
export function pruneResolved(records,{now=Date.now(),isBusy=()=>false}={}){
 if(now<retentionDeadline)return [];
 const removed=[];for(const [id,record] of Object.entries(records))if(!isBusy(id)&&!unresolved(record)){delete records[id];removed.push(id);}return removed;
}
