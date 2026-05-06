import{S}from'./state.js';
import{db,ref,push,update,set,remove}from'./firebase.js';
import{parseItems,aggStatus,esc,fl,showConfirm,todayStr}from'./utils.js';
import{applyStockDeltas,deductMenuStock}from'./stock.js';
import{getTMeta}from'./tables.js';
import{buildQuickTableBtns,isInstantItem}from'./render.js';

// ─── ADD ORDER ────────────────────────────────────────
export async function addOrder(){
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
      const tNum=tableRaw;const items=parseItems(rawItems);
      if(!items.length){fl('fInfo','Не удалось распознать позиции!');}
      else{
        const num=(S.orders.length?Math.max(...S.orders.map(o=>o.num||0)):0)+1;
        const date=todayStr();
        const existingMeta=getTMeta(date,tNum);
        if(existingMeta.status==='closed'){
          const newSid=Date.now().toString(36);
          existingMeta.sessions=existingMeta.sessions||[];
          existingMeta.sessions.push({sid:existingMeta.sid,closedAt:existingMeta.closedAt,openedAt:existingMeta.openedAt});
          existingMeta.sid=newSid;existingMeta.status='open';existingMeta.openedAt=Date.now();
          delete existingMeta.closedAt;
        }
        const sid=existingMeta.sid||(existingMeta.sid=Date.now().toString(36));
        const newRef=push(ref(db,'orders'));
        const itemsObj={};items.forEach(it=>itemsObj[it.id]=it);
        const newOrder={id:newRef.key,table:tNum,items:itemsObj,note,priority:prio,status:'new',createdAt:Date.now(),num,date,sid};
        await update(ref(db,'orders/'+newRef.key),newOrder);
        await update(ref(db,'tables'),S.tablesMeta);
        await deductMenuStock(items);
        fl('fOk','✅ Заказ #'+num+' — Стол '+tNum+' ('+items.length+' поз.)');
        ['inpTable','inpItems','inpNote'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('inpPriority').value='normal';
        buildQuickTableBtns();
        if(S.role==='waiter')window.sw('queue');
      }
    }
  }finally{if(btn){btn.disabled=false;btn.style.opacity='';}}
}

// ─── ITEM ACTIONS ─────────────────────────────────────
export async function barItemAction(orderId,itemFbKey,newStatus){
  const o=S.orders.find(x=>x.id===orderId);if(!o)return;
  const it=o.items.find(x=>(x._fbKey||x.id)===itemFbKey);if(!it)return;
  it.status=newStatus;
  if(newStatus==='making')it.makingAt=Date.now();
  if(newStatus==='ready')it.readyAt=Date.now();
  if(newStatus==='new'){delete it.makingAt;delete it.readyAt;}
  const prev=o.status;o.status=aggStatus(o.items);
  if(o.status==='ready'&&prev!=='ready')fl('fOk','🟢 Стол '+o.table+' — всё готово! Официант, забирай!');
  const fbKey=it._fbKey||it.id;const upd={};
  upd[`orders/${orderId}/items/${fbKey}/status`]=newStatus;
  if(newStatus==='making')upd[`orders/${orderId}/items/${fbKey}/makingAt`]=it.makingAt;
  if(newStatus==='ready')upd[`orders/${orderId}/items/${fbKey}/readyAt`]=it.readyAt;
  if(newStatus==='new'){upd[`orders/${orderId}/items/${fbKey}/makingAt`]=null;upd[`orders/${orderId}/items/${fbKey}/readyAt`]=null;}
  await update(ref(db),upd);
}

export async function waiterDeliverItem(orderId,itemFbKey){
  const o=S.orders.find(x=>x.id===orderId);if(!o)return;
  const it=o.items.find(x=>(x._fbKey||x.id)===itemFbKey);if(!it)return;
  if(it.status==='done')return;
  if(it.status!=='ready'&&!isInstantItem(it.name))return;
  it.status='done';it.doneAt=Date.now();
  o.status=aggStatus(o.items);
  const fbKey=it._fbKey||it.id;
  const upd={[`orders/${orderId}/items/${fbKey}/status`]:'done',[`orders/${orderId}/items/${fbKey}/doneAt`]:it.doneAt};
  if(o.status==='done'){o.doneAt=Date.now();upd[`orders/${orderId}/doneAt`]=o.doneAt;}
  await update(ref(db),upd);
  fl('fOk','✅ '+it.qty+'× '+it.name+' → Стол '+o.table);
}

export async function waiterDeliverAll(orderId){
  const o=S.orders.find(x=>x.id===orderId);if(!o)return;
  let count=0;const upd={};
  o.items.forEach(it=>{
    if(it.status==='done')return;
    if(it.status==='ready'||isInstantItem(it.name)){
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

export async function reopenOrder(id){
  const o=S.orders.find(x=>x.id===id);if(!o)return;
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
  await applyStockDeltas(o.items.map(it=>({name:it.name,delta:-it.qty})));
}

export async function delOrder(id){
  const o=S.orders.find(x=>x.id===id);
  const ok=await showConfirm('🗑 Удалить заказ?',`Заказ #${o?.num||'?'} будет удалён безвозвратно.`);
  if(!ok)return;
  if(o&&Array.isArray(o.items)){
    const toRestore=o.items.filter(it=>it.status!=='done');
    if(toRestore.length)await applyStockDeltas(toRestore.map(it=>({name:it.name,delta:-it.qty})));
  }
  await remove(ref(db,'orders/'+id));
}

// ─── EDIT ORDER MODAL ─────────────────────────────────
let _editItems=[];

export function openEditModal(orderId,billMode=false){
  const o=S.orders.find(x=>x.id===orderId);if(!o)return;
  S.editOrderId=orderId;S.editBillMode=billMode;
  document.getElementById('editPriority').value=o.priority||'normal';
  document.getElementById('editNote').value=o.note||'';
  const doneItems=(o.items||[]).filter(it=>it.status==='done');
  const activeItems=(o.items||[]).filter(it=>it.status!=='done');
  const sub=document.getElementById('editSub');
  let itemsToEdit;
  if(billMode){
    sub.innerHTML=`Заказ #${o.num} · Стол ${o.table}<br><span style="color:var(--accent);font-size:10px;">📋 Правка чека — позиции сохранятся как доставленные</span>`;
    itemsToEdit=(o.items||[]);
  } else {
    itemsToEdit=activeItems;
    if(doneItems.length)sub.innerHTML=`Заказ #${o.num} · Стол ${o.table}<br><span style="color:var(--muted);font-size:10px;">✅ Доставлено: ${doneItems.map(it=>it.qty+'× '+it.name).join(', ')}</span>`;
    else sub.textContent='Заказ #'+o.num+' · Стол '+o.table;
  }
  renderEditItemsList(itemsToEdit.map(it=>({qty:it.qty,name:it.name})));
  document.getElementById('editOverlay').classList.remove('hidden');
}

function renderEditItemsList(items){
  const el=document.getElementById('editItemsList');if(!el)return;
  el.innerHTML=items.map((it,i)=>`
    <div style="display:flex;align-items:center;gap:8px;" id="edit-row-${i}">
      <input type="number" value="${it.qty}" min="1" max="99"
        style="width:52px;text-align:center;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--accent);font-family:'Bebas Neue',sans-serif;font-size:20px;"
        onchange="updateEditRow(${i},'qty',+this.value)">
      <input type="text" value="${esc(it.name)}"
        style="flex:1;padding:9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:'IBM Plex Mono',monospace;font-size:13px;"
        onchange="updateEditRow(${i},'name',this.value)">
      <button onclick="removeEditRow(${i})" style="width:36px;height:36px;min-width:36px;border-radius:6px;background:rgba(229,57,53,.15);color:var(--red);border:1px solid rgba(229,57,53,.3);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">✕</button>
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
  S.editOrderId=null;S.editBillMode=false;
}

export async function saveEditOrder(){
  if(!S.editOrderId){fl('fInfo','❌ ID заказа не найден');return;}
  const o=S.orders.find(x=>x.id===S.editOrderId);
  if(!o){fl('fInfo','❌ Заказ не найден');return;}
  const rawItems=document.getElementById('editItems').value.trim();
  const note=document.getElementById('editNote').value.trim();
  const prio=document.getElementById('editPriority').value;
  if(!rawItems){fl('fInfo','Введите позиции!');return;}
  let mergedItems;
  if(S.editBillMode){
    const parsed=parseItems(rawItems);
    mergedItems=parsed.map(it=>({...it,status:'done',doneAt:Date.now()}));
  } else {
    const doneItems=o.items.filter(it=>it.status==='done');
    const newParsed=parseItems(rawItems);
    mergedItems=[...doneItems,...newParsed];
    // Считаем дельту стока
    const origNonDone=o.items.filter(it=>it.status!=='done');
    const origMap={};for(const it of origNonDone){const k=it.name.trim().toLowerCase();origMap[k]=(origMap[k]||0)+it.qty;}
    const newMap={};for(const it of newParsed){const k=it.name.trim().toLowerCase();newMap[k]=(newMap[k]||0)+it.qty;}
    const allNames=new Set([...Object.keys(origMap),...Object.keys(newMap)]);
    const stockDeltas=[];
    for(const k of allNames){const delta=(newMap[k]||0)-(origMap[k]||0);if(delta!==0)stockDeltas.push({name:k,delta});}
    const itemsObj={};
    mergedItems.forEach(it=>{const k=it._fbKey||it.id;const{_fbKey,...clean}=it;itemsObj[k]=clean;});
    try{
      const snapshot={items:Object.fromEntries(o.items.map(it=>{const{_fbKey,...clean}=it;return[it._fbKey||it.id,clean];})),note:o.note||'',priority:o.priority||'normal',editedAt:Date.now(),editedBy:S.role||'unknown'};
      await set(ref(db,'orders/'+S.editOrderId+'/history/'+Date.now()),snapshot);
      await set(ref(db,'orders/'+S.editOrderId+'/items'),itemsObj);
      await update(ref(db,'orders/'+S.editOrderId),{note,priority:prio});
      if(stockDeltas.length)await applyStockDeltas(stockDeltas);
      closeEditModal();fl('fOk','✅ Заказ #'+o.num+' обновлён');
    }catch(e){console.error('saveEditOrder error:',e);fl('fInfo','❌ Ошибка: '+e.message);}
    return;
  }
  const itemsObj={};mergedItems.forEach(it=>{const k=it._fbKey||it.id;const{_fbKey,...clean}=it;itemsObj[k]=clean;});
  try{
    const snapshot={items:Object.fromEntries(o.items.map(it=>{const{_fbKey,...clean}=it;return[it._fbKey||it.id,clean];})),note:o.note||'',priority:o.priority||'normal',editedAt:Date.now(),editedBy:S.role||'unknown'};
    await set(ref(db,'orders/'+S.editOrderId+'/history/'+Date.now()),snapshot);
    await set(ref(db,'orders/'+S.editOrderId+'/items'),itemsObj);
    await update(ref(db,'orders/'+S.editOrderId),{note,priority:prio});
    closeEditModal();fl('fOk','✅ Заказ #'+o.num+' обновлён');
  }catch(e){console.error('saveEditOrder error:',e);fl('fInfo','❌ Ошибка: '+e.message);}
}
