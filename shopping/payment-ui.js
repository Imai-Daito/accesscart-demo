// Only explicit, reviewed checkout starts an order. Reload checks an existing one.
(() => {
 const get=id=>document.getElementById(id);
 const consent=get('purchase-consent'),prepare=get('checkout-prepare'),check=get('payment-check'),cancel=get('payment-cancel'),approve=get('payment-approve');
 let state=null,working=false,timer=null,deadlineTimer=null,deadline=0,generation=0,lastError='';
 const phases={CREATING:'Preparing the existing Sandbox order.',UNKNOWN:'The payment result is not confirmed. Do not pay again. Check this same order again.',AWAITING_APPROVAL:'Review the saved order below, then continue to PayPal Sandbox. Payment has not been confirmed.',APPROVED:'PayPal approval received. Checking payment completion. Please do not start another payment.',CAPTURING:'Confirming the approved payment. Do not pay again.',PAID:'Payment completed in PayPal Sandbox. No real charge or delivery.',CANCELED:'This checkout has been closed for editing. Your cart is retained. This does not cancel or refund a completed payment.',FAILED:'This payment failed or was voided. Your cart is retained.'};
 const uncertain=o=>o&&!['PAID','CANCELED','FAILED'].includes(o.phase);
 function text(message){get('payment-status').textContent=message;}
 function draw(){
  if(!state)return;const o=state.checkout;
  prepare.disabled=working||!consent.checked||!state.cart.lines.length||state.blocked;
  consent.disabled=working||state.blocked;
  approve.hidden=working||!o?.approvalUrl;approve.removeAttribute('href');if(!approve.hidden)approve.href=o.approvalUrl;
  check.hidden=!uncertain(o);check.disabled=working;
  cancel.hidden=!o?.canCancel;cancel.disabled=working;
  get('payment-order').textContent=o?`Order: ${o.id||'not confirmed yet'}. `+o.cart.lines.map(p=>`${p.name}, ${p.form}: ${p.quantity} bag(s) at ${dollars(p.priceCents)} each.`).join(' ')+` Subtotal ${dollars(o.cart.subtotalCents)}. Shipping ${dollars(o.cart.shippingCents)}. Total ${dollars(o.cart.totalCents)}.`:'';
  if(state.legacyBlocked)text('An earlier payment needs confirmation. Use Check the existing Sandbox payment below.');
  else if(lastError)text(lastError);
  else if(o)text(deadline&&Date.now()>=deadline&&uncertain(o)?'The result is still unconfirmed after automatic checks. Do not pay again. Use Check this payment again.':phases[o.phase]||phases.UNKNOWN);
  else text('Review your current cart before starting checkout.');
 }
 function stopPolling(){generation++;clearTimeout(timer);clearTimeout(deadlineTimer);deadline=0;}
 async function run(action,body){
  if(working)return;working=true;lastError='';quiet();draw();
  try{const data=await request('/api/shop/checkout/'+action,body);display(data);}
  catch(e){lastError=e.message+' Do not start another payment.';text(lastError);try{const data=await request('/api/shop/state');state=data;display(data);}catch{/* Keep the current recovery controls. */}text(e.message+' Check the existing order again.');}
  finally{working=false;draw();}
 }
 async function tick(token){
  if(token!==generation||Date.now()>=deadline||!uncertain(state?.checkout))return;
  await run('check',{attempt:state.checkout.attempt});
  if(token!==generation)return;
  if(uncertain(state?.checkout)&&Date.now()<deadline)timer=setTimeout(()=>tick(token),4000);
 }
 function poll(){stopPolling();if(!uncertain(state?.checkout))return;deadline=Date.now()+30000;const token=generation;
  deadlineTimer=setTimeout(()=>{if(token===generation&&uncertain(state?.checkout))text('The result is still unconfirmed after automatic checks. Do not pay again. Use Check this payment again.');},30000);
  tick(token);
 }
 // display is shared with chat/voice so checkout, cart and access state stay consistent.
 const originalDisplay=display;
 display=function(data){const changed=state&&state.cart.revision!==data.cart.revision;state=data;if(changed)consent.checked=false;originalDisplay(data);draw();};
 consent.onchange=draw;
 prepare.onclick=async()=>{if(!state||prepare.disabled)return;await run('prepare',{confirmed:consent.checked,revision:state.cart.revision});consent.checked=false;draw();if(uncertain(state?.checkout)&&state.checkout.phase!=='AWAITING_APPROVAL')poll();};
 check.onclick=async()=>{await run('check',{attempt:state?.checkout?.attempt});};
 cancel.onclick=async()=>{stopPolling();await run('cancel',{attempt:state?.checkout?.attempt});if(uncertain(state?.checkout)&&!state.checkout.canCancel)poll();};
 window.addEventListener('pagehide',stopPolling);
 window.addEventListener('pageshow',event=>{if(event.persisted)request('/api/shop/state').then(data=>{display(data);poll();}).catch(()=>text('Connection lost. Check this payment again.'));});
 request('/api/shop/state').then(async data=>{
  display(data);const query=new URLSearchParams(location.search);const returned=query.get('checkout'),canceled=query.get('cancel');
  if(returned||canceled){
   const attempt=returned||canceled;
   if(attempt!==state.checkout?.attempt){text('This return is for an older or different checkout. Its payment has not been started here. Check the current order.');return;}
   await run(canceled?'cancel':'check',{attempt});
   history.replaceState(null,'','/shop');get('payment-status').setAttribute('tabindex','-1');get('payment-status').focus();
  }
  // Includes browser reload/revisit during an unknown result.
  if(uncertain(state?.checkout)&&state.checkout.phase!=='AWAITING_APPROVAL')poll();
 }).catch(()=>text('The saved payment status could not load. Reload in this same browser. Do not pay again.'));
})();
