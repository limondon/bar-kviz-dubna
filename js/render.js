import{S}from'./state.js';
import{esc,fmt,empty,setBadge,setEl,todayStr,shiftDS,aggStatus}from'./utils.js';
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
  const oid=esc(orderId),iid=esc(it._fbKey||it.id);
  let btns='';
  if(it.status==='new'){btns=`<button class="ib ib-start" data-oid="${oid}" data-iid="${iid}" data-st="making">🍹 Начал</button><button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button>`;}
  else if(it.status==='making'){btns=`<button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button><button class="ib ib-undo" data-oid="${oid}" data-iid="${iid}" data-st="new">↩</button>`;}
  else if(it.status==='ready'){btns=`<span class="item-status-chip isc-ready">✓ ждёт офиц.</span><button class="ib ib-undo" data-oid="${oid}" data-iid="${iid}" data-st="making">↩</button>`;}
  return`<div class="item-row ${cls}"><span class="item-ico">${ico}</span><span class="item-qty">${it.qty}</span><span class="item-name">${esc(it.name)}</span><div class="item-btns">${btns}</div></div>`;
}

export function waiterItemRow(orderId,it){
  const cls={new:'',making:'is-making',ready:'is-ready',done:'is-done'}[it.status]||'';
  const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';
  const oid=esc(orderId),iid=esc(it._fbKey||it.id);
  const instant=isInstantItem(it.name);
  let btns='';
  if(it.status==='ready'){btns=`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button>`;}
  else if(it.status==='making'){btns=instant?`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button>`:`<span class="item-status-chip isc-making">🍹 готовится</span>`;}
  else if(it.status==='new'){btns=instant?`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button>`:`<span class="item-status-chip isc-waiting">ожидает</span>`;}
  return`<div class="item-row ${cls}"><span class="item-ico">${ico}</span><span class="item-qty">${it.qty}</span><span class="item-name">${esc(it.name)}</span><div class="item-btns">${btns}</div></div>`;
}

export function adminItemRow(orderId,it){
  const cls={new:'',making:'is-making',ready:'is-ready',done:'is-done'}[it.status]||'';
  const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';
  const oid=esc(orderId),iid=esc(it._fbKey||it.id);
  const instant=isInstantItem(it.name);
  let btns='';
  if(it.status==='new'){btns=instant?`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button>`:`<button class="ib ib-start" data-oid="${oid}" data-iid="${iid}" data-st="making">🍹 Начал</button><button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button>`;}
  else if(it.status==='making'){btns=instant?`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button><button class="ib ib-undo" data-oid="${oid}" data-iid="${iid}" data-st="new">↩</button>`:`<button class="ib ib-barready" data-oid="${oid}" data-iid="${iid}" data-st="ready">🟢 Готово</button><button class="ib ib-undo" data-oid="${oid}" data-iid="${iid}" data-st="new">↩</button>`;}
  else if(it.status==='ready'){btns=`<button class="ib ib-deliver" data-oid="${oid}" data-iid="${iid}" data-action="deliver">✅ Отнёс</button><button class="ib ib-undo" data-oid="${oid}" data-iid="${iid}" data-st="making">↩</button>`;}
  return`<div class="item-row ${cls}"><span class="item-ico">${ico}</span><span class="item-qty">${it.qty}</span><span class="item-name">${esc(it.name)}</span><div class="item-btns">${btns}</div></div>`;
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
  if(st==='ready')banner=`<div class="ready-banner"><div class="rdot"></div>Всё готово — неси на Стол ${o.table}!</div>`;
  else if(readyC>0&&st==='making')banner=`<div class="partial-banner">🟢 ${readyC} из ${total} позиц. готовы — можно частично забрать!</div>`;
  const prog=(st==='making'||st==='ready')&&total>1?`<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div><div class="progress-label">${doneC+readyC} / ${total} готово</div>`:'';
  let itemsHtml='';
  if(!isDone&&S.role==='barman')itemsHtml=`<div class="items-list">${allItems.map(it=>barmanItemRow(o.id,it)).join('')}</div>`;
  else if(!isDone&&S.role==='admin')itemsHtml=`<div class="items-list">${allItems.map(it=>adminItemRow(o.id,it)).join('')}</div>`;
  else if(!isDone&&S.role==='waiter')itemsHtml=`<div class="items-list">${allItems.map(it=>waiterItemRow(o.id,it)).join('')}</div>`;
  else itemsHtml=`<div class="items-list">${allItems.map(it=>{const ico={new:'⬜',making:'🍹',ready:'🟢',done:'✅'}[it.status]||'⬜';return`<div class="item-row${it.status==='done'?' is-done':''}" style="cursor:default;"><span class="item-ico">${ico}</span><span class="item-qty">${it.qty}</span><span class="item-name">${esc(it.name)}</span></div>`;}).join('')}</div>`;
  let acts='';const oid=esc(o.id);
  if(isDone){if(S.role==='admin')acts+=`<button class="btn-sm bx" data-action="del" data-oid="${oid}">🗑 Удалить</button>`;}
  else{
    if(S.role==='waiter'||S.role==='admin')acts+=`<button class="btn-edit" data-action="edit" data-oid="${oid}">✏️ Изменить</button>`;
    if((S.role==='waiter'||S.role==='admin')&&readyC>0)acts+=`<button class="btn-sm bd" data-action="deliverall" data-oid="${oid}">✅ Отнести всё (${readyC} поз.)</button>`;
    if(S.role==='admin')acts+=` <button class="btn-sm bx" data-action="del" data-oid="${oid}">🗑</button>`;
  }
  const waitMins=isDone?0:Math.floor((Date.now()-o.createdAt)/60000);
  const waitLbl=!isDone&&o.createdAt?`<span data-created="${o.createdAt}" style="font-size:var(--fs-xs);padding:2px 8px;border-radius:8px;font-weight:700;margin-left:6px;background:${waitMins>=15?'rgba(229,57,53,.18)':'rgba(255,255,255,.06)'};color:${waitMins>=15?'var(--red)':'var(--muted)'};">${waitMins>0?`⏱ ${waitMins} мин${waitMins>=15?' !':''}`:'⏱ <1 мин'}</span>`:'';
  return`<div class="order-card ${borderCls}"><div class="cnum">#${o.num}</div><div class="card-header"><div class="tnum-big"><small>СТОЛ</small>${o.table}</div><div class="tags">${pTag}${stTag}</div></div>${banner}<div class="order-time">принят в ${fmt(o.createdAt)}${waitLbl}</div>${note}${prog}${itemsHtml}${acts?`<div class="order-actions">${acts}</div>`:''}</div>`;
}

// ─── QUICK TABLE BUTTONS ──────────────────────────────
export function buildQuickTableBtns(){
  const el=document.getElementById('quickTableBtns');if(!el)return;
  const TABLES=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,'PS1','PS2'];
  const current=document.getElementById('inpTable')?.value?.toUpperCase().trim();
  el.innerHTML=TABLES.map(t=>{
    const val=String(t);const isPS=val.startsWith('PS');const isActive=val===current;
    return`<button onclick="pickTable('${val}')" data-tval="${val}" style="min-width:${isPS?56:44}px;min-height:44px;padding:6px ${isPS?'10px':'8px'};background:${isActive?'rgba(245,166,35,.25)':'var(--card)'};border:${isActive?'2px solid var(--accent)':'1px solid var(--border)'};border-radius:8px;color:${isPS?'var(--purple)':isActive?'var(--accent)':'var(--text)'};font-family:'Bebas Neue',sans-serif;font-size:${isPS?'14px':'18px'};cursor:pointer;transition:all .15s;letter-spacing:1px;${isPS?'border-color:rgba(156,39,176,.5);background:rgba(156,39,176,.08);':''}${isActive&&isPS?'border-color:var(--purple)!important;background:rgba(156,39,176,.25)!important;':''}">${val}</button>`;
  }).join('');
}

function mkFb(val,label){return`<button class="fb${S.qf===val?' active':''}" onclick="setQF('${val}',this)">${label}</button>`;}

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
  const openTablesSet=new Set(S.orders.filter(o=>o.date===today).filter(o=>{const meta=getTMeta(today,o.table);const sid=o.sid||'default';return(meta.sid===sid||(!meta.sid&&sid==='default'))&&meta.status!=='closed';}).map(o=>o.table));
  setBadge('bQ',active.length);setBadge('bR',hasReady.length);setBadge('bT',openTablesSet.size);
  const closedTablesSet=new Set(S.orders.filter(o=>o.date===today).filter(o=>{const meta=getTMeta(today,o.table);const sid=o.sid||'default';return(meta.sid===sid||(!meta.sid&&sid==='default'))&&meta.status==='closed';}).map(o=>o.table));
  setBadge('bD',closedTablesSet.size);
  setEl('sN',active.length);setEl('sNew',newCnt);setEl('sP',inProgress);setEl('sR',readyCnt);
  const tables=[...new Set(active.map(o=>String(o.table)))].sort((a,b)=>{const an=parseInt(a),bn=parseInt(b);if(!isNaN(an)&&!isNaN(bn))return an-bn;if(!isNaN(an))return-1;if(!isNaN(bn))return 1;return a.localeCompare(b);});
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
  el.innerHTML=`<div style="display:flex;flex-direction:column;gap:var(--sp-md);">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-sm);">
      <div class="sc"><span class="n">${todayOrders.length}</span><span>заказов сегодня</span></div>
      <div class="sc"><span class="n" style="color:var(--green);">${todayDone.length}</span><span>выполнено</span></div>
      <div class="sc"><span class="n" style="color:var(--blue);">${new Set(todayOrders.map(o=>o.table)).size}</span><span>столов</span></div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-md);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;color:var(--accent);margin-bottom:var(--sp-sm);">📅 ЗАКАЗЫ ЗА 7 ДНЕЙ</div>
      <div style="display:flex;align-items:flex-end;gap:6px;height:80px;">${Object.values(dayStats).map(d=>{const h=d.orders?Math.max(8,Math.round(d.orders/maxOrders*70)):2;const isToday=d.date===today;const lbl=d.date.slice(8);return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;"><div style="font-size:9px;color:var(--muted);">${d.orders||''}</div><div style="width:100%;height:${h}px;background:${isToday?'var(--accent)':'rgba(201,169,110,.35)'};border-radius:3px 3px 0 0;"></div><div style="font-size:9px;color:${isToday?'var(--accent)':'var(--muted)'};">${lbl}</div></div>`;}).join('')}</div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-md);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;color:var(--accent);margin-bottom:var(--sp-sm);">🏆 ТОП ПОЗИЦИЙ (30 дней)</div>
      ${popular.length?popular.map((p,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);"><div style="display:flex;align-items:center;gap:8px;"><span style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:var(--muted);min-width:20px;">${i+1}</span><span style="font-size:13px;">${esc(p.name)}</span></div><span style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--accent);">${p.count}</span></div>`).join(''):'<div style="color:var(--muted);font-size:12px;">Нет данных</div>'}
    </div>
  </div>`;
}

// ─── POLL ─────────────────────────────────────────────
export function startPoll(){
  setInterval(()=>{const el=document.getElementById('hTime');if(el)el.textContent=new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});},1000);
  setInterval(()=>{document.querySelectorAll('[data-created]').forEach(el=>{const created=parseInt(el.dataset.created);if(!created)return;const mins=Math.floor((Date.now()-created)/60000);const urgent=mins>=15;el.textContent=mins>0?`⏱ ${mins} мин${urgent?' !':''}`:'' ;el.style.background=urgent?'rgba(229,57,53,.18)':'rgba(255,255,255,.06)';el.style.color=urgent?'var(--red)':'var(--muted)';});},60000);
}
