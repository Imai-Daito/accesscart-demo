import {randomUUID} from 'node:crypto';
import {catalog} from '../shopping/catalog.mjs';
import {snapshot} from '../shopping/engine.mjs';

const terminal=new Set(['PAID','CANCELED','FAILED']);
const safeRetryMs=5*60*60*1000; // Stay inside the standard six-hour idempotency retention.
export const checkoutBlocks=s=>!!s.checkout&&!terminal.has(s.checkout.phase);
const amount=c=>(c/100).toFixed(2);
const usd=c=>({currency_code:'USD',value:amount(c)});
function cents(v){if(typeof v!=='string'||!/^\d+\.\d{2}$/.test(v))return NaN;return Number(v.replace('.',''));}
export function checkoutView(s){
 const o=s.checkout;if(!o)return null;
 return {attempt:o.attempt,id:o.id||null,phase:o.phase,paid:o.phase==='PAID',cart:o.cart,approvalUrl:o.phase==='AWAITING_APPROVAL'?o.approvalUrl:null,captureId:o.phase==='PAID'?o.captureId:null,canCancel:o.phase==='AWAITING_APPROVAL'&&!o.captureAttempted,createdAt:o.createdAt};
}
export function orderBody(o,origin){return {
 intent:'CAPTURE',purchase_units:[{reference_id:'accesscart',custom_id:o.attempt,description:'AccessCart fictional coffee. Sandbox only; no delivery.',amount:{...usd(o.cart.totalCents),breakdown:{item_total:usd(o.cart.subtotalCents),shipping:usd(o.cart.shippingCents)}},items:o.cart.lines.map(p=>({name:`${p.name} · ${p.form} · ${p.weightGrams}g`,sku:p.id,quantity:String(p.quantity),unit_amount:usd(p.priceCents),category:'PHYSICAL_GOODS'}))}],
 payment_source:{paypal:{experience_context:{shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',return_url:origin+'/shop?checkout='+o.attempt,cancel_url:origin+'/shop?cancel='+o.attempt}}}
};}
function approval(data){const href=data.links?.find(l=>['payer-action','approve'].includes(l.rel))?.href;if(!href)return null;try{const u=new URL(href);return u.protocol==='https:'&&u.hostname==='www.sandbox.paypal.com'?href:null;}catch{return null;}}
function validate(data,o){
 const units=data.purchase_units;
 if(data.id!==o.id||data.intent!=='CAPTURE'||!Array.isArray(units)||units.length!==1)throw Error('Unverified order');
 const u=units[0];
 if(u.custom_id!==o.attempt||u.reference_id!=='accesscart'||u.amount?.currency_code!=='USD'||cents(u.amount.value)!==o.cart.totalCents)throw Error('Unverified order amount');
 const captures=u.payments?.captures||[];
 if(!Array.isArray(captures))throw Error('Unverified captures');
 return captures;
}
function applyObservation(s,data,save){
 const o=s.checkout;const captures=validate(data,o);
 const completed=captures.filter(c=>c.status==='COMPLETED');
 if(data.status==='COMPLETED'&&captures.length===1&&completed.length===1){
  const c=completed[0];if(c.amount?.currency_code!=='USD'||cents(c.amount.value)!==o.cart.totalCents||!c.id)throw Error('Unverified capture amount');
  if(!o.fulfilled){
   // Debit inventory and mark this order fulfilled in the SAME durable commit.
   for(const p of o.cart.lines)if(!Number.isInteger(s.inventory[p.id])||s.inventory[p.id]<p.quantity)throw Error('Inventory reconciliation required');
   for(const p of o.cart.lines)s.inventory[p.id]-=p.quantity;
   s.cart={};s.pending=null;s.revision++;o.fulfilled=true;o.finishedRevision=s.revision;
  }
  o.phase='PAID';o.captureId=c.id;o.approvalUrl=null;save();return;
 }
 // A pending capture is not a failure, even if the top-level order is COMPLETED.
 if(captures.length){
  o.phase=captures.length===1&&captures[0].status==='DECLINED'?'FAILED':'UNKNOWN';save();return;
 }
 if(['VOIDED'].includes(data.status)){o.phase='FAILED';o.approvalUrl=null;save();return;}
 if(data.status==='APPROVED'){o.phase='APPROVED';save();return;}
 if(['CREATED','PAYER_ACTION_REQUIRED','SAVED'].includes(data.status)){
  // Once capture might have been sent, a stale GET must not reopen approval/cancellation.
  o.phase=o.captureAttempted?'UNKNOWN':'AWAITING_APPROVAL';o.approvalUrl=approval(data)||o.approvalUrl;save();return;
 }
 o.phase='UNKNOWN';save();
}
export function createCheckoutService({api,save,origin,now=()=>Date.now()}){
 async function create(s){
  const o=s.checkout;
  // Never silently mint a replacement after request-ID retention might expire.
  if(now()-o.createdAt>safeRetryMs){o.phase='UNKNOWN';save();return;}
  o.phase='CREATING';save();
  const data=await api('/v2/checkout/orders','POST',orderBody(o,origin),o.createKey);
  if(typeof data.id!=='string'||!/^[A-Z0-9]{8,32}$/.test(data.id))throw Error('Unverified order ID');
  o.id=data.id;save();applyObservation(s,data,save);
 }
 async function recover(s){
  const o=s.checkout;if(!o||terminal.has(o.phase))return checkoutView(s);
  try{
   if(!o.id)await create(s);
   else{
    const path='/v2/checkout/orders/'+encodeURIComponent(o.id);
    let data=await api(path);applyObservation(s,data,save);
    if(o.phase==='APPROVED'){
     if(o.captureAttempted&&now()-o.captureAttemptedAt>safeRetryMs){o.phase='UNKNOWN';save();return checkoutView(s);}
     o.captureAttempted=true;o.captureAttemptedAt??=now();o.phase='CAPTURING';save();
     await api(path+'/capture','POST',{},o.captureKey);
     // Capture responses can omit original purchase-unit metadata. Confirm
     // completion by reading the same order rather than trusting that payload.
     data=await api(path);applyObservation(s,data,save);
    }
   }
  }catch{o.phase='UNKNOWN';save();}
  return checkoutView(s);
 }
 async function prepare(s,{confirmed,revision}={}){
  // An existing uncertain order takes priority over every new checkout request.
  if(checkoutBlocks(s))return checkoutView(s);
  const previous=s.checkout;
  if(previous?.phase==='PAID'&&!Object.keys(s.cart).length)return checkoutView(s);
  if(confirmed!==true||revision!==s.revision)throw Error('Review the current cart and confirm it before continuing.');
  const cart=snapshot(s);if(!cart.lines.length)throw Error('Your cart is empty. Add a product before checkout.');
  for(const p of cart.lines){const fixed=catalog.find(t=>t.id===p.id);if(!fixed||!Number.isInteger(p.quantity)||p.quantity<1||p.quantity>s.inventory[p.id])throw Error('Stock changed. Review your cart again.');}
  if(previous)(s.checkoutHistory??=[]).push(previous);
  s.checkout={attempt:randomUUID(),createKey:randomUUID(),captureKey:randomUUID(),createdAt:now(),phase:'CREATING',cart:structuredClone(cart)};
  s.pending=null;save();return recover(s);
 }
 async function cancel(s,attempt){
  const o=s.checkout;
  if(!o||o.attempt!==attempt)throw Error('This return does not match the current order. Check the existing order.');
  if(terminal.has(o.phase))return checkoutView(s);
  if(!o.id||o.captureAttempted)return recover(s);
  try{
   const data=await api('/v2/checkout/orders/'+encodeURIComponent(o.id));const captures=validate(data,o);
   if(!captures.length&&['CREATED','PAYER_ACTION_REQUIRED','SAVED'].includes(data.status)){
    // Retire this unapproved order locally. We never capture a retired order,
    // including if a delayed approval later reaches its original return URL.
    o.phase='CANCELED';o.approvalUrl=null;save();return checkoutView(s);
   }
   applyObservation(s,data,save);
  }catch{o.phase='UNKNOWN';save();return checkoutView(s);}
  return recover(s);
 }
 return {prepare,recover,cancel};
}
