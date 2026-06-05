import{S}from'./state.js';
import{esc,escAttr,fmt,empty,setBadge,setEl,todayStr,shiftDS,aggStatus}from'./utils.js';
import{BUILTIN_MENU}from'./menu-data.js';
import{renderTables,renderClosed,getTMeta,getItemPrice}from'./tables.js';

// ─── INSTANT ITEMS (пиво/напитки/закуски) ────────────
export function isInstantItem(name){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const key=name.trim().toLowerCase();
  for(const cat of menu){
    const c=(cat.cat||'').toLowerCase();
    if(c.includes('пиво')||c.includes('напитки')||c.includes('закуски')){
      if((cat.items||[]).some(it=>it.name.trim().toLowerCase()===key))return true;
    }
  }
  return false;
}

// ─── ITEM ROWS ────────────────────────────────────────
export function barmanItemRow(orderId,it){
  const cls={new:'',making:'is-making',ready:'is-ready',done:'is-done'}[it.status]||'';
  const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';
  const oid=escAttr(orderId),iid=escAttr(it._fbKey||it.id);
  let btns='';
  if(it.status==='new'){btns=`<button class="ib ib-start" data-oid="${oid}" data-iid="${iid}" data-st="making">🍹 Начал</button><button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button>`;}
  else if(it.status==='making'){btns=`<button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button><button class="ib ib-undo" data-oid="${oid}" data-iid="${iid}" data-st="new">↩</button>`;}
  else if(it.status==='ready'){btns=`<span class="item-status-chip isc-ready">✓ ждёт офиц.</span><button class="ib ib-undo" data-oid="${oid}" data-iid="${iid}" data-st="making">↩</button>`;}
  return`<div class="item-row ${cls}"><span class="item-ico">${ico}</span><span class="item-qty">${esc(it.qty)}</span><span class="item-name">${esc(it.name)}</span><div class="item-btns">${btns}</div></div>`;
}

export function waiterItemRow(orderId,it){
  const instant=isInstantItem(it.name);
  const needsDeliver=it.status==='ready'||(instant&&it.status!=='done');
  const cls=it.status==='done'?'is-done':needsDeliver?'is-ready':(it.status==='making'&&!instant?'is-making':'');
  const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';
  const oid=escAttr(orderId),iid=escAttr(it._fbKey||it.id);
  let btns='';
  if(it.status==='ready'){btns=`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button>`;}
  else if(it.status==='making'){btns=instant?`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button>`:`<span class="item-status-chip isc-making">🍹 готовится</span>`;}
  else if(it.status==='new'){btns=instant?`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button>`:`<span class="item-status-chip isc-waiting">ожидает</span>`;}
  return`<div class="item-row ${cls}"><span class="item-ico">${ico}</span><span class="item-qty">${esc(it.qty)}</span><span class="item-name">${esc(it.name)}</span><div class="item-btns">${btns}</div></div>`;
}

export function adminItemRow(orderId,it){
  const instant=isInstantItem(it.name);
  const needsDeliver=it.status==='ready'||(instant&&it.status!=='done');
  const cls=it.status==='done'?'is-done':needsDeliver?'is-ready':(it.status==='making'&&!instant?'is-making':'');
  const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';
  const oid=escAttr(orderId),iid=escAttr(it._fbKey||it.id);
  let btns='';
  if(it.status==='new'){btns=instant?`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button>`:`<button class="ib ib-start" data-oid="${oid}" data-iid="${iid}" data-st="making">🍹 Начал</button><button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button>`;}
  else if(it.status==='making'){btns=instant?`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button><button class="ib ib-undo" data-oid="${oid}" data-iid="${iid}" data-st="new">↩</button>`:`<button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button><button class="ib ib-undo" data-oid="${oid}" data-iid="${iid}" data-st="new">↩</button>`;}
  else if(it.status==='ready'){btns=`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button><button class="ib ib-undo" data-oid="${oid}" data-iid="${iid}" data-st="making">↩</button>`;}
  return`<div class="item-row ${cls}"><span class="item-ico">${ico}</span><span class="item-qty">${esc(it.qty)}</span><span class="item-name">${esc(it.name)}</span><div class="item-btns">${btns}</div></div>`;
}

// ─── ORDER CARD ───────────────────────────────────────
export function orderCard(o,isDone){
  const st=o.status;
  const allItems=o.items||[];
  const doneC=allItems.filter(i=>i.status==='done').length;
  const readyC=allItems.filter(i=>i.status==='ready').length;
  const total=allItems.length;
  const pct=total?Math.round((doneC+readyC)/total*100):0;
  const borderCls='oc-'+(st==='making'?'partial':st)+(o.priority==='urgent'?' p-urgent':'');
  const stTag={new:`<span class="tag t-new">🕐 ожидает</span>`,making:`<span class="tag t-partial">🍹 готовится</span>`,ready:`<span class="tag t-ready">🟢 ГОТОВО!</span>`,done:`<span class="tag t-done">✓ доставлен</span>`}[st]||'';
  const pTag=o.priority==='urgent'?`<span class="tag t-urgent">🔥 СРОЧНО</span>`:'';
  const note=o.note?`<div class="order-note">💬 ${esc(o.note)}</div>`:'';
  let banner='';
  if(st==='ready')banner=`<div class="ready-banner"><div class="rdot"></div>Всё готово — неси на Стол ${esc(o.table)}!</div>`;
  else if(readyC>0&&st==='making')banner=`<div class="partial-banner">🟢 ${readyC} из ${total} позиц. готовы — можно частично забрать!</div>`;
  const prog=(st==='making'||st==='ready')&&total>1?`<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-label">${doneC+readyC} / ${total} готово</div>`:'';
  let itemsHtml='';
  if(!isDone&&S.role==='barman')itemsHtml=`<div class="items-list">${allItems.map(it=>barmanItemRow(o.id,it)).join('')}</div>`;
  else if(!isDone&&S.role==='admin')itemsHtml=`<div class="items-list">${allItems.map(it=>adminItemRow(o.id,it)).join('')}</div>`;
  else if(!isDone&&S.role==='waiter')itemsHtml=`<div class="items-list">${allItems.map(it=>waiterItemRow(o.id,it)).join('')}</div>`;
  else itemsHtml=`<div class="items-list">${allItems.map(it=>{const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';return`<div class="item-row readonly${it.status==='done'?' is-done':''}"><span class="item-ico">${ico}</span><span class="item-qty">${esc(it.qty)}</span><span class="item-name">${esc(it.name)}</span></div>`;}).join('')}</div>`;
  let acts='';const oid=escAttr(o.id);
  if(isDone){if(S.role==='admin')acts+=`<button class="btn-sm bx" data-action="del" data-oid="${oid}">🗑 Удалить</button>`;}
  else{
    if(S.role==='waiter'||S.role==='admin')acts+=`<button class="btn-edit" data-action="edit" data-oid="${oid}">✏️ Изменить</button>`;
    if((S.role==='waiter'||S.role==='admin')&&readyC>0)acts+=`<button class="btn-sm bd" data-action="deliverall" data-oid="${oid}">✅ Отнести всё (${readyC} поз.)</button>`;
    if(S.role==='admin')acts+=` <button class="btn-sm bx" data-action="del" data-oid="${oid}">🗑</button>`;
  }
  const waitMins=isDone?0:Math.floor((Date.now()-o.createdAt)/60000);
  const waitLbl=!isDone&&o.createdAt?`<span data-created="${escAttr(o.createdAt)}" class="wait-chip${waitMins>=15?' urgent':''}">${waitMins>0?`⏱ ${waitMins} мин${waitMins>=15?' !':''}`:'⏱ &lt;1 мин'}</span>`:'';
  return`<div class="order-card ${borderCls}"><div class="cnum">#${esc(o.num)}</div><div class="card-header"><div class="tnum-big"><small>СТОЛ</small>${esc(o.table)}</div><div class="tags">${pTag}${stTag}</div></div>${banner}<div class="order-time">принят в ${fmt(o.createdAt)}${waitLbl}</div>${note}${prog}${itemsHtml}${acts?`<div class="order-actions">${acts}</div>`:''}</div>`;
}

// ─── QUICK TABLE BUTTONS ──────────────────────────────
export function buildQuickTableBtns(){
  const el=document.getElementById('quickTableBtns');if(!el)return;
  const TABLES=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,'PS1','PS2'];
  const current=document.getElementById('inpTable')?.value?.toUpperCase().trim();
  el.innerHTML=TABLES.map(t=>{
    const val=String(t);const isPS=val.startsWith('PS');const isActive=val===current;
    return`<button onclick="pickTable('${escAttr(val)}')" data-tval="${escAttr(val)}" class="quick-table-btn${isPS?' ps':''}${isActive?' active':''}">${esc(val)}</button>`;
  }).join('');
}

function mkFb(val,label){return`<button class="fb${S.qf===val?' active':''}" onclick="setQF('${escAttr(val)}',this)">${esc(label)}</button>`;}

// ─── RENDER ALL ───────────────────────────────────────
export function renderAll(){
  if(!S.role)return;
  S.orders.forEach(o=>{if(Array.isArray(o.items))o.status=aggStatus(o.items);});
  const active=S.orders.filter(o=>o.status!=='done');
  const done=S.orders.filter(o=>o.status==='done');
  const hasReady=S.orders.filter(o=>o.status!=='done'&&o.items&&o.items.some(i=>i.status==='ready'));
  active.sort((a,b)=>{if(a.priority==='urgent'&&b.priority!=='urgent')return-1;if(b.priority==='urgent'&&a.priority!=='urgent')return 1;return a.createdAt-b.createdAt;});
  let inProgress=0,readyCnt=0,newCnt=0;
  S.orders.forEach(o=>{if(o.status==='new')newCnt++;o.items&&o.items.forEach(it=>{if(it.status==='making')inProgress++;if(it.status==='ready')readyCnt++;});});
  const today=todayStr();
  const todayOrders=S.orders.filter(o=>o.date===today&&o.table!=null&&o.table!==''&&o.table!=='undefined');
  const openTablesSet=new Set();
  const closedTablesSet=new Set();
  todayOrders.forEach(o=>{
    const meta=getTMeta(today,o.table);
    const sid=o.sid||'default';
    const isCurrent=meta.sid===sid||(!meta.sid&&sid==='default');
    if(isCurrent&&meta.status==='closed')closedTablesSet.add(String(o.table));
    else if(isCurrent&&meta.status!=='closed')openTablesSet.add(String(o.table));
  });
  setBadge('bQ',active.length);setBadge('bR',hasReady.length);setBadge('bT',openTablesSet.size);
  setBadge('bD',closedTablesSet.size);
  setEl('sN',active.length);setEl('sNew',newCnt);setEl('sP',inProgress);setEl('sR',readyCnt);
  const tables=[...new Set(active.filter(o=>o.table!=null&&o.table!==''&&o.table!=='undefined').map(o=>String(o.table)))].sort((a,b)=>{const an=parseInt(a),bn=parseInt(b);if(!isNaN(an)&&!isNaN(bn))return an-bn;if(!isNaN(an))return-1;if(!isNaN(bn))return 1;return a.localeCompare(b);});
  const qfEl=document.getElementById('qFilters');
  if(qfEl)qfEl.innerHTML=mkFb('all','Все')+mkFb('new','🆕 Новые')+mkFb('making','🍹 В работе')+mkFb('ready','🟢 Готово')+tables.map(t=>mkFb('t'+t,'Стол '+t)).join('');
  const ql=document.getElementById('qList');
  if(ql){let list=active;if(S.qf==='new')list=active.filter(o=>o.status==='new');if(S.qf==='making')list=active.filter(o=>o.status==='making');if(S.qf==='ready')list=active.filter(o=>o.status==='ready');if(S.qf.startsWith('t')){const t=S.qf.slice(1);list=active.filter(o=>String(o.table)===t);}ql.innerHTML=list.length?list.map(o=>orderCard(o,false)).join(''):empty('📭','Нет заказов в очереди');}
  const rl=document.getElementById('rList');
  if(rl){const rs=hasReady.slice().sort((a,b)=>a.createdAt-b.createdAt);rl.innerHTML=rs.length?rs.map(o=>orderCard(o,false)).join(''):empty('⏳','Нет готовых позиций');}
  if(S.activeTab==='tables')renderTables();
  if(S.activeTab==='done')renderClosed();
  if(document.getElementById('quickTableBtns'))buildQuickTableBtns();
}

// ─── STATS ───────────────────────────────────────────
export function renderStats(){
  const el=document.getElementById('statsContent');if(!el)return;
  const today=todayStr();
  const todayOrders=S.orders.filter(o=>o.date===today);
  const todayDone=todayOrders.filter(o=>o.status==='done');
  const popMap={};
  S.orders.forEach(o=>(o.items||[]).forEach(it=>{const k=it.name.trim().toLowerCase();if(!popMap[k])popMap[k]={name:it.name,count:0};popMap[k].count+=it.qty;}));
  const popular=Object.values(popMap).sort((a,b)=>b.count-a.count).slice(0,10);
  const dayStats={};
  for(let i=6;i>=0;i--){const d=shiftDS(today,-i);dayStats[d]={date:d,orders:0,tables:new Set()};}
  S.orders.forEach(o=>{if(dayStats[o.date]){dayStats[o.date].orders++;dayStats[o.date].tables.add(o.table);}});
  const maxOrders=Math.max(...Object.values(dayStats).map(d=>d.orders),1);
  el.innerHTML=`<div class="stats-layout">
    <div class="stats-cards">
      <div class="sc"><span class="n">${todayOrders.length}</span><span>заказов сегодня</span></div>
      <div class="sc"><span class="n g">${todayDone.length}</span><span>выполнено</span></div>
      <div class="sc"><span class="n b">${new Set(todayOrders.map(o=>o.table)).size}</span><span>столов</span></div>
    </div>
    <div class="stats-card">
      <div class="stats-card-title">📅 ЗАКАЗЫ ЗА 7 ДНЕЙ</div>
      <div class="stats-chart">${Object.values(dayStats).map(d=>{const h=d.orders?Math.max(8,Math.round(d.orders/maxOrders*70)):2;const isToday=d.date===today;const lbl=d.date.slice(8);return`<div class="stats-bar-col${isToday?' today':''}"><div class="stats-bar-count">${d.orders||''}</div><div class="stats-bar-line" style="height:${h}px"></div><div class="stats-bar-label">${lbl}</div></div>`;}).join('')}</div>
    </div>
    <div class="stats-card">
      <div class="stats-card-title">🏆 ТОП ПОЗИЦИЙ (30 дней)</div>
      ${popular.length?popular.map((p,i)=>`<div class="stats-pop-row"><div class="stats-pop-name"><span class="stats-pop-rank">${i+1}</span><span>${esc(p.name)}</span></div><span class="stats-pop-count">${esc(p.count)}</span></div>`).join(''):'<div class="stats-empty">Нет данных</div>'}
    </div>
  </div>`;
}

// ─── POLL ─────────────────────────────────────────────
export function startPoll(){
  setInterval(()=>{const el=document.getElementById('hTime');if(el)el.textContent=new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});},1000);
  setInterval(()=>{document.querySelectorAll('[data-created]').forEach(el=>{const created=parseInt(el.dataset.created);if(!created)return;const mins=Math.floor((Date.now()-created)/60000);const urgent=mins>=15;el.textContent=mins>0?`⏱ ${mins} мин${urgent?' !':''}`:'';el.classList.toggle('urgent',urgent);});},60000);
}
