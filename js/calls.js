import{S}from'./state.js';
import{db,ref,update}from'./firebase.js';
import{fl,showConfirm,setBadge,fmt,esc}from'./utils.js';

export function renderCalls(){
  const el=document.getElementById('callsContent');if(!el)return;
  const allCalls=Object.entries(S.waiterCallsData)
    .map(([id,c])=>({...c,_id:id}))
    .sort((a,b)=>(b.calledAt||0)-(a.calledAt||0));
  const pending=allCalls.filter(c=>c.status==='pending');
  setBadge('bC',pending.length);
  if(!allCalls.length){el.innerHTML=`<div class="empty"><div class="ei">🔔</div><p>Вызовов пока не было</p></div>`;return;}
  el.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--sp-md);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;color:var(--accent);">🔔 ВЫЗОВЫ ОФИЦИАНТА</div>
      <button onclick="clearCalls()" style="font-size:11px;color:var(--muted);background:transparent;border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer;">Очистить</button>
    </div>
    ${allCalls.map(c=>`
      <div style="background:var(--card);border:1px solid ${c.status==='pending'?'rgba(245,166,35,.4)':'var(--border)'};border-radius:var(--radius);padding:var(--sp-md);margin-bottom:var(--sp-sm);display:flex;align-items:center;justify-content:space-between;gap:var(--sp-sm);">
        <div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:var(--accent);">СТОЛ ${c.table}</div>
          <div style="font-size:11px;color:var(--muted);">${fmt(c.calledAt)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${c.status==='pending'
            ?`<button data-action="checkInCall" data-callid="${c._id}" style="min-height:40px;padding:6px 14px;background:rgba(76,175,80,.15);color:var(--green);border:1px solid rgba(76,175,80,.4);border-radius:8px;font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">✅ Подошёл</button>`
            :`<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:rgba(255,255,255,.06);color:var(--muted);">✓ Подошёл</span>`}
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
  await update(ref(db,'waiterCalls'),null);
  S.waiterCallsData={};renderCalls();
}
