import{S}from'./state.js';
import{db,ref,update,remove}from'./firebase.js';
import{fl,showConfirm,setBadge,fmt,esc,escAttr}from'./utils.js';

export function renderCalls(){
  const el=document.getElementById('callsContent');if(!el)return;
  const allCalls=Object.entries(S.waiterCallsData)
    .map(([id,c])=>({...c,_id:id}))
    .sort((a,b)=>(b.calledAt||0)-(a.calledAt||0));
  const pending=allCalls.filter(c=>c.status==='pending');
  setBadge('bC',pending.length);
  if(!allCalls.length){el.innerHTML=`<div class="empty"><div class="ei">🔔</div><p>Вызовов пока не было</p></div>`;return;}
  el.innerHTML=`
    <div class="calls-head">
      <div class="calls-title">🔔 ВЫЗОВЫ ОФИЦИАНТА</div>
      <button onclick="clearCalls()" class="calls-clear">Очистить</button>
    </div>
    ${allCalls.map(c=>`
      <div class="call-card${c.status==='pending'?' pending':''}">
        <div>
          <div class="call-table">СТОЛ ${esc(c.table)}</div>
          <div class="call-time">${new Date(c.calledAt).toLocaleDateString('ru',{day:'2-digit',month:'2-digit'})} ${fmt(c.calledAt)}</div>
        </div>
        <div class="call-actions">
          ${c.status==='pending'
            ?`<button data-action="checkInCall" data-callid="${escAttr(c._id)}" class="call-checkin">✅ Подошёл</button>`
            :`<span class="call-done">✓ Подошёл</span>`}
        </div>
      </div>`).join('')}`;
}

export async function checkInCall(callId){
  await update(ref(db,'waiterCalls/'+callId),{status:'done'});
  fl('fOk','✅ Отмечено — подошли к столу');
}

export async function clearCalls(){
  const ok=await showConfirm('Очистить историю вызовов?','Все вызовы будут удалены.');
  if(!ok)return;
  await remove(ref(db,'waiterCalls'));
  S.waiterCallsData={};renderCalls();
}
