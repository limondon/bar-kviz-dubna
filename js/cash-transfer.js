import{S}from'./state.js';
import{db,auth,ref,onValue,runTransaction}from'./firebase.js';
import{esc,escAttr,lockScroll,unlockScroll,itemKey,itemExtraPrice}from'./utils.js';
import{cashPath,buildCashBill,queueCashBill}from'./cash-bill.js';

const labels={queued:'Передан — ожидает выбора на кассе',opening:'Касса выполняет открытие. Повторная отправка заблокирована',opened:'Открыт на кассе. Оплата подтверждается отдельно',unknown:'Результат открытия неизвестен. Проверьте текущий чек на кассе',rejected:'Касса отклонила открытие. Проверьте причину на Эвоторе'};
let active=null;
function priceFor(name){
  const matches=S.BUILTIN_MENU_LIVE.flatMap(c=>c.items||[]).filter(i=>itemKey(i.name)===itemKey(name));
  if(matches.length!==1||matches[0].price==null||matches[0].price==='')return null;
  const price=Number(matches[0].price);return Number.isFinite(price)&&price>=0?price+itemExtraPrice(name):null;
}
function currentBill(date,table,sid){
  const meta=S.tablesMeta[date+'_'+table];
  if(!meta||meta.status==='closed'||(meta.sid||'default')!==sid)throw Error('Это посещение стола уже закрыто или заменено.');
  return buildCashBill({date,table,sid,orders:S.orders,priceFor});
}
export async function openCashTransfer(date,table,sid){
  if(active||!['admin','waiter'].includes(S.role)||auth.currentUser?.email!=='manager@1708.local')return;
  let bill;try{bill=await currentBill(date,table,sid);}catch(e){window.alert(e.message);return;}
  if(active)return;
  const panel=document.createElement('div');panel.className='app-modal-overlay';
  panel.innerHTML=`<section class="app-modal-panel" role="dialog" aria-modal="true" aria-label="Передать счёт на кассу"><h3>Стол ${esc(table)} · передача на Эвотор</h3><p>Снимок счёта: ${bill.rows.length} строк, ${(bill.total/100).toLocaleString('ru-RU')} ₽. Кружки исключены.</p>${bill.estimated?'<p>В старых заказах нет сохранённой цены. Использована текущая цена меню — проверьте сумму.</p>':''}<p>Состав можно обновить до открытия чека. После начала открытия повторная передача этого посещения заблокирована, включая дозаказы. Сначала завершите проверку на кассе.</p><div class="cash-transfer-lines">${bill.rows.map(r=>`<p>${esc(r[3])} ×${r[4]} — ${r[4]*r[5]/100} ₽</p>`).join('')}</div><p class="cash-transfer-status" role="status">Проверяю состояние передачи…</p><div class="app-modal-actions"><button class="app-modal-btn" data-cash-close>Закрыть</button><button class="app-modal-btn primary" data-cash-send disabled>Передать на кассу</button></div></section>`;
  document.body.appendChild(panel);lockScroll();
  const cashDate=document.createElement('p');cashDate.className='cash-transfer-day';
  cashDate.textContent='На Эвоторе выберите дату '+bill.date+' и нажмите «Обновить список».';
  panel.querySelector('h3').after(cashDate);
  const status=panel.querySelector('[role=status]'),send=panel.querySelector('[data-cash-send]'),closeButton=panel.querySelector('[data-cash-close]');
  let loading=true,pending=false,remote=null,closed=false,stale=false,timer;
  const refresh=()=>{send.disabled=loading||pending||stale||!!(remote&&remote.state!=='queued');send.textContent=remote?.state==='queued'?'Обновить состав счёта':'Передать на кассу';closeButton.textContent=pending?'Скрыть окно':'Закрыть';};
  // Hiding the window does not cancel a pending write. Retrying always reuses the same server slot.
  const close=()=>{closed=true;clearTimeout(timer);unsubscribe();panel.remove();active=null;unlockScroll();};
  const unsubscribe=onValue(ref(db,`${cashPath}/${date}/${bill.id}`),snapshot=>{
    remote=snapshot.val();loading=false;if(!pending)status.textContent=remote?(labels[remote.state]||'Неизвестный статус. Проверьте кассу.'):'Счёт ещё не передан.';refresh();
  },()=>{loading=true;status.textContent='Нет доступа к состоянию передачи. Проверьте вход и соединение.';refresh();});
  active={close};panel.querySelector('[data-cash-close]').onclick=close;
  send.onclick=async()=>{
    if(send.disabled)return;
    pending=true;refresh();status.textContent='Отправляю. Жду подтверждения базы…';
    // This timeout never implies the write failed. The same deterministic slot is used for every retry.
    timer=setTimeout(()=>{if(!closed)status.textContent='Подтверждения пока нет. Передача может выполняться. Повторять нажатие не нужно.';},12000);
    try{
      const fresh=await currentBill(date,table,sid);
      if(fresh.digest!==bill.digest){stale=true;throw Error('Состав или цена изменились. Закройте окно и заново проверьте счёт.');}
      const saved=await runTransaction(ref(db,`${cashPath}/${date}/${bill.id}`),current=>queueCashBill(current,bill,Date.now()),{applyLocally:false});
      status.textContent=saved.committed?'Передан — ожидает выбора на кассе. Стол не отмечен оплаченным.':(labels[saved.snapshot.val()?.state]||'Передача уже выполняется. Проверьте кассу.');
    }catch(e){status.textContent='Не удалось подтвердить передачу: '+e.message;}
    finally{clearTimeout(timer);pending=false;refresh();}
  };
}
