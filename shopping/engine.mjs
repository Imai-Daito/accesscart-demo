import {catalog,money,label} from './catalog.mjs';
export function fresh(){return {cart:{},inventory:Object.fromEntries(catalog.map(p=>[p.id,p.initialStock])),filters:{acidity:null,form:null,maxPriceCents:null},compared:[],shown:[],pending:null,revision:0};}
export function snapshot(s){const lines=Object.entries(s.cart).map(([id,quantity])=>({...catalog.find(p=>p.id===id),quantity}));const subtotalCents=lines.reduce((n,p)=>n+p.priceCents*p.quantity,0);return {lines,subtotalCents,shippingCents:lines.length?500:0,totalCents:subtotalCents+(lines.length?500:0),revision:s.revision};}
function summary(s){const c=snapshot(s);return c.lines.length?c.lines.map(p=>`${label(p)}: ${p.quantity} bag(s) at ${money(p.priceCents)} each.`).join(' ')+` Subtotal ${money(c.subtotalCents)}. Shipping ${money(c.shippingCents)}. Total ${money(c.totalCents)}. No tax or additional fees.`:'Your cart is empty. No shipping is charged.';}
function validQty(q){return Number.isInteger(q)&&q>=1&&q<=20;}
const confirmWords=/^(yes|yes please|confirm|go ahead|please do|do it)[.!\s]*$/i;
const declineWords=/^(no|no thanks|no thank you|keep my cart)[.!\s]*$/i;
const quantityWords='one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');
export function apply(s,a,words,{blocked=false,lastReply=''}={}){
 const say=reply=>({reply,cart:snapshot(s),shown:s.shown,compared:s.compared});
 const pending=s.pending;
 const consent=words.trim().replace(/,/g,' ').replace(/\s+/g,' ');
 // A reply to our saved price question must not depend on the model choosing
 // the right action or product ID. Only exact, standalone consent qualifies.
 if(pending&&confirmWords.test(consent))a={action:'confirm'};
 else if(pending&&declineWords.test(consent))a={action:'decline'};
 // Confirmation comes from the actual user's text, never the model's assertion.
 if(a.action==='confirm'){
  if(!pending)return say('There is no change waiting for confirmation.');
  if(!confirmWords.test(consent))return say('Please say Yes to confirm this price change, or No to keep your cart.');
  s.pending=null;
  if(blocked)return say('An existing payment needs confirmation. Check the original payment before changing your cart.');
  if(pending.revision!==s.revision)return say('Your cart changed. Please request the change again.');
  return changeVariant(s,pending.source,pending.target,true,say);
 }
 s.pending=null;
 if(a.action==='decline')return say('Your cart has not changed.');
 if(a.action==='repeat')return say(lastReply||summary(s));
 if(a.action==='cart')return say(summary(s));
 if(a.action==='clarify')return say(typeof a.question==='string'&&a.question.length<=250?a.question:'Which coffee and form would you like?');
 if(a.action==='search'){
  const f=a.filters;
  if(!f||!['low','medium','high',null].includes(f.acidity)||!['whole beans','ground',null].includes(f.form)||!(f.maxPriceCents===null||(Number.isInteger(f.maxPriceCents)&&f.maxPriceCents>=0&&f.maxPriceCents<=100000)))return say('Please give an acidity, form, or price per bag.');
  // A fresh search is explicit; follow-up searches must include retained constraints via the interpreter.
  s.filters={...f};
  const hits=catalog.filter(p=>(!f.acidity||p.acidity===f.acidity)&&(!f.form||p.form===f.form)&&(f.maxPriceCents===null||p.priceCents<=f.maxPriceCents)&&s.inventory[p.id]>0).sort((a,b)=>a.priceCents-b.priceCents||a.id.localeCompare(b.id));
  s.shown=hits.slice(0,3).map(p=>p.id);
  return say(hits.length?`${hits.length} matching products. Here are ${Math.min(3,hits.length)}: `+hits.slice(0,3).map(p=>`${label(p)}, ${money(p.priceCents)} per bag, ${p.acidity} acidity, ${s.inventory[p.id]} in stock.`).join(' '):'No products match all those conditions. Would you like to change one condition? I will keep the others.');
 }
 const ids=a.ids;
 if(!Array.isArray(ids)||ids.some(id=>!catalog.some(p=>p.id===id))||new Set(ids).size!==ids.length)return say('Please choose a product from the catalog.');
 if(a.action==='compare'){
  if(ids.length!==2)return say('Which two products would you like to compare? Please name the coffee and form.');
  s.compared=[...ids];return say(ids.map(id=>{const p=catalog.find(p=>p.id===id);return `${label(p)} costs ${money(p.priceCents)}, with ${p.acidity} acidity, ${p.roast} roast, and ${p.flavor.toLowerCase()} notes.`;}).join(' '));
 }
 if(!['add','set','remove','variant'].includes(a.action))return say('I can help search, compare two coffees, or change your cart. I cannot approve or cancel payments.');
 if(blocked)return say('An existing payment needs confirmation. Check the original payment before changing your cart.');
 if(ids.length!==1)return say('Which product do you want to change? Please name the coffee and form.');
 let id=ids[0],p=catalog.find(p=>p.id===id);
 // A standalone quantity correction using "it" refers to the unique actual
 // cart line, not an unaccepted variant mentioned in the conversation.
 if(a.action==='set'&&!s.cart[id]&&Object.keys(s.cart).length===1){
  const m=words.trim().match(/^(?:actually[,\s]+)?make it ([a-z]+|\d+) bags?[.!\s]*$/i);
  const quantity=m?(/^\d+$/.test(m[1])?Number(m[1]):quantityWords.indexOf(m[1].toLowerCase())+1):null;
  if(validQty(quantity)&&quantity===a.quantity){id=Object.keys(s.cart)[0];p=catalog.find(t=>t.id===id);}
 }
 // The interpreter may name the destination variant. Resolve it only through
 // an exact group/weight match to a unique existing cart line.
 if(a.action==='variant'&&!s.cart[id]&&p.form===a.form){
  const sources=catalog.filter(t=>s.cart[t.id]&&t.groupId===p.groupId&&t.weightGrams===p.weightGrams);
  if(sources.length===1){p=sources[0];id=p.id;}
 }
 if(a.action==='variant'){
  if(!s.cart[id])return say('That product is not in your cart.');
  if(!['whole beans','ground'].includes(a.form))return say('Would you like whole beans or ground coffee?');
  const target=catalog.find(t=>t.groupId===p.groupId&&t.weightGrams===p.weightGrams&&t.form===a.form);
  if(!target)return say('There is no matching product in that form and weight. Your cart has not changed.');
  return changeVariant(s,id,target.id,false,say);
 }
 if(a.action==='remove'){
  if(!s.cart[id])return say('That product is not in your cart.');
  delete s.cart[id];s.revision++;return say(`Removed ${label(p)}. `+summary(s));
 }
 if(a.action==='set'&&!s.cart[id])return say('That product is not in your cart. Add it first.');
 if(!validQty(a.quantity))return say('Please choose a whole number of bags between 1 and 20. Your cart has not changed.');
 const quantity=a.action==='add'?(s.cart[id]||0)+a.quantity:a.quantity;
 if(quantity>20||quantity>s.inventory[id])return say(`Only ${s.inventory[id]} bags of ${label(p)} are available. Your cart has not changed.`);
 s.cart[id]=quantity;s.revision++;
 return say(`Your cart now has ${quantity} bag(s) of ${label(p)}. `+summary(s));
}
function changeVariant(s,source,target,confirmed,say){
 const p=catalog.find(p=>p.id===source),t=catalog.find(p=>p.id===target),quantity=s.cart[source];
 if(!quantity||!t||p.groupId!==t.groupId||p.weightGrams!==t.weightGrams)return say('That change is unavailable. Your cart has not changed.');
 if(source===target)return say('Your cart already has that form. '+summary(s));
 const targetQuantity=quantity+(s.cart[target]||0);
 if(targetQuantity>s.inventory[target]||targetQuantity>20)return say(`Only ${s.inventory[target]} bags of ${label(t)} are available. Your cart has not changed.`);
 if(p.priceCents!==t.priceCents&&!confirmed){
  s.pending={source,target,revision:s.revision};
  const total=snapshot(s).totalCents+quantity*(t.priceCents-p.priceCents);
  const over=s.filters.maxPriceCents!==null&&t.priceCents>s.filters.maxPriceCents?` This exceeds your per-bag budget of ${money(s.filters.maxPriceCents)}.`:'';
  return say(`Change ${quantity} bag(s) from ${label(p)} at ${money(p.priceCents)} per bag to ${label(t)} at ${money(t.priceCents)} per bag? The new total including shipping is ${money(total)}.${over} Say Yes to change, or No to keep your cart.`);
 }
 delete s.cart[source];s.cart[target]=targetQuantity;s.revision++;return say(`Changed to ${quantity} bag(s) of ${label(t)}. `+summary(s));
}
