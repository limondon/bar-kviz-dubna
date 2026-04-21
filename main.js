// ═══════════════════════════
//  KEYS & STATE
// ═══════════════════════════
const OKEY='bar_orders_v10';
const TKEY='bar_tables_v10';
let orders=[], tablesMeta={}, menuItems=[];
let BUILTIN_MENU_LIVE=[]; // меню из Firebase (категории + позиции)
let role=null, activeTab='', lastHash='', qf='all';
let viewDate=todayStr(), closedViewDate=todayStr(), pendingRole=null, editOrderId=null, editBillMode=false;

// ═══════════════════════════
//  DATE HELPERS
// ═══════════════════════════
function todayStr(){const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function pad(n){return String(n).padStart(2,'0');}
function dateLbl(s){
  const [y,m,d]=s.split('-');
  if(s===todayStr())return'Сегодня, '+d+'.'+m;
  if(s===shiftDS(todayStr(),-1))return'Вчера, '+d+'.'+m;
  return d+'.'+m+'.'+y;
}
function shiftDS(s,n){const d=new Date(s);d.setDate(d.getDate()+n);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function shiftDate(n){viewDate=shiftDS(viewDate,n);renderTables();}
function jumpDate(d){viewDate=d;renderTables();}

// ═══════════════════════════
//  PARSE ITEMS
// ═══════════════════════════
function parseItems(text){
  return text.split('\n').map(l=>l.trim()).filter(Boolean).map((line,i)=>{
    let qty=1, name=line;
    // m1: "2x Пиво" or "2х Пиво" — x/х must be followed by space (not part of word)
    const m1=line.match(/^(\d+)\s*[xXхХ]\s+(.+)/);
    // m2: "2 Пиво светлое"
    const m2=line.match(/^(\d+)\s+(.+)/);
    // m3: "Пиво x2" or "Пиво х2" — x/х preceded by space
    const m3=line.match(/^(.+?)\s+[xXхХ](\d+)$/);
    if(m1){qty=parseInt(m1[1]);name=m1[2].trim();}
    else if(m2){qty=parseInt(m2[1]);name=m2[2].trim();}
    else if(m3){qty=parseInt(m3[2]);name=m3[1].trim();}
    return{id:Date.now().toString(36)+'_'+i+'_'+Math.random().toString(36).slice(2,5),name,qty,status:'new'};
  });
}

// ═══════════════════════════
//  AGGREGATE ORDER STATUS
// ═══════════════════════════
function aggStatus(items){
  if(!items||!items.length)return'new';
  const n=items.length;
  const done=items.filter(i=>i.status==='done').length;
  const ready=items.filter(i=>i.status==='ready').length;
  const making=items.filter(i=>i.status==='making').length;
  if(done===n)return'done';
  if(done+ready===n)return'ready';
  if(making>0||ready>0||done>0)return'making';
  return'new';
}

// ═══════════════════════════
//  FIREBASE SDK (real-time)
// ═══════════════════════════
import{initializeApp}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import{getDatabase,ref,push,update,set,remove,onValue,serverTimestamp}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const fbApp=initializeApp({databaseURL:'https://project-3061022303410047846-default-rtdb.firebaseio.com'});
const db=getDatabase(fbApp);

function setConnStatus(ok){
  const dot=document.querySelector('.dot');
  if(dot){dot.style.background=ok?'var(--green)':'var(--red)';dot.style.boxShadow=ok?'0 0 5px var(--green)':'0 0 5px var(--red)';}
}

async function fbUpdate(path,data){
  try{await update(ref(db,path),data);}
  catch(e){console.error('fbUpdate',e);setConnStatus(false);}
}

// ═══════════════════════════
//  STORAGE (real-time SDK)
// ═══════════════════════════
function normalizeOrder(o){
  if(typeof o.items==='string'){
    o.items=parseItems(o.items);
  } else if(o.items&&!Array.isArray(o.items)){
    o.items=Object.entries(o.items)
      .filter(([k,v])=>v&&typeof v==='object'&&v.name)
      .map(([k,v])=>{
        const it={...v};
        it._fbKey=k;
        if(!it.id)it.id=k;
        return it;
      });
  } else if(Array.isArray(o.items)){
    o.items=o.items.filter(it=>it&&it.name).map((it,i)=>{
      const r={...it};
      if(!r._fbKey)r._fbKey=r.id||String(i);
      if(!r.id)r.id=String(i);
      return r;
    });
  }
  if(!Array.isArray(o.items))o.items=[];
  o.items.forEach(it=>{if(!it.status)it.status='new';});
  o.status=aggStatus(o.items);
  return o;
}

// ═══════════════════════════
//  SERVICE WORKER + NOTIFICATIONS
// ═══════════════════════════
let knownOrderIds=new Set();
let audioCtx=null;
let audioUnlocked=false;
let swReg=null;

async function registerSW(){
  if(!('serviceWorker' in navigator))return;
  try{
    swReg=await navigator.serviceWorker.register('/bar-kviz-dubna/sw.js',{scope:'/bar-kviz-dubna/'});
    console.log('SW registered');
  }catch(e){console.warn('SW registration failed',e);}
}

async function requestNotificationPermission(){
  if(!('Notification' in window))return false;
  if(Notification.permission==='granted') return true;
  if(Notification.permission==='denied') return false;
  // iOS требует вызова строго внутри user gesture (click/touch)
  const result=await Notification.requestPermission();
  updateNotifBtn();
  return result==='granted';
}

function unlockAudio(){
  if(audioUnlocked)return;
  try{
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const buf=audioCtx.createBuffer(1,1,22050);
    const src=audioCtx.createBufferSource();
    src.buffer=buf;src.connect(audioCtx.destination);src.start(0);
    audioUnlocked=true;
  }catch(e){}
}
document.addEventListener('touchstart',unlockAudio,{once:true,passive:true});
document.addEventListener('click',unlockAudio,{once:true,passive:true});

// Кнопка уведомлений — полноценный переключатель вкл/выкл
// notifMuted хранится в localStorage — пользователь может выключить звук/вибрацию
let notifMuted=localStorage.getItem('bar_notif_muted')==='1';

function updateNotifBtn(){
  const btns=document.querySelectorAll('.notif-btn');
  if(!('Notification' in window)&&!('vibrate' in navigator)){
    btns.forEach(b=>b.style.display='none');return;
  }
  const perm=typeof Notification!=='undefined'?Notification.permission:'granted';
  btns.forEach(b=>{
    b.style.pointerEvents='auto';
    b.style.opacity='1';
    if(perm==='denied'){
      // Браузер запретил — объясняем где снять запрет
      b.textContent='🔕 Запрещено в настройках';
      b.style.color='var(--red)';
      b.style.opacity='0.6';
      b.style.pointerEvents='none';
    } else if(notifMuted){
      b.textContent='🔕 Уведомления выкл.';
      b.style.color='var(--muted)';
    } else if(perm==='granted'){
      b.textContent='🔔 Уведомления вкл.';
      b.style.color='var(--green)';
    } else {
      b.textContent='🔔 Включить уведомления';
      b.style.color='var(--accent)';
    }
  });
}

async function enableNotifications(){
  const perm=typeof Notification!=='undefined'?Notification.permission:'default';
  if(perm==='denied') return; // нельзя снять запрет программно
  if(notifMuted){
    // Включаем обратно
    notifMuted=false;
    localStorage.setItem('bar_notif_muted','0');
    updateNotifBtn();
    fl('fOk','🔔 Уведомления включены');
    return;
  }
  if(perm==='granted'){
    // Выключаем
    notifMuted=true;
    localStorage.setItem('bar_notif_muted','1');
    updateNotifBtn();
    fl('fInfo','🔕 Уведомления выключены');
    return;
  }
  // Ещё не запрашивали — запрашиваем разрешение
  unlockAudio();
  await requestNotificationPermission();
  notifMuted=false;
  localStorage.setItem('bar_notif_muted','0');
  updateNotifBtn();
}

function playBeep(){
  try{
    if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const play=()=>{
      const osc=audioCtx.createOscillator();
      const gain=audioCtx.createGain();
      osc.connect(gain);gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(1000,audioCtx.currentTime);
      osc.frequency.setValueAtTime(700,audioCtx.currentTime+0.15);
      osc.type='sine';
      gain.gain.setValueAtTime(0,audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5,audioCtx.currentTime+0.02);
      gain.gain.setValueAtTime(0.5,audioCtx.currentTime+0.13);
      gain.gain.linearRampToValueAtTime(0,audioCtx.currentTime+0.15);
      gain.gain.linearRampToValueAtTime(0.4,audioCtx.currentTime+0.17);
      gain.gain.linearRampToValueAtTime(0,audioCtx.currentTime+0.32);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime+0.35);
    };
    if(audioCtx.state==='suspended') audioCtx.resume().then(play);
    else play();
  }catch(e){}
}

function notifyNewOrder(order){
  if(notifMuted) return; // пользователь выключил
  if(navigator.vibrate) navigator.vibrate([150,80,150,80,150]);
  playBeep();
  const table=order?.table||'?';
  const count=order?.items?Object.keys(order.items).length:'';
  if(swReg&&Notification.permission==='granted'){
    swReg.active?.postMessage({type:'NOTIFY_NEW_ORDER',table,count});
  } else if(Notification.permission==='granted'){
    new Notification('🍺 Новый заказ!',{body:`Стол ${table} — ${count} позиц.`,icon:'/bar-kviz-dubna/icon-192.png'});
  }
}

function checkNewOrders(newOrders){
  if(knownOrderIds.size===0){
    newOrders.forEach(o=>knownOrderIds.add(o.id));
    return;
  }
  const newOnes=[];
  newOrders.forEach(o=>{
    if(!knownOrderIds.has(o.id)){knownOrderIds.add(o.id);newOnes.push(o);}
  });
  if(newOnes.length&&(role==='barman'||role==='admin')){
    notifyNewOrder(newOnes[newOnes.length-1]);
  }
}


async function loadAll(){
  setConnStatus(false);

  // Вычисляем дату 30 дней назад для фильтрации
  const cutoffDate=(()=>{
    const d=new Date();d.setDate(d.getDate()-30);
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  })();

  onValue(ref(db,'orders'),(snap)=>{
    const raw=snap.val();
    if(raw){
      const cleanupUpd={};
      Object.entries(raw).forEach(([orderId,o])=>{
        if(o.items&&typeof o.items==='object'&&!Array.isArray(o.items)){
          Object.entries(o.items).forEach(([k,v])=>{
            if(!v||typeof v!=='object'||!v.name){
              cleanupUpd[`orders/${orderId}/items/${k}`]=null;
            }
          });
        }
      });
      if(Object.keys(cleanupUpd).length>0){
        update(ref(db),cleanupUpd).catch(e=>console.error('cleanup',e));
      }
    }
    // Загружаем только заказы за последние 30 дней
    orders=raw?Object.values(raw)
      .filter(o=>!o.date||o.date>=cutoffDate)
      .map(normalizeOrder):[];
    checkNewOrders(orders);
    setConnStatus(true);
    renderAll();
  },(e)=>{console.error(e);setConnStatus(false);});

  onValue(ref(db,'tables'),(snap)=>{
    tablesMeta=snap.val()||{};
    if(activeTab==='tables')renderTables();
  });

  onValue(ref(db,'menu2'),(snap)=>{
    const raw=snap.val();
    if(!raw){
      // Первый запуск — заливаем встроенное меню в Firebase
      set(ref(db,'menu2'), BUILTIN_MENU).catch(e=>console.error('menu seed',e));
    } else {
      // Firebase возвращает объект — конвертируем в массив
      const cats=Array.isArray(raw)?raw:Object.values(raw);
      // Конвертируем items внутри каждой категории
      BUILTIN_MENU_LIVE=cats.map(cat=>({
        ...cat,
        items:Array.isArray(cat.items)?cat.items:Object.values(cat.items||{})
      }));
      if(activeTab==='menu') renderMenuPage();
    }
  });
}

function startPoll(){
  setInterval(()=>{
    document.getElementById('hTime').textContent=new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
  },1000);
  // Обновляем только тексты таймеров раз в минуту — без перерисовки карточек
  setInterval(()=>{
    document.querySelectorAll('[data-created]').forEach(el=>{
      const created=parseInt(el.dataset.created);
      if(!created)return;
      const mins=Math.floor((Date.now()-created)/60000);
      const urgent=mins>=15;
      el.textContent=mins>0?`⏱ ${mins} мин${urgent?' !':''}`:'' ;
      el.style.background=urgent?'rgba(229,57,53,.18)':'rgba(255,255,255,.06)';
      el.style.color=urgent?'var(--red)':'var(--muted)';
    });
  },60000);
}

// ═══════════════════════════
//  ВСТРОЕННОЕ МЕНЮ (категории + позиции)
// ═══════════════════════════
const BUILTIN_MENU=[
  {cat:'🍺 Пиво', items:[
    {name:'Hoegarden',price:250},
    {name:'Spaten',price:300},
    {name:'Corona Extra',price:300},
    {name:'Stella Artois',price:250},
    {name:'Сидр Chester',price:250,note:true,notePlaceholder:'вкус: яблоко, груша, клубника, кокос, ягоды'},
    {name:'Безалкогольное пиво',price:200},
    {name:'Козел тёмный',price:250},
  ]},
  {cat:'🍵 Фрукт. чай', items:[
    {name:'Облепиховый чай',price:700},
    {name:'Имбирно-лимонный чай',price:700},
    {name:'Вишневый блик',price:700},
    {name:'Облепиха-груша',price:700},
    {name:'Сладкий цитрус',price:700},
    {name:'Итальянские каникулы',price:700},
    {name:'Ягодный микс',price:700},
    {name:'Апельсин-корица',price:700},
    {name:'Имбирно-малиновый чай',price:700},
    {name:'Марокканский чай',price:700},
    {name:'Малиновый чай',price:700},
    {name:'Клюквенный чай',price:700},
  ]},
  {cat:'🍃 Лист. чай', items:[
    {name:'Сенча',price:500},
    {name:'Ассам',price:500},
    {name:'Чай с бергамотом',price:500},
    {name:'Наглый фрукт',price:500},
    {name:'Каркаде',price:500},
    {name:'Клубника со сливками',price:500},
    {name:'Иван-чай',price:500},
  ]},
  {cat:'🥤 Лимонады', items:[
    {name:'Лимонад вишневый',price:400},
    {name:'Манго Давида',price:400},
    {name:'Клубнично-малиновый',price:400},
    {name:'Лимонад цитрусовый',price:400},
    {name:'Лимонад имбирно-лимонный',price:400},
    {name:'Тропический',price:400},
    {name:'Мохито',price:400},
    {name:'Клюква с черной смородиной',price:400},
    {name:'Грейпфрут-ваниль',price:400},
  ]},
  {cat:'🥤 Напитки', items:[
    {name:'Сок',price:400,note:true,notePlaceholder:'какой сок'},
    {name:'Вода газ',price:150},
    {name:'Вода без газа',price:150},
    {name:'Натахтари',price:250,note:true,notePlaceholder:'вкус: виноград, фейхоа, ...'},
    {name:'Red Bull',price:300},
    {name:'Coca-Cola',price:250},
    {name:'Fanta',price:250},
    {name:'Sprite',price:250},
  ]},
  {cat:'🍟 Закуски', items:[
    {name:'Чипсы Lays',price:200},
    {name:'Сухарики',price:200},
    {name:'Фисташки',price:200},
    {name:'Арахис',price:150},
    {name:'Шоколад',price:200,note:true,notePlaceholder:'какой шоколад'},
    {name:'Джерки',price:250},
  ]},
  {cat:'☕ Кофе', items:[
    {name:'Эспрессо',price:100},
    {name:'Двойной эспрессо',price:170},
    {name:'Американо',price:200},
    {name:'Латте',price:350},
    {name:'Капучино',price:350},
  ]},
];

// Состояние модала
let pickerState={}; // {itemName: {qty, note}}
let pickerCat=0;

function buildMenuButtons(){
  // Кнопка выбора из меню — уже в HTML, просто скрываем если нет позиций
  const el=document.getElementById('menuBtns');
  if(el)el.innerHTML='';
}

function openMenuPicker(){
  pickerState={};
  pickerCat=0;
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  // Предзаполняем из textarea если что-то уже введено
  const ta=document.getElementById('inpItems');
  if(ta&&ta.value.trim()){
    parseItems(ta.value).forEach(it=>{
      pickerState[it.name]={qty:it.qty,note:''};
    });
  }
  renderPickerTabs();
  renderPickerList();
  updatePickerBtn();
  document.getElementById('menuPickerOverlay').classList.remove('hidden');
}

function closeMenuPicker(){
  document.getElementById('menuPickerOverlay').classList.add('hidden');
}

function renderPickerTabs(){
  const el=document.getElementById('menuPickerTabs');
  if(!el)return;
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  el.innerHTML=menu.map((cat,i)=>`
    <div onclick="switchPickerCat(${i})" style="
      flex-shrink:0;padding:10px 14px;cursor:pointer;white-space:nowrap;
      font-size:13px;font-family:'IBM Plex Mono',monospace;
      border-bottom:3px solid ${i===pickerCat?'var(--accent)':'transparent'};
      color:${i===pickerCat?'var(--accent)':'var(--muted)'};
      transition:all .15s;
    ">${cat.cat}</div>
  `).join('');
}

function switchPickerCat(i){
  pickerCat=i;
  renderPickerTabs();
  renderPickerList();
}

function renderPickerList(){
  const el=document.getElementById('menuPickerList');
  if(!el)return;
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const cat=menu[pickerCat];
  el.innerHTML=cat.items.map(item=>{
    const st=pickerState[item.name]||{qty:0,note:''};
    const hasQty=st.qty>0;
    return`
    <div style="padding:10px 16px;border-bottom:1px solid var(--border);${hasQty?'background:rgba(245,166,35,.04);':''}">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="flex:1;">
          <div style="font-size:14px;${hasQty?'color:var(--text);font-weight:600;':'color:var(--muted);'}">${esc(item.name)}</div>
          <div style="font-size:11px;color:var(--muted);">${item.price}₽</div>
        </div>
        <div style="display:flex;align-items:center;gap:0;flex-shrink:0;">
          <button data-picker-action="minus" data-item="${esc(item.name)}" style="
            width:40px;height:40px;border:1px solid var(--border);border-radius:8px 0 0 8px;
            background:var(--card);color:var(--text);font-size:20px;cursor:pointer;
            ${!hasQty?'opacity:.35;':''}
          ">−</button>
          <div style="
            width:40px;height:40px;display:flex;align-items:center;justify-content:center;
            border-top:1px solid var(--border);border-bottom:1px solid var(--border);
            font-family:'Bebas Neue',sans-serif;font-size:22px;
            color:${hasQty?'var(--accent)':'var(--muted)'};background:var(--bg);
          ">${st.qty}</div>
          <button data-picker-action="plus" data-item="${esc(item.name)}" style="
            width:40px;height:40px;border:1px solid var(--border);border-radius:0 8px 8px 0;
            background:var(--accent);color:#000;font-size:20px;cursor:pointer;font-weight:700;
          ">+</button>
        </div>
      </div>
      ${hasQty&&item.note?`
        <input type="text" placeholder="${item.notePlaceholder||'уточнить...'}"
          value="${esc(st.note||'')}"
          data-picker-note="${esc(item.name)}"
          style="width:100%;margin-top:8px;padding:7px 10px;border-radius:6px;
            border:1px solid var(--border);background:var(--bg);color:var(--text);
            font-family:'IBM Plex Mono',monospace;font-size:13px;"
        >
      `:''}
    </div>`;
  }).join('');
}

function updatePickerBtn(){
  const btn=document.getElementById('menuPickerBtn');
  if(!btn)return;
  const total=Object.values(pickerState).reduce((s,v)=>s+(v.qty||0),0);
  btn.textContent=total>0?`ГОТОВО (${total} позиц.)`:'ГОТОВО';
}

function confirmMenuPicker(){
  // Сохраняем уточнения из инпутов
  document.querySelectorAll('[data-picker-note]').forEach(inp=>{
    const name=inp.dataset.pickerNote;
    if(pickerState[name]) pickerState[name].note=inp.value.trim();
  });

  // Строим текст для textarea
  const lines=[];
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  menu.forEach(cat=>{
    cat.items.forEach(item=>{
      const st=pickerState[item.name];
      if(st&&st.qty>0){
        const note=st.note?` (${st.note})`:'';
        lines.push(`${st.qty} ${item.name}${note}`);
      }
    });
  });

  const ta=document.getElementById('inpItems');
  if(ta) ta.value=lines.join('\n');
  closeMenuPicker();
}

// Обработчик кнопок +/– в пикере
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-picker-action]');
  if(!btn)return;
  const action=btn.dataset.pickerAction;
  const itemName=btn.dataset.item;
  if(!pickerState[itemName]) pickerState[itemName]={qty:0,note:''};
  if(action==='plus') pickerState[itemName].qty++;
  if(action==='minus') pickerState[itemName].qty=Math.max(0,pickerState[itemName].qty-1);
  renderPickerList();
  updatePickerBtn();
},true);


function openMenuEditor(){
  const overlay=document.getElementById('menuEditorOverlay');
  if(!overlay)return;
  renderMenuEditor();
  overlay.classList.remove('hidden');
}
function closeMenuEditor(){
  const overlay=document.getElementById('menuEditorOverlay');
  if(overlay)overlay.classList.add('hidden');
}

function renderMenuEditor(){
  const el=document.getElementById('menuEditorList');
  if(!el)return;
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu.length){
    el.innerHTML=`<div style="color:var(--muted);font-size:12px;padding:8px 0;">Меню пусто</div>`;
    return;
  }
  el.innerHTML=menu.map((cat,ci)=>`
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border);">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;color:var(--accent);letter-spacing:1px;">
          ${esc(cat.cat)}
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          ${ci>0?`<button onclick="moveMenuCat(${ci},-1)" style="background:transparent;border:1px solid var(--border);color:var(--muted);cursor:pointer;border-radius:4px;padding:2px 7px;font-size:12px;">▲</button>`:'<span style="width:28px;"></span>'}
          ${ci<menu.length-1?`<button onclick="moveMenuCat(${ci},+1)" style="background:transparent;border:1px solid var(--border);color:var(--muted);cursor:pointer;border-radius:4px;padding:2px 7px;font-size:12px;">▼</button>`:'<span style="width:28px;"></span>'}
          <button onclick="removeMenuCategory(${ci})" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:12px;padding:2px 6px;" title="Удалить категорию">🗑</button>
        </div>
      </div>
      ${cat.items.map((item,ii)=>`
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);">
          <input type="text" value="${esc(item.name)}"
            onchange="updateMenuCatItem(${ci},${ii},'name',this.value)"
            style="flex:1;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);">
          <input type="number" value="${item.price||0}" min="0"
            onchange="updateMenuCatItem(${ci},${ii},'price',+this.value)"
            style="width:65px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:5px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--muted);">
          <span style="font-size:11px;color:var(--muted);">₽</span>
          <button onclick="removeMenuCatItem(${ci},${ii})" style="background:rgba(229,57,53,.15);color:var(--red);border:1px solid rgba(229,57,53,.3);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;flex-shrink:0;">✕</button>
        </div>
      `).join('')}
      <div style="display:flex;gap:6px;margin-top:6px;">
        <input type="text" id="newItem_${ci}" placeholder="Новая позиция"
          style="flex:1;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:5px 8px;background:var(--bg);border:1px dashed var(--border);border-radius:5px;color:var(--text);"
          onkeydown="if(event.key==='Enter')addMenuCatItem(${ci})">
        <button onclick="addMenuCatItem(${ci})" style="background:rgba(76,175,80,.15);color:var(--green);border:1px solid rgba(76,175,80,.3);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;">+ Добавить</button>
      </div>
    </div>
  `).join('');
}

async function moveMenuCat(ci, dir){
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const ni=ci+dir;
  if(ni<0||ni>=menu.length)return;
  [menu[ci],menu[ni]]=[menu[ni],menu[ci]];
  await saveMenuToFirebase();
  renderMenuPage();
}

async function addMenuCategory(){
  const emoji=(document.getElementById('newCatEmoji')?.value||'').trim();
  const name=(document.getElementById('newCatName')?.value||'').trim();
  if(!name){fl('fInfo','Введите название категории');return;}
  const cat=emoji?`${emoji} ${name}`:name;
  const menu=BUILTIN_MENU_LIVE.length?[...BUILTIN_MENU_LIVE]:[...BUILTIN_MENU];
  menu.push({cat,items:[]});
  BUILTIN_MENU_LIVE.length=0;
  menu.forEach(c=>BUILTIN_MENU_LIVE.push(c));
  await saveMenuToFirebase();
  document.getElementById('newCatEmoji').value='';
  document.getElementById('newCatName').value='';
  renderMenuPage();
  fl('fOk','✅ Категория "'+cat+'" создана');
}

async function removeMenuCategory(ci){
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const ok=await showConfirm(`Удалить категорию "${menu[ci]?.cat}"?`,'Все позиции в ней тоже удалятся.');
  if(!ok)return;
  menu.splice(ci,1);
  await saveMenuToFirebase();
  renderMenuPage();
  fl('fOk','Категория удалена');
}

async function saveMenuToFirebase(){
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  await set(ref(db,'menu2'), menu);
}

async function updateMenuCatItem(ci,ii,field,val){
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu[ci]||!menu[ci].items[ii])return;
  menu[ci].items[ii][field]=val;
  await saveMenuToFirebase();
}

async function removeMenuCatItem(ci,ii){
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu[ci])return;
  menu[ci].items.splice(ii,1);
  await saveMenuToFirebase();
  renderMenuEditor();
  fl('fOk','Позиция удалена');
}

async function addMenuCatItem(ci){
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu[ci])return;
  const inp=document.getElementById('newItem_'+ci);
  const name=(inp?.value||'').trim();
  if(!name){fl('fInfo','Введите название');return;}
  menu[ci].items.push({name,price:0});
  await saveMenuToFirebase();
  if(inp)inp.value='';
  renderMenuEditor();
  fl('fOk','✅ '+name+' добавлено');
}

// Старые функции оставляем для совместимости
async function updateMenuItem(){}
async function removeMenuItem(){}
async function addNewMenuItem(){
  // Перенаправляем на новую логику — добавление в первую категорию
  fl('fInfo','Используй кнопку "+ Добавить" в нужной категории');
}
function tKey(date,tNum){return date+'_'+tNum;}
function getTMeta(date,tNum){
  const k=tKey(date,tNum);
  if(!tablesMeta[k])tablesMeta[k]={status:'open',openedAt:Date.now(),date,tNum};
  return tablesMeta[k];
}
async function closeTable(date,tNum,sid){
  const ok=await showConfirm(
    `💳 Закрыть стол ${tNum}?`,
    'Отметить как оплачен. Стол переместится в "Закрытые".',
    'ЗАКРЫТЬ / ОПЛАЧЕН'
  );
  if(!ok)return;
  const m=getTMeta(date,tNum);
  m.status='closed';m.closedAt=Date.now();
  if(!m.closedSessions)m.closedSessions=[];
  m.closedSessions.push({sid:sid||m.sid||'default',closedAt:m.closedAt,openedAt:m.openedAt});
  await fbUpdate('tables',tablesMeta);
  renderTables();renderClosed();fl('fOk','✅ Стол '+tNum+' закрыт');
}
async function reopenTable(date,tNum){
  const m=getTMeta(date,tNum);
  m.status='open';
  delete m.closedAt;
  if(m.closedSessions&&m.closedSessions.length){
    m.closedSessions.pop();
  }
  await fbUpdate('tables',tablesMeta);
  renderTables();
  renderClosed();
  fl('fOk','↩ Стол '+tNum+' переоткрыт');
}

// ═══════════════════════════
//  ROLE
// ═══════════════════════════
function openRoleModal(){
  pendingRole=role;
  document.querySelectorAll('.rc').forEach(c=>c.classList.remove('sel'));
  if(role){const m={waiter:'rw',barman:'rb',admin:'ra'};document.querySelector('.rc.'+m[role])?.classList.add('sel');}
  document.getElementById('roleClose').style.display=role?'block':'none';
  document.getElementById('roleOverlay').classList.remove('hidden');
}
function closeRoleModal(){document.getElementById('roleOverlay').classList.add('hidden');}
function pickRole(r){
  pendingRole=r;
  document.querySelectorAll('.rc').forEach(c=>c.classList.remove('sel'));
  const m={waiter:'rw',barman:'rb',admin:'ra'};
  document.querySelector('.rc.'+m[r])?.classList.add('sel');
}
function confirmRole(){
  if(!pendingRole){fl('fInfo','Выберите роль!');return;}
  role=pendingRole;localStorage.setItem('bar_role',role);
  closeRoleModal();applyRole();
  fl('fOk','Роль: '+{waiter:'Официант',barman:'Бармен',admin:'Менеджер'}[role]);
}
function applyRole(){
  const lbl={waiter:'🛎️ Официант',barman:'🍹 Бармен',admin:'👑 Менеджер'};
  const cls={waiter:'rb-waiter',barman:'rb-barman',admin:'rb-admin'};
  const hr=document.getElementById('hRole');
  hr.textContent=lbl[role];hr.className='rbadge '+cls[role];
  buildTabs();renderAll();
  buildQuickTableBtns();
  // Показываем кнопку уведомлений в хедере на телефоне (для бармена и менеджера)
  let hnotif=document.getElementById('hNotif');
  if(!hnotif){
    hnotif=document.createElement('span');
    hnotif.id='hNotif';
    hnotif.className='notif-btn';
    hnotif.style.cssText='font-size:11px;cursor:pointer;padding:4px 8px;border-radius:12px;border:1px solid;white-space:nowrap;display:none;';
    hnotif.onclick=enableNotifications;
    document.querySelector('.hright').insertBefore(hnotif,document.querySelector('.dot'));
  }
  // Показываем только барменам и менеджерам — они принимают заказы
  if(role==='barman'||role==='admin'){
    hnotif.style.display='flex';
    updateNotifBtn();
  } else {
    hnotif.style.display='none';
  }
}

function buildQuickTableBtns(){
  const el=document.getElementById('quickTableBtns');
  if(!el)return;
  const TABLES=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,'PS1','PS2'];
  const current=document.getElementById('inpTable')?.value?.toUpperCase().trim();
  el.innerHTML=TABLES.map(t=>{
    const val=String(t);
    const isPS=val.startsWith('PS');
    const isActive=val===current;
    return`<button
      onclick="pickTable('${val}')"
      data-tval="${val}"
      style="
        min-width:${isPS?56:44}px;min-height:44px;
        padding:6px ${isPS?'10px':'8px'};
        background:${isActive?'rgba(245,166,35,.25)':'var(--card)'};
        border:${isActive?'2px solid var(--accent)':'1px solid var(--border)'};
        border-radius:8px;
        color:${isPS?'var(--purple)':isActive?'var(--accent)':'var(--text)'};
        font-family:'Bebas Neue',sans-serif;
        font-size:${isPS?'14px':'18px'};
        cursor:pointer;transition:all .15s;letter-spacing:1px;
        ${isPS?'border-color:rgba(156,39,176,.5);background:rgba(156,39,176,.08);':''}
        ${isActive&&isPS?'border-color:var(--purple)!important;background:rgba(156,39,176,.25)!important;':''}
      "
    >${val}</button>`;
  }).join('');
}

function pickTable(val){
  const inp=document.getElementById('inpTable');
  if(inp)inp.value=val;
  buildQuickTableBtns();
}

// ═══════════════════════════
//  DEVICE DETECTION
// ═══════════════════════════
function getDevice(){
  const w=window.innerWidth;
  if(w>=1024)return'desktop';
  if(w>=768)return'tablet';
  return'phone';
}

// ═══════════════════════════
//  TABS / NAV BUILD
// ═══════════════════════════
function buildTabs(){
  const device=getDevice();
  const tabDefs=getTabDefs();
  const bar=document.getElementById('tabsBar');
  bar.innerHTML=tabDefs.map(t=>
    `<div class="tab" onclick="sw('${t.id}')">${t.label}${t.badge?` <span class="bdg${t.badgeCls?` ${t.badgeCls}`:''}" id="${t.badge}">0</span>`:''}</div>`
  ).join('');
  buildBottomNav(tabDefs);
  buildSidebar(tabDefs);
  applyDeviceLayout(device);
  sw(tabDefs[0].id);
}

function getTabDefs(){
  if(role==='barman') return[
    {id:'queue', label:'Очередь', ico:'📋', badge:'bQ'},
    {id:'tables',label:'Столики', ico:'🪑', badge:'bT', badgeCls:'bp'},
    {id:'done',  label:'Закрытые',ico:'✅', badge:'bD'},
  ];
  if(role==='waiter') return[
    {id:'new',   label:'+ Заказ', ico:'➕'},
    {id:'ready', label:'Забрать', ico:'🛎️', badge:'bR', badgeCls:'bg'},
    {id:'queue', label:'Очередь', ico:'📋', badge:'bQ'},
    {id:'tables',label:'Столики', ico:'🪑', badge:'bT', badgeCls:'bp'},
    {id:'done',  label:'Закрытые',ico:'✅', badge:'bD'},
  ];
  // admin
  return[
    {id:'new',    label:'+ Заказ',  ico:'➕'},
    {id:'queue',  label:'Очередь',  ico:'📋', badge:'bQ'},
    {id:'ready',  label:'Забрать',  ico:'🛎️', badge:'bR', badgeCls:'bg'},
    {id:'tables', label:'Столики',  ico:'🪑', badge:'bT', badgeCls:'bp'},
    {id:'done',   label:'Закрытые', ico:'✅', badge:'bD'},
    {id:'stats',  label:'Статист.', ico:'📊'},
    {id:'menu',   label:'Меню',     ico:'📋'},
  ];
}

function buildBottomNav(tabs){
  const nav=document.getElementById('bottomNav');
  nav.innerHTML=tabs.map(t=>`
    <div class="bnav-item" id="bn-${t.id}" onclick="sw('${t.id}')">
      <span class="bnav-ico">${t.ico}</span>
      <span class="bnav-lbl">${t.label.replace('+ ','')}</span>
      ${t.badge?`<span class="bnav-badge${t.badgeCls==='.bg'?' green':t.badgeCls==='.bp'?' purple':''}" id="bnb-${t.badge}"></span>`:''}
    </div>`
  ).join('');
}

function buildSidebar(tabs){
  const sb=document.getElementById('sidebar');
  const roleNames={waiter:'🛎️ Официант',barman:'🍹 Бармен',admin:'👑 Менеджер'};
  sb.innerHTML=`
    <div style="padding:0 20px 16px;border-bottom:1px solid var(--border);margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAFyElEQVR4nO2XW0hUaRzA/+c7M5OlZk5jLjJoWpm42kZsCCJSwtKyggahC4oIEZgsFD3ky77si4sUG7ms7LJ0A9leWlhwWSYscy2z8bKauDrqzKhzaeaMZyZ1prmcy3e+fdg+G01N09IHf08z5/r7vv+NA7DNNpsLgxACvV6vvnLlyrfp6enZ3d3df5rNZpPFYnFOTk7Out1uYW5ujqz0EJZlgWEYAAAghICiKEDIiresXpBhGCCEgFarRdeuXfumurr6R3oyEolEvF6vxeVyDU9NTQ1ZrdZ/rVardWJignM4HAGO48RXr14taYIQAkVR1i/42nJ+xeXl5elNTU1tOp0uHWMssiyrWepGRVFgenra6nQ6B20224DFYhk2m81jNpuN7+7u9gYCAbJRkkAlWZYFAIDDhw/vePr0aTMhhEiSFBZFUZBlWZAkKSxJUhhjLJFlCIfDxGg0GrKysmIAAFQq1cYIUugDY2JioLGxsZK+WJKkBVKKomBFUTDGWKLifr/fNzo6OkAIIZOTk33p6elqAJhf+HIghBbk8ZooKSnRcxw3TqWW2jVFUYiiKNhsNpsikUhYlmWBEEKsVuuz/fv3a5aSRAiBSqV6SwohtLwMvTguLo45efLkvoKCgsT4+HgmNzc3tr29/SYVjBalvx0Ox8TMzIyPClNJi8XSk5aWNi+5lEBmZmZMcXFxKv2/YlowDAMajQaKior2tbS0XJVlmfA8b+nv7//r+fPnTwKBwFxUiAkhhPh8Pp/b7XYulqeSY2NjT/R6/YK3ZmVl7bx06VJ+e3v7zUAgEHS5XD6DwXA1JSVlbUl76tSpfZ2dnXfozvT29rba7XYTlQgGg0GbzWZfLgVEUaSSf+t0OraioiKzq6vrbiQSmc9pjuMs9+/fbyKEEK/Xa6+oqDioVqtXDjdCaEF+lJSU6Ht6eu4RQsjo6GhPf3+/QRRFgeM4H93JJXITy7KMBUEIE0JIb2/vHzU1NXn0XDgcDsiyLHR1df3W2tr6q9/v561W67O2trZfjhw5EreqoomuLoZhoLKyMtNkMrXyPO958ODBvZGRkUGe5zme5z1+v38uFAoFRVF8qw3R1vT48eOfGxsbqzDGkiiKQUIIuXHjRu2hQ4d2pKamqhbv2qrrmmVZwBgDAIBGo4Ha2trPz50715CQkPAZQkhgWVaWZVmRJEnCGMsMwyBBEII+n49LSkpK0+l0n7AsC7t379YZjcbfVSpVXF5e3pcAAGfPns25ffv28LxU1OBYc+OJFk1MTGTOnz9fWFZW9v3Ro0fzF4dkZGTkn9jY2Njp6Wl3KBQSdu3atXPPnj3JOp1Ob7fbzXq9PkWr1Sbl5ubGm0ymEEIIMMYL5vh7dMY3U0eWZQAASE5OZsvKyvJramp+yMnJOQ4A4PV6PZFIJKLX69MAADDGIs/z7tnZ2RkAIImJiVpJkkAUxWB2dvangiAs2LkNIXo8AgAkJCSg5ubm70KhkGAymQYEQQjTQokunJmZGY/b7Xa6XK65y5cvlwK8o0GvFzqqEEIwNDTUOjw83D8+Pj4U3Xqk/wlT0cHBQUNVVVXWe4+4tUB3saCgQPu65w2GQqEgFaMNmxBCjEbjvfLy8oMfXCoaOpquX7/+tSzLZGxsbABjvECss7Pz7pkzZzKWWthHgWVZGB8f73A6nfZgMBikYh0dHXdKS0vTNlUMACAvLy9BkiTCcZxLkqTww4cPfyouLtZvmhiFhrehoeG0x+PxPHr06FZdXV3RRomtu7YxxsCyLJw4caL65cuX3IEDB4739fUNIYRArVbPX7Mp0N517NixOLvdPkUIIfX19V8BbFI4F0PDe/HixXxCCGlpaamnxz9qG1kOKmEwGG45HI7hvXv3IoZhPuxUWC1UIiMjQ/PixYtAYWGhFmCLhBbgjciFCxeK6urqvgD4AJ+Y64FhGFCr1XD69Onc5T6GNp0tE853sSUqdpttttmi/Ac+GkiJ2qO+PwAAAABJRU5ErkJggg==" style="width:26px;height:26px;object-fit:contain;">
        <span style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:var(--accent);letter-spacing:2px;">1708</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">${roleNames[role]||''}</div>
    </div>
    ${tabs.map(t=>`
      <div class="sidebar-item" id="sb-${t.id}" onclick="sw('${t.id}')">
        <span class="sidebar-ico">${t.ico}</span>
        <span>${t.label}</span>
        ${t.badge?`<span class="sidebar-badge${t.badgeCls==='.bg'?' green':t.badgeCls==='.bp'?' purple':''}" id="sbb-${t.badge}"></span>`:''}
      </div>`).join('')}
    <div style="margin-top:auto;padding:16px 20px 0;border-top:1px solid var(--border);margin-top:16px;">
      <div onclick="openRoleModal()" style="font-size:11px;color:var(--muted);cursor:pointer;padding:8px 0;">⚙️ Сменить роль</div>
      <div class="notif-btn" onclick="enableNotifications()" style="font-size:11px;cursor:pointer;padding:8px 0;"></div>
    </div>
  `;
  updateNotifBtn();
}

function applyDeviceLayout(device){
  const bottomNav=document.getElementById('bottomNav');
  const sidebar=document.getElementById('sidebar');
  const tabsBar=document.getElementById('tabsBar');
  const desktopLayout=document.getElementById('desktopLayout');
  if(device==='phone'){
    bottomNav.style.display='flex';
    sidebar.style.display='none';
    tabsBar.style.display='none';
    desktopLayout.style.display='block';
  } else if(device==='tablet'){
    bottomNav.style.display='none';
    sidebar.style.display='none';
    tabsBar.style.display='flex';
    desktopLayout.style.display='block';
  } else {
    bottomNav.style.display='none';
    sidebar.style.display='flex';
    tabsBar.style.display='none';
    desktopLayout.style.display='grid';
  }
}

let resizeTimer;
window.addEventListener('resize',()=>{
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{
    if(role){applyDeviceLayout(getDevice());}
  },120);
});

function sw(tab){
  activeTab=tab;
  document.querySelectorAll('#tabsBar .tab').forEach(t=>t.classList.toggle('active',(t.getAttribute('onclick')||'').includes("'"+tab+"'")));
  document.querySelectorAll('.bnav-item').forEach(t=>t.classList.toggle('active',t.id==='bn-'+tab));
  document.querySelectorAll('.sidebar-item').forEach(t=>t.classList.toggle('active',t.id==='sb-'+tab));
  document.querySelectorAll('.section-page').forEach(p=>p.classList.remove('active'));
  const pg=document.getElementById('page-'+tab);if(pg)pg.classList.add('active');
  if(tab==='tables')renderTables();
  if(tab==='done')renderClosed();
  if(tab==='stats')renderStats();
  if(tab==='menu')renderMenuPage();
}

// ═══════════════════════════
//  ADD ORDER
// ═══════════════════════════
async function addOrder(){
  const btn=document.querySelector('.btn-add');
  if(btn&&btn.disabled)return;
  if(btn){btn.disabled=true;btn.style.opacity='.5';}
  try{
    const tableRaw=document.getElementById('inpTable').value.trim().toUpperCase();
    const rawItems=document.getElementById('inpItems').value.trim();
    const note=document.getElementById('inpNote').value.trim();
    const prio=document.getElementById('inpPriority').value;
    if(!tableRaw){fl('fInfo','Укажите номер стола!');}
    else if(!rawItems){fl('fInfo','Введите позиции!');}
    else{
      const tNum=tableRaw;
      const items=parseItems(rawItems);
      if(!items.length){fl('fInfo','Не удалось распознать позиции!');}
      else{
        const num=(orders.length?Math.max(...orders.map(o=>o.num||0)):0)+1;
        const date=todayStr();
        const existingMeta=getTMeta(date,tNum);
        if(existingMeta.status==='closed'){
          const newSid=Date.now().toString(36);
          existingMeta.sessions=existingMeta.sessions||[];
          existingMeta.sessions.push({sid:existingMeta.sid,closedAt:existingMeta.closedAt,openedAt:existingMeta.openedAt});
          existingMeta.sid=newSid;
          existingMeta.status='open';
          existingMeta.openedAt=Date.now();
          delete existingMeta.closedAt;
        }
        const sid=existingMeta.sid||(existingMeta.sid=Date.now().toString(36));
        const newRef=push(ref(db,'orders'));
        const itemsObj={};
        items.forEach(it=>itemsObj[it.id]=it);
        const newOrder={id:newRef.key,table:tNum,items:itemsObj,note,priority:prio,status:'new',createdAt:Date.now(),num,date,sid};
        await fbUpdate('orders/'+newRef.key,newOrder);
        await fbUpdate('tables',tablesMeta);
        fl('fOk','✅ Заказ #'+num+' — Стол '+tNum+' ('+items.length+' поз.)');
        ['inpTable','inpItems','inpNote'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('inpPriority').value='normal';
        buildQuickTableBtns();
        if(role==='waiter')sw('queue');
      }
    }
  }finally{
    if(btn){btn.disabled=false;btn.style.opacity='';}
  }
}

// ═══════════════════════════
//  ITEM ACTIONS
// ═══════════════════════════
async function barItemAction(orderId,itemFbKey,newStatus){
  const o=orders.find(x=>x.id===orderId);if(!o)return;
  const it=o.items.find(x=>(x._fbKey||x.id)===itemFbKey);if(!it)return;
  it.status=newStatus;
  if(newStatus==='making')it.makingAt=Date.now();
  if(newStatus==='ready') it.readyAt=Date.now();
  if(newStatus==='new')  {delete it.makingAt;delete it.readyAt;}
  const prev=o.status;
  o.status=aggStatus(o.items);
  if(o.status==='ready'&&prev!=='ready') fl('fOk','🟢 Стол '+o.table+' — всё готово! Официант, забирай!');
  const fbKey=it._fbKey||it.id;
  const upd={};
  upd[`orders/${orderId}/items/${fbKey}/status`]=newStatus;
  if(newStatus==='making') upd[`orders/${orderId}/items/${fbKey}/makingAt`]=it.makingAt;
  if(newStatus==='ready')  upd[`orders/${orderId}/items/${fbKey}/readyAt`]=it.readyAt;
  if(newStatus==='new'){
    upd[`orders/${orderId}/items/${fbKey}/makingAt`]=null;
    upd[`orders/${orderId}/items/${fbKey}/readyAt`]=null;
  }
  await update(ref(db),upd);
}

async function waiterDeliverItem(orderId,itemFbKey){
  const o=orders.find(x=>x.id===orderId);if(!o)return;
  const it=o.items.find(x=>(x._fbKey||x.id)===itemFbKey);if(!it)return;
  if(it.status!=='ready')return;
  it.status='done';it.doneAt=Date.now();
  o.status=aggStatus(o.items);
  const fbKey=it._fbKey||it.id;
  const upd={[`orders/${orderId}/items/${fbKey}/status`]:'done',[`orders/${orderId}/items/${fbKey}/doneAt`]:it.doneAt};
  if(o.status==='done'){o.doneAt=Date.now();upd[`orders/${orderId}/doneAt`]=o.doneAt;}
  await update(ref(db),upd);
  fl('fOk','✅ '+it.qty+'× '+it.name+' → Стол '+o.table);
}

async function waiterDeliverAll(orderId){
  const o=orders.find(x=>x.id===orderId);if(!o)return;
  let count=0;
  const upd={};
  o.items.forEach(it=>{
    if(it.status==='ready'){
      it.status='done';it.doneAt=Date.now();count++;
      const fbKey=it._fbKey||it.id;
      upd[`orders/${orderId}/items/${fbKey}/status`]='done';
      upd[`orders/${orderId}/items/${fbKey}/doneAt`]=it.doneAt;
    }
  });
  o.status=aggStatus(o.items);
  if(o.status==='done'){o.doneAt=Date.now();upd[`orders/${orderId}/doneAt`]=o.doneAt;}
  await update(ref(db),upd);
  fl('fOk','✅ '+count+' позиц. доставлены — Стол '+o.table);
}

async function reopenOrder(id){
  const o=orders.find(x=>x.id===id);if(!o)return;
  const upd={[`orders/${id}/status`]:'new',[`orders/${id}/doneAt`]:null};
  o.items.forEach(it=>{
    it.status='new';delete it.makingAt;delete it.readyAt;delete it.doneAt;
    const fbKey=it._fbKey||it.id;
    upd[`orders/${id}/items/${fbKey}/status`]='new';
    upd[`orders/${id}/items/${fbKey}/makingAt`]=null;
    upd[`orders/${id}/items/${fbKey}/readyAt`]=null;
    upd[`orders/${id}/items/${fbKey}/doneAt`]=null;
  });
  o.status='new';delete o.doneAt;
  await update(ref(db),upd);
}

async function delOrder(id){
  const o=orders.find(x=>x.id===id);
  const ok=await showConfirm('🗑 Удалить заказ?',`Заказ #${o?.num||'?'} будет удалён безвозвратно.`);
  if(!ok)return;
  await remove(ref(db,'orders/'+id));
}

function setQF(f,btn){
  qf=f;
  document.querySelectorAll('#qFilters .fb').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderAll();
}

// ═══════════════════════════
//  RENDER ALL
// ═══════════════════════════
function renderAll(){
  if(!role)return;
  orders.forEach(o=>{if(Array.isArray(o.items))o.status=aggStatus(o.items);});

  const active=orders.filter(o=>o.status!=='done');
  const done  =orders.filter(o=>o.status==='done');
  const hasReady=orders.filter(o=>o.status!=='done'&&o.items&&o.items.some(i=>i.status==='ready'));

  active.sort((a,b)=>{
    if(a.priority==='urgent'&&b.priority!=='urgent')return -1;
    if(b.priority==='urgent'&&a.priority!=='urgent')return 1;
    const so={ready:0,making:1,new:2};
    const as=so[a.status]??2,bs=so[b.status]??2;
    if(as!==bs)return as-bs;
    return a.createdAt-b.createdAt;
  });

  let inProgress=0,readyCnt=0,newCnt=0;
  orders.forEach(o=>{
    if(o.status==='new') newCnt++;
    o.items&&o.items.forEach(it=>{
      if(it.status==='making')inProgress++;
      if(it.status==='ready')readyCnt++;
    });
  });

  const today=todayStr();
  const openTablesSet=new Set(
    orders.filter(o=>o.date===today).filter(o=>{
      const meta=getTMeta(today,o.table);
      const sid=o.sid||'default';
      const isCurrentSession=meta.sid===sid||(!meta.sid&&sid==='default');
      return isCurrentSession && meta.status!=='closed';
    }).map(o=>o.table)
  );

  setBadge('bQ',active.length);
  setBadge('bR',hasReady.length);
  setBadge('bT',openTablesSet.size);

  // Счётчик закрытых столов за сегодня
  const closedTablesSet=new Set(
    orders.filter(o=>o.date===today).filter(o=>{
      const meta=getTMeta(today,o.table);
      const sid=o.sid||'default';
      const isCurrentSession=meta.sid===sid||(!meta.sid&&sid==='default');
      return isCurrentSession&&meta.status==='closed';
    }).map(o=>o.table)
  );
  setBadge('bD',closedTablesSet.size);

  setEl('sN',active.length);setEl('sNew',newCnt);setEl('sP',inProgress);setEl('sR',readyCnt);

  const tables=[...new Set(active.map(o=>String(o.table)))].sort((a,b)=>{
    const an=parseInt(a),bn=parseInt(b);
    if(!isNaN(an)&&!isNaN(bn))return an-bn;
    if(!isNaN(an))return -1; if(!isNaN(bn))return 1;
    return a.localeCompare(b);
  });
  const qfEl=document.getElementById('qFilters');
  if(qfEl){
    qfEl.innerHTML=
      mkFb('all','Все')+mkFb('new','🆕 Новые')+mkFb('making','🍹 В работе')+mkFb('ready','🟢 Готово')+
      tables.map(t=>mkFb('t'+t,'Стол '+t)).join('');
  }

  const ql=document.getElementById('qList');
  if(ql){
    let list=active;
    if(qf==='new')    list=active.filter(o=>o.status==='new');
    if(qf==='making') list=active.filter(o=>o.status==='making');
    if(qf==='ready')  list=active.filter(o=>o.status==='ready');
    if(qf.startsWith('t')){const t=qf.slice(1);list=active.filter(o=>String(o.table)===t);}
    ql.innerHTML=list.length?list.map(o=>orderCard(o,false)).join(''):empty('📭','Нет заказов в очереди');
  }

  const rl=document.getElementById('rList');
  if(rl){
    const rs=hasReady.slice().sort((a,b)=>a.createdAt-b.createdAt);
    rl.innerHTML=rs.length?rs.map(o=>orderCard(o,false)).join(''):empty('⏳','Нет готовых позиций');
  }

  if(activeTab==='tables')renderTables();
  if(activeTab==='done')renderClosed();
  if(document.getElementById('quickTableBtns'))buildQuickTableBtns();
}

function mkFb(val,label){
  return`<button class="fb${qf===val?' active':''}" onclick="setQF('${val}',this)">${label}</button>`;
}

// ═══════════════════════════
//  ORDER CARD
// ═══════════════════════════
function orderCard(o,isDone){
  const st=o.status;
  const allItems=o.items||[];
  const doneC=allItems.filter(i=>i.status==='done').length;
  const readyC=allItems.filter(i=>i.status==='ready').length;
  const total=allItems.length;
  const pct=total?Math.round((doneC+readyC)/total*100):0;

  const borderCls='oc-'+(st==='making'?'partial':st)+(o.priority==='urgent'?' p-urgent':'');

  const stTag={
    new:    `<span class="tag t-new">🕐 ожидает</span>`,
    making: `<span class="tag t-partial">🍹 готовится</span>`,
    ready:  `<span class="tag t-ready">🟢 ГОТОВО!</span>`,
    done:   `<span class="tag t-done">✓ доставлен</span>`,
  }[st]||'';
  const pTag=o.priority==='urgent'?`<span class="tag t-urgent">🔥 СРОЧНО</span>`:'';
  const note=o.note?`<div class="order-note">💬 ${esc(o.note)}</div>`:'';

  let banner='';
  if(st==='ready'){
    banner=`<div class="ready-banner"><div class="rdot"></div>Всё готово — неси на Стол ${o.table}!</div>`;
  } else if(readyC>0&&st==='making'){
    banner=`<div class="partial-banner">🟢 ${readyC} из ${total} позиц. готовы — можно частично забрать!</div>`;
  }

  const prog=(st==='making'||st==='ready')&&total>1
    ?`<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-label">${doneC+readyC} / ${total} готово</div>`:'' ;

  let itemsHtml='';
  if(!isDone&&role==='barman'){
    itemsHtml=`<div class="items-list">${allItems.map(it=>barmanItemRow(o.id,it)).join('')}</div>`;
  } else if(!isDone&&role==='admin'){
    // Менеджер видит кнопки бармена + кнопку доставки как официант
    itemsHtml=`<div class="items-list">${allItems.map(it=>adminItemRow(o.id,it)).join('')}</div>`;
  } else if(!isDone&&role==='waiter'){
    itemsHtml=`<div class="items-list">${allItems.map(it=>waiterItemRow(o.id,it)).join('')}</div>`;
  } else {
    itemsHtml=`<div class="items-list">${allItems.map(it=>{
      const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';
      return`<div class="item-row${it.status==='done'?' is-done':''}" style="cursor:default;">
        <span class="item-ico">${ico}</span>
        <span class="item-qty">${it.qty}</span>
        <span class="item-name">${esc(it.name)}</span>
      </div>`;
    }).join('')}</div>`;
  }

  let acts='';
  const oid=esc(o.id);
  if(isDone){
    if(role==='admin') acts+=`<button class="btn-sm bx" data-action="del" data-oid="${oid}">🗑 Удалить</button>`;
  } else {
    if(role==='waiter'||role==='admin'){
      acts+=`<button class="btn-edit" data-action="edit" data-oid="${oid}">✏️ Изменить</button>`;
    }
    if((role==='waiter'||role==='admin')&&readyC>0){
      acts+=`<button class="btn-sm bd" data-action="deliverall" data-oid="${oid}">✅ Отнести всё (${readyC} поз.)</button>`;
    }
    if(role==='admin') acts+=` <button class="btn-sm bx" data-action="del" data-oid="${oid}">🗑</button>`;
  }

  // Waiting timer — only for active (non-done) orders
  const waitMins=isDone?0:Math.floor((Date.now()-o.createdAt)/60000);
  const waitLbl=!isDone&&o.createdAt
    ?`<span data-created="${o.createdAt}" style="font-size:var(--fs-xs);padding:2px 8px;border-radius:8px;font-weight:700;margin-left:6px;
        background:${waitMins>=15?'rgba(229,57,53,.18)':'rgba(255,255,255,.06)'};
        color:${waitMins>=15?'var(--red)':'var(--muted)'};">
        ${waitMins>0?`⏱ ${waitMins} мин${waitMins>=15?' !':''}`:'⏱ <1 мин'}</span>`:'';

  return`
  <div class="order-card ${borderCls}">
    <div class="cnum">#${o.num}</div>
    <div class="card-header">
      <div class="tnum-big"><small>СТОЛ</small>${o.table}</div>
      <div class="tags">${pTag}${stTag}</div>
    </div>
    ${banner}
    <div class="order-time">принят в ${fmt(o.createdAt)}${waitLbl}</div>
    ${note}
    ${prog}
    ${itemsHtml}
    ${acts?`<div class="order-actions">${acts}</div>`:''}
  </div>`;
}

// ═══════════════════════════
//  BARMAN ITEM ROW
// ═══════════════════════════
function barmanItemRow(orderId,it){
  const cls={new:'',making:'is-making',ready:'is-ready',done:'is-done'}[it.status]||'';
  const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';
  const oid=esc(orderId), iid=esc(it._fbKey||it.id);
  let btns='';
  if(it.status==='new'){
    btns=`<button class="ib ib-start"   data-oid="${oid}" data-iid="${iid}" data-st="making">🍹 Начал</button>
          <button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button>`;
  } else if(it.status==='making'){
    btns=`<button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button>
          <button class="ib ib-undo"     data-oid="${oid}" data-iid="${iid}" data-st="new">↩</button>`;
  } else if(it.status==='ready'){
    btns=`<span class="item-status-chip isc-ready">✓ ждёт офиц.</span>
          <button class="ib ib-undo"     data-oid="${oid}" data-iid="${iid}" data-st="making">↩</button>`;
  }
  return`<div class="item-row ${cls}">
    <span class="item-ico">${ico}</span>
    <span class="item-qty">${it.qty}</span>
    <span class="item-name">${esc(it.name)}</span>
    <div class="item-btns">${btns}</div>
  </div>`;
}

// ═══════════════════════════
//  WAITER ITEM ROW
// ═══════════════════════════
function waiterItemRow(orderId,it){
  const cls={new:'',making:'is-making',ready:'is-ready',done:'is-done'}[it.status]||'';
  const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';
  const oid=esc(orderId), iid=esc(it._fbKey||it.id);
  let btns='';
  if(it.status==='ready'){
    btns=`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button>`;
  } else if(it.status==='making'){
    btns=`<span class="item-status-chip isc-making">🍹 готовится</span>`;
  } else if(it.status==='new'){
    btns=`<span class="item-status-chip isc-waiting">ожидает</span>`;
  }
  return`<div class="item-row ${cls}">
    <span class="item-ico">${ico}</span>
    <span class="item-qty">${it.qty}</span>
    <span class="item-name">${esc(it.name)}</span>
    <div class="item-btns">${btns}</div>
  </div>`;
}

function adminItemRow(orderId,it){
  // Менеджер видит кнопки бармена + кнопку доставки если готово
  const cls={new:'',making:'is-making',ready:'is-ready',done:'is-done'}[it.status]||'';
  const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';
  const oid=esc(orderId), iid=esc(it._fbKey||it.id);
  let btns='';
  if(it.status==='new'){
    btns=`<button class="ib ib-start"    data-oid="${oid}" data-iid="${iid}" data-st="making">🍹 Начал</button>
          <button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button>`;
  } else if(it.status==='making'){
    btns=`<button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button>
          <button class="ib ib-undo"     data-oid="${oid}" data-iid="${iid}" data-st="new">↩</button>`;
  } else if(it.status==='ready'){
    btns=`<button class="ib ib-deliver"  data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button>
          <button class="ib ib-undo"     data-oid="${oid}" data-iid="${iid}" data-st="making">↩</button>`;
  }
  return`<div class="item-row ${cls}">
    <span class="item-ico">${ico}</span>
    <span class="item-qty">${it.qty}</span>
    <span class="item-name">${esc(it.name)}</span>
    <div class="item-btns">${btns}</div>
  </div>`;
}

// Поиск цены позиции в меню
function getItemPrice(name){
  const menu=BUILTIN_MENU_LIVE.length?BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const key=name.trim().toLowerCase();
  for(const cat of menu){
    for(const item of (cat.items||[])){
      if(item.name.trim().toLowerCase()===key) return item.price||0;
    }
  }
  return 0;
}

// ═══════════════════════════
//  TABLES PAGE
// ═══════════════════════════
function renderTables(){
  document.getElementById('dateLabel').textContent=dateLbl(viewDate);

  const allDates=[...new Set(orders.map(o=>o.date).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
  const qnEl=document.getElementById('dateQuickNav');
  if(qnEl){
    qnEl.innerHTML=allDates.map(d=>
      `<button onclick="jumpDate('${d}')" style="padding:5px 12px;border-radius:18px;border:1px solid ${d===viewDate?'var(--accent)':'var(--border)'};background:${d===viewDate?'var(--accent)':'transparent'};color:${d===viewDate?'#000':'var(--muted)'};font-size:11px;font-family:IBM Plex Mono,monospace;cursor:pointer;white-space:nowrap;">${dateLbl(d)}</button>`
    ).join('');
  }

  const dayOrders=orders.filter(o=>o.date===viewDate);

  const sessionMap={};
  dayOrders.forEach(o=>{
    const meta=getTMeta(viewDate,o.table);
    const sid=o.sid||'default';
    const k=o.table+'_'+sid;
    if(!sessionMap[k])sessionMap[k]={tNum:o.table,sid,orders:[],meta};
    sessionMap[k].orders.push(o);
  });

  const sessions=Object.values(sessionMap).filter(({sid,meta})=>{
    const isCurrentSession=meta.sid===sid||(!meta.sid&&sid==='default');
    if(!isCurrentSession) return false;
    return meta.status!=='closed';
  }).sort((a,b)=>{
    if(a.tNum!==b.tNum){
      const aNum=parseInt(a.tNum), bNum=parseInt(b.tNum);
      const aIsNum=!isNaN(aNum), bIsNum=!isNaN(bNum);
      if(aIsNum&&bIsNum)return aNum-bNum;
      if(aIsNum)return -1;
      if(bIsNum)return 1;
      return String(a.tNum).localeCompare(String(b.tNum));
    }
    return (a.orders[0]?.createdAt||0)-(b.orders[0]?.createdAt||0);
  });

  if(!sessions.length){
    document.getElementById('tablesBillList').innerHTML=
      `<div class="empty"><div class="ei">🗓️</div><p>Нет заказов за ${dateLbl(viewDate)}</p></div>`;
    return;
  }

  document.getElementById('tablesBillList').innerHTML=sessions.map(({tNum,sid,orders:tOrdersRaw,meta})=>{
    const tOrders=tOrdersRaw.sort((a,b)=>a.createdAt-b.createdAt);
    const isCurrentSession=meta.sid===sid||(!meta.sid&&sid==='default');
    const isOpen=isCurrentSession&&meta.status!=='closed';

    const sumMap={};
    tOrders.forEach(o=>(o.items||[]).forEach(it=>{
      const k=it.name.trim().toLowerCase();
      if(!sumMap[k])sumMap[k]={name:it.name,qty:0,price:getItemPrice(it.name)};
      sumMap[k].qty+=it.qty;
    }));
    const sumItems=Object.values(sumMap).sort((a,b)=>a.name.localeCompare(b.name));
    const totalSum=sumItems.reduce((s,x)=>s+(x.price*x.qty),0);
    const sumLines=sumItems.map(x=>`
      <div class="sum-line">
        <span class="sum-item">${esc(x.name)}</span>
        <span class="sum-cnt">${x.qty} шт.${x.price?` · <b style="color:var(--text)">${x.price*x.qty}₽</b>`:''}</span>
      </div>`
    ).join('')+(totalSum?`
      <div class="sum-line" style="border-top:2px solid var(--border);margin-top:6px;padding-top:6px;">
        <span class="sum-item" style="font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--accent);">ИТОГО</span>
        <span class="sum-cnt" style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--accent);">${totalSum}₽</span>
      </div>`:'');

    const ordersHtml=tOrders.map(o=>{
      const sico={new:'🕐',making:'🍹',ready:'🟢',done:'✅'}[o.status]||'';
      const note=o.note?`<div class="tbo-note">💬 ${esc(o.note)}</div>`:'';
      const lines=(o.items||[]).map(it=>
        `<div class="tbo-line${it.status==='done'?' tl-done':''}">
          <span class="tl-name">${esc(it.name)}</span>
          <span class="tl-qty">${it.qty} шт.</span>
        </div>`
      ).join('');
      return`<div class="tbo-item">
        <div class="tbo-hdr">
          <span class="tbo-num">#${o.num} ${sico}</span>
          <span class="tbo-time">${fmt(o.createdAt)}</span>
          <button class="btn-edit" data-action="edit" data-oid="${esc(o.id)}" data-bill="1" style="padding:3px 10px;font-size:11px;min-height:32px;">✏️</button>
        </div>
        <div class="tbo-lines">${lines}</div>
        ${note}
      </div>`;
    }).join('');

    const closedSession=(meta.closedSessions||[]).find(s=>s.sid===sid);
    const closedAt=isCurrentSession?meta.closedAt:closedSession?.closedAt;
    const closedLbl=!isOpen&&closedAt
      ?`<span style="font-size:10px;color:var(--muted);display:block;margin-top:3px;">Оплачен в ${fmt(closedAt)}</span>`:'';

    const totalItems=tOrders.reduce((s,o)=>s+(o.items?o.items.reduce((a,i)=>a+i.qty,0):0),0);

    const actions=isOpen
      ?`<button class="btn-pay" data-action="closeTable" data-date="${viewDate}" data-tnum="${tNum}" data-sid="${sid}">💳 ЗАКРЫТЬ / ОПЛАЧЕН</button>`
      :`<button class="btn-reopen" data-action="reopenTable" data-date="${viewDate}" data-tnum="${tNum}">↩ Переоткрыть</button>`;

    const mgmtBtns=`
      <button class="btn-sm bu" data-action="renameTable" data-date="${viewDate}" data-tnum="${tNum}" data-sid="${sid}">✏️ Переименовать</button>
      <button class="btn-sm bx" data-action="deleteTable" data-date="${viewDate}" data-tnum="${tNum}" data-sid="${sid}">🗑 Удалить стол</button>`;

    const cardId='tb-'+tNum+'_'+sid;
    return`
    <div class="table-bill ${isOpen?'':'closed'}" id="${cardId}">
      <div class="tb-header" onclick="toggleBill('${cardId}')">
        <div class="tb-left">
          <div class="tb-num"><small>СТОЛ</small>${tNum}</div>
          <div class="tb-meta">
            <b>${tOrders.length} ${pl(tOrders.length,'заказ','заказа','заказов')} · ${totalItems} позиц.</b>
            с ${fmt(tOrders[0]?.createdAt)}${closedLbl}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="tb-st ${isOpen?'tb-open':'tb-closed'}">${isOpen?'🟢 Открыт':'✅ Оплачен'}</span>
          <span class="tb-chev" id="chev-${cardId}">▼</span>
        </div>
      </div>
      <div class="tb-body" id="body-${cardId}">
        ${ordersHtml}
        <div class="tb-summary"><h4>📋 ИТОГО</h4>${sumLines||'<div style="color:var(--muted);font-size:12px">Нет позиций</div>'}</div>
        <div class="tb-actions">${actions}${mgmtBtns}</div>
      </div>
    </div>`;
  }).join('');
}

function toggleBill(cardId){
  const b=document.getElementById('body-'+cardId);
  const c=document.getElementById('chev-'+cardId);
  if(!b)return;
  const open=b.classList.contains('open');
  b.classList.toggle('open',!open);c.classList.toggle('open',!open);
}

// ═══════════════════════════
//  TABLE MANAGEMENT
// ═══════════════════════════

// Кастомный confirm — возвращает Promise<boolean>
let _confirmResolve=null;
function showConfirm(title,msg,okLabel='УДАЛИТЬ'){
  const overlay=document.getElementById('confirmOverlay');
  if(overlay){
    return new Promise(resolve=>{
      _confirmResolve=resolve;
      document.getElementById('confirmTitle').textContent=title;
      document.getElementById('confirmMsg').textContent=msg;
      document.getElementById('confirmOkBtn').textContent=okLabel;
      overlay.classList.remove('hidden');
    });
  }
  return Promise.resolve(window.confirm(title+'\n'+msg));
}
function closeConfirmModal(){
  const overlay=document.getElementById('confirmOverlay');
  if(overlay)overlay.classList.add('hidden');
  if(_confirmResolve){_confirmResolve(false);_confirmResolve=null;}
}
function confirmOk(){
  const overlay=document.getElementById('confirmOverlay');
  if(overlay)overlay.classList.add('hidden');
  if(_confirmResolve){_confirmResolve(true);_confirmResolve=null;}
}

// Кастомный rename modal
let _renameCb=null;
function openRenameModal(currentName,cb){
  const overlay=document.getElementById('renameOverlay');
  if(overlay){
    _renameCb=cb;
    document.getElementById('renameSub').textContent='Сейчас: '+currentName;
    const inp=document.getElementById('renameInput');
    inp.value='';
    overlay.classList.remove('hidden');
    setTimeout(()=>inp.focus(),100);
    return;
  }
  // Fallback — нативный prompt
  const val=(window.prompt('Новое название стола (сейчас: '+currentName+')','')||'').trim().toUpperCase();
  if(val&&val!==String(currentName)) cb(val);
}
function closeRenameModal(){
  const overlay=document.getElementById('renameOverlay');
  if(overlay)overlay.classList.add('hidden');
  _renameCb=null;
}
function confirmRename(){
  const val=document.getElementById('renameInput').value.trim().toUpperCase();
  if(!val){fl('fInfo','Введите название!');return;}
  const cb=_renameCb;
  _renameCb=null;
  const overlay=document.getElementById('renameOverlay');
  if(overlay)overlay.classList.add('hidden');
  if(cb) cb(val);
}

async function renameTable(date,oldTNum,sid){
  // Пробуем кастомный модал, иначе нативный prompt
  const overlay=document.getElementById('renameOverlay');
  if(overlay){
    openRenameModal(oldTNum,async(newTNum)=>{
      await doRenameTable(date,oldTNum,sid,newTNum);
    });
  } else {
    const val=(window.prompt('Новое название стола (сейчас: '+oldTNum+'):',oldTNum)||'').trim().toUpperCase();
    if(val&&val!==String(oldTNum)) await doRenameTable(date,oldTNum,sid,val);
  }
}

async function doRenameTable(date,oldTNum,sid,newTNum){
  if(!newTNum||newTNum===String(oldTNum))return;
  const upd={};
  orders.forEach(o=>{
    const oSid=o.sid||'default';
    if(o.date===date&&String(o.table)===String(oldTNum)&&oSid===sid){
      upd[`orders/${o.id}/table`]=newTNum;
      o.table=newTNum;
    }
  });
  const oldKey=tKey(date,oldTNum);
  const newKey=tKey(date,newTNum);
  if(tablesMeta[oldKey]){
    tablesMeta[newKey]={...tablesMeta[oldKey],tNum:newTNum};
    delete tablesMeta[oldKey];
    upd[`tables/${oldKey}`]=null;
    upd[`tables/${newKey}`]=tablesMeta[newKey];
  }
  await update(ref(db),upd);
  renderTables();renderClosed();
  fl('fOk',`✅ Стол ${oldTNum} → ${newTNum}`);
}

async function deleteTable(date,tNum,sid){
  const tOrders=orders.filter(o=>o.date===date&&String(o.table)===String(tNum)&&(o.sid||'default')===sid);
  const ok=await showConfirm(
    `🗑 Удалить стол ${tNum}?`,
    `Будет удалено ${tOrders.length} ${pl(tOrders.length,'заказ','заказа','заказов')}. Это нельзя отменить.`
  );
  if(!ok)return;
  const upd={};
  tOrders.forEach(o=>{upd[`orders/${o.id}`]=null;});
  const k=tKey(date,tNum);
  upd[`tables/${k}`]=null;
  delete tablesMeta[k];
  await update(ref(db),upd);
  // Локально убираем сразу — не ждём Firebase
  orders=orders.filter(o=>!(o.date===date&&String(o.table)===String(tNum)&&(o.sid||'default')===sid));
  renderTables();renderClosed();renderAll();
  fl('fOk',`🗑 Стол ${tNum} удалён`);
}

// ═══════════════════════════
//  UTILS
// ═══════════════════════════
function fmt(ts){return ts?new Date(ts).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):'-';}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function empty(icon,msg){return`<div class="empty"><div class="ei">${icon}</div><p>${msg}</p></div>`;}
function setBadge(id,val){
  const el=document.getElementById(id);
  if(el){el.textContent=val;el.style.display=val>0?'inline-block':'none';}
  const bn=document.getElementById('bnb-'+id);
  if(bn){bn.textContent=val;bn.classList.toggle('vis',val>0);}
  const sb=document.getElementById('sbb-'+id);
  if(sb){sb.textContent=val;sb.classList.toggle('vis',val>0);}
}
function setEl(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
function pl(n,a,b,c){return n%10===1&&n%100!==11?a:n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?b:c;}

let ft={};
function fl(id,msg){
  const el=document.getElementById(id);if(!el)return;
  el.textContent=msg;el.classList.add('show');
  clearTimeout(ft[id]);ft[id]=setTimeout(()=>el.classList.remove('show'),2800);
}

// ═══════════════════════════
//  EDIT ORDER MODAL
// ═══════════════════════════

function openEditModal(orderId, billMode=false){
  const o=orders.find(x=>x.id===orderId);if(!o)return;
  editOrderId=orderId;
  editBillMode=billMode;

  document.getElementById('editPriority').value=o.priority||'normal';
  document.getElementById('editNote').value=o.note||'';

  const doneItems=(o.items||[]).filter(it=>it.status==='done');
  const activeItems=(o.items||[]).filter(it=>it.status!=='done');

  const sub=document.getElementById('editSub');

  if(billMode){
    // Режим правки чека — показываем ВСЕ позиции для редактирования
    sub.innerHTML=`Заказ #${o.num} · Стол ${o.table}<br><span style="color:var(--accent);font-size:10px;">📋 Правка чека — позиции сохранятся как доставленные</span>`;
    const allItems=(o.items||[]);
    document.getElementById('editItems').value=allItems.map(it=>it.qty+' '+it.name).join('\n');
  } else {
    // Обычный режим — только активные позиции, доставленные показываем справкой
    document.getElementById('editItems').value=activeItems.map(it=>it.qty+' '+it.name).join('\n');
    if(doneItems.length){
      sub.innerHTML=`Заказ #${o.num} · Стол ${o.table}<br><span style="color:var(--muted);font-size:10px;">✅ Доставлено: ${doneItems.map(it=>it.qty+'× '+it.name).join(', ')}</span>`;
    } else {
      sub.textContent='Заказ #'+o.num+' · Стол '+o.table;
    }
  }
  document.getElementById('editOverlay').classList.remove('hidden');
}

function closeEditModal(){
  document.getElementById('editOverlay').classList.add('hidden');
  editOrderId=null;
  editBillMode=false;
}

async function saveEditOrder(){
  if(!editOrderId){fl('fInfo','❌ ID заказа не найден');return;}
  const o=orders.find(x=>x.id===editOrderId);
  if(!o){fl('fInfo','❌ Заказ не найден');return;}

  const rawItems=document.getElementById('editItems').value.trim();
  const note=document.getElementById('editNote').value.trim();
  const prio=document.getElementById('editPriority').value;
  if(!rawItems){fl('fInfo','Введите позиции!');return;}

  let mergedItems;
  if(editBillMode){
    // Правка чека — все позиции помечаем как done (уже в чеке)
    const parsed=parseItems(rawItems);
    mergedItems=parsed.map(it=>({...it,status:'done',doneAt:Date.now()}));
  } else {
    // Обычное редактирование — сохраняем доставленные, новые — в очередь (new)
    const doneItems=o.items.filter(it=>it.status==='done');
    const newParsed=parseItems(rawItems);
    mergedItems=[...doneItems,...newParsed];
  }

  const itemsObj={};
  mergedItems.forEach(it=>{
    const k=it._fbKey||it.id;
    const {_fbKey,...clean}=it;
    itemsObj[k]=clean;
  });

  try{
    // Снапшот истории
    const snapshot={
      items:Object.fromEntries(o.items.map(it=>{const {_fbKey,...clean}=it;return[it._fbKey||it.id,clean];})),
      note:o.note||'',priority:o.priority||'normal',
      editedAt:Date.now(),editedBy:role||'unknown'
    };
    await set(ref(db,'orders/'+editOrderId+'/history/'+Date.now()),snapshot);
    await set(ref(db,'orders/'+editOrderId+'/items'),itemsObj);
    await update(ref(db,'orders/'+editOrderId),{note,priority:prio});
    closeEditModal();
    fl('fOk','✅ Заказ #'+o.num+' обновлён');
  }catch(e){
    console.error('saveEditOrder error:',e);
    fl('fInfo','❌ Ошибка: '+e.message);
  }
}

// ═══════════════════════════
//  CLOSED TABLES PAGE
// ═══════════════════════════
function shiftClosedDate(n){closedViewDate=shiftDS(closedViewDate,n);renderClosed();}

function renderClosed(){
  const lbl=document.getElementById('closedDateLabel');
  if(lbl)lbl.textContent=dateLbl(closedViewDate);

  const allDates=[...new Set(orders.map(o=>o.date).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
  const qnEl=document.getElementById('closedDateQuickNav');
  if(qnEl){
    qnEl.innerHTML=allDates.map(d=>
      `<button onclick="jumpClosedDate('${d}')" style="padding:5px 12px;border-radius:18px;border:1px solid ${d===closedViewDate?'var(--accent)':'var(--border)'};background:${d===closedViewDate?'var(--accent)':'transparent'};color:${d===closedViewDate?'#000':'var(--muted)'};font-size:11px;font-family:IBM Plex Mono,monospace;cursor:pointer;white-space:nowrap;">${dateLbl(d)}</button>`
    ).join('');
  }

  const listEl=document.getElementById('closedTablesList');
  if(!listEl)return;

  const dayOrders=orders.filter(o=>o.date===closedViewDate);

  const sessionMap={};
  dayOrders.forEach(o=>{
    const meta=getTMeta(closedViewDate,o.table);
    const sid=o.sid||'default';
    const k=o.table+'_'+sid;
    if(!sessionMap[k])sessionMap[k]={tNum:o.table,sid,orders:[],meta};
    sessionMap[k].orders.push(o);
  });

  const closedSessions=Object.values(sessionMap).filter(({tNum,sid,meta})=>{
    const isCurrentSession=meta.sid===sid||(!meta.sid&&sid==='default');
    const wasClosedInHistory=(meta.closedSessions||[]).some(s=>s.sid===sid);
    return (isCurrentSession&&meta.status==='closed')||wasClosedInHistory;
  }).sort((a,b)=>{
    const getClosedAt=(s)=>{
      if(s.meta.sid===s.sid&&s.meta.closedAt)return s.meta.closedAt;
      const h=(s.meta.closedSessions||[]).find(x=>x.sid===s.sid);
      return h?.closedAt||0;
    };
    return getClosedAt(b)-getClosedAt(a);
  });

  if(!closedSessions.length){
    listEl.innerHTML=`<div class="empty"><div class="ei">🗓️</div><p>Нет закрытых столов за ${dateLbl(closedViewDate)}</p></div>`;
    return;
  }

  listEl.innerHTML=closedSessions.map(({tNum,sid,orders:tOrdersRaw,meta})=>{
    const tOrders=tOrdersRaw.sort((a,b)=>a.createdAt-b.createdAt);

    const isCurrentSession=meta.sid===sid||(!meta.sid&&sid==='default');
    const closedSessionHist=(meta.closedSessions||[]).find(s=>s.sid===sid);
    const closedAt=isCurrentSession?meta.closedAt:closedSessionHist?.closedAt;

    // Итого: доставленные — обычно, недоставленные — зачёркнуто
    const sumMap={},pendingMap={};
    tOrders.forEach(o=>(o.items||[]).forEach(it=>{
      const k=it.name.trim().toLowerCase();
      if(it.status==='done'){
        if(!sumMap[k])sumMap[k]={name:it.name,qty:0,price:getItemPrice(it.name)};
        sumMap[k].qty+=it.qty;
      } else {
        if(!pendingMap[k])pendingMap[k]={name:it.name,qty:0};
        pendingMap[k].qty+=it.qty;
      }
    }));
    const doneItems=Object.values(sumMap).sort((a,b)=>a.name.localeCompare(b.name));
    const totalSum=doneItems.reduce((s,x)=>s+(x.price*x.qty),0);
    const sumLines=[
      ...doneItems.map(x=>
        `<div class="sum-line"><span class="sum-item">${esc(x.name)}</span><span class="sum-cnt">${x.qty} шт.${x.price?` · <b style="color:var(--text)">${x.price*x.qty}₽</b>`:''}</span></div>`
      ),
      ...Object.values(pendingMap).sort((a,b)=>a.name.localeCompare(b.name)).map(x=>
        `<div class="sum-line" style="opacity:.4;text-decoration:line-through;"><span class="sum-item">${esc(x.name)}</span><span class="sum-cnt">${x.qty} шт.</span></div>`
      ),
      totalSum?`<div class="sum-line" style="border-top:2px solid var(--border);margin-top:6px;padding-top:6px;">
        <span class="sum-item" style="font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--accent);">ИТОГО</span>
        <span class="sum-cnt" style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--accent);">${totalSum}₽</span>
      </div>`:''
    ].join('');

    const ordersHtml=tOrders.map(o=>{
      const sico={new:'🕐',making:'🍹',ready:'🟢',done:'✅'}[o.status]||'';
      const note=o.note?`<div class="tbo-note">💬 ${esc(o.note)}</div>`:'';
      const lines=(o.items||[]).map(it=>
        `<div class="tbo-line${it.status==='done'?' tl-done':''}">
          <span class="tl-name">${esc(it.name)}</span>
          <span class="tl-qty">${it.qty} шт.</span>
        </div>`
      ).join('');
      return`<div class="tbo-item">
        <div class="tbo-hdr">
          <span class="tbo-num">#${o.num} ${sico}</span>
          <span class="tbo-time">${fmt(o.createdAt)}</span>
          <button class="btn-edit" data-action="edit" data-oid="${esc(o.id)}" data-bill="1" style="padding:3px 10px;font-size:11px;min-height:32px;">✏️</button>
        </div>
        <div class="tbo-lines">${lines}</div>
        ${note}
      </div>`;
    }).join('');

    const totalItems=tOrders.reduce((s,o)=>s+(o.items?o.items.reduce((a,i)=>a+i.qty,0):0),0);
    const cardId='cl-'+tNum+'_'+sid;

    return`
    <div class="table-bill closed" id="${cardId}">
      <div class="tb-header" onclick="toggleBill('${cardId}')">
        <div class="tb-left">
          <div class="tb-num"><small>СТОЛ</small>${tNum}</div>
          <div class="tb-meta">
            <b>${tOrders.length} ${pl(tOrders.length,'заказ','заказа','заказов')} · ${totalItems} позиц.</b>
            с ${fmt(tOrders[0]?.createdAt)}
            ${closedAt?`<span style="color:var(--green);display:block;margin-top:2px;">✅ Закрыт в ${fmt(closedAt)}</span>`:''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="tb-st tb-closed">✅ Оплачен</span>
          <span class="tb-chev" id="chev-${cardId}">▼</span>
        </div>
      </div>
      <div class="tb-body" id="body-${cardId}">
        ${ordersHtml}
        <div class="tb-summary"><h4>📋 ИТОГО</h4>${sumLines||'<div style="color:var(--muted);font-size:12px">Нет позиций</div>'}</div>
        <div class="tb-actions">
          <button class="btn-reopen" data-action="reopenTable" data-date="${closedViewDate}" data-tnum="${tNum}">↩ Переоткрыть</button>
          <button class="btn-sm bu" data-action="renameTable" data-date="${closedViewDate}" data-tnum="${tNum}" data-sid="${sid}">✏️ Переименовать</button>
          <button class="btn-sm bx" data-action="deleteTable" data-date="${closedViewDate}" data-tnum="${tNum}" data-sid="${sid}">🗑 Удалить стол</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function jumpClosedDate(d){closedViewDate=d;renderClosed();}

// ═══════════════════════════
//  STATISTICS PAGE
// ═══════════════════════════
function renderStats(){
  const el=document.getElementById('statsContent');
  if(!el)return;

  const today=todayStr();
  const todayOrders=orders.filter(o=>o.date===today);
  const todayDone=todayOrders.filter(o=>o.status==='done');

  // Популярные позиции за всё время (30 дней)
  const popMap={};
  orders.forEach(o=>(o.items||[]).forEach(it=>{
    const k=it.name.trim().toLowerCase();
    if(!popMap[k])popMap[k]={name:it.name,count:0};
    popMap[k].count+=it.qty;
  }));
  const popular=Object.values(popMap).sort((a,b)=>b.count-a.count).slice(0,10);

  // Статистика по дням (последние 7 дней)
  const dayStats={};
  for(let i=6;i>=0;i--){
    const d=shiftDS(today,-i);
    dayStats[d]={date:d,orders:0,tables:new Set()};
  }
  orders.forEach(o=>{
    if(dayStats[o.date]){
      dayStats[o.date].orders++;
      dayStats[o.date].tables.add(o.table);
    }
  });
  const maxOrders=Math.max(...Object.values(dayStats).map(d=>d.orders),1);

  el.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:var(--sp-md);">

      <!-- Сегодня -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-sm);">
        <div class="sc"><span class="n">${todayOrders.length}</span><span>заказов сегодня</span></div>
        <div class="sc"><span class="n" style="color:var(--green);">${todayDone.length}</span><span>выполнено</span></div>
        <div class="sc"><span class="n" style="color:var(--blue);">${new Set(todayOrders.map(o=>o.table)).size}</span><span>столов</span></div>
      </div>

      <!-- График по дням -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-md);">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;color:var(--accent);margin-bottom:var(--sp-sm);">📅 ЗАКАЗЫ ЗА 7 ДНЕЙ</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:80px;">
          ${Object.values(dayStats).map(d=>{
            const h=d.orders?Math.max(8,Math.round(d.orders/maxOrders*70)):2;
            const isToday=d.date===today;
            const lbl=d.date.slice(8);
            return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;">
              <div style="font-size:9px;color:var(--muted);">${d.orders||''}</div>
              <div style="width:100%;height:${h}px;background:${isToday?'var(--accent)':'rgba(201,169,110,.35)'};border-radius:3px 3px 0 0;"></div>
              <div style="font-size:9px;color:${isToday?'var(--accent)':'var(--muted)'};">${lbl}</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Топ позиций -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-md);">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;color:var(--accent);margin-bottom:var(--sp-sm);">🏆 ТОП ПОЗИЦИЙ (30 дней)</div>
        ${popular.length?popular.map((p,i)=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:var(--muted);min-width:20px;">${i+1}</span>
              <span style="font-size:13px;">${esc(p.name)}</span>
            </div>
            <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--accent);">${p.count}</span>
          </div>`).join('')
        :'<div style="color:var(--muted);font-size:12px;">Нет данных</div>'}
      </div>
    </div>
  `;
}

// ═══════════════════════════
//  MENU PAGE
// ═══════════════════════════
function renderMenuPage(){
  const el=document.getElementById('menuPageContent');
  if(!el)return;
  el.innerHTML=`
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-md);margin-bottom:var(--sp-md);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;color:var(--accent);margin-bottom:var(--sp-md);">➕ НОВАЯ КАТЕГОРИЯ</div>
      <div style="display:flex;gap:var(--sp-sm);flex-wrap:wrap;">
        <input type="text" id="newCatEmoji" placeholder="🍕" maxlength="4"
          style="width:58px;text-align:center;font-size:20px;padding:8px;font-family:'IBM Plex Mono',monospace;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);">
        <input type="text" id="newCatName" placeholder="Пицца, Роллы..."
          style="flex:1;min-width:150px;font-family:'IBM Plex Mono',monospace;font-size:14px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);"
          onkeydown="if(event.key==='Enter')addMenuCategory()">
        <button onclick="addMenuCategory()" class="btn-sm bd" style="min-width:100px;">+ Создать</button>
      </div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-md);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;color:var(--accent);margin-bottom:var(--sp-sm);">📋 ТЕКУЩЕЕ МЕНЮ</div>
      <div id="menuEditorList"></div>
    </div>
  `;
  renderMenuEditor();
}

// ═══════════════════════════
//  EVENT DELEGATION
// ═══════════════════════════
document.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action],[data-st]');
  if(!btn)return;
  e.stopPropagation();

  const st=btn.dataset.st;
  if(st!==undefined){
    const oid=btn.dataset.oid, iid=btn.dataset.iid;
    if(oid&&iid) await barItemAction(oid,iid,st);
    return;
  }

  const action=btn.dataset.action;
  const oid=btn.dataset.oid, iid=btn.dataset.iid;
  const date=btn.dataset.date, tnum=btn.dataset.tnum, sid=btn.dataset.sid;

  if(action==='deliver'&&oid&&iid){ await waiterDeliverItem(oid,iid); return; }
  if(action==='deliverall'&&oid){ await waiterDeliverAll(oid); return; }
  if(action==='reopen'&&oid)    { await reopenOrder(oid);       return; }
  if(action==='del'&&oid)       { await delOrder(oid);          return; }
  if(action==='edit'&&oid)      { openEditModal(oid, btn.dataset.bill==='1'); return; }
  if(action==='menuitem'){ /* handled by picker now */ return; }

  // Table management
  if(action==='closeTable'&&date&&tnum&&sid){ await closeTable(date,tnum,sid); return; }
  if(action==='reopenTable'&&date&&tnum)    { await reopenTable(date,tnum);    return; }
  if(action==='renameTable'&&date&&tnum&&sid){ await renameTable(date,tnum,sid); return; }
  if(action==='deleteTable'&&date&&tnum&&sid){ await deleteTable(date,tnum,sid); return; }
});

// ═══════════════════════════
//  EXPOSE TO HTML
// ═══════════════════════════
Object.assign(window,{
  pickRole,confirmRole,openRoleModal,closeRoleModal,
  sw,addOrder,barItemAction,waiterDeliverItem,waiterDeliverAll,
  pickTable,enableNotifications,
  closeTable,reopenTable,reopenOrder,delOrder,setQF,toggleBill,shiftDate,jumpDate,
  renderTables,openEditModal,closeEditModal,saveEditOrder,
  shiftClosedDate,jumpClosedDate,renderClosed,
  renameTable,deleteTable,doRenameTable,
  closeConfirmModal,confirmOk,closeRenameModal,confirmRename,
  openMenuEditor,closeMenuEditor,addNewMenuItem,removeMenuItem,updateMenuItem,renderStats,renderMenuPage,
  updateMenuCatItem,removeMenuCatItem,addMenuCatItem,addMenuCategory,removeMenuCategory,moveMenuCat,
  openMenuPicker,closeMenuPicker,confirmMenuPicker,switchPickerCat
});

// ═══════════════════════════
//  BOOT
// ═══════════════════════════
(async()=>{
  registerSW(); // регистрируем SW как можно раньше
  const sr=localStorage.getItem('bar_role');
  if(sr){role=sr;applyRole();}
  else openRoleModal();
  await loadAll();
  startPoll();
})();
