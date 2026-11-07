import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,sep,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=new URL('./',import.meta.url),envFile=new URL('.env.local',root);
if(existsSync(envFile))for(const line of readFileSync(envFile,'utf8').split('\n')){
 const match=line.match(/^([A-Z_]+)=(.*)$/);if(match)process.env[match[1]]=match[2].trim().replace(/^['"]|['"]$/g,'');
}
export const origin=process.env.ACCESSCART_ORIGIN||process.env.RENDER_EXTERNAL_URL||'http://127.0.0.1:4173';
if(new URL(origin).origin!==origin)throw Error('The app origin must have no path or trailing slash.');
export const local=origin==='http://127.0.0.1:4173';
if(!local&&(!process.env.ACCESSCART_DATA_DIR||!isAbsolute(process.env.ACCESSCART_DATA_DIR)))throw Error('Public mode requires an absolute persistent ACCESSCART_DATA_DIR.');
export const dataDir=process.env.ACCESSCART_DATA_DIR?pathToFileURL(resolve(process.env.ACCESSCART_DATA_DIR)+sep):new URL('.local/',root);
mkdirSync(dataDir,{recursive:true,mode:0o700});
export const port=Number(process.env.PORT||4173);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid listen port.');
