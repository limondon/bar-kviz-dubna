import{S}from'./state.js';
import{db,auth,ref,update,set,remove,onValue,signInAnonymously}from'./firebase.js';
import{todayStr,normalizeOrder,fl,closeConfirmModal,confirmOk,setBadge}from'./utils.js';
import{BUILTIN_MENU}from'./menu-data.js';
import{registerSW,checkNewOrders,playBeep,notifMuted,swReg,updateNotifBtn}from'./notifications.js';
import{renderAll,startPoll}from'./render.js';
import{renderTables,renderClosed}from'./tables.js';
import{renderMenuPage}from'./menu.js';
import{renderStats}from'./render.js';
import{renderCalls}from'./calls.js';
import{barItemAction,waiterDeliverItem,waiterDeliverAll,reopenOrder,delOrder,openEditModal,closeEditModal,saveEditOrder,addOrder,updateEditRow,removeEditRow,addEditItem}from'./orders.js';
import{closeTable,reopenTable,renameTable,doRenameTable,deleteTable,logTable,unlogTable,showQR,closeQrModal,openQrPicker,closeQrPicker,closeRenameModal,confirmRename,shiftDate,jumpDate,shiftClosedDate,jumpClosedDate,toggleBill as _toggleBill}from'./tables.js';
import{sw,setQF,pickTable,openRoleModal,closeRoleModal,pickRole,confirmRole,applyRole,checkPassword,openPasswordModal,checkAuth,changePassword,buildTabs,toggleSettingsMenu,toggleBill}from'./ui.js';
import{openMenuPicker,closeMenuPicker,confirmMenuPicker,switchPickerCat,pickerToggleGroup,openMenuEditor,closeMenuEditor,updateMenuCatItem,removeMenuCatItem,addMenuCatItem,addMenuCategory,removeMenuCategory,moveMenuCat,renderMenuEditor,updateMenuItem,removeMenuItem,addNewMenuItem,buildMenuButtons}from'./menu.js';
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
async function loadAll(){
  const cutoffDate=(()=>{const d=new Date();d.setDate(d.getDate()-30);return d.getFullYear()+'-'+(d.getMonth()+1).toString().padStart(2,'0')+'-'+d.getDate().toString().padStart(2,'0');})();

  onValue(ref(db,'orders'),(snap)=>{
    const raw=snap.val();
    if(raw){
      const cleanupUpd={};
      Object.entries(raw).forEach(([orderId,o])=>{
        if(o.items&&typeof o.items==='object'&&!Array.isArray(o.items)){
          Object.entries(o.items).forEach(([k,v])=>{if(!v||typeof v!=='object'||!v.name)cleanupUpd[`orders/${orderId}/items/${k}`]=null;});
        }
      });
      if(Object.keys(cleanupUpd).length>0)update(ref(db),cleanupUpd).catch(e=>console.error('cleanup',e));
    }
    S.orders=raw?Object.values(raw).filter(o=>!o.date||o.date>=cutoffDate).map(normalizeOrder):[];
    checkNewOrders(S.orders);
    renderAll();
  },(e)=>console.error(e));

  onValue(ref(db,'tables'),(snap)=>{
    S.tablesMeta=snap.val()||{};
    if(S.activeTab==='tables')renderTables();
  });

  onValue(ref(db,'menu2'),(snap)=>{
    const raw=snap.val();
    if(!raw){
      set(ref(db,'menu2'),BUILTIN_MENU).catch(e=>console.error('menu seed',e));
    } else {
      const cats=Array.isArray(raw)?raw:Object.values(raw);
      S.BUILTIN_MENU_LIVE=cats.map(cat=>({...cat,items:Array.isArray(cat.items)?cat.items:Object.values(cat.items||{})}));
      if(S.activeTab==='menu')renderMenuPage();
    }
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
          if(swReg&&Notification.permission==='granted')swReg.active?.postMessage({type:'NOTIFY_NEW_ORDER',table:call.table,count:'вызов'});
          else if(Notification.permission==='granted')new Notification('🔔 Вызов официанта!',{body:`Стол ${call.table} зовёт официанта`,icon:'icon-192.png'});
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
  updateMenuCatItem,removeMenuCatItem,addMenuCatItem,addMenuCategory,removeMenuCategory,moveMenuCat,
  openMenuPicker,closeMenuPicker,confirmMenuPicker,switchPickerCat,pickerToggleGroup,
  showQR,closeQrModal,openQrPicker,closeQrPicker,
  logTable,unlogTable,
  prepareQuiz,finishQuiz,
  renderCalls,clearCalls,checkInCall,
  addEditItem,removeEditRow,updateEditRow,
  toggleSettingsMenu,
  buildQuickTableBtns,
});

// ─── BOOT ─────────────────────────────────────────────
(async()=>{
  registerSW();
  try{await signInAnonymously(auth);}catch(e){console.error('Auth error:',e);}

  try{
    const passSnap=await new Promise(resolve=>{const unsub=onValue(ref(db,'config/password'),snap=>{unsub();resolve(snap);});});
    S.appPassword=passSnap.val()||null;
  }catch(e){console.error('Password load error:',e);}

  if(!checkAuth()){openPasswordModal();}
  else{const sr=localStorage.getItem('bar_role');if(sr){S.role=sr;applyRole();}else openRoleModal();}

  await loadAll();
  startPoll();
})();
