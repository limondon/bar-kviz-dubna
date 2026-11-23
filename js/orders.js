import{S}from'./state.js';
import{db,get,increment,ref,push,update,remove,runTransaction}from'./firebase.js';

function logDelivery(o,it){
  const key=push(ref(db,'config/deliveryLog')).key;
  const entry={at:Date.now(),table:o.table,orderNum:o.num,name:it.name,qty:it.qty};
  update(ref(db,'config/deliveryLog/'+key),entry).catch(e=>console.error('logDelivery',e));
}
import{parseItems,normalizeOrder,aggStatus,esc,escAttr,fl,showConfirm,todayStr,lockScroll,unlockScroll,itemKey}from'./utils.js';
import{applyStockDeltas,staffStockWrites}from'./stock.js';
import{genToken}from'./tables.js';
import{buildQuickTableBtns,isInstantItem,renderAll}from'./render.js';
import{nextOrderNum}from'./counters.js';
import{isCashCup}from'./cash-bill.js';
import{savedMenuPrice}from'./menu.js';

function withOrderPrice(item){
  const price=savedMenuPrice(item.name);
  return price===null?item:{...item,price};
}

// ─── ADD ORDER ────────────────────────────────────────
const staffDraftKey='bar_staff_order_draft';
const staffFieldIds=['inpTable','inpItems','inpNote','inpPriority'];
function saveStaffDraft(){
  const draft=Object.fromEntries(staffFieldIds.map(id=>[id,document.getElementById(id)?.value||'']));
  try{
    if(!draft.inpTable.trim()&&!draft.inpItems.trim()&&!draft.inpNote.trim()&&draft.inpPriority==='normal')sessionStorage.removeItem(staffDraftKey);
    else sessionStorage.setItem(staffDraftKey,JSON.stringify(draft));
  }catch{}
}
function clearStaffDraft(){try{sessionStorage.removeItem(staffDraftKey);}catch{}}
function restoreStaffDraft(){
  try{
    const d=JSON.parse(sessionStorage.getItem(staffDraftKey)||'null');
    if(!d||typeof d!=='object'||typeof d.inpTable!=='string'||d.inpTable.length>30||typeof d.inpItems!=='string'||d.inpItems.length>5000||typeof d.inpNote!=='string'||d.inpNote.length>1000||!['normal','urgent'].includes(d.inpPriority))return;
    for(const id of staffFieldIds)document.getElementById(id).value=d[id];
    buildQuickTableBtns();
  }catch{}
}
restoreStaffDraft();
for(const id of staffFieldIds)document.getElementById(id)?.addEventListener(id==='inpPriority'?'change':'input',saveStaffDraft);

async function saveStaffOrder(tNum,rawItems,items,note,prio){
  const date=todayStr(),tableKey=date+'_'+tNum;
  const signature=JSON.stringify([date,tNum,rawItems,note,prio]);
  const pendingKey='bar_staff_submission';
  const previous=JSON.parse(sessionStorage.getItem(pendingKey)||'null');
  const receipt=previous&&(await get(ref(db,'staffReceipts/'+previous.id))).val();
  if(previous&&receipt&&previous.signature!==signature){
    sessionStorage.removeItem(pendingKey);
    throw Error('Предыдущий заказ #'+receipt.num+' сохранён. Проверьте изменённый черновик перед отправкой.');
  }
  const id=previous?.signature===signature?previous.id:push(ref(db,'orders')).key;
  const num=receipt?.num||(previous?.signature===signature?previous.num:await nextOrderNum());
  if(!receipt){
    const meta=(await get(ref(db,'tables/'+tableKey))).val();
    const now=Date.now(),newVisit=!meta||meta.status==='closed';
    const sid=newVisit?id:(meta.sid||'default');
    const itemsObj=Object.fromEntries(items.map(it=>[it.id,it]));
    const {writes,stockRows}=staffStockWrites(items,increment);
    writes['orders/'+id]={id,table:tNum,items:itemsObj,note,priority:prio,status:'new',createdAt:now,num,date,sid,source:'staff'};
    writes['staffReceipts/'+id]={num,tableKey,sid,stockRows,previousStatus:meta?.status||'missing',previousSid:meta?.sid||'default',previousOpenedAt:meta?.openedAt||0};
    if(newVisit){
      const path='tables/'+tableKey+'/';
      if(meta&&!meta.closedSessions?.some(session=>session.sid===(meta.sid||'default'))){
        const history=meta.closedSessions||[];
        writes[path+'closedSessions/'+history.length]={sid:meta.sid||'default',closedAt:meta.closedAt||now,...(meta.openedAt?{openedAt:meta.openedAt}:{})};
      }
      for(const [field,value] of Object.entries({date,tNum,sid,status:'open',openedAt:now,token:genToken(),closedAt:null,autoClosed:null,loggedAt:null,note:null}))writes[path+field]=value;
    }
    sessionStorage.setItem(pendingKey,JSON.stringify({id,num,signature}));
    try{await update(ref(db),writes);}
    catch(error){
      if(!(await get(ref(db,'staffReceipts/'+id))).exists()){
        throw Error('Заказ не подтверждён. Проверьте стол, остатки и соединение перед повтором.');
      }
    }
  }
  sessionStorage.removeItem(pendingKey);
  return num;
}

export async function addOrder(){
  const btn=document.querySelector('.btn-add');
  if(btn.disabled)return;
  btn.disabled=true;
  const originalLabel=btn.textContent;
  const slow=setTimeout(()=>{btn.textContent='Ждём подтверждения…';},3000);
  const values=()=>staffFieldIds.map(id=>document.getElementById(id).value);
  const original=values();
  try{
    const tNum=original[0].trim().toUpperCase(),rawItems=original[1].trim();
    const note=original[2].trim(),prio=original[3];
    if(!tNum){fl('fInfo','Укажите номер стола!');return;}
    if(!rawItems){fl('fInfo','Введите позиции!');return;}
    if(/[.#$\[\]/]/.test(tNum))throw Error('В названии стола недопустимый символ.');
    const items=parseItems(rawItems).map(withOrderPrice);
    if(!items.length||items.some(item=>!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>100))throw Error('Количество каждой позиции должно быть от 1 до 100.');
    if(!S.BUILTIN_MENU_LIVE.length)throw Error('Меню ещё не загружено. Проверьте соединение и повторите.');
    const unpriced=items.filter(item=>item.price==null&&!isCashCup(item.name));
    if(unpriced.length){
      const names=[...new Set(unpriced.map(item=>item.name))].join(', ');
      const ok=await showConfirm('Позиции без цены',names+'. Их стоимость не войдёт в итог стола, пока цена не будет указана.','Добавить без цены');
      if(!ok)return;
    }
    const num=await saveStaffOrder(tNum,rawItems,items,note,prio);
    fl('fOk','✅ Заказ #'+num+' — Стол '+tNum+' ('+items.length+' поз.)');
    if(values().some((value,index)=>value!==original[index]))return;
    ['inpTable','inpItems','inpNote'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('inpPriority').value='normal';
    clearStaffDraft();
    buildQuickTableBtns();
    if(S.role==='waiter')window.sw('queue');
  }catch(e){
    console.error('addOrder',e);
    fl('fErr',e?.message||'Ошибка создания заказа');
  }finally{
    clearTimeout(slow);btn.textContent=originalLabel;btn.disabled=false;
  }
}

// ─── ITEM ACTIONS ─────────────────────────────────────
const pendingOrders=new Set();
const pendingLines=S.pendingItemActions;
const lineKey=it=>it._fbKey||it.id;
const sameLine=(a,b)=>a&&b&&a.name===b.name&&Number(a.qty)===Number(b.qty)&&a.status===b.status;
// Re-read the order inside Firebase's transaction. An old click cannot recreate
// a deleted row or overwrite a newer status; unrelated rows stay untouched.
async function saveLineStatuses(o,changes){
  if(!changes.length)return false;
  const keys=changes.map(({item})=>lineKey(item));
  const busy=pendingLines.get(o.id)||new Map();
  if(pendingOrders.has(o.id)||keys.some(key=>busy.has(key)&&busy.get(key).phase!=='confirmed')){fl('fInfo','Сохраняется предыдущее действие. Дождись подтверждения.');return false;}
  const actions=new Map(changes.map(({item,status})=>[lineKey(item),{phase:'saving',fromStatus:item.status,orderStatus:o.status,targetStatus:status}]));
  // Keep the tapped row/card's space while its controls change to feedback.
  // Otherwise a two-button row can collapse and pull the next button upward.
  for(const row of document.querySelectorAll('.item-row[data-render-key]')){
    const key=changes.find(({item})=>row.dataset.renderKey===JSON.stringify(['line',o.id,lineKey(item)]));
    if(!key)continue;
    const action=actions.get(lineKey(key.item)),height=row.getBoundingClientRect().height;
    if(!height)continue;
    action.rowHeight=Math.max(action.rowHeight||0,height);
    const card=row.closest('.order-card');
    if(card){action.cardHeights??=new Map();action.cardHeights.set(card.dataset.renderKey,card.getBoundingClientRect().height);}
  }
  actions.forEach((action,key)=>busy.set(key,action));
  pendingLines.set(o.id,busy);
  renderAll();
  const release=()=>{
    actions.forEach((action,key)=>{if(busy.get(key)===action)busy.delete(key);});
    if(!busy.size&&pendingLines.get(o.id)===busy)pendingLines.delete(o.id);
    renderAll();
  };
  // A slow acknowledgement is not a failed write: keep the lock until the
  // transaction really settles, otherwise a retry can race its late result.
  const slowTimer=setTimeout(()=>{
    keys.forEach(key=>{const action=busy.get(key);if(action)action.phase='slow';});
    renderAll();
  },5000);
  let confirmed=false;
  try{
    const now=Date.now();
    const result=await runTransaction(ref(db,'orders/'+o.id),raw=>{
      if(!raw)return;
      const current=normalizeOrder({...raw});
      if(changes.some(({item})=>!sameLine(item,current.items.find(it=>lineKey(it)===lineKey(item)))))return;
      for(const {item,status}of changes){
        const it=current.items.find(it=>lineKey(it)===lineKey(item));
        it.status=status;
        if(status==='new'){delete it.makingAt;delete it.readyAt;delete it.doneAt;}
        if(status==='making'){it.makingAt=now;delete it.readyAt;delete it.doneAt;}
        if(status==='ready'){it.readyAt=now;delete it.doneAt;}
        if(status==='done')it.doneAt=now;
      }
      const status=aggStatus(current.items);
      const next={...raw,items:itemsToDbObject(current.items),status};
      if(status==='done')next.doneAt=now;else delete next.doneAt;
      return next;
    },{applyLocally:false});
    if(!result.committed){fl('fInfo','Заказ уже изменился. Проверь актуальные позиции и повтори действие.');return false;}
    confirmed=true;
    keys.forEach(key=>busy.get(key).phase='confirmed');
    renderAll();
    return result.snapshot.val();
  }catch(e){console.error('saveLineStatuses',e);fl('fErr','❌ Не удалось обновить статус — проверь интернет');return false;}
  finally{
    clearTimeout(slowTimer);
    // Keep an acknowledged row briefly in place: a repeated tap must not
    // become a delivery of the next row when this one disappears.
    if(confirmed)setTimeout(release,800);else release();
  }
}

export async function barItemAction(orderId,itemFbKey,newStatus){
  const o=S.orders.find(x=>x.id===orderId);if(!o)return;
  const it=o.items.find(x=>(x._fbKey||x.id)===itemFbKey);if(!it)return;
  if(!({new:['making','ready'],making:['ready','new'],ready:['making']}[it.status]||[]).includes(newStatus))return;
  const saved=await saveLineStatuses(o,[{item:it,status:newStatus}]);
  if(saved?.status==='ready'&&o.status!=='ready')fl('fOk','🟢 Стол '+o.table+' — всё готово! Официант, забирай!');
}

export async function waiterDeliverItem(orderId,itemFbKey){
  const o=S.orders.find(x=>x.id===orderId);if(!o)return;
  const it=o.items.find(x=>(x._fbKey||x.id)===itemFbKey);if(!it)return;
  if(it.status==='done')return;
  if(it.status!=='ready'&&!isInstantItem(it.name))return;
  if(!await saveLineStatuses(o,[{item:it,status:'done'}]))return;
  logDelivery(o,it);
  fl('fOk','✅ '+it.qty+'× '+it.name+' → Стол '+o.table);
}

export async function waiterDeliverAll(orderId){
  const o=S.orders.find(x=>x.id===orderId);if(!o)return;
  const delivered=o.items.filter(it=>it.status!=='done'&&(it.status==='ready'||isInstantItem(it.name)));
  if(!await saveLineStatuses(o,delivered.map(item=>({item,status:'done'}))))return;
  delivered.forEach(it=>logDelivery(o,it));
  fl('fOk','✅ '+delivered.length+' позиц. доставлены — Стол '+o.table);
}

export async function reopenOrder(id){
  const o=S.orders.find(x=>x.id===id);if(!o)return;
  await saveLineStatuses(o,o.items.map(item=>({item,status:'new'})));
}

export async function delOrder(id){
  const o=S.orders.find(x=>x.id===id);
  const ok=await showConfirm('🗑 Удалить заказ?',`Заказ #${o?.num||'?'} будет удалён безвозвратно.`);
  if(!ok)return;
  let stockReturned=false;
  try{
    if(o&&Array.isArray(o.items)){
      await applyStockDeltas(o.items.map(it=>({name:it.name,delta:-it.qty})));
      stockReturned=true;
    }
    await remove(ref(db,'orders/'+id));
  }catch(e){
    if(stockReturned&&o&&Array.isArray(o.items)){
      await applyStockDeltas(o.items.map(it=>({name:it.name,delta:it.qty}))).catch(err=>console.error('stock rollback failed:',err));
    }
    console.error('delOrder error:',e);
    fl('fInfo','❌ Ошибка удаления: '+(e?.message||e));
  }
}

// ─── EDIT ORDER MODAL ─────────────────────────────────
let _editItems=[];
let _editVersion='';
const editVersion=o=>JSON.stringify([itemsToDbObject(o.items),o.note||'',o.priority||'normal']);

function buildStockDeltas(beforeItems,afterItems){
  const map=new Map();
  const add=(it,sign)=>{
    const key=itemKey(it.name);
    if(!key)return;
    const qty=Math.max(0,Number(it.qty)||0);
    if(!qty)return;
    const row=map.get(key)||{name:it.name,delta:0};
    row.delta+=sign*qty;
    map.set(key,row);
  };
  (beforeItems||[]).forEach(it=>add(it,-1));
  (afterItems||[]).forEach(it=>add(it,1));
  return [...map.values()].filter(it=>it.delta!==0);
}
function itemsToDbObject(items){
  const itemsObj={};
  items.forEach(it=>{
    const k=it._fbKey||it.id;
    const{_fbKey,...clean}=it;
    itemsObj[k]=clean;
  });
  return itemsObj;
}
function orderSnapshot(o){
  return {
    items:Object.fromEntries(o.items.map(it=>{
      const{_fbKey,...clean}=it;
      return[it._fbKey||it.id,clean];
    })),
    note:o.note||'',
    priority:o.priority||'normal',
    editedAt:Date.now(),
    editedBy:S.role||'unknown'
  };
}
async function rollbackStockDeltas(stockDeltas){
  if(stockDeltas.length)await applyStockDeltas(stockDeltas.map(it=>({name:it.name,delta:-it.delta})));
}

export function openEditModal(orderId,billMode=false){
  const o=S.orders.find(x=>x.id===orderId);if(!o)return;
  const doneItems=(o.items||[]).filter(it=>it.status==='done');
  const activeItems=(o.items||[]).filter(it=>it.status!=='done');
  if(!billMode&&activeItems.length===0)billMode=true;
  S.editOrderId=orderId;S.editBillMode=billMode;
  _editVersion=editVersion(o);
  document.getElementById('editPriority').value=o.priority||'normal';
  document.getElementById('editNote').value=o.note||'';
  const sub=document.getElementById('editSub');
  let itemsToEdit;
  if(billMode){
    sub.innerHTML=`Заказ #${esc(o.num)} · Стол ${esc(o.table)}<br><span class="edit-sub-accent">📋 Правка чека — позиции сохранятся как доставленные</span>`;
    itemsToEdit=(o.items||[]);
  } else {
    itemsToEdit=activeItems;
    if(doneItems.length)sub.innerHTML=`Заказ #${esc(o.num)} · Стол ${esc(o.table)}<br><span class="edit-sub-muted">✅ Доставлено: ${doneItems.map(it=>esc(it.qty)+'× '+esc(it.name)).join(', ')}</span>`;
    else sub.textContent='Заказ #'+o.num+' · Стол '+o.table;
  }
  renderEditItemsList(itemsToEdit.map(it=>({...it})));
  document.getElementById('editOverlay').classList.remove('hidden');
  lockScroll();
}

function renderEditItemsList(items){
  const el=document.getElementById('editItemsList');if(!el)return;
  el.innerHTML=items.map((it,i)=>`
    <div class="edit-items-row" id="edit-row-${i}">
      <input class="edit-qty-input" type="number" value="${escAttr(it.qty)}" min="1" max="99" onchange="updateEditRow(${i},'qty',+this.value)">
      <input class="edit-name-input" type="text" value="${escAttr(it.name)}" onchange="updateEditRow(${i},'name',this.value)">
      <button class="edit-remove-row" onclick="removeEditRow(${i})">✕</button>
    </div>`).join('');
  syncEditItemsToTextarea(items);
}

export function updateEditRow(i,field,val){if(!_editItems[i])return;_editItems[i][field]=val;syncEditItemsToTextarea(_editItems);}
export function removeEditRow(i){_editItems.splice(i,1);renderEditItemsList(_editItems);}
export function addEditItem(){
  _editItems.push({qty:1,name:''});renderEditItemsList(_editItems);
  setTimeout(()=>{const rows=document.querySelectorAll('#editItemsList [type=text]');if(rows.length)rows[rows.length-1].focus();},50);
}
function syncEditItemsToTextarea(items){
  _editItems=items.map(it=>({...it}));
  const ta=document.getElementById('editItems');
  if(ta)ta.value=items.filter(it=>it.name.trim()).map(it=>`${it.qty} ${it.name}`).join('\n');
}

export function closeEditModal(){
  document.getElementById('editOverlay').classList.add('hidden');
  unlockScroll();
  S.editOrderId=null;S.editBillMode=false;
}

export async function saveEditOrder(){
  if(!S.editOrderId){fl('fInfo','❌ ID заказа не найден');return;}
  const o=S.orders.find(x=>x.id===S.editOrderId);
  if(!o){fl('fInfo','❌ Заказ не найден');return;}
  if(pendingOrders.has(o.id)||pendingLines.has(o.id)){fl('fInfo','Сохраняется предыдущее действие. Дождись подтверждения.');return;}
  if(editVersion(o)!==_editVersion){fl('fInfo','Заказ изменился. Закрой правку и открой заказ заново.');return;}
  const rawItems=document.getElementById('editItems').value.trim();
  const note=document.getElementById('editNote').value.trim();
  const prio=document.getElementById('editPriority').value;
  if(!rawItems){fl('fInfo','Введите позиции!');return;}
  const originalItems=Array.isArray(o.items)?o.items:[];
  const billMode=S.editBillMode,expectedVersion=_editVersion,orderId=o.id;
  // Keep IDs, prices, modifiers and progress of unchanged editor rows.
  const parsed=parseItems(rawItems);
  const editorRows=_editItems.filter(it=>it.name.trim());
  const editedItems=parsed.flatMap((it,i)=>{
    const source=originalItems.find(old=>lineKey(old)===lineKey(editorRows[i]||{}));
    if(source&&source.name===it.name&&Number(source.qty)===it.qty)return {...source,...(billMode?{status:'done',doneAt:source.doneAt||Date.now()}:{})};
    if(source&&source.name===it.name){
      if(!billMode&&it.qty>Number(source.qty)&&['making','ready'].includes(source.status)){
        // Keep the started batch intact; only the added quantity needs preparation.
        // Do not copy its database key or progress timestamps onto the new line.
        const extra={...source,id:it.id,qty:it.qty-Number(source.qty),status:'new'};
        delete extra._fbKey;delete extra.makingAt;delete extra.readyAt;delete extra.doneAt;
        return [{...source},extra];
      }
      const changed={...source,qty:it.qty,status:billMode?'done':'new'};
      delete changed.makingAt;delete changed.readyAt;delete changed.doneAt;
      if(billMode)changed.doneAt=Date.now();
      return changed;
    }
    const added=withOrderPrice(it);
    return billMode?{...added,status:'done',doneAt:Date.now()}:added;
  });
  let mergedItems,stockDeltas;
  if(billMode){
    mergedItems=editedItems;
    stockDeltas=buildStockDeltas(originalItems,mergedItems);
  } else {
    const doneItems=originalItems.filter(it=>it.status==='done');
    mergedItems=[...doneItems,...editedItems];
    stockDeltas=buildStockDeltas(originalItems.filter(it=>it.status!=='done'),editedItems);
  }
  const itemsObj=itemsToDbObject(mergedItems);
  let stockApplied=false;
  pendingOrders.add(orderId);
  try{
    if(stockDeltas.length){await applyStockDeltas(stockDeltas);stockApplied=true;}
    const snapshot=orderSnapshot(o);
    const result=await runTransaction(ref(db,'orders/'+orderId),raw=>{
      if(!raw||editVersion(normalizeOrder({...raw}))!==expectedVersion)return;
      const status=aggStatus(mergedItems);
      const next={...raw,items:itemsObj,note,priority:prio,status,history:{...raw.history,[snapshot.editedAt]:snapshot}};
      if(status==='done')next.doneAt=raw.doneAt||Date.now();else delete next.doneAt;
      return next;
    },{applyLocally:false});
    if(!result.committed)throw new Error('Заказ изменился. Закрой правку и открой заказ заново.');
    closeEditModal();fl('fOk','✅ Заказ #'+o.num+' обновлён');
  }catch(e){
    if(stockApplied)await rollbackStockDeltas(stockDeltas).catch(err=>console.error('stock rollback failed:',err));
    console.error('saveEditOrder error:',e);
    fl('fInfo','❌ Ошибка: '+e.message);
  }finally{pendingOrders.delete(orderId);}
}
