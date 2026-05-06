import{S}from'./state.js';
import{db,ref,update,fbUpdate}from'./firebase.js';
import{todayStr,dateLbl,shiftDS,fmt,fmt2,esc,pl,fl,showConfirm}from'./utils.js';
import{BUILTIN_MENU}from'./menu-data.js';

// ─── TABLE META ───────────────────────────────────────
export function tKey(date,tNum){return date+'_'+tNum;}
export function genToken(){return Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,6);}
export function getTMeta(date,tNum){
  const k=tKey(date,tNum);
  if(!S.tablesMeta[k])S.tablesMeta[k]={status:'open',openedAt:Date.now(),date,tNum,token:genToken()};
  if(!S.tablesMeta[k].token)S.tablesMeta[k].token=genToken();
  return S.tablesMeta[k];
}

export function getItemPrice(name){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const key=name.trim().toLowerCase();
  for(const cat of menu){
    for(const item of(cat.items||[])){
      if(item.name.trim().toLowerCase()===key)return item.price||0;
    }
  }
  return 0;
}

// ─── TABLE ACTIONS ────────────────────────────────────
export async function closeTable(date,tNum,sid){
  const ok=await showConfirm(`💳 Закрыть стол ${tNum}?`,'Отметить как оплачен.','ЗАКРЫТЬ / ОПЛАЧЕН');
  if(!ok)return;
  const m=getTMeta(date,tNum);
  m.status='closed';m.closedAt=Date.now();
  if(!m.closedSessions)m.closedSessions=[];
  m.closedSessions.push({sid:sid||m.sid||'default',closedAt:m.closedAt,openedAt:m.openedAt});
  await fbUpdate('tables',S.tablesMeta);
  renderTables();renderClosed();fl('fOk','✅ Стол '+tNum+' закрыт');
}

export async function reopenTable(date,tNum){
  const m=getTMeta(date,tNum);
  m.status='open';delete m.closedAt;
  m.token=genToken();
  if(m.closedSessions&&m.closedSessions.length)m.closedSessions.pop();
  await fbUpdate('tables',S.tablesMeta);
  renderTables();renderClosed();fl('fOk','↩ Стол '+tNum+' переоткрыт — новый QR готов');
}

let _renameCb=null;
function openRenameModal(currentName,cb){
  const overlay=document.getElementById('renameOverlay');
  if(overlay){
    _renameCb=cb;
    document.getElementById('renameSub').textContent='Сейчас: '+currentName;
    const inp=document.getElementById('renameInput');
    inp.value='';overlay.classList.remove('hidden');
    setTimeout(()=>inp.focus(),100);return;
  }
  const val=(window.prompt('Новое название стола (сейчас: '+currentName+')','')||'').trim().toUpperCase();
  if(val&&val!==String(currentName))cb(val);
}
export function closeRenameModal(){
  const overlay=document.getElementById('renameOverlay');
  if(overlay)overlay.classList.add('hidden');
  _renameCb=null;
}
export function confirmRename(){
  const val=document.getElementById('renameInput').value.trim().toUpperCase();
  if(!val){fl('fInfo','Введите название!');return;}
  const cb=_renameCb;_renameCb=null;
  const overlay=document.getElementById('renameOverlay');
  if(overlay)overlay.classList.add('hidden');
  if(cb)cb(val);
}
export async function renameTable(date,oldTNum,sid){
  const overlay=document.getElementById('renameOverlay');
  if(overlay){openRenameModal(oldTNum,async(newTNum)=>{await doRenameTable(date,oldTNum,sid,newTNum);});}
  else{const val=(window.prompt('Новое название стола (сейчас: '+oldTNum+'):',oldTNum)||'').trim().toUpperCase();if(val&&val!==String(oldTNum))await doRenameTable(date,oldTNum,sid,val);}
}
export async function doRenameTable(date,oldTNum,sid,newTNum){
  if(!newTNum||newTNum===String(oldTNum))return;
  const upd={};
  S.orders.forEach(o=>{
    const oSid=o.sid||'default';
    if(o.date===date&&String(o.table)===String(oldTNum)&&oSid===sid){upd[`orders/${o.id}/table`]=newTNum;o.table=newTNum;}
  });
  const oldKey=tKey(date,oldTNum),newKey=tKey(date,newTNum);
  if(S.tablesMeta[oldKey]){
    S.tablesMeta[newKey]={...S.tablesMeta[oldKey],tNum:newTNum};
    delete S.tablesMeta[oldKey];
    upd[`tables/${oldKey}`]=null;upd[`tables/${newKey}`]=S.tablesMeta[newKey];
  }
  await update(ref(db),upd);
  renderTables();renderClosed();fl('fOk',`✅ Стол ${oldTNum} → ${newTNum}`);
}
export async function deleteTable(date,tNum,sid){
  const tOrders=S.orders.filter(o=>o.date===date&&String(o.table)===String(tNum)&&(o.sid||'default')===sid);
  const ok=await showConfirm(`🗑 Удалить стол ${tNum}?`,`Будет удалено ${tOrders.length} ${pl(tOrders.length,'заказ','заказа','заказов')}.`);
  if(!ok)return;
  const upd={};
  tOrders.forEach(o=>{upd[`orders/${o.id}`]=null;});
  const k=tKey(date,tNum);upd[`tables/${k}`]=null;delete S.tablesMeta[k];
  await update(ref(db),upd);
  S.orders=S.orders.filter(o=>!(o.date===date&&String(o.table)===String(tNum)&&(o.sid||'default')===sid));
  renderTables();renderClosed();
  if(window.renderAll)window.renderAll();
  fl('fOk',`🗑 Стол ${tNum} удалён`);
}

export async function logTable(date,tNum){
  const m=getTMeta(date,tNum);m.loggedAt=Date.now();
  await fbUpdate('tables',S.tablesMeta);
  renderTables();fl('fOk','📋 Стол '+tNum+' — внесено в систему в '+fmt2(m.loggedAt));
}
export async function unlogTable(date,tNum){
  const m=getTMeta(date,tNum);delete m.loggedAt;m.loggedAt=null;
  await fbUpdate('tables',S.tablesMeta);
  renderTables();fl('fInfo','↩ Отметка "вбили в систему" снята');
}

export function toggleBill(cardId){
  const b=document.getElementById('body-'+cardId);
  const c=document.getElementById('chev-'+cardId);
  if(!b)return;
  const open=b.classList.contains('open');
  b.classList.toggle('open',!open);c.classList.toggle('open',!open);
}

// ─── QR CODE ─────────────────────────────────────────
export async function showQR(tNum){
  const date=todayStr();const meta=getTMeta(date,tNum);
  await fbUpdate('tables/'+date+'_'+tNum,meta);
  const token=meta.token;
  const base=location.href.substring(0,location.href.lastIndexOf('/')+1);
  const guestUrl=`${base}guest.html?table=${encodeURIComponent(tNum)}&token=${token}`;
  document.getElementById('qrTableNum').textContent=tNum;
  document.getElementById('qrUrlText').textContent=guestUrl;
  const canvas=document.getElementById('qrCanvas');
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,220,220);
  try{
    const qr=window.qrcode(0,'M');qr.addData(guestUrl);qr.make();
    const size=220,cells=qr.getModuleCount();
    const cellSize=Math.floor((size-16)/cells);const offset=Math.floor((size-cells*cellSize)/2);
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,size,size);ctx.fillStyle='#1a1825';
    for(let r=0;r<cells;r++)for(let c=0;c<cells;c++)if(qr.isDark(r,c))ctx.fillRect(offset+c*cellSize,offset+r*cellSize,cellSize-1,cellSize-1);
  }catch(e){ctx.fillStyle='#fff';ctx.fillRect(0,0,220,220);ctx.fillStyle='#333';ctx.font='11px monospace';ctx.textAlign='center';ctx.fillText('QR недоступен',110,110);}
  document.getElementById('qrOverlay').classList.remove('hidden');
}
export function closeQrModal(){document.getElementById('qrOverlay').classList.add('hidden');}
export function openQrPicker(){
  const TABLES=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,'PS1','PS2'];
  const overlay=document.getElementById('qrPickerOverlay');
  const list=document.getElementById('qrPickerList');
  if(!overlay||!list)return;
  list.innerHTML=TABLES.map(t=>
    `<button onclick="showQR('${t}');closeQrPicker();" style="min-height:52px;padding:8px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Bebas Neue',sans-serif;font-size:20px;cursor:pointer;">${t}</button>`
  ).join('');
  overlay.classList.remove('hidden');
}
export function closeQrPicker(){document.getElementById('qrPickerOverlay')?.classList.add('hidden');}

// ─── RENDER TABLES ────────────────────────────────────
export function shiftDate(n){S.viewDate=shiftDS(S.viewDate,n);renderTables();}
export function jumpDate(d){S.viewDate=d;renderTables();}
export function shiftClosedDate(n){S.closedViewDate=shiftDS(S.closedViewDate,n);renderClosed();}
export function jumpClosedDate(d){S.closedViewDate=d;renderClosed();}

export function renderTables(){
  document.getElementById('dateLabel').textContent=dateLbl(S.viewDate);
  const allDates=[...new Set(S.orders.map(o=>o.date).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
  const qnEl=document.getElementById('dateQuickNav');
  if(qnEl)qnEl.innerHTML=allDates.map(d=>`<button onclick="jumpDate('${d}')" style="padding:5px 12px;border-radius:18px;border:1px solid ${d===S.viewDate?'var(--accent)':'var(--border)'};background:${d===S.viewDate?'var(--accent)':'transparent'};color:${d===S.viewDate?'#000':'var(--muted)'};font-size:11px;font-family:IBM Plex Mono,monospace;cursor:pointer;white-space:nowrap;">${dateLbl(d)}</button>`).join('');

  const dayOrders=S.orders.filter(o=>o.date===S.viewDate);
  const sessionMap={};
  dayOrders.forEach(o=>{
    const meta=getTMeta(S.viewDate,o.table);const sid=o.sid||'default';const k=o.table+'_'+sid;
    if(!sessionMap[k])sessionMap[k]={tNum:o.table,sid,orders:[],meta};
    sessionMap[k].orders.push(o);
  });
  const sessions=Object.values(sessionMap).filter(({sid,meta})=>{
    const isCurrent=meta.sid===sid||(!meta.sid&&sid==='default');
    return isCurrent&&meta.status!=='closed';
  }).sort((a,b)=>{
    if(a.tNum!==b.tNum){const an=parseInt(a.tNum),bn=parseInt(b.tNum);const aIsNum=!isNaN(an),bIsNum=!isNaN(bn);if(aIsNum&&bIsNum)return an-bn;if(aIsNum)return-1;if(bIsNum)return 1;return String(a.tNum).localeCompare(String(b.tNum));}
    return(a.orders[0]?.createdAt||0)-(b.orders[0]?.createdAt||0);
  });
  if(!sessions.length){document.getElementById('tablesBillList').innerHTML=`<div class="empty"><div class="ei">🗓️</div><p>Нет заказов за ${dateLbl(S.viewDate)}</p></div>`;return;}
  document.getElementById('tablesBillList').innerHTML=sessions.map(({tNum,sid,orders:tOrdersRaw,meta})=>{
    const tOrders=tOrdersRaw.sort((a,b)=>a.createdAt-b.createdAt);
    const isCurrentSession=meta.sid===sid||(!meta.sid&&sid==='default');
    const isOpen=isCurrentSession&&meta.status!=='closed';
    const sumMap={};
    tOrders.forEach(o=>(o.items||[]).forEach(it=>{const k=it.name.trim().toLowerCase();if(!sumMap[k])sumMap[k]={name:it.name,qty:0,price:getItemPrice(it.name)};sumMap[k].qty+=it.qty;}));
    const sumItems=Object.values(sumMap).sort((a,b)=>a.name.localeCompare(b.name));
    const totalSum=sumItems.reduce((s,x)=>s+(x.price*x.qty),0);
    const sumLines=sumItems.map(x=>`<div class="sum-line"><span class="sum-item">${esc(x.name)}</span><span class="sum-cnt">${x.qty} шт.${x.price?` · <b style="color:var(--text)">${x.price*x.qty}₽</b>`:''}</span></div>`).join('')+(totalSum?`<div class="sum-line" style="border-top:2px solid var(--border);margin-top:6px;padding-top:6px;"><span class="sum-item" style="font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--accent);">ИТОГО</span><span class="sum-cnt" style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--accent);">${totalSum}₽</span></div>`:'');
    const loggedAt=meta.loggedAt||null;
    const ordersHtml=(()=>{
      const before=loggedAt?tOrders.filter(o=>o.createdAt<=loggedAt):tOrders;
      const after=loggedAt?tOrders.filter(o=>o.createdAt>loggedAt):[];
      const renderOrder=o=>{
        const sico={new:'🕐',making:'🍹',ready:'🟢',done:'✅'}[o.status]||'';
        const note=o.note?`<div class="tbo-note">💬 ${esc(o.note)}</div>`:'';
        const lines=(o.items||[]).map(it=>`<div class="tbo-line${it.status==='done'?' tl-done':''}"><span class="tl-name">${esc(it.name)}</span><span class="tl-qty">${it.qty} шт.</span></div>`).join('');
        return`<div class="tbo-item"><div class="tbo-hdr"><span class="tbo-num">#${o.num} ${sico}</span><span class="tbo-time">${fmt(o.createdAt)}</span><button class="btn-edit" data-action="edit" data-oid="${esc(o.id)}" data-bill="1" style="padding:3px 10px;font-size:11px;min-height:32px;">✏️</button></div><div class="tbo-lines">${lines}</div>${note}</div>`;
      };
      let html=before.map(renderOrder).join('');
      if(after.length)html+=`<div style="margin:8px 0;padding:6px 10px;background:rgba(245,166,35,.08);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;font-size:11px;color:var(--accent);">🆕 Дозаказ после внесения в систему (${fmt(loggedAt)})</div>`+after.map(renderOrder).join('');
      return html;
    })();
    const closedAt=isCurrentSession?meta.closedAt:undefined;
    const closedLbl=!isOpen&&closedAt?`<span style="font-size:10px;color:var(--muted);display:block;margin-top:3px;">Оплачен в ${fmt(closedAt)}</span>`:'';
    const totalItems=tOrders.reduce((s,o)=>s+(o.items?o.items.reduce((a,i)=>a+i.qty,0):0),0);
    const actions=isOpen
      ?`<div style="display:flex;gap:var(--sp-sm);flex-wrap:wrap;align-items:center;"><button class="btn-pay" data-action="closeTable" data-date="${S.viewDate}" data-tnum="${tNum}" data-sid="${sid}">💳 ЗАКРЫТЬ / ОПЛАЧЕН</button>${(S.role==='waiter'||S.role==='admin')?`<button onclick="showQR('${tNum}')" style="min-height:var(--touch);padding:0 14px;background:rgba(245,166,35,.12);color:var(--accent);border:1px solid rgba(245,166,35,.3);border-radius:8px;font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;cursor:pointer;">📱 QR</button>`:''}</div>`
      :`<button class="btn-reopen" data-action="reopenTable" data-date="${S.viewDate}" data-tnum="${tNum}">↩ Переоткрыть</button>`;
    const mgmtBtns=`<button class="btn-sm bu" data-action="renameTable" data-date="${S.viewDate}" data-tnum="${tNum}" data-sid="${sid}">✏️ Переименовать</button><button class="btn-sm bx" data-action="deleteTable" data-date="${S.viewDate}" data-tnum="${tNum}" data-sid="${sid}">🗑 Удалить стол</button>`;
    const loggedBtn=(S.role==='admin'||S.role==='waiter')&&isOpen?loggedAt?`<button class="btn-sm" style="background:rgba(76,175,80,.1);color:var(--green);border:1px solid rgba(76,175,80,.3);" data-action="unlogTable" data-date="${S.viewDate}" data-tnum="${tNum}">✅ Вбито в ${fmt2(loggedAt)} — отменить</button>`:`<button class="btn-sm bu" data-action="logTable" data-date="${S.viewDate}" data-tnum="${tNum}">📋 Вбили в систему</button>`:'';
    const cardId='tb-'+tNum+'_'+sid;
    return`<div class="table-bill ${isOpen?'':'closed'}" id="${cardId}"><div class="tb-header" onclick="toggleBill('${cardId}')"><div class="tb-left"><div class="tb-num"><small>СТОЛ</small>${tNum}</div><div class="tb-meta"><b>${tOrders.length} ${pl(tOrders.length,'заказ','заказа','заказов')} · ${totalItems} позиц.</b> с ${fmt(tOrders[0]?.createdAt)}${closedLbl}</div></div><div style="display:flex;align-items:center;gap:8px;"><span class="tb-st ${isOpen?'tb-open':'tb-closed'}">${isOpen?'🟢 Открыт':'✅ Оплачен'}</span><span class="tb-chev" id="chev-${cardId}">▼</span></div></div><div class="tb-body" id="body-${cardId}">${ordersHtml}<div class="tb-summary"><h4>📋 ИТОГО</h4>${sumLines||'<div style="color:var(--muted);font-size:12px">Нет позиций</div>'}</div><div class="tb-actions">${actions}${loggedBtn}${mgmtBtns}</div></div></div>`;
  }).join('');
}

export function renderClosed(){
  const lbl=document.getElementById('closedDateLabel');
  if(lbl)lbl.textContent=dateLbl(S.closedViewDate);
  const allDates=[...new Set(S.orders.map(o=>o.date).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
  const qnEl=document.getElementById('closedDateQuickNav');
  if(qnEl)qnEl.innerHTML=allDates.map(d=>`<button onclick="jumpClosedDate('${d}')" style="padding:5px 12px;border-radius:18px;border:1px solid ${d===S.closedViewDate?'var(--accent)':'var(--border)'};background:${d===S.closedViewDate?'var(--accent)':'transparent'};color:${d===S.closedViewDate?'#000':'var(--muted)'};font-size:11px;font-family:IBM Plex Mono,monospace;cursor:pointer;white-space:nowrap;">${dateLbl(d)}</button>`).join('');
  const listEl=document.getElementById('closedTablesList');if(!listEl)return;
  const dayOrders=S.orders.filter(o=>o.date===S.closedViewDate);
  const sessionMap={};
  dayOrders.forEach(o=>{
    const meta=getTMeta(S.closedViewDate,o.table);const sid=o.sid||'default';const k=o.table+'_'+sid;
    if(!sessionMap[k])sessionMap[k]={tNum:o.table,sid,orders:[],meta};sessionMap[k].orders.push(o);
  });
  const closedSessions=Object.values(sessionMap).filter(({tNum,sid,meta})=>{
    const isCurrent=meta.sid===sid||(!meta.sid&&sid==='default');
    const wasClosedInHistory=(meta.closedSessions||[]).some(s=>s.sid===sid);
    return(isCurrent&&meta.status==='closed')||wasClosedInHistory;
  }).sort((a,b)=>{
    const getCA=(s)=>{if(s.meta.sid===s.sid&&s.meta.closedAt)return s.meta.closedAt;const h=(s.meta.closedSessions||[]).find(x=>x.sid===s.sid);return h?.closedAt||0;};
    return getCA(b)-getCA(a);
  });
  if(!closedSessions.length){listEl.innerHTML=`<div class="empty"><div class="ei">🗓️</div><p>Нет закрытых столов за ${dateLbl(S.closedViewDate)}</p></div>`;return;}
  listEl.innerHTML=closedSessions.map(({tNum,sid,orders:tOrdersRaw,meta})=>{
    const tOrders=tOrdersRaw.sort((a,b)=>a.createdAt-b.createdAt);
    const isCurrent=meta.sid===sid||(!meta.sid&&sid==='default');
    const closedSessionHist=(meta.closedSessions||[]).find(s=>s.sid===sid);
    const closedAt=isCurrent?meta.closedAt:closedSessionHist?.closedAt;
    const sumMap={},pendingMap={};
    tOrders.forEach(o=>(o.items||[]).forEach(it=>{const k=it.name.trim().toLowerCase();if(it.status==='done'){if(!sumMap[k])sumMap[k]={name:it.name,qty:0,price:getItemPrice(it.name)};sumMap[k].qty+=it.qty;}else{if(!pendingMap[k])pendingMap[k]={name:it.name,qty:0};pendingMap[k].qty+=it.qty;}}));
    const doneItems=Object.values(sumMap).sort((a,b)=>a.name.localeCompare(b.name));
    const totalSum=doneItems.reduce((s,x)=>s+(x.price*x.qty),0);
    const sumLines=[...doneItems.map(x=>`<div class="sum-line"><span class="sum-item">${esc(x.name)}</span><span class="sum-cnt">${x.qty} шт.${x.price?` · <b style="color:var(--text)">${x.price*x.qty}₽</b>`:''}</span></div>`),...Object.values(pendingMap).sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`<div class="sum-line" style="opacity:.4;text-decoration:line-through;"><span class="sum-item">${esc(x.name)}</span><span class="sum-cnt">${x.qty} шт.</span></div>`),totalSum?`<div class="sum-line" style="border-top:2px solid var(--border);margin-top:6px;padding-top:6px;"><span class="sum-item" style="font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--accent);">ИТОГО</span><span class="sum-cnt" style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--accent);">${totalSum}₽</span></div>`:'' ].join('');
    const ordersHtml=tOrders.map(o=>{const sico={new:'🕐',making:'🍹',ready:'🟢',done:'✅'}[o.status]||'';const note=o.note?`<div class="tbo-note">💬 ${esc(o.note)}</div>`:'';const lines=(o.items||[]).map(it=>`<div class="tbo-line${it.status==='done'?' tl-done':''}"><span class="tl-name">${esc(it.name)}</span><span class="tl-qty">${it.qty} шт.</span></div>`).join('');return`<div class="tbo-item"><div class="tbo-hdr"><span class="tbo-num">#${o.num} ${sico}</span><span class="tbo-time">${fmt(o.createdAt)}</span><button class="btn-edit" data-action="edit" data-oid="${esc(o.id)}" data-bill="1" style="padding:3px 10px;font-size:11px;min-height:32px;">✏️</button></div><div class="tbo-lines">${lines}</div>${note}</div>`;}).join('');
    const totalItems=tOrders.reduce((s,o)=>s+(o.items?o.items.reduce((a,i)=>a+i.qty,0):0),0);
    const cardId='cl-'+tNum+'_'+sid;
    return`<div class="table-bill closed" id="${cardId}"><div class="tb-header" onclick="toggleBill('${cardId}')"><div class="tb-left"><div class="tb-num"><small>СТОЛ</small>${tNum}</div><div class="tb-meta"><b>${tOrders.length} ${pl(tOrders.length,'заказ','заказа','заказов')} · ${totalItems} позиц.</b> с ${fmt(tOrders[0]?.createdAt)}${closedAt?`<span style="color:var(--green);display:block;margin-top:2px;">✅ Закрыт в ${fmt(closedAt)}</span>`:''}</div></div><div style="display:flex;align-items:center;gap:8px;"><span class="tb-st tb-closed">✅ Оплачен</span><span class="tb-chev" id="chev-${cardId}">▼</span></div></div><div class="tb-body" id="body-${cardId}">${ordersHtml}<div class="tb-summary"><h4>📋 ИТОГО</h4>${sumLines||'<div style="color:var(--muted);font-size:12px">Нет позиций</div>'}</div><div class="tb-actions"><button class="btn-reopen" data-action="reopenTable" data-date="${S.closedViewDate}" data-tnum="${tNum}">↩ Переоткрыть</button><button class="btn-sm bu" data-action="renameTable" data-date="${S.closedViewDate}" data-tnum="${tNum}" data-sid="${sid}">✏️ Переименовать</button><button class="btn-sm bx" data-action="deleteTable" data-date="${S.closedViewDate}" data-tnum="${tNum}" data-sid="${sid}">🗑 Удалить стол</button></div></div></div>`;
  }).join('');
}
