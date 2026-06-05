import{initializeApp}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import{getDatabase,ref,onValue,push,update,get,runTransaction}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import{getAuth,signInAnonymously}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const BAR_NAME='Кальянная 1708';
const fbApp=initializeApp({
  apiKey:'AIzaSyAdPAuuu7TRsJfI9jxyYkdscPvPObm-6h8',
  authDomain:'project-3061022303410047846.firebaseapp.com',
  databaseURL:'https://project-3061022303410047846-default-rtdb.firebaseio.com',
  projectId:'project-3061022303410047846',
  storageBucket:'project-3061022303410047846.firebasestorage.app',
  messagingSenderId:'21905205682',
  appId:'1:21905205682:web:c2d6935c9b9848a7291cab'
});
const db=getDatabase(fbApp);
const auth=getAuth(fbApp);

;(()=>{let _lt=0,_lx=0,_ly=0;document.addEventListener('touchend',e=>{const t=Date.now();const tc=e.changedTouches[0];const tag=e.target.tagName.toLowerCase();const skip=tag==='button'||tag==='input'||tag==='select'||tag==='textarea'||e.target.closest('button,[data-action]');const dx=tc.clientX-_lx,dy=tc.clientY-_ly;if(!skip&&t-_lt<300&&Math.sqrt(dx*dx+dy*dy)<20)e.preventDefault();_lt=t;_lx=tc.clientX;_ly=tc.clientY;},{passive:false});})();
let tableNum=null, token=null, sessionId=null;
let menuData=[]; // [{cat, items:[{name,price,stock?,group?}]}]
let cart={};     // {key: {name,price,qty,addons:{},option:null}}
let activeCat=0;
let openGroups=new Set();
let guestCups=0;
const G_TEA_ADDONS=['Чабрец','Лимон','Мята'];
function isLeafTeaCat(cat){return cat?.cat?.toLowerCase().includes('лист');}
function isTeaCat(cat){return cat?.cat?.toLowerCase().includes('чай');}
let flashTmr=null;

// ─── BOOT ───────────────────────────────────────────
(async()=>{
  const p=new URLSearchParams(location.search);
  tableNum=p.get('table'); token=p.get('token');
  if(!tableNum||!token){showInvalid();return;}
  try{await signInAnonymously(auth);}catch(e){}
  const today=todayStr();
  const metaKey=today+'_'+tableNum;
  try{
    const snap=await get(ref(db,'tables/'+metaKey));
    const meta=snap.val();
    const readQuizToken=async()=>{
      const quizSnap=await get(ref(db,'quiz_tokens/'+token));
      const qt=quizSnap.val();
      return qt&&String(qt.table)===String(tableNum)?qt:null;
    };
    if(!meta){
      // Стол не существует — проверяем quiz_tokens (для печатных QR квиза)
      const qt=await readQuizToken();
      if(!qt||String(qt.table)!==String(tableNum)){showInvalid();return;}
      // Токен валидный — автоматически открываем стол
      const newSid=Date.now().toString(36);
      await update(ref(db,'tables/'+metaKey),{status:'open',openedAt:Date.now(),date:today,tNum:tableNum,token,sid:newSid,autoOpened:true});
      sessionId=newSid;
    } else {
      if(meta.status==='closed'){showInvalid('closed');return;}
      if(meta.token!==token){
        const qt=await readQuizToken();
        if(!qt){showInvalid();return;}
      }
      sessionId=meta.sid||'default';
    }
    // Load menu once then subscribe
    await loadMenu();
    showApp();
    // Real-time menu updates (for stock)
    onValue(ref(db,'menu2'),snap=>{
      const raw=snap.val();
      if(raw){
        const cats=Array.isArray(raw)?raw:Object.values(raw);
        menuData=cats.map(c=>({...c,items:Array.isArray(c.items)?c.items:Object.values(c.items||{})}));
        renderMenu();
      }
      setConn(true);
    },()=>setConn(false));
    // Watch table status
    onValue(ref(db,'tables/'+metaKey),snap=>{
      const m=snap.val();
      if(m&&m.status==='closed')showInvalid('closed');
    });
  }catch(e){console.error(e);showInvalid();}
})();

// ─── MENU LOAD ───────────────────────────────────────
async function loadMenu(){
  const snap=await get(ref(db,'menu2'));
  const raw=snap.val();
  if(raw){
    const cats=Array.isArray(raw)?raw:Object.values(raw);
    menuData=cats.map(c=>({...c,items:Array.isArray(c.items)?c.items:Object.values(c.items||{})}));
  }
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
async function deductGuestStock(entries){
  const txs=[];
  for(const[,ci]of entries){
    const oName=ci.name.trim().toLowerCase();
    for(let ci2=0;ci2<menuData.length;ci2++){
      const catItems=menuData[ci2].items||[];
      for(let ii=0;ii<catItems.length;ii++){
        if(catItems[ii].name.trim().toLowerCase()===oName&&getStock(catItems[ii])!==null){
          txs.push({path:`menu2/${ci2}/items/${ii}/stock`,item:catItems[ii],qty:ci.qty,name:ci.name});
        }
      }
    }
  }
  for(const tx of txs){
    const res=await runTransaction(ref(db,tx.path),cur=>{
      if(cur===undefined||cur===null||cur==='')return cur;
      const n=Math.max(0,parseInt(cur,10)||0);
      if(n<tx.qty)return;
      return n-tx.qty;
    });
    if(!res.committed)throw new Error('Недостаточно остатков: '+tx.name);
    tx.item.stock=res.snapshot.val();
  }
}
function isOut(item){const s=getStock(item);return s!==null&&s===0;}
function canAdd(item,key){
  const s=getStock(item);
  if(s===null)return true;
  return s-(cart[key]?.qty||0)>0;
}
function iKey(item){return item.id||item.name.trim().toLowerCase().replace(/\s+/g,'_');}
function findItem(key){
  for(const cat of menuData)for(const it of(cat.items||[]))if(iKey(it)===key)return it;
  return null;
}

// ─── RENDER TABS ────────────────────────────────────
function renderTabs(){
  const el=document.getElementById('catTabs');
  el.innerHTML=menuData.map((c,i)=>
    `<div class="cat-tab${i===activeCat?' active':''}" data-action="setCat" data-index="${i}">${esc(c.cat)}</div>`
  ).join('')+'<div style="width:8px;flex-shrink:0"></div>';
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
  el.innerHTML=html.join('');
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
  const optHtml=qty>0&&item.options?.length?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">${item.options.map(opt=>{const sel=selOpt===opt;return`<div data-action="selectOption" data-key="${escAttr(key)}" data-option="${escAttr(opt)}" style="padding:4px 10px;border-radius:16px;font-size:12px;cursor:pointer;background:${sel?'#4caf50':'rgba(255,255,255,.07)'};color:${sel?'#000':'#888'};border:1px solid ${sel?'#4caf50':'rgba(255,255,255,.15)'};">${esc(opt)}</div>`;}).join('')}</div>`:'';
  return`<div class="menu-item${out?' unavail':''}">
    <div class="item-info">
      <div class="item-name">${esc(item.name)}</div>
      ${item.desc?`<div class="item-desc">${esc(item.desc)}</div>`:''}
      <div class="item-meta">
        <span class="item-price">${fmt(item.price||0)}</span>
        ${stockHtml}
      </div>
      ${addonHtml}${optHtml}
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
  if(!cart[key])cart[key]={name:item.name,price:item.price||0,qty:0,addons:{},option:null};
  cart[key].qty++;
  const cat=menuData[activeCat];
  if(isTeaCat(cat)&&guestCups===0)guestCups=1;
  updateCartBar();renderMenu();
}
function remItem(key){
  if(!cart[key])return;
  cart[key].qty--;
  if(cart[key].qty<=0)delete cart[key];
  updateCartBar();renderMenu();
}
function toggleAddon(key,addon){
  if(!cart[key])return;
  if(!cart[key].addons)cart[key].addons={};
  cart[key].addons[addon]=!cart[key].addons[addon];
  renderMenu();
}
function selectOption(key,val){
  if(!cart[key])return;
  cart[key].option=cart[key].option===val?null:val;
  renderMenu();
}
function adjustCups(delta){
  guestCups=Math.max(0,guestCups+delta);
  renderMenu();
}
function cQty(key,delta){
  if(!cart[key])return;
  const item=findItem(key);
  if(delta>0&&item&&!canAdd(item,key)){flash('Больше нет в наличии',true);return;}
  cart[key].qty+=delta;
  if(cart[key].qty<=0)delete cart[key];
  renderCartScreen();updateCartBar();
}
function toggleGroup(g){
  if(openGroups.has(g))openGroups.delete(g);else openGroups.add(g);
  renderMenu();
}
function setCat(i){activeCat=i;renderTabs();renderMenu();document.getElementById('menuList').scrollTop=0;}

function updateCartBar(){
  const entries=Object.values(cart).filter(x=>x.qty>0);
  const total=entries.reduce((s,i)=>s+i.price*i.qty,0);
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
  const subtotal=entries.reduce((s,[k,v])=>s+v.price*v.qty,0);
  document.getElementById('cartList').innerHTML=entries.map(([key,item])=>
    `<div class="cart-row">
      <div class="cart-row-name">${esc(item.name)}</div>
      <div class="c-qty-row">
        <div class="c-qty-btn" data-action="cQty" data-key="${escAttr(key)}" data-delta="-1">−</div>
        <div class="c-qty-num">${item.qty}</div>
        <div class="c-qty-btn" data-action="cQty" data-key="${escAttr(key)}" data-delta="1">+</div>
      </div>
      <div class="cart-row-price">${fmt(item.price*item.qty)}</div>
    </div>`
  ).join('');
  document.getElementById('cartSubtotal').textContent=fmt(subtotal);
  document.getElementById('cartGrand').textContent=fmt(subtotal);
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
  if(cur){cur.classList.remove('active');cur.classList.add(fwd?'exit':'enter');setTimeout(()=>{cur.classList.remove('exit','enter');cur.classList.add('hidden');},400);}
  tgt.classList.remove('hidden','exit','enter');tgt.classList.add('active');
}

// ─── PLACE ORDER ────────────────────────────────────
async function placeOrder(){
  const entries=Object.entries(cart).filter(([k,v])=>v.qty>0);
  if(!entries.length)return;
  const btn=document.getElementById('placeBtn');
  btn.disabled=true;btn.textContent='Отправляем…';
  try{
    // Stock conflict check
    const conflicts=[];
    for(const [key,cartItem] of entries){
      const menuItem=findItem(key);
      if(!menuItem)continue;
      const s=getStock(menuItem);
      if(s===null)continue;
      if(s<cartItem.qty)conflicts.push({key,name:cartItem.name,wanted:cartItem.qty,available:s});
    }
    if(conflicts.length){
      let html='';
      conflicts.forEach(c=>{
        if(c.available===0){html+=`❌ <b>${esc(c.name)}</b> закончилась — убрана из заказа<br>`;delete cart[c.key];}
        else{html+=`⚠️ <b>${esc(c.name)}</b>: хотели ${c.wanted} шт., осталось ${c.available} шт.<br>`;cart[c.key].qty=c.available;}
      });
      document.getElementById('conflictBox').innerHTML=`<div class="conflict-box">${html}</div>`;
      renderCartScreen();updateCartBar();
      btn.disabled=false;btn.textContent='ОТПРАВИТЬ ЗАКАЗ';
      return;
    }
    // Get order num
    const numRes=await runTransaction(ref(db,'publicCounters/orderNum'),n=>(n||0)+1);
    const orderNum=numRes.snapshot.val();
    const note=document.getElementById('orderNote').value.trim();
    const total=entries.reduce((s,[k,v])=>s+v.price*v.qty,0);
    const today=todayStr();
    // Build items obj
    const items={};
    entries.forEach(([key,ci],i)=>{
      const id=Date.now().toString(36)+'_'+i+'_'+Math.random().toString(36).slice(2,5);
      let name=ci.name;
      if(ci.addons){const sel=G_TEA_ADDONS.filter(a=>ci.addons[a]);if(sel.length)name+=` + ${sel.map(a=>a.toLowerCase()).join(', ')}`;}
      if(ci.option)name+=` — ${ci.option}`;
      items[id]={id,name,qty:ci.qty,status:'new'};
    });
    if(guestCups>0){const cid=Date.now().toString(36)+'_cups';const pl=guestCups===1?'кружка':guestCups<5?'кружки':'кружек';items[cid]={id:cid,name:`${guestCups} ${pl}`,qty:1,status:'new'};};
    await deductGuestStock(entries);
    const newRef=push(ref(db,'orders'));
    await update(ref(db,'orders/'+newRef.key),{
      id:newRef.key,table:parseInt(tableNum)||tableNum,
      items,note,priority:'normal',status:'new',
      createdAt:Date.now(),num:orderNum,date:today,sid:sessionId,source:'guest',total
    });
    // Show confirm
    document.getElementById('confirmInfo').textContent=`Заказ #${orderNum} · Стол ${tableNum} · ${fmt(total)}`;
    cart={};document.getElementById('orderNote').value='';
    updateCartBar();go('screen-confirm');
  }catch(e){console.error(e);flash('Ошибка соединения — попробуйте ещё раз',true);}
  finally{btn.disabled=false;btn.textContent='ОТПРАВИТЬ ЗАКАЗ';}
}

// ─── CALL WAITER ────────────────────────────────────
async function callWaiter(){
  try{
    const newRef=push(ref(db,'waiterCalls'));
    await update(ref(db,'waiterCalls/'+newRef.key),{table:tableNum,calledAt:Date.now(),date:todayStr(),status:'pending'});
    flash('🔔 Официант уже идёт!');
    const btn=document.getElementById('waiterBtn');
    if(btn){
      btn.style.opacity='.4';btn.style.pointerEvents='none';
      btn.textContent='✓ Вызов отправлен';
      setTimeout(()=>{btn.style.opacity='';btn.style.pointerEvents='';btn.textContent='🔔 Позвать официанта';},30000);
    }
  }catch(e){flash('Ошибка — попробуйте ещё раз',true);}
}

function newOrder(){cart={};activeCat=0;updateCartBar();renderTabs();renderMenu();go('screen-menu');}

// ─── UI HELPERS ──────────────────────────────────────
function showInvalid(reason){
  document.getElementById('screen-loading').classList.add('hidden');
  document.getElementById('screen-invalid').classList.remove('hidden');
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
function todayStr(){const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function pad(n){return String(n).padStart(2,'0');}
function fmt(n){return(Number(n)||0).toLocaleString('ru-RU')+' ₽';}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escAttr(s){return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

document.addEventListener('click',e=>{
  const el=e.target.closest('[data-action]');
  if(!el)return;
  const a=el.dataset.action;
  if(a==='setCat')setCat(Number(el.dataset.index)||0);
  else if(a==='adjustCups')adjustCups(Number(el.dataset.delta)||0);
  else if(a==='addItem')addItem(el.dataset.key);
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
