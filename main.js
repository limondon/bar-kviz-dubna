// ═══════════════════════════
//  KEYS & STATE
// ═══════════════════════════
const OKEY='bar_orders_v10';
const TKEY='bar_tables_v10';
let orders=[], tablesMeta={};
let role=null, activeTab='', lastHash='', qf='all';
let viewDate=todayStr(), closedViewDate=todayStr(), pendingRole=null, editOrderId=null;

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
    const m1=line.match(/^(\d+)\s*[xXхХ]\s*(.+)/);
    const m2=line.match(/^(\d+)\s+(.+)/);
    const m3=line.match(/^(.+?)\s*[xXхХ]\s*(\d+)$/);
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

async function loadAll(){
  setConnStatus(false);
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
    orders=raw?Object.values(raw).map(normalizeOrder):[];
    setConnStatus(true);
    renderAll();
  },(e)=>{console.error(e);setConnStatus(false);});

  onValue(ref(db,'tables'),(snap)=>{
    tablesMeta=snap.val()||{};
    if(activeTab==='tables')renderTables();
  });
}

async function saveAll(){
  const ordersObj={};
  orders.forEach(o=>ordersObj[o.id]=o);
  await Promise.all([
    fbUpdate('orders',ordersObj),
    fbUpdate('tables',tablesMeta)
  ]);
}

function startPoll(){
  setInterval(()=>{
    document.getElementById('hTime').textContent=new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
  },1000);
}

// ═══════════════════════════
//  TABLE META
// ═══════════════════════════
function tKey(date,tNum){return date+'_'+tNum;}
function getTMeta(date,tNum){
  const k=tKey(date,tNum);
  if(!tablesMeta[k])tablesMeta[k]={status:'open',openedAt:Date.now(),date,tNum};
  return tablesMeta[k];
}
async function closeTable(date,tNum,sid){
  if(!confirm('Закрыть стол '+tNum+'? Отметить как оплачен.'))return;
  const m=getTMeta(date,tNum);
  m.status='closed';m.closedAt=Date.now();
  if(!m.closedSessions)m.closedSessions=[];
  m.closedSessions.push({sid:sid||m.sid||'default',closedAt:m.closedAt,openedAt:m.openedAt});
  await saveAll();renderTables();renderClosed();fl('fOk','✅ Стол '+tNum+' закрыт');
}
async function reopenTable(date,tNum){
  const m=getTMeta(date,tNum);
  m.status='open';
  delete m.closedAt;
  if(m.closedSessions&&m.closedSessions.length){
    m.closedSessions.pop();
  }
  await saveAll();
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
    {id:'done',  label:'Закрытые',ico:'✅'},
  ];
  if(role==='waiter') return[
    {id:'new',   label:'+ Заказ', ico:'➕'},
    {id:'ready', label:'Забрать', ico:'🛎️', badge:'bR', badgeCls:'bg'},
    {id:'queue', label:'Очередь', ico:'📋', badge:'bQ'},
    {id:'tables',label:'Столики', ico:'🪑', badge:'bT', badgeCls:'bp'},
    {id:'done',  label:'Закрытые',ico:'✅'},
  ];
  return[
    {id:'new',   label:'+ Заказ', ico:'➕'},
    {id:'queue', label:'Очередь', ico:'📋', badge:'bQ'},
    {id:'ready', label:'Забрать', ico:'🛎️', badge:'bR', badgeCls:'bg'},
    {id:'tables',label:'Столики', ico:'🪑', badge:'bT', badgeCls:'bp'},
    {id:'done',  label:'Закрытые',ico:'✅'},
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
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:var(--accent);letter-spacing:2px;">🍺 БАР</div>
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
    </div>
  `;
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
}

// ═══════════════════════════
//  ADD ORDER
// ═══════════════════════════
async function addOrder(){
  const tableRaw=document.getElementById('inpTable').value.trim().toUpperCase();
  const rawItems=document.getElementById('inpItems').value.trim();
  const note=document.getElementById('inpNote').value.trim();
  const prio=document.getElementById('inpPriority').value;
  if(!tableRaw){alert('Укажите номер стола!');return;}
  if(!rawItems){alert('Введите позиции!');return;}
  const tNum=tableRaw;
  const items=parseItems(rawItems);
  if(!items.length){alert('Не удалось распознать позиции!');return;}
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
  if(!confirm('Удалить заказ?'))return;
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

  let inProgress=0,readyCnt=0;
  orders.forEach(o=>o.items&&o.items.forEach(it=>{
    if(it.status==='making')inProgress++;
    if(it.status==='ready')readyCnt++;
  }));

  const today=todayStr();
  const openTablesSet=new Set(
    orders.filter(o=>o.date===today).filter(o=>{
      const meta=getTMeta(today,o.table);
      const sid=o.sid||meta.sid||'default';
      const isCurrentSession=meta.sid===sid||(!meta.sid&&sid==='default');
      return isCurrentSession && meta.status!=='closed';
    }).map(o=>o.table)
  );

  setBadge('bQ',active.length);
  setBadge('bR',hasReady.length);
  setBadge('bT',openTablesSet.size);
  setEl('sN',active.length);setEl('sP',inProgress);setEl('sR',readyCnt);

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
  if(!isDone&&(role==='barman'||role==='admin')){
    itemsHtml=`<div class="items-list">${allItems.map(it=>barmanItemRow(o.id,it)).join('')}</div>`;
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

  return`
  <div class="order-card ${borderCls}">
    <div class="cnum">#${o.num}</div>
    <div class="card-header">
      <div class="tnum-big"><small>СТОЛ</small>${o.table}</div>
      <div class="tags">${pTag}${stTag}</div>
    </div>
    ${banner}
    <div class="order-time">принят в ${fmt(o.createdAt)}</div>
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
      if(!sumMap[k])sumMap[k]={name:it.name,qty:0};
      sumMap[k].qty+=it.qty;
    }));
    const sumLines=Object.values(sumMap).sort((a,b)=>a.name.localeCompare(b.name)).map(x=>
      `<div class="sum-line"><span class="sum-item">${esc(x.name)}</span><span class="sum-cnt">${x.qty} шт.</span></div>`
    ).join('');

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
      ?`<button class="btn-pay" onclick="closeTable('${viewDate}','${tNum}','${sid}')">💳 ЗАКРЫТЬ / ОПЛАЧЕН</button>`
      :(role==='admin'?`<button class="btn-reopen" onclick="reopenTable('${viewDate}','${tNum}')">↩ Переоткрыть</button>`:'');

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
        <div class="tb-summary"><h4>📋 ИТОГО ДЛЯ ЧЕКА</h4>${sumLines||'<div style="color:var(--muted);font-size:12px">Нет позиций</div>'}</div>
        ${actions?`<div class="tb-actions">${actions}</div>`:''}
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
function openEditModal(orderId){
  const o=orders.find(x=>x.id===orderId);if(!o)return;
  editOrderId=orderId;
  document.getElementById('editSub').textContent='Заказ #'+o.num+' · Стол '+o.table;
  document.getElementById('editPriority').value=o.priority||'normal';
  document.getElementById('editNote').value=o.note||'';
  const lines=(o.items||[])
    .filter(it=>it.status!=='done')
    .map(it=>it.qty+' '+it.name).join('\n');
  document.getElementById('editItems').value=lines;
  document.getElementById('editOverlay').classList.remove('hidden');
}
function closeEditModal(){
  document.getElementById('editOverlay').classList.add('hidden');
  editOrderId=null;
}
async function saveEditOrder(){
  if(!editOrderId){fl('fInfo','❌ ID заказа не найден');return;}
  const o=orders.find(x=>x.id===editOrderId);
  if(!o){fl('fInfo','❌ Заказ не найден');return;}

  const rawItems=document.getElementById('editItems').value.trim();
  const note=document.getElementById('editNote').value.trim();
  const prio=document.getElementById('editPriority').value;
  if(!rawItems){alert('Введите позиции!');return;}

  const doneItems=o.items.filter(it=>it.status==='done');
  const newParsed=parseItems(rawItems);
  const mergedItems=[...doneItems,...newParsed];

  const itemsObj={};
  mergedItems.forEach(it=>{
    const k=it._fbKey||it.id;
    const {_fbKey,...clean}=it;
    itemsObj[k]=clean;
  });

  try{
    await set(ref(db,'orders/'+editOrderId+'/items'), itemsObj);
    await update(ref(db,'orders/'+editOrderId), {note, priority:prio});
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

    const sumMap={};
    tOrders.forEach(o=>(o.items||[]).forEach(it=>{
      const k=it.name.trim().toLowerCase();
      if(!sumMap[k])sumMap[k]={name:it.name,qty:0};
      sumMap[k].qty+=it.qty;
    }));
    const sumLines=Object.values(sumMap).sort((a,b)=>a.name.localeCompare(b.name)).map(x=>
      `<div class="sum-line"><span class="sum-item">${esc(x.name)}</span><span class="sum-cnt">${x.qty} шт.</span></div>`
    ).join('');

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
        ${role==='admin'?`<div class="tb-actions"><button class="btn-reopen" onclick="reopenTable('${closedViewDate}','${tNum}')">↩ Переоткрыть</button></div>`:''}
      </div>
    </div>`;
  }).join('');
}
function jumpClosedDate(d){closedViewDate=d;renderClosed();}

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
  if(action==='deliver'&&oid&&iid){ await waiterDeliverItem(oid,iid); return; }
  if(action==='deliverall'&&oid){ await waiterDeliverAll(oid); return; }
  if(action==='reopen'&&oid)    { await reopenOrder(oid);       return; }
  if(action==='del'&&oid)       { await delOrder(oid);          return; }
  if(action==='edit'&&oid)      { openEditModal(oid);           return; }
});

// ═══════════════════════════
//  EXPOSE TO HTML
// ═══════════════════════════
Object.assign(window,{
  pickRole,confirmRole,openRoleModal,closeRoleModal,
  sw,addOrder,barItemAction,waiterDeliverItem,waiterDeliverAll,
  pickTable,
  closeTable,reopenTable,reopenOrder,delOrder,setQF,toggleBill,shiftDate,jumpDate,
  renderTables,openEditModal,closeEditModal,saveEditOrder,
  shiftClosedDate,jumpClosedDate,renderClosed
});

// ═══════════════════════════
//  BOOT
// ═══════════════════════════
(async()=>{
  const sr=localStorage.getItem('bar_role');
  if(sr){role=sr;applyRole();}
  else openRoleModal();
  await loadAll();
  startPoll();
})();
