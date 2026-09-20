import{S}from'./state.js';
import{initArchive}from'./archive.js';
import{db,auth,ref,onValue,onAuthStateChanged,callService}from'./firebase.js';
import{todayStr,normalizeOrder,fl,closeConfirmModal,confirmOk,setBadge,showConfirm}from'./utils.js';
import{registerSW,checkNewOrders,playBeep,notifMuted,swReg,updateNotifBtn,hasRemotePush}from'./notifications.js';
import{renderAll,startPoll}from'./render.js';
import{renderTables,renderClosed}from'./tables.js';
import{renderMenuPage,refreshMenuFromServer}from'./menu.js';
import{renderStats}from'./render.js';
import{renderCalls,isPendingCall}from'./calls.js';
import{barItemAction,waiterDeliverItem,waiterDeliverAll,reopenOrder,delOrder,openEditModal,closeEditModal,saveEditOrder,addOrder,updateEditRow,removeEditRow,addEditItem}from'./orders.js';
import{closeTable,reopenTable,renameTable,doRenameTable,deleteTable,logTable,unlogTable,showQR,closeQrModal,openQrPicker,closeQrPicker,closeRenameModal,confirmRename,shiftDate,jumpDate,shiftClosedDate,jumpClosedDate,toggleBill as _toggleBill,openCorkagePicker,closeCorkageModal,confirmCorkage,corkageAdj,toggleDatesExpanded,toggleClosedDatesExpanded,toggleQuickCorkage,_quickCorkagePick,editTableNote,openDeliveryLog,renderDeliveryLogSidebar}from'./tables.js';
import{sw,setQF,pickTable,openRoleModal,closeRoleModal,pickRole,confirmRole,applyRole,checkPassword,openPasswordModal,checkAuth,changePassword,buildTabs,toggleSettingsMenu,toggleBill}from'./ui.js';
import{openMenuPicker,closeMenuPicker,confirmMenuPicker,switchPickerCat,pickerToggleGroup,openMenuEditor,closeMenuEditor,updateMenuCatItem,removeMenuCatItem,addMenuCatItem,addMenuCategory,removeMenuCategory,moveMenuCat,renderMenuEditor,updateMenuItem,removeMenuItem,addNewMenuItem,buildMenuButtons,updateMenuCat,toggleMenuCatHidden,restructureLemonades,openItemEditor,closeItemEditor,saveItemEditor}from'./menu.js';
import{prepareQuiz,finishQuiz}from'./quiz.js';
import{checkInCall,clearCalls}from'./calls.js';
import{buildQuickTableBtns}from'./render.js';
import{enableNotifications}from'./notifications.js';

// Инициализируем даты в состоянии
S.viewDate=todayStr();
S.closedViewDate=todayStr();
initArchive();

// Делаем renderAll доступным глобально (нужен для deleteTable)
window.renderAll=renderAll;

// ─── FIREBASE LISTENERS ───────────────────────────────
let _ordersLoaded=false,_tablesLoaded=false,_selfHealDone=false,_counterSeedDone=false,_counterConfigLoaded=false;
function renderMaintenance(){
  const banner=document.getElementById('maintenanceBanner'),text=document.getElementById('maintenanceText'),resume=document.getElementById('maintenanceResume');
  if(!banner||!text||!resume)return;
  const active=S.maintenance?.enabled===true;banner.hidden=!active;
  text.textContent=active?(S.maintenance.reason||'Новые действия временно остановлены.'):'Новые действия временно остановлены.';
  resume.hidden=!(active&&S.role==='admin');
}
async function toggleMaintenanceMode(){
  if(S.role!=='admin'){fl('fErr','Режим обслуживания доступен менеджеру');return;}
  const current=S.maintenance?.enabled===true,enable=!current;
  const ok=await showConfirm(enable?'НАЧАТЬ ОБСЛУЖИВАНИЕ?':'ВОЗОБНОВИТЬ РАБОТУ?',enable?'Новые заказы и изменения будут остановлены. Просмотр данных останется доступен.':'Сотрудники и гости снова смогут отправлять заказы и изменять данные.',enable?'ОСТАНОВИТЬ ОПЕРАЦИИ':'ВОЗОБНОВИТЬ');
  if(!ok)return;
  try{
    const result=await callService('setMaintenanceMode',{requestId:crypto.randomUUID(),enabled:enable,expectedEnabled:current,reason:'Обновление системы'});
    S.maintenance=result.maintenance||null;renderMaintenance();fl('fOk',enable?'Операции остановлены':'Работа возобновлена');
  }catch(error){fl('fErr',error?.message||'Не удалось изменить режим обслуживания');}
}
async function loadAll(){

  onValue(ref(db,'maintenance'),snap=>{S.maintenance=snap.val();renderMaintenance();});

  onValue(ref(db,'orders'),(snap)=>{
    const raw=snap.val();
    const unreadable=[];
    S.orders=Object.entries(raw||{}).flatMap(([key,value])=>{
      try{
        if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid order');
        return [normalizeOrder({...value,id:value.id||key})];
      }catch{unreadable.push(key);return [];}
    });
    const warning=document.getElementById('orderDataWarning');
    warning.hidden=!unreadable.length;
    warning.textContent=unreadable.length?`Не удалось прочитать ${unreadable.length} записей заказов. Очередь и суммы могут быть неполными. Нужна проверка данных: ${unreadable.join(', ')}. Записи не удалены.`:'';
    _ordersLoaded=true;
    checkNewOrders(S.orders);
    renderAll();
  },(e)=>console.error(e));

  onValue(ref(db,'tables'),(snap)=>{
    S.tablesMeta=snap.val()||{};
    S.tablesLoaded=true;
    _tablesLoaded=true;
    if(S.activeTab==='tables')renderTables();
    renderAll();
  });

  onValue(ref(db,'config/orderNumResetAt'),(snap)=>{S.orderNumResetAt=snap.val()||0;_counterConfigLoaded=true;});

  onValue(ref(db,'config/deliveryLog'),(snap)=>{
    const raw=snap.val()||{};
    const cutoff=Date.now()-24*60*60*1000;
    S.deliveryLog=Object.fromEntries(Object.entries(raw).filter(([k,v])=>v&&(v.at||0)>=cutoff));
    if(window.renderDeliveryLogSidebar)window.renderDeliveryLogSidebar();
  });

  onValue(ref(db,'menu2'),(snap)=>{
    const cats=Object.values(snap.val()||{}).filter(Boolean).map(cat=>({...cat,items:Object.values(cat.items||{}).filter(Boolean)}));
    S.menuBaseline=structuredClone(cats);
    S.BUILTIN_MENU_LIVE=cats.map((cat,ci)=>({...cat,items:cat.items.map((item,ii)=>({...item,_originPath:ci+'/'+ii}))}));
    if(S.activeTab==='menu')refreshMenuFromServer();
  });

  onValue(ref(db,'config/quizSession'),snap=>{S.quizSession=snap.val();});
  let knownWaiterCalls=new Set();
  onValue(ref(db,'waiterCalls'),(snap)=>{
    const raw=snap.val();
    S.waiterCallsData=raw||{};
    if(S.activeTab==='calls')renderCalls();
    const pending=Object.values(S.waiterCallsData).filter(isPendingCall);
    setBadge('bC',pending.length);
    if(!raw)return;
    Object.entries(raw).forEach(([id,call])=>{
      if(isPendingCall(call)&&!knownWaiterCalls.has(id)){
        knownWaiterCalls.add(id);
        if((S.role==='waiter'||S.role==='admin')&&!notifMuted){
          if(navigator.vibrate)navigator.vibrate([200,100,200]);
          playBeep();
          const msg=`🔔 Стол ${call.table} зовёт официанта!`;
          if(!hasRemotePush()){
            if(swReg&&Notification.permission==='granted')swReg.active?.postMessage({type:'NOTIFY_WAITER_CALL',table:call.table});
            else if(Notification.permission==='granted')new Notification('🔔 Вызов официанта!',{body:`Стол ${call.table} зовёт официанта`,icon:'icons/icon-192.png'});
          }
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
  if(action==='reopenTable'&&date&&tnum&&sid){await reopenTable(date,tnum,sid);return;}
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
  await callService('resetStaffCounter',{requestId:crypto.randomUUID()});
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
  toggleMaintenanceMode,renderMaintenance,
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
