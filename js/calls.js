import{S}from'./state.js';
import{callService}from'./firebase.js';
import{fl,showConfirm,setBadge,fmt,esc,escAttr,todayStr}from'./utils.js';

export function isPendingCall(c){const m=S.tablesMeta[c?.date+'_'+c?.table];return c?.status==='pending'&&c.date===todayStr()&&!!m&&m.status!=='closed'&&(m.sid||'default')===(c.sid||'default');}
export function renderCalls(){
  const el=document.getElementById('callsContent');if(!el)return;
  const allCalls=Object.entries(S.waiterCallsData)
    .map(([id,c])=>({...c,_id:id}))
    .sort((a,b)=>(b.calledAt||0)-(a.calledAt||0));
  const pending=allCalls.filter(isPendingCall);
  setBadge('bC',pending.length);
  if(!allCalls.length){el.innerHTML=`<div class="empty"><div class="ei">🔔</div><p>Вызовов пока не было</p></div>`;return;}
  el.innerHTML=`
    <div class="calls-head">
      <div class="calls-title">🔔 ВЫЗОВЫ ОФИЦИАНТА</div>
      <button onclick="clearCalls()" class="calls-clear">Очистить завершённые</button>
    </div>
    ${allCalls.map(c=>`
      <div class="call-card${isPendingCall(c)?' pending':''}">
        <div>
          <div class="call-table">СТОЛ ${esc(c.table)}</div>
          <div class="call-time">${new Date(c.calledAt).toLocaleDateString('ru',{day:'2-digit',month:'2-digit'})} ${fmt(c.calledAt)}</div>
        </div>
        <div class="call-actions">
          ${isPendingCall(c)
            ?`<button data-action="checkInCall" data-callid="${escAttr(c._id)}" class="call-checkin">✅ Подошёл</button>`
            :`<span class="call-done">${c.status==='done'?'✓ Подошёл':'Сессия завершена'}</span>`}
        </div>
      </div>`).join('')}`;
}

const checking=new Set();
export async function checkInCall(callId){
  if(checking.has(callId))return;checking.add(callId);
  try{await callService('checkInStaffCall',{requestId:'check_'+callId,callId});fl('fOk','✅ Отмечено — подошли к столу');}
  catch(e){fl('fErr',e.message||'Не удалось подтвердить вызов');}
  finally{checking.delete(callId);}
}
export async function clearCalls(){
  const ids=Object.entries(S.waiterCallsData).filter(([,c])=>c&&!isPendingCall(c)).map(([id])=>id).slice(0,1000);
  if(!ids.length){fl('fInfo','Нет завершённых вызовов для очистки');return;}
  if(!await showConfirm('Очистить завершённые вызовы?',`Будет удалено до ${ids.length} записей. Ожидающие вызовы сохранятся.`))return;
  try{await callService('clearStaffCalls',{requestId:crypto.randomUUID(),ids});fl('fOk','История завершённых вызовов очищена');}
  catch(e){fl('fErr',e.message||'Не удалось очистить историю');}
}
