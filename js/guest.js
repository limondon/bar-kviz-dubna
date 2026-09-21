import{db,auth,ref,onValue,get,signInAnonymously,callService as api}from'./firebase.js';
const BAR_NAME='Кальянная 1708';
let confirmedOrder=null,pendingOrder=null,pendingCall=null,callPending=false,callCooldown=0,orderBusy=false,menuSubscribed=false;
const draftKey=()=>`bar_guest:${tableNum}:${token}`;
function saveDraft(){try{sessionStorage.setItem(draftKey(),JSON.stringify({cart,guestCups,pendingOrder,pendingCall,confirmedOrder,note:document.getElementById('orderNote').value}));return true;}catch{return false;}}
function restoreDraft(){
  let raw;try{raw=sessionStorage.getItem(draftKey());}catch{return true;}
  if(!raw)return true;
  const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const text=v=>typeof v==='string';
  const request=v=>record(v)&&/^[-\w]{1,80}$/.test(v.requestId||'')&&v.table===tableNum&&v.token===token;
  try{
    const d=JSON.parse(raw);if(!record(d))return false;
    // Never silently discard an uncertain submission or receipt: it may already be accepted.
    if(d.pendingOrder!=null&&(!request(d.pendingOrder)||!Array.isArray(d.pendingOrder.items)||!d.pendingOrder.items.length||!Number.isFinite(d.pendingOrder.expectedTotal)))return false;
    if(d.pendingCall!=null&&!request(d.pendingCall))return false;
    if(d.confirmedOrder!=null&&(!record(d.confirmedOrder)||d.confirmedOrder.table!==tableNum||!text(d.confirmedOrder.id)||!Number.isSafeInteger(d.confirmedOrder.num)||!Number.isFinite(d.confirmedOrder.total)))return false;
    const restored={};let damaged=d.cart!=null&&!record(d.cart);
    for(const [key,row] of Object.entries(record(d.cart)?d.cart:{})){
      if(!/^[-\w]+:[-\w]+(?:#[-\w]+)?$/.test(key)||!record(row)||!text(row.name)||!row.name||!Number.isSafeInteger(row.qty)||row.qty<1||row.qty>99||!Number.isFinite(row.price)||row.price<0||(row.option!=null&&!text(row.option))||(row.productId!=null&&!text(row.productId))||(row.addons!=null&&(!record(row.addons)||Object.values(row.addons).some(v=>typeof v!=='boolean')))){
        damaged=true;continue;
      }
      restored[key]={...row,addons:row.addons||{},option:row.option||null};
    }
    if(damaged&&d.pendingOrder!=null)return false;
    cart=restored;guestCups=Number.isInteger(d.guestCups)&&d.guestCups>=0&&d.guestCups<=50?d.guestCups:0;
    pendingOrder=d.pendingOrder||null;pendingCall=d.pendingCall||null;confirmedOrder=d.confirmedOrder||null;
    document.getElementById('orderNote').value=text(d.note)?d.note:'';
    if(damaged)flash('Часть корзины не удалось восстановить. Проверьте позиции перед отправкой.',true);
    return true;
  }catch{return false;}
}
function readMenu(raw){
  return Object.entries(raw||{}).filter(([,c])=>c&&!c.hidden).map(([ck,c])=>({...c,items:Object.entries(c.items||{}).filter(([,i])=>i).map(([ik,i])=>({...i,_categoryKey:ck,_itemKey:ik}))}));
}
function refreshCartPrices(){if(pendingOrder)return;for(const [key,row] of Object.entries(cart)){const item=findItem(key);if(item&&item.name===row.name&&(item.productId||null)===(row.productId||null))row.price=Number(item.price)||0;}}


let tableNum=null, token=null, sessionId=null;
let menuData=[]; // [{cat, items:[{name,price,stock?,group?}]}]
let cart={};     // {key: {name,price,qty,addons:{},option:null}}
let activeCat=0;
let openGroups=new Set();
let guestCups=0;
const G_TEA_ADDONS=['Чабрец','Лимон','Мята'];
const G_ADDON_PRICE=50;
function isLeafTeaCat(cat){return cat?.cat?.toLowerCase().includes('лист');}
function isTeaCat(cat){return cat?.cat?.toLowerCase().includes('чай');}
function baseItemName(name){return String(name||'').replace(/\s+[—–-]\s+.+$/,'').replace(/\s+\+\s+.+$/,'').trim();}
function itemKey(name){return baseItemName(name).toLowerCase();}
function parseOption(opt){
  const text=String(opt||'').trim();
  const m=text.match(/^(.+?)\s*(?:\+|=|:)\s*(\d+)\s*₽?$/);
  return m?{label:m[1].trim(),price:Number(m[2])||0}:{label:text,price:0};
}
function addonPrice(item){
  return Object.values(item.addons||{}).filter(Boolean).length*G_ADDON_PRICE;
}
function optionPrice(item){
  return item.option?parseOption(item.option).price:0;
}
function unitPrice(item){
  return(Number(item.price)||0)+addonPrice(item)+optionPrice(item);
}
let flashTmr=null;

// ─── BOOT ───────────────────────────────────────────
(async()=>{
  const p=new URLSearchParams(location.search);
  tableNum=p.get('table'); token=p.get('token');
  if(!tableNum||!token){showInvalid();return;}
  try{
    await signInAnonymously(auth);
    if(!restoreDraft()){showInvalid('draft');return;}syncCallButtons();
    if(confirmedOrder){showApp();showConfirmation(confirmedOrder);return;}
    // A committed receipt remains recoverable even if the table was closed meanwhile.
    if(pendingOrder){
      showApp();openCart();
      return;
    }
    await initializeMenuSession();showApp();
  }catch(e){console.error(e);showInvalid(e.code==='functions/permission-denied'?'invalid':e.code==='functions/failed-precondition'?'closed':'network');}
})();

// ─── MENU LOAD ───────────────────────────────────────
async function initializeMenuSession(){
  const session=await api('openGuestSession',{table:tableNum,token});
  sessionId=session.sid;
  await loadMenu();
  refreshCartPrices();updateCartBar();
  if(document.getElementById('screen-cart').classList.contains('active'))renderCartScreen();
  if(menuSubscribed)return;
  menuSubscribed=true;
  onValue(ref(db,'menu2'),snap=>{
    menuData=readMenu(snap.val());
    activeCat=Math.min(activeCat,Math.max(0,menuData.length-1));
    refreshCartPrices();renderTabs();renderMenu();updateCartBar();
    if(document.getElementById('screen-cart').classList.contains('active'))renderCartScreen();
  },()=>setConn(false));
  onValue(ref(db,'.info/connected'),snap=>setConn(snap.val()===true));
}

async function loadMenu(){
  const snap=await get(ref(db,'menu2'));
  menuData=readMenu(snap.val());
  activeCat=0;
  renderTabs();
  renderMenu();
}

// ─── STOCK HELPERS ───────────────────────────────────
function getStock(item){
  if(item.stock===undefined||item.stock===null||item.stock==='')return null;
  return Math.max(0,parseInt(item.stock)||0);
}
function stockClass(item){
  const s=getStock(item);
  if(s===null)return'';
  if(s===0)return'stock-out';
  if(s<=3)return'stock-low';
  return'stock-ok';
}
function stockText(item){
  const s=getStock(item);
  if(s===null)return'';
  if(s===0)return'Нет в наличии';
  return'Осталось: '+s+' шт.';
}
function isOut(item){const s=getStock(item);return s!==null&&s===0;}
function canAdd(item,key){
  const s=getStock(item);
  if(s===null)return true;
  return s-Object.entries(cart).filter(([k])=>k.split('#')[0]===key.split('#')[0]).reduce((n,[,v])=>n+v.qty,0)>0;
}
function iKey(item){return item._categoryKey+':'+item._itemKey;}
function findItem(key){
  for(const cat of menuData)for(const it of(cat.items||[]))if(iKey(it)===key.split('#')[0])return it;
  return null;
}
function hasTeaInCart(){
  return Object.entries(cart).some(([key,row])=>{
    if(!row?.qty)return false;
    const item=findItem(key);
    return !!item&&isTeaCat(menuData.find(cat=>(cat.items||[]).includes(item)));
  });
}
function normalizeGuestCups(){
  if(!pendingOrder&&!hasTeaInCart())guestCups=0;
}

// ─── RENDER TABS ────────────────────────────────────
function renderTabs(){
  const el=document.getElementById('catTabs');
  el.innerHTML=menuData.map((c,i)=>
    `<div class="cat-tab${i===activeCat?' active':''}" data-action="setCat" data-index="${i}">${esc(c.cat)}</div>`
  ).join('')+'<div style="width:8px;flex-shrink:0"></div>';enhanceControls(el);
}

// ─── RENDER MENU ────────────────────────────────────
function renderMenu(){
  const el=document.getElementById('menuList');
  const cat=menuData[activeCat];
  if(!cat||!cat.items||!cat.items.length){
    el.innerHTML=`<div style="text-align:center;padding:48px 20px;color:var(--muted);">Позиции скоро появятся</div>`;
    return;
  }
  const items=cat.items;
  const html=[];
  const doneGroups=new Set();
  html.push(`<div class="section-label">${esc(cat.cat)}</div>`);
  items.forEach(item=>{
    if(item.group){
      if(doneGroups.has(item.group))return;
      doneGroups.add(item.group);
      const groupItems=items.filter(i=>i.group===item.group);
      html.push(renderGroup(item.group,groupItems,cat));
    } else {
      html.push(renderItem(item,cat));
    }
  });
  // Кружки для чайных категорий
  const isTea=isTeaCat(cat);
  const anyTeaSelected=isTea&&items.some(i=>(cart[iKey(i)]?.qty||0)>0);
  if(anyTeaSelected){
    html.push(`<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(245,166,35,.1);border-top:2px solid rgba(245,166,35,.35);border-radius:0 0 12px 12px;margin-top:4px;">
      <div style="flex:1;"><div style="font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1px;color:#f5a623;">☕ КРУЖКИ НА СТОЛ</div><div style="font-size:11px;color:#888;margin-top:1px;">сколько кружек принести</div></div>
      <div data-action="adjustCups" data-delta="-1" style="width:38px;height:38px;min-width:38px;border-radius:50%;border:1.5px solid #444;color:#ccc;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</div>
      <span style="font-size:26px;font-weight:700;font-family:'Bebas Neue',sans-serif;min-width:28px;text-align:center;color:#f5a623;">${guestCups}</span>
      <div data-action="adjustCups" data-delta="1" style="width:38px;height:38px;min-width:38px;border-radius:50%;border:1.5px solid #f5a623;color:#f5a623;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</div>
    </div>`);
  }
  el.innerHTML=html.join('');enhanceControls(el);
}

function renderItem(item,cat){
  const key=iKey(item);
  const qty=cart[key]?.qty||0;
  const out=isOut(item);
  const sText=stockText(item);
  const sCls=stockClass(item);
  const more=canAdd(item,key);
  const stockHtml=sText?`<span class="stock-label ${sCls}">${sText}</span>`:'';
  let btn;
  if(out) btn=`<span class="badge-out">Нет</span>`;
  else if(qty===0) btn=`<div class="add-btn" data-action="addItem" data-key="${escAttr(key)}">+</div>`;
  else btn=`<div class="qty-wrap">
    <div class="qty-btn" data-action="remItem" data-key="${escAttr(key)}">−</div>
    <div class="qty-num">${qty}</div>
    <div class="qty-btn${more?'':' dis'}" data-action="addItem" data-key="${escAttr(key)}">+</div>
  </div>`;
  const addons=cart[key]?.addons||{};
  const addonHtml=qty>0&&isLeafTeaCat(cat)?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">${G_TEA_ADDONS.map(a=>{const sel=addons[a];return`<div data-action="toggleAddon" data-key="${escAttr(key)}" data-addon="${escAttr(a)}" style="padding:4px 10px;border-radius:16px;font-size:12px;cursor:pointer;background:${sel?'#f5a623':'rgba(255,255,255,.07)'};color:${sel?'#000':'#888'};border:1px solid ${sel?'#f5a623':'rgba(255,255,255,.15)'};">${esc(a)} <span style="font-size:11px;">+50₽</span></div>`;}).join('')}</div>`:'';
  const selOpt=cart[key]?.option||null;
  const optHtml=qty>0&&item.options?.length?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">${item.options.map(opt=>{const sel=selOpt===opt;const parsed=parseOption(opt);return`<div data-action="selectOption" data-key="${escAttr(key)}" data-option="${escAttr(opt)}" style="padding:4px 10px;border-radius:16px;font-size:12px;cursor:pointer;background:${sel?'#4caf50':'rgba(255,255,255,.07)'};color:${sel?'#000':'#888'};border:1px solid ${sel?'#4caf50':'rgba(255,255,255,.15)'};">${esc(parsed.label)}${parsed.price?` <span style="font-size:11px;">+${parsed.price}₽</span>`:''}</div>`;}).join('')}</div>`:'';
  return`<div class="menu-item${out?' unavail':''}">
    <div class="item-info">
      <div class="item-name">${esc(item.name)}</div>
      ${item.desc?`<div class="item-desc">${esc(item.desc)}</div>`:''}
      <div class="item-meta">
        <span class="item-price">${fmt(item.price||0)}</span>
        ${stockHtml}
      </div>
      ${addonHtml}${optHtml}
      ${qty>0&&(isLeafTeaCat(cat)||item.options?.length)?`<button type="button" class="variant-btn" data-action="anotherVariant" data-key="${escAttr(key)}">Добавить другой вариант</button>`:''}
    </div>
    <div class="item-btn">${btn}</div>
  </div>`;
}

function renderGroup(groupName,groupItems,cat){
  const isOpen=openGroups.has(groupName);
  const cartTotal=groupItems.reduce((s,i)=>s+(cart[iKey(i)]?.qty||0),0);
  const allOut=groupItems.every(i=>isOut(i));
  const sub=allOut?'Нет в наличии':cartTotal>0?`Выбрано: ${cartTotal}`:`${groupItems.length} вкусов`;
  const innerHtml=groupItems.map(item=>{
    const key=iKey(item);
    const qty=cart[key]?.qty||0;
    const out=isOut(item);
    const sText=stockText(item);
    const sCls=stockClass(item);
    const more=canAdd(item,key);
    const stockHtml=sText?`<span class="group-item-stock ${sCls}">${sText}</span>`:'';
    let btn;
    if(out) btn=`<span class="badge-out">Нет</span>`;
    else if(qty===0) btn=`<div class="add-btn" style="width:36px;height:36px;min-width:40px;min-height:40px;font-size:18px;" data-action="addItem" data-key="${escAttr(key)}">+</div>`;
    else btn=`<div class="qty-wrap">
      <div class="qty-btn" style="width:36px;height:36px;min-width:40px;min-height:40px;" data-action="remItem" data-key="${escAttr(key)}">−</div>
      <div class="qty-num">${qty}</div>
      <div class="qty-btn${more?'':' dis'}" style="width:36px;height:36px;min-width:40px;min-height:40px;" data-action="addItem" data-key="${escAttr(key)}">+</div>
    </div>`;
    return`<div class="group-item${out?' unavail':''}">
      <div class="group-item-name">${esc(item.name)}</div>
      ${stockHtml}
      <div class="group-item-price">${fmt(item.price||0)}</div>
      ${btn}
    </div>`;
  }).join('');
  return`<div class="group-hdr" data-action="toggleGroup" data-group="${escAttr(groupName)}">
    <div class="group-info">
      <div class="group-name">${esc(groupName)}</div>
      <div class="group-sub">${sub}</div>
    </div>
    <span class="group-arrow${isOpen?' open':''}">▼</span>
  </div>
  <div class="group-body${isOpen?' open':''}">
    ${innerHtml}
  </div>`;
}

// ─── CART ACTIONS ────────────────────────────────────
function addItem(key){
  const item=findItem(key);if(!item)return;
  if(!canAdd(item,key)){flash('Больше нет в наличии',true);return;}
  const hadTea=hasTeaInCart();
  if(!cart[key])cart[key]={name:item.name,productId:item.productId||null,price:item.price||0,qty:0,addons:{},option:null};
  cart[key].qty++;
  const cat=menuData[activeCat];
  if(isTeaCat(cat)&&!hadTea&&guestCups===0)guestCups=1;
  updateCartBar();renderMenu();
}
function anotherVariant(key){
  const item=findItem(key);if(!cart[key]||!item)return;
  if(!canAdd(item,key)){flash('Больше нет в наличии',true);return;}
  cart[key+'#'+crypto.randomUUID()]={...cart[key]};delete cart[key];addItem(key);
}
function remItem(key){
  if(!cart[key])return;
  cart[key].qty--;
  if(cart[key].qty<=0)delete cart[key];
  normalizeGuestCups();
  updateCartBar();renderMenu();
}
function toggleAddon(key,addon){
  if(!cart[key])return;
  if(!cart[key].addons)cart[key].addons={};
  cart[key].addons[addon]=!cart[key].addons[addon];
  updateCartBar();renderMenu();
}
function selectOption(key,val){
  if(!cart[key])return;
  cart[key].option=cart[key].option===val?null:val;
  updateCartBar();renderMenu();
}
function adjustCups(delta){
  if(!hasTeaInCart()){guestCups=0;updateCartBar();return;}
  guestCups=Math.min(50,Math.max(0,guestCups+delta));saveDraft();
  renderMenu();
  if(document.getElementById('screen-cart').classList.contains('active'))renderCartScreen();
}
function cQty(key,delta){
  if(!cart[key])return;
  const item=findItem(key);
  if(delta>0&&item&&!canAdd(item,key)){flash('Больше нет в наличии',true);return;}
  cart[key].qty+=delta;
  if(cart[key].qty<=0)delete cart[key];
  normalizeGuestCups();
  renderCartScreen();updateCartBar();
}
function toggleGroup(g){
  if(openGroups.has(g))openGroups.delete(g);else openGroups.add(g);
  renderMenu();
}
function setCat(i){activeCat=i;renderTabs();renderMenu();document.getElementById('menuList').scrollTop=0;}

function updateCartBar(){
  saveDraft();
  const entries=Object.values(cart).filter(x=>x.qty>0);
  const total=entries.reduce((s,i)=>s+unitPrice(i)*i.qty,0);
  const count=entries.reduce((s,i)=>s+i.qty,0);
  document.getElementById('cartCount').textContent=count;
  document.getElementById('cartTotal').textContent=fmt(total);
  document.getElementById('cartBar').classList.toggle('hidden',count===0);
}

// Липкая шапка — появляется когда основная шапка уходит за экран
function initStickyHeader(){
  const menuList=document.getElementById('menuList');
  const stickyHdr=document.getElementById('stickyHeader');
  const menuHdr=document.querySelector('.menu-header');
  if(!menuList||!stickyHdr||!menuHdr)return;
  menuList.addEventListener('scroll',()=>{
    const hdrBottom=menuHdr.getBoundingClientRect().bottom;
    stickyHdr.classList.toggle('visible',hdrBottom<60);
  },{passive:true});
}

// ─── CART SCREEN ────────────────────────────────────
function renderCartScreen(){
  const entries=Object.entries(cart).filter(([k,v])=>v.qty>0);
  const subtotal=entries.reduce((s,[k,v])=>s+unitPrice(v)*v.qty,0);
  const hasTea=hasTeaInCart();
  if(!hasTea)guestCups=0;
  const cupsHtml=hasTea?`<section class="cups-picker" aria-label="Количество кружек">
    <div><div class="cups-title">☕ Сколько кружек принести?</div><div class="cups-hint">Укажите число, чтобы не писать его в комментарии</div></div>
    <div class="cups-controls">
      <button type="button" class="cups-btn" data-action="adjustCups" data-delta="-1" aria-label="Уменьшить количество кружек">−</button>
      <span class="cups-count">${guestCups}</span>
      <button type="button" class="cups-btn" data-action="adjustCups" data-delta="1" aria-label="Увеличить количество кружек">+</button>
    </div>
  </section><div class="cups-summary">Кружки — ${guestCups} шт.</div>`:'';
  document.getElementById('cartList').innerHTML=entries.map(([key,item])=>
    `<div class="cart-row">
      <div class="cart-row-name">${esc(item.name)}<div class="cart-options">${[...G_TEA_ADDONS.filter(a=>item.addons?.[a]).map(a=>`${esc(a)} +50 ₽`),...(item.option?[`${esc(parseOption(item.option).label)} — ${parseOption(item.option).price?fmt(parseOption(item.option).price):'бесплатно'}`]:[])].join('<br>')}</div></div>
      <div class="c-qty-row">
        <div class="c-qty-btn" data-action="cQty" data-key="${escAttr(key)}" data-delta="-1">−</div>
        <div class="c-qty-num">${item.qty}</div>
        <div class="c-qty-btn" data-action="cQty" data-key="${escAttr(key)}" data-delta="1">+</div>
      </div>
      <div class="cart-row-price">${fmt(unitPrice(item)*item.qty)}</div>
    </div>`
  ).join('')+cupsHtml;
  syncOrderControls();
  document.getElementById('cartSubtotal').textContent=fmt(subtotal);
  document.getElementById('cartGrand').textContent=fmt(subtotal);
  enhanceControls(document.getElementById('cartList'));
  document.getElementById('cartTableLbl').textContent=tableNum;
  document.getElementById('cartBarLbl').textContent=BAR_NAME;
}

function openCart(){renderCartScreen();document.getElementById('conflictBox').innerHTML='';go('screen-cart');}
function closeCart(){go('screen-menu');}

function go(tid){
  const screens=document.querySelectorAll('.screen');
  const cur=[...screens].find(s=>s.classList.contains('active'));
  const tgt=document.getElementById(tid);
  if(!tgt||tgt===cur)return;
  const fwd=tid!=='screen-menu';
  if(cur){cur.inert=true;cur.classList.remove('active');cur.classList.add(fwd?'exit':'enter');setTimeout(()=>{if(cur.classList.contains('active'))return;cur.classList.remove('exit','enter');cur.classList.add('hidden');},400);}
  tgt.inert=false;
  tgt.classList.remove('hidden','exit','enter');tgt.classList.add('active');
}

// ─── PLACE ORDER ────────────────────────────────────
function syncOrderControls(){
  const btn=document.getElementById('placeBtn');
  btn.disabled=orderBusy||(!pendingOrder&&!Object.values(cart).some(v=>v.qty>0));
  btn.textContent=orderBusy?'Отправляем…':pendingOrder?'ПРОВЕРИТЬ ОТПРАВКУ':'ОТПРАВИТЬ ЗАКАЗ';
  document.getElementById('orderNote').readOnly=orderBusy||!!pendingOrder;
}

async function placeOrder(){
  const btn=document.getElementById('placeBtn');if(orderBusy||btn.disabled)return;
  const entries=Object.entries(cart).filter(([,v])=>v.qty>0);
  if(!entries.length&&!pendingOrder)return;
  orderBusy=true;syncOrderControls();
  try{
    if(!pendingOrder){
      const items=entries.map(([key,v])=>{
        const item=findItem(key);
        if(!item||item.name!==v.name||(item.productId||null)!==(v.productId||null))throw new Error('Меню изменилось. Уберите старую позицию и выберите товар заново.');
        return{category:item._categoryKey,item:item._itemKey,name:item.name,productId:v.productId||null,qty:v.qty,option:v.option,addons:G_TEA_ADDONS.filter(a=>v.addons?.[a])};
      });
      pendingOrder={requestId:crypto.randomUUID(),table:tableNum,token,sid:sessionId,items,cups:guestCups,note:document.getElementById('orderNote').value.trim(),expectedTotal:entries.reduce((s,[,v])=>s+unitPrice(v)*v.qty,0)};
      if(!saveDraft()){pendingOrder=null;throw new Error('Браузер не сохраняет состояние отправки. Разрешите хранилище для сайта и повторите.');}
    }
    const result=await api('placeGuestOrder',pendingOrder);
    confirmedOrder=result;
    pendingOrder=null;cart={};guestCups=0;document.getElementById('orderNote').value='';
    updateCartBar();showConfirmation(result);
  }catch(e){
    // Only explicit validation failures guarantee the operation was not accepted.
    if(['functions/invalid-argument','functions/failed-precondition','functions/permission-denied','functions/resource-exhausted'].includes(e.code)){
      pendingOrder=null;saveDraft();
      // Restored requests bypass session/menu loading so accepted receipts survive closure.
      // After a definite rejection, restore the editing session before allowing a new request.
      try{await initializeMenuSession();}
      catch(recoveryError){showInvalid(recoveryError.code==='functions/permission-denied'?'invalid':recoveryError.code==='functions/failed-precondition'?'closed':'network');}
    }
    saveDraft();
    const maintenance=e.code==='functions/unavailable'&&/режим обслуживания/i.test(e.message||'');
    document.getElementById('conflictBox').textContent=pendingOrder?(maintenance?e.message+' После возобновления работы нажмите «Проверить отправку».':'Не удалось подтвердить отправку. Нажмите «Проверить отправку»: повтор не создаст второй заказ.'):(e.message||'Проверьте заказ и повторите отправку.');
  }finally{orderBusy=false;syncOrderControls();}
}

// ─── CALL WAITER ────────────────────────────────────
function syncCallButtons(){for(const b of document.querySelectorAll('[data-action="callWaiter"]')){b.dataset.originalLabel||=b.textContent;b.textContent=pendingCall?'Проверить вызов':b.dataset.originalLabel;}}
async function callWaiter(){
  if(callPending||Date.now()<callCooldown)return;
  callPending=true;
  const buttons=document.querySelectorAll('[data-action="callWaiter"]');
  buttons.forEach(b=>b.disabled=true);
  try{
    if(!pendingCall){pendingCall={requestId:crypto.randomUUID(),table:tableNum,token,sid:sessionId};if(!saveDraft()){pendingCall=null;throw new Error('Браузер не сохраняет состояние вызова. Разрешите хранилище для сайта.');}}
    await api('guestCallWaiter',pendingCall);
    pendingCall=null;saveDraft();
    callCooldown=Date.now()+30000;flash('Вызов отправлен');
  }catch(e){
    if(['functions/invalid-argument','functions/failed-precondition','functions/permission-denied','functions/resource-exhausted'].includes(e.code))pendingCall=null;
    saveDraft();flash(pendingCall?'Не удалось подтвердить вызов. Нажмите «Проверить вызов».':e.message,true);
  }
  finally{syncCallButtons();callPending=false;setTimeout(()=>buttons.forEach(b=>b.disabled=false),Math.max(0,callCooldown-Date.now()));}
}
function showConfirmation(result){document.getElementById('confirmInfo').textContent=`Заказ #${result.num} · Стол ${result.table} · ${fmt(result.total)}`;go('screen-confirm');}
function newOrder(){confirmedOrder=null;cart={};guestCups=0;saveDraft();location.reload();}

// ─── UI HELPERS ──────────────────────────────────────
function showInvalid(reason){
  document.getElementById('app').style.display='none';
  document.getElementById('screen-loading').classList.add('hidden');
  document.getElementById('screen-invalid').classList.remove('hidden');
  if(reason==='draft'){
    document.getElementById('invalidTitle').textContent='Не удалось восстановить заказ';
    document.getElementById('invalidBody').textContent='Сохранённые данные повреждены. Уточните у официанта, был ли принят заказ, прежде чем оформлять его заново.';
  }
  if(reason==='network'){
    document.getElementById('invalidTitle').textContent='Не удалось загрузить меню';
    document.getElementById('invalidBody').textContent='Проверьте интернет и обновите страницу. Если ошибка повторится, позовите официанта.';
  }
  if(reason==='closed'){
    document.getElementById('invalidTitle').textContent='Стол закрыт';
    document.getElementById('invalidBody').textContent='Этот стол уже закрыт. Попросите официанта открыть новую сессию.';
  }
}
function showApp(){
  document.getElementById('screen-loading').classList.add('hidden');
  document.getElementById('app').style.display='block';
  document.getElementById('tableLbl').textContent=tableNum;
  const sl=document.getElementById('stickyTableLbl');
  if(sl)sl.textContent=tableNum;
  initStickyHeader();
}
function setConn(ok){document.getElementById('connDot').style.background=ok?'var(--green)':'var(--red)';document.getElementById('offlineBanner').style.display=ok?'none':'block';}
function flash(msg,isErr){
  const el=document.getElementById('flash');
  el.textContent=msg;el.classList.toggle('err',!!isErr);el.classList.add('show');
  clearTimeout(flashTmr);flashTmr=setTimeout(()=>el.classList.remove('show'),2800);
}
function todayStr(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function pad(n){return String(n).padStart(2,'0');}
function fmt(n){return(Number(n)||0).toLocaleString('ru-RU')+' ₽';}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escAttr(s){return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

document.addEventListener('click',e=>{
  const el=e.target.closest('[data-action]');
  if(!el)return;
  const a=el.dataset.action;
  if((pendingOrder||orderBusy)&&!['placeOrder','callWaiter'].includes(a)){flash('Сначала проверьте отправку предыдущего заказа',true);return;}
  if(a==='setCat')setCat(Number(el.dataset.index)||0);
  else if(a==='adjustCups')adjustCups(Number(el.dataset.delta)||0);
  else if(a==='addItem')addItem(el.dataset.key);
  else if(a==='anotherVariant')anotherVariant(el.dataset.key);
  else if(a==='remItem')remItem(el.dataset.key);
  else if(a==='toggleAddon')toggleAddon(el.dataset.key,el.dataset.addon);
  else if(a==='selectOption')selectOption(el.dataset.key,el.dataset.option);
  else if(a==='toggleGroup')toggleGroup(el.dataset.group);
  else if(a==='cQty')cQty(el.dataset.key,Number(el.dataset.delta)||0);
  else if(a==='openCart')openCart();
  else if(a==='closeCart')closeCart();
  else if(a==='placeOrder')placeOrder();
  else if(a==='newOrder')newOrder();
  else if(a==='callWaiter')callWaiter();
});

document.getElementById('orderNote').addEventListener('input',saveDraft);

function enhanceControls(root){
  root.querySelectorAll('[data-action]').forEach(el=>{
    if(el.tagName!=='BUTTON'){el.setAttribute('role','button');el.tabIndex=0;}
    const a=el.dataset.action;
    if(['addItem','remItem','cQty'].includes(a))el.setAttribute('aria-label',((a==='remItem'||el.dataset.delta==='-1')?'Уменьшить количество: ':'Увеличить количество: ')+(findItem(el.dataset.key)?.name||''));
    if(a==='selectOption')el.setAttribute('aria-pressed',String(cart[el.dataset.key]?.option===el.dataset.option));
    if(a==='toggleAddon')el.setAttribute('aria-pressed',String(!!cart[el.dataset.key]?.addons?.[el.dataset.addon]));
  });
}
enhanceControls(document);
document.querySelectorAll('.screen.hidden').forEach(el=>el.inert=true);
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role="button"][data-action]')){e.preventDefault();e.target.click();}});
