import{S}from'./state.js';
import{db,auth,ref,get,onValue,runTransaction}from'./firebase.js';
import{esc,lockScroll,unlockScroll}from'./utils.js';
import{savedMenuPrice}from'./menu.js';
import{summarizeTableItems}from'./tables.js';
import{cashPath,buildCashBill,queueCashBill}from'./cash-bill.js';
import{cashDevicesPath}from'./cash-rules.js';
import{checkCashRows}from'./cash-preflight.js';
import{openCashSettings}from'./cash-settings.js';

const labels={queued:'Передан — ожидает выбора на кассе',cleared:'Прежний чек очищен на кассе. Обновите состав счёта перед повторным открытием.',opening:'Касса выполняет открытие. Повторная отправка заблокирована',opened:'Открыт на кассе. Оплата подтверждается отдельно',unknown:'Результат открытия неизвестен. Проверьте текущий чек на кассе',rejected:'Касса отклонила открытие. Проверьте причину на Эвоторе'};
function transferStatus(record,bill){
  if(!record)return 'Счёт ещё не передан.';
  const postponed=record.state==='cleared'&&record.recoveryKind==='postponed';
  const status=postponed?'Стол отложен. На Эвоторе выберите его и нажмите «Продолжить счёт».':labels[record.state]||'Неизвестный статус. Проверьте кассу.';
  if(record.digest===bill.digest)return status;
  const next=['queued','cleared'].includes(record.state)?'Обновите состав перед открытием на кассе.':'Сверьте изменения на кассе перед расчётом.';
  return status+' Состав на сайте отличается от последней передачи. '+next;
}
let active=null;
function currentBill(date,table,sid){
  const meta=S.tablesMeta[date+'_'+table];
  if(!meta||meta.status==='closed'||(meta.sid||'default')!==sid)throw Error('Это посещение стола уже закрыто или заменено.');
  return buildCashBill({date,table,sid,orders:S.orders,priceFor:savedMenuPrice});
}
export async function openCashTransfer(date,table,sid,previousDevice=''){
  if(active||!['admin','waiter'].includes(S.role)||auth.currentUser?.email!=='manager@1708.local')return;
  let bill;try{bill=await currentBill(date,table,sid);}catch(e){window.alert(e.message);return;}
  if(active)return;
  const panel=document.createElement('div');panel.className='app-modal-overlay cash-transfer';
  const summary=summarizeTableItems(bill.rows.map(([, ,productId,name,qty,kopecks])=>({productId,name,qty,price:kopecks/100})));
  panel.innerHTML=`<section class="app-modal-panel" role="dialog" aria-modal="true" aria-label="Передать счёт на кассу"><h3>Стол ${esc(table)} · передача на Эвотор</h3><p>На сайте: ${summary.length} строк, ${(bill.total/100).toLocaleString('ru-RU')} ₽. Кружки исключены.</p>${bill.estimated?'<p>В старых заказах нет сохранённой цены. Использована текущая цена меню — проверьте сумму.</p>':''}<div class="cash-transfer-lines">${summary.map(row=>`<p>${esc(row.name)} ×${row.qty} — ${row.kopecks/100} ₽</p>`).join('')}</div><p class="cash-transfer-status" role="status">Проверяю состояние передачи…</p><div class="app-modal-actions"><button class="app-modal-btn" data-cash-close>Закрыть</button><button class="app-modal-btn primary" data-cash-send disabled>Передать на кассу</button></div></section>`;
  document.body.appendChild(panel);lockScroll();
  const cashDate=document.createElement('p');cashDate.className='cash-transfer-day';
  cashDate.textContent='Дата счёта на кассе · '+bill.date;
  panel.querySelector('h3').after(cashDate);
  const status=panel.querySelector('[role=status]'),send=panel.querySelector('[data-cash-send]'),closeButton=panel.querySelector('[data-cash-close]');
  const check=document.createElement('div');check.className='cash-preflight';
  check.innerHTML='<label hidden>Касса для проверки <select></select></label><p role="status"></p><ul></ul><button class="app-modal-btn" data-recheck>Проверить снова</button> <button class="app-modal-btn" data-settings>Касса Эвотор</button>';
  status.before(check);
  const deviceSelect=check.querySelector('select'),report=check.querySelector('p'),issues=check.querySelector('ul'),retry=check.querySelector('[data-recheck]'),settingsButton=check.querySelector('[data-settings]');
  let loading=true,pending=false,remote=null,closed=false,stale=false,timer;
  let ready=false,checking=false,deviceId=previousDevice;
  const refresh=()=>{send.disabled=!ready||checking||loading||pending||stale||!!(remote&&!['queued','cleared'].includes(remote.state));send.textContent=['queued','cleared'].includes(remote?.state)?'Обновить состав счёта':'Передать на кассу';closeButton.textContent=pending?'Скрыть окно':'Закрыть';retry.disabled=deviceSelect.disabled=settingsButton.disabled=pending||checking;};
  async function verify(beforeSend=false){
    ready=false;checking=true;issues.replaceChildren();report.textContent='Сверяю позиции с каталогом Эвотора…';
    retry.hidden=true;settingsButton.hidden=true;refresh();
    try{
      let device;
      if(beforeSend){
        device=(await get(ref(db,cashDevicesPath+'/'+deviceId))).val();
        if(!device||device.registration?.archived===true)throw Error('Выбранная касса больше недоступна. Проверьте список касс снова.');
      }else{
        const records=(await get(ref(db,cashDevicesPath))).val()||{};
        const devices=Object.entries(records).filter(([,d])=>d&&d.registration?.archived!==true);
        if(closed)return false;
        deviceSelect.replaceChildren(new Option('Выберите кассу',''),...devices.map(([id,d])=>{
          const name=d.catalog?.deviceName||'Эвотор',suffix=id.slice(0,8);
          return new Option(name.includes(suffix)?name:name+' · '+suffix,id);
        }));
        deviceSelect.parentElement.hidden=devices.length<2;
        if(!devices.some(([id])=>id===deviceId))deviceId=devices.length===1?devices[0][0]:'';
        deviceSelect.value=deviceId;
        if(!devices.length)throw Error('Нет активной кассы. В разделе «Касса Эвотор» проверьте регистрацию и получите каталог с терминала.');
        if(!deviceId)throw Error('Выберите кассу, на которой сотрудник откроет этот счёт.');
        device=records[deviceId];
      }
      const problems=await checkCashRows(bill.rows,device);
      if(closed)return false;
      for(const message of problems){const li=document.createElement('li');li.textContent=message;issues.append(li);}
      ready=!problems.length;
      if(ready)report.textContent='Позиции и цены проверены по каталогу «'+(device.catalog.deviceName||deviceId)+'».';
      else report.textContent=S.role==='admin'?'Перед передачей исправьте:':'Попросите менеджера исправить настройки, затем проверьте снова.';
      if(!loading&&!pending&&!stale)status.textContent=transferStatus(remote,bill);
    }catch(e){report.textContent=e.code||e instanceof TypeError?'Не удалось проверить каталог. Проверьте соединение и нажмите «Проверить снова».':e.message;}
    finally{checking=false;retry.hidden=ready;settingsButton.hidden=ready||S.role!=='admin';refresh();}
    return ready;
  }
  // Hiding the window does not cancel a pending write. Retrying always reuses the same server slot.
  const close=()=>{closed=true;clearTimeout(timer);unsubscribe();panel.remove();active=null;unlockScroll();};
  const unsubscribe=onValue(ref(db,`${cashPath}/${date}/${bill.id}`),snapshot=>{
    remote=snapshot.val();loading=false;if(!pending)status.textContent=transferStatus(remote,bill);refresh();
  },()=>{loading=true;status.textContent='Нет доступа к состоянию передачи. Проверьте вход и соединение.';refresh();});
  active={close};panel.querySelector('[data-cash-close]').onclick=close;
  deviceSelect.onchange=()=>{deviceId=deviceSelect.value;verify();};
  retry.onclick=()=>verify();
  settingsButton.onclick=()=>{close();openCashSettings({deviceId,onClose:()=>openCashTransfer(date,table,sid,deviceId)});};
  verify();
  send.onclick=async()=>{
    if(send.disabled)return;
    pending=true;refresh();status.textContent='Проверяю актуальный состав и настройки кассы…';
    try{
      if(!await verify(true)){status.textContent='Счёт не передан. Проверьте замечания выше.';return;}
      const fresh=await currentBill(date,table,sid);
      if(fresh.digest!==bill.digest){stale=true;throw Error('Состав или цена изменились. Закройте окно и заново проверьте счёт.');}
      status.textContent='Отправляю. Жду подтверждения базы…';
      // This timeout never implies the write failed. Retries reuse the same server slot.
      timer=setTimeout(()=>{if(!closed)status.textContent='Подтверждения пока нет. Передача может выполняться. Повторять нажатие не нужно.';},12000);
      const saved=await runTransaction(ref(db,`${cashPath}/${date}/${bill.id}`),current=>queueCashBill(current,bill,Date.now()),{applyLocally:false});
      status.textContent=saved.committed?'Передан — ожидает выбора на кассе. Стол не отмечен оплаченным.':transferStatus(saved.snapshot.val(),bill);
    }catch(e){status.textContent='Не удалось подтвердить передачу: '+e.message;}
    finally{clearTimeout(timer);pending=false;refresh();}
  };
}
