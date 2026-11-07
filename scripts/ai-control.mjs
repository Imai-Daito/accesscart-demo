import {dataDir} from '../runtime.mjs';
// Local owner operation. Not exposed by the web server.
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
const file=new URL('ai-budget.json',dataDir);
const data=JSON.parse(readFileSync(file,'utf8'));
const action=process.argv[2];
if(action==='pause')data.paused=true;
else if(action==='resume'){
 if(data.reservedYen+5>1000)throw Error('No test allowance remains. Do not increase it without reviewing the project budget.');
 data.paused=false;
}else if(action!=='status')throw Error('Use status, pause, or resume.');
if(action!=='status'){const tmp=new URL(file.href+'.owner.tmp');writeFileSync(tmp,JSON.stringify(data),{mode:0o600});renameSync(tmp,file);}
console.log(JSON.stringify({paused:data.paused,reservedYen:data.reservedYen,calls:data.calls}));
