// Deliberately Sandbox-only. Never accept an arbitrary API base or URL from a client.
const base='https://api-m.sandbox.paypal.com';
let cached=null,authenticating=null;
async function accessToken(){
 if(cached&&cached.until>Date.now())return cached.value;
 if(authenticating)return authenticating;
 authenticating=(async()=>{
  const auth=await fetch(base+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(process.env.PAYPAL_SANDBOX_CLIENT_ID+':'+process.env.PAYPAL_SANDBOX_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(5000)});
  const credentials=await auth.json();if(!auth.ok||!credentials.access_token)throw Error('Sandbox authentication failed');
  const seconds=Math.min(300,Number(credentials.expires_in)||300);
  cached={value:credentials.access_token,until:Date.now()+Math.max(0,seconds-30)*1000};return cached.value;
 })();
 try{return await authenticating;}finally{authenticating=null;}
}
export async function paypalApi(path,method='GET',body,key){
 if(!/^\/v2\/checkout\/orders(?:\/[A-Z0-9]+(?:\/capture)?)?$/.test(path))throw Error('Invalid Sandbox API path');
 const token=await accessToken();
 const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation',...(key?{'PayPal-Request-Id':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(7000)});
 const data=await response.json();if(!response.ok){if(response.status===401)cached=null;throw Error('Sandbox order could not be confirmed');}return data;
}
