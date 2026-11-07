import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
export function createBudget(file,{now=()=>Date.now(),initialReservedYen=Number(process.env.ACCESSCART_INITIAL_RESERVED_YEN||0)}={}){
 if(!Number.isInteger(initialReservedYen)||initialReservedYen<0||initialReservedYen>1000)throw Error('Invalid initial AI allowance.');
 const read=()=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{reservedYen:initialReservedYen,calls:Math.ceil(initialReservedYen/5),paused:initialReservedYen>=1000};
 const write=data=>{const temp=new URL(file.href+'.tmp');writeFileSync(temp,JSON.stringify(data),{mode:0o600});renameSync(temp,file);};
 function reserve(sid){
  const b=read();if(b.paused||b.reservedYen+5>1000){b.paused=true;write(b);return 'AI usage is paused at the local test limit. Existing payment status remains available.';}
  const usage=(b.users??={})[sid]??={start:now(),count:0,total:0};
  if(now()-usage.start>=3600000){usage.start=now();usage.count=0;}
  if(usage.count>=25||usage.total>=100)return 'This browser has reached its AI request limit. Existing payment status remains available.';
  usage.count++;usage.total++;b.users[sid]=usage;b.reservedYen+=5;b.calls++;if(b.reservedYen>=1000)b.paused=true;write(b);return null;
 }
 function success(){const b=read();delete b.lastError;b.lastSuccessAt=new Date(now()).toISOString();write(b);}
 function permissionError(){const b=read();b.lastError='permissions';write(b);}
 function forget(ids){if(!ids.length)return;const b=read();for(const id of ids)if(b.users)delete b.users[id];write(b);}
 return {read,reserve,success,permissionError,forget};
}
