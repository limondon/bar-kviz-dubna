import{S}from'./state.js';
import{callService}from'./firebase.js';

import{parseItems,todayStr,esc,escAttr,fl,showConfirm,lockScroll,unlockScroll}from'./utils.js';
import{buildQuickTableBtns,isInstantItem}from'./render.js';

// ─── ADD ORDER ────────────────────────────────────────
let pendingCreate=null;
const staffDraftKey='bar_staff_order_draft';
const staffFieldIds=['inpTable','inpItems','inpNote','inpPriority'];
function readStaffDraft(){
  return Object.fromEntries(staffFieldIds.map(id=>[id,document.getElementById(id)?.value||'']));
}
function isStaffDraft(d){
  return !!d&&typeof d==='object'&&typeof d.inpTable==='string'&&d.inpTable.length<=30&&typeof d.inpItems==='string'&&d.inpItems.length<=5000&&typeof d.inpNote==='string'&&d.inpNote.length<=1000&&['normal','urgent'].includes(d.inpPriority);
}
function saveStaffDraft(){
  if(pendingCreate)return;
  const draft=readStaffDraft();
  try{
    if(!draft.inpTable.trim()&&!draft.inpItems.trim()&&!draft.inpNote.trim()&&draft.inpPriority==='normal')sessionStorage.removeItem(staffDraftKey);
    else sessionStorage.setItem(staffDraftKey,JSON.stringify(draft));
  }catch{}
}
function clearStaffDraft(){try{sessionStorage.removeItem(staffDraftKey);}catch{}}
function restoreStaffDraft(){
  try{
    const saved=JSON.parse(sessionStorage.getItem(staffDraftKey)||'null');
    if(!isStaffDraft(saved))return;
    for(const id of staffFieldIds)document.getElementById(id).value=saved[id];
    buildQuickTableBtns();
  }catch{}
}
function syncPendingForm(){
  const locked=!!pendingCreate;S.pendingStaffOrder=locked;
  document.getElementById('staffOrderFields').inert=locked;
  for(const id of ['inpTable','inpItems','inpNote','inpPriority'])document.getElementById(id).disabled=locked;
  document.querySelector('.btn-add').textContent=locked?'ПРОВЕРИТЬ ОТПРАВКУ':'ДОБАВИТЬ ЗАКАЗ';
  document.getElementById('staffOrderStatus').textContent=locked?'Предыдущая отправка ещё не подтверждена. Нажмите «Проверить отправку»: повтор не создаст второй заказ.':'';
}
function restorePendingForm(){
  if(!pendingCreate)return;
  document.getElementById('inpTable').value=pendingCreate.table;
  document.getElementById('inpItems').value=pendingCreate.items.map(i=>`${i.qty} x ${i.name}`).join('\n');
  document.getElementById('inpNote').value=pendingCreate.note;
  document.getElementById('inpPriority').value=pendingCreate.priority;
}
export async function addOrder(){
  const btn=document.querySelector('.btn-add');if(btn?.disabled)return;
  if(btn)btn.disabled=true;
  try{
    restorePendingForm();
    if(!pendingCreate){
      const table=document.getElementById('inpTable').value.trim().toUpperCase();
      const items=parseItems(document.getElementById('inpItems').value.trim());
      if(!table||!items.length)throw new Error('Укажите стол и позиции');
      if(!S.tablesLoaded)throw new Error('Дождитесь загрузки столов перед отправкой заказа.');
      const date=todayStr(),meta=S.tablesMeta[date+'_'+table];
      const expectedSession=meta?{sid:meta.sid||'default',status:meta.status==='closed'?'closed':'open'}:null;
      pendingCreate={requestId:crypto.randomUUID(),table,date,expectedSession,items,note:document.getElementById('inpNote').value.trim(),priority:document.getElementById('inpPriority').value};
      try{sessionStorage.setItem('bar_pending_staff_order',JSON.stringify(pendingCreate));}
      catch{pendingCreate=null;throw new Error('Браузер не сохраняет состояние отправки. Разрешите хранилище для сайта и повторите.');}
    }
    syncPendingForm();
    const result=await callService('createStaffOrder',pendingCreate);
    pendingCreate=null;try{sessionStorage.removeItem('bar_pending_staff_order');}catch{}
    clearStaffDraft();
    fl('fOk','✅ Заказ #'+result.num+' создан');
    ['inpTable','inpItems','inpNote'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('inpPriority').value='normal';buildQuickTableBtns();
    if(S.role==='waiter')window.sw('queue');
  }catch(e){
    if(['functions/invalid-argument','functions/failed-precondition','functions/permission-denied','functions/aborted'].includes(e.code)){pendingCreate=null;try{sessionStorage.removeItem('bar_pending_staff_order');}catch{}}
    const maintenance=e.code==='functions/unavailable'&&/режим обслуживания/i.test(e.message||'');
    fl('fErr',pendingCreate?(maintenance?e.message+' После возобновления работы нажмите ещё раз.':'Не удалось подтвердить заказ. Нажмите ещё раз для проверки отправки.'):e.message);
  }finally{syncPendingForm();if(btn)btn.disabled=false;}
}
try{
  const saved=JSON.parse(sessionStorage.getItem('bar_pending_staff_order')||'null');
  if(saved&&typeof saved.table==='string'&&typeof saved.requestId==='string'&&Array.isArray(saved.items)&&saved.items.length&&saved.items.every(i=>i&&typeof i.name==='string'&&Number.isInteger(i.qty)))pendingCreate=saved;
}catch{}
if(pendingCreate)restorePendingForm();else restoreStaffDraft();
for(const id of staffFieldIds){
  const field=document.getElementById(id);
  field?.addEventListener(id==='inpPriority'?'change':'input',saveStaffDraft);
}
syncPendingForm();

// ─── ITEM ACTIONS ─────────────────────────────────────
const updating=new Set();
async function updateItems(o,changes){
  if(updating.has(o.id)||!changes.length)return false;
  updating.add(o.id);
  try{await callService('updateStaffItems',{requestId:crypto.randomUUID(),orderId:o.id,changes});return true;}
  catch(e){fl('fErr',e.message||'Не удалось подтвердить статус');return false;}
  finally{updating.delete(o.id);}
}
export async function barItemAction(orderId,itemFbKey,newStatus){
  const o=S.orders.find(x=>x.id===orderId),it=o?.items.find(x=>(x._fbKey||x.id)===itemFbKey);if(!it)return;
  await updateItems(o,[{id:it.id,from:it.status,to:newStatus}]);
}
export async function waiterDeliverItem(orderId,itemFbKey){
  const o=S.orders.find(x=>x.id===orderId),it=o?.items.find(x=>(x._fbKey||x.id)===itemFbKey);if(!it||it.status==='done')return;
  if(await updateItems(o,[{id:it.id,from:it.status,to:'done'}]))fl('fOk','Выдача подтверждена — стол '+o.table);
}
export async function waiterDeliverAll(orderId){
  const o=S.orders.find(x=>x.id===orderId);if(!o)return;
  const items=o.items.filter(it=>it.status!=='done'&&(it.status==='ready'||isInstantItem(it.name)));
  if(await updateItems(o,items.map(it=>({id:it.id,from:it.status,to:'done'}))))fl('fOk',`Выдано ${items.length} поз. — стол ${o.table}`);
}

export async function reopenOrder(id){
  const o=S.orders.find(x=>x.id===id);if(!o)return;
  await updateItems(o,o.items.filter(it=>it.status!=='new').map(it=>({id:it.id,from:it.status,to:'new'})));
}

const deleting=new Set();
export async function delOrder(id){
  if(deleting.has(id))return;
  const o=S.orders.find(x=>x.id===id);
  const ok=await showConfirm('Удалить заказ?',`Заказ #${o?.num||'?'} будет удалён. На склад вернутся только позиции, которые ещё не начали готовить.`);
  if(!ok)return;
  deleting.add(id);
  try{await callService('deleteStaffOrder',{requestId:'delete_'+id,orderId:id});}
  catch(e){fl('fErr',e.message||'Не удалось удалить заказ');}
  finally{deleting.delete(id);}
}

// ─── EDIT ORDER MODAL ─────────────────────────────────
let _editItems=[],_editOriginal=[],_editVersion=0,_savingEdit=false,_editRequest=null;

export function openEditModal(orderId,billMode=false){
  const o=S.orders.find(x=>x.id===orderId);if(!o)return;
  const doneItems=(o.items||[]).filter(it=>it.status==='done');
  const activeItems=(o.items||[]).filter(it=>it.status!=='done');
  if(!billMode&&activeItems.length===0)billMode=true;
  S.editOrderId=orderId;S.editBillMode=billMode;
  document.getElementById('editPriority').value=o.priority||'normal';
  document.getElementById('editNote').value=o.note||'';
  const sub=document.getElementById('editSub');
  let itemsToEdit;
  if(billMode){
    sub.innerHTML=`Заказ #${esc(o.num)} · Стол ${esc(o.table)}<br><span class="edit-sub-accent">📋 Цены и статусы сохранятся. Начатые позиции доступны только для просмотра.</span>`;
    itemsToEdit=(o.items||[]);
  } else {
    itemsToEdit=activeItems;
    if(doneItems.length)sub.innerHTML=`Заказ #${esc(o.num)} · Стол ${esc(o.table)}<br><span class="edit-sub-muted">✅ Доставлено: ${doneItems.map(it=>esc(it.qty)+'× '+esc(it.name)).join(', ')}</span>`;
    else sub.textContent='Заказ #'+o.num+' · Стол '+o.table;
  }
  _editOriginal=structuredClone(o.items);_editVersion=o.version||0;_editRequest=null;
  renderEditItemsList(itemsToEdit.map(it=>({...it})));
  document.getElementById('editOverlay').classList.remove('hidden');
  lockScroll();
}

function renderEditItemsList(items){
  const el=document.getElementById('editItemsList');if(!el)return;
  el.innerHTML=items.map((it,i)=>`
    <div class="edit-items-row" id="edit-row-${i}">
      <input class="edit-qty-input" type="number" value="${escAttr(it.qty)}" min="1" max="99" ${it.status&&it.status!=='new'||it.stockConsumed?'readonly':''} aria-label="Количество" onchange="updateEditRow(${i},'qty',+this.value)">
      <input class="edit-name-input" type="text" value="${escAttr(it.name)}" ${it.status&&it.status!=='new'||it.stockConsumed?'readonly':''} aria-label="Название" onchange="updateEditRow(${i},'name',this.value)">
      <button class="edit-remove-row" ${it.status&&it.status!=='new'||it.stockConsumed?'disabled':''} aria-label="Удалить позицию" onclick="removeEditRow(${i})">✕</button>
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
  if(_savingEdit||!S.editOrderId)return;
  const o=S.orders.find(x=>x.id===S.editOrderId);if(!o)return;
  _savingEdit=true;
  try{
    if(!_editRequest){
      const rows=_editItems.filter(i=>i.name.trim());
      if(!rows.length)throw new Error('Введите позиции');
      const done=S.editBillMode?[]:_editOriginal.filter(i=>i.status==='done');
      _editRequest={requestId:crypto.randomUUID(),orderId:o.id,expectedVersion:_editVersion,expectedItems:_editOriginal,items:[...done,...rows],note:document.getElementById('editNote').value.trim(),priority:document.getElementById('editPriority').value};
    }
    await callService('editStaffOrder',_editRequest);
    closeEditModal();fl('fOk','✅ Заказ #'+o.num+' обновлён');
  }catch(e){
    if(['functions/invalid-argument','functions/failed-precondition','functions/aborted','functions/not-found','functions/permission-denied'].includes(e.code))_editRequest=null;
    fl('fErr',e.message||'Не удалось подтвердить изменение. Повторите сохранение.');
  }finally{_savingEdit=false;}
}
