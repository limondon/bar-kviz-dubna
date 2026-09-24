import{S}from'./state.js';
import{db,auth,ref,update,set,remove,onValue,runTransaction,onAuthStateChanged}from'./firebase.js';
import{todayStr,normalizeOrder,fl,closeConfirmModal,confirmOk,setBadge}from'./utils.js';
import{registerSW,checkNewOrders,playBeep,notifMuted,swReg,updateNotifBtn}from'./notifications.js';
import{renderAll,startPoll}from'./render.js';
import{renderTables,renderClosed}from'./tables.js';
import{renderMenuPage}from'./menu.js';
import{renderStats}from'./render.js';
import{renderCalls}from'./calls.js';
import{barItemAction,waiterDeliverItem,waiterDeliverAll,reopenOrder,delOrder,openEditModal,closeEditModal,saveEditOrder,addOrder,updateEditRow,removeEditRow,addEditItem}from'./orders.js';
import{closeTable,reopenTable,renameTable,doRenameTable,deleteTable,logTable,unlogTable,showQR,closeQrModal,openQrPicker,closeQrPicker,closeRenameModal,confirmRename,shiftDate,jumpDate,shiftClosedDate,jumpClosedDate,toggleBill as _toggleBill,openCorkagePicker,closeCorkageModal,confirmCorkage,corkageAdj,toggleDatesExpanded,toggleClosedDatesExpanded,toggleQuickCorkage,_quickCorkagePick,editTableNote,openDeliveryLog,renderDeliveryLogSidebar}from'./tables.js';
import{sw,setQF,pickTable,openRoleModal,closeRoleModal,pickRole,confirmRole,applyRole,checkPassword,openPasswordModal,checkAuth,changePassword,buildTabs,toggleSettingsMenu,toggleBill}from'./ui.js';
import{openMenuPicker,closeMenuPicker,confirmMenuPicker,switchPickerCat,pickerToggleGroup,openMenuEditor,closeMenuEditor,updateMenuCatItem,removeMenuCatItem,addMenuCatItem,addMenuCategory,removeMenuCategory,moveMenuCat,renderMenuEditor,updateMenuItem,removeMenuItem,addNewMenuItem,buildMenuButtons,updateMenuCat,toggleMenuCatHidden,restructureLemonades,openItemEditor,closeItemEditor,saveItemEditor}from'./menu.js';
import{prepareQuiz,finishQuiz}from'./quiz.js';
import{checkInCall,clearCalls}from'./calls.js';
import{applyStockDeltas,deductMenuStock}from'./stock.js';
import{buildQuickTableBtns}from'./render.js';
import{enableNotifications}from'./notifications.js';

// Инициализируем даты в состоянии
S.viewDate=todayStr();
S.closedViewDate=todayStr();

// Делаем renderAll доступным глобально (нужен для deleteTable)
window.renderAll=renderAll;

// ─── FIREBASE LISTENERS ───────────────────────────────
let _ordersLoaded=false,_counterSeedDone=false,_counterConfigLoaded=false;
function _seedOrderCounter(){
  if(_counterSeedDone||!_ordersLoaded||!_counterConfigLoaded||!S.orders.length)return;
  const orders=S.orderNumResetAt?S.orders.filter(o=>(o.createdAt||0)>=S.orderNumResetAt):S.orders;
  if(!orders.length)return;
  _counterSeedDone=true;
  const maxNum=Math.max(...orders.map(o=>o.num||0),0);
  runTransaction(ref(db,'publicCounters/orderNum'),n=>Math.max(n||0,maxNum)).catch(e=>console.error('order counter seed',e));
}

async function loadAll(){
  const cutoffDate=(()=>{const d=new Date();d.setDate(d.getDate()-30);return d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0')+'-'+d.getDate().toString().padStart(2,'0');})();

  onValue(ref(db,'orders'),(snap)=>{
    const raw=snap.val();
    const rows=Object.entries(raw||{});
    const valid=rows.filter(([,o])=>o&&typeof o==='object'&&o.table&&o.table!=='undefined');
    if(valid.length!==rows.length)fl('fErr','Некоторые старые заказы не удалось отобразить. Исходные записи сохранены.');
    S.orders=valid.filter(([,o])=>!o.date||o.date>=cutoffDate).map(([id,o])=>normalizeOrder({...o,id}));
    _ordersLoaded=true;_seedOrderCounter();
    checkNewOrders(S.orders);
    renderAll();
  },(e)=>console.error(e));

  onValue(ref(db,'tables'),(snap)=>{
    S.tablesMeta=snap.val()||{};
    if(S.activeTab==='tables')renderTables();
    renderAll();
  });

  onValue(ref(db,'config/orderNumResetAt'),(snap)=>{S.orderNumResetAt=snap.val()||0;_counterConfigLoaded=true;_seedOrderCounter();});

  onValue(ref(db,'config/deliveryLog'),(snap)=>{
    const raw=snap.val()||{};
    const cutoff=Date.now()-24*60*60*1000;
    const cleanupUpd={};
    Object.entries(raw).forEach(([k,v])=>{if(!v||(v.at||0)<cutoff)cleanupUpd[`config/deliveryLog/${k}`]=null;});
    if(Object.keys(cleanupUpd).length)update(ref(db),cleanupUpd).catch(e=>console.error('deliveryLog cleanup',e));
    S.deliveryLog=Object.fromEntries(Object.entries(raw).filter(([k,v])=>v&&(v.at||0)>=cutoff));
    if(window.renderDeliveryLogSidebar)window.renderDeliveryLogSidebar();
  });

  onValue(ref(db,'menu2'),(snap)=>{
    const raw=snap.val();
    if(raw){
      const cats=Array.isArray(raw)?raw:Object.values(raw);
      S.BUILTIN_MENU_LIVE=cats.map(cat=>({...cat,items:Array.isArray(cat.items)?cat.items:Object.values(cat.items||{})}));
      if(S.activeTab==='menu')renderMenuPage();
    }else{S.BUILTIN_MENU_LIVE=[];fl('fErr','Меню в базе отсутствует. Проверьте данные перед приёмом заказов.');}
  });

  let knownWaiterCalls=new Set();
  onValue(ref(db,'waiterCalls'),(snap)=>{
    const raw=snap.val();
    S.waiterCallsData=raw||{};
    if(S.activeTab==='calls')renderCalls();
    const pending=Object.values(S.waiterCallsData).filter(c=>c.status==='pending');
    setBadge('bC',pending.length);
    if(!raw)return;
    Object.entries(raw).forEach(([id,call])=>{
      if(call.status==='pending'&&!knownWaiterCalls.has(id)){
        knownWaiterCalls.add(id);
        if((S.role==='waiter'||S.role==='admin')&&!notifMuted){
          if(navigator.vibrate)navigator.vibrate([200,100,200]);
          playBeep();
          const msg=`🔔 Стол ${call.table} зовёт официанта!`;
          if(swReg&&typeof Notification!=='undefined'&&Notification.permission==='granted')swReg.active?.postMessage({type:'NOTIFY_NEW_ORDER',table:call.table,count:'вызов'});
          else if(typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification('🔔 Вызов официанта!',{body:`Стол ${call.table} зовёт официанта`,icon:'icons/icon-192.png'});
          fl('fOk',msg);
        }
      }
    });
  });
}

// ─── CLICK DELEGATION ────────────────────────────────
document.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action],[data-st]');if(!btn)return;
  e.stopPropagation();
  const st=btn.dataset.st;
  if(st!==undefined){const oid=btn.dataset.oid,iid=btn.dataset.iid;if(oid&&iid)await barItemAction(oid,iid,st);return;}
  const action=btn.dataset.action;
  const oid=btn.dataset.oid,iid=btn.dataset.iid;
  const date=btn.dataset.date,tnum=btn.dataset.tnum,sid=btn.dataset.sid;
  if(action==='deliver'&&oid&&iid){await waiterDeliverItem(oid,iid);return;}
  if(action==='deliverall'&&oid){await waiterDeliverAll(oid);return;}
  if(action==='reopen'&&oid){await reopenOrder(oid);return;}
  if(action==='del'&&oid){await delOrder(oid);return;}
  if(action==='edit'&&oid){openEditModal(oid,btn.dataset.bill==='1');return;}
  if(action==='closeTable'&&date&&tnum&&sid){await closeTable(date,tnum,sid);return;}
  if(action==='reopenTable'&&date&&tnum){await reopenTable(date,tnum);return;}
  if(action==='renameTable'&&date&&tnum&&sid){await renameTable(date,tnum,sid);return;}
  if(action==='deleteTable'&&date&&tnum&&sid){await deleteTable(date,tnum,sid);return;}
  if(action==='logTable'&&date&&tnum){await logTable(date,tnum);return;}
  if(action==='unlogTable'&&date&&tnum){await unlogTable(date,tnum);return;}
  if(action==='checkInCall'){const callId=btn.dataset.callid;if(callId)await checkInCall(callId);return;}
});

// ─── RESET ORDER COUNTER ─────────────────────────────
async function resetOrderCounter(){
  const ok=await new Promise(resolve=>{
    const d=document.createElement('div');
    d.className='app-modal-overlay';
    d.innerHTML=`<div class="app-modal-panel compact">
      <div class="app-modal-title">СБРОСИТЬ СЧЁТЧИК?</div>
      <div class="app-modal-copy">Следующий заказ получит номер #1. Старые заказы не удалятся.</div>
      <div class="app-modal-actions center">
        <button id="_rcOk" class="app-modal-btn primary">СБРОСИТЬ</button>
        <button id="_rcNo" class="app-modal-btn">Отмена</button>
      </div></div>`;
    document.body.appendChild(d);
    d.querySelector('#_rcOk').onclick=()=>{document.body.removeChild(d);resolve(true);};
    d.querySelector('#_rcNo').onclick=()=>{document.body.removeChild(d);resolve(false);};
  });
  if(!ok)return;
  await set(ref(db,'config/orderNumResetAt'),Date.now());
  await set(ref(db,'publicCounters/orderNum'),0);
  fl('fOk','✅ Счётчик сброшен — следующий заказ будет #1');
}
window.resetOrderCounter=resetOrderCounter;

// ─── EXPOSE TO HTML ───────────────────────────────────
Object.assign(window,{
  pickRole,confirmRole,openRoleModal,closeRoleModal,checkPassword,changePassword,
  sw,addOrder,barItemAction,waiterDeliverItem,waiterDeliverAll,
  pickTable,enableNotifications,
  closeTable,reopenTable,reopenOrder,delOrder,setQF,toggleBill,shiftDate,jumpDate,
  renderTables,openEditModal,closeEditModal,saveEditOrder,
  shiftClosedDate,jumpClosedDate,renderClosed,
  renameTable,deleteTable,doRenameTable,closeRenameModal,confirmRename,
  closeConfirmModal,confirmOk,
  openMenuEditor,closeMenuEditor,addNewMenuItem,removeMenuItem,updateMenuItem,renderStats,renderMenuPage,
  updateMenuCatItem,removeMenuCatItem,addMenuCatItem,addMenuCategory,removeMenuCategory,moveMenuCat,updateMenuCat,toggleMenuCatHidden,
  openItemEditor,closeItemEditor,saveItemEditor,
  openMenuPicker,closeMenuPicker,confirmMenuPicker,switchPickerCat,pickerToggleGroup,
  showQR,closeQrModal,openQrPicker,closeQrPicker,openCorkagePicker,closeCorkageModal,confirmCorkage,corkageAdj,toggleDatesExpanded,toggleClosedDatesExpanded,toggleQuickCorkage,_quickCorkagePick,
  logTable,unlogTable,editTableNote,openDeliveryLog,renderDeliveryLogSidebar,
  prepareQuiz,finishQuiz,
  renderCalls,clearCalls,checkInCall,
  addEditItem,removeEditRow,updateEditRow,
  toggleSettingsMenu,restructureLemonades,
  buildQuickTableBtns,
});

// ─── BOOT ─────────────────────────────────────────────
function hideSplash(){const el=document.getElementById('splashScreen');if(!el)return;el.style.transition='opacity .2s';el.style.opacity='0';setTimeout(()=>el?.remove(),220);}

let _appStarted=false;
async function startApp(){
  if(_appStarted)return;
  _appStarted=true;
  await loadAll();
  startPoll();
}
window.startApp=startApp;

function waitAuthUser(timeout=3000){
  return new Promise(resolve=>{
    let done=false;
    const finish=user=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      unsub?.();
      resolve(user);
    };
    const timer=setTimeout(()=>finish(null),timeout);
    let unsub=null;
    unsub=onAuthStateChanged(auth,finish,()=>finish(null));
  });
}

(async()=>{
  registerSW();

  // Если роль и пароль уже известны — показываем UI сразу, без ожидания сети
  const staffUser=await waitAuthUser();
  if(!staffUser?.email){
    openPasswordModal();
    requestAnimationFrame(hideSplash);
    return;
  }

  // Firebase auth и пароль грузим в фоне
  const cachedRole=localStorage.getItem('bar_role');

  // Если не было кэша — проверяем авторизацию как обычно
  if(cachedRole){S.role=cachedRole;applyRole();}
  else openRoleModal();
  requestAnimationFrame(hideSplash);
  await startApp();
})();
