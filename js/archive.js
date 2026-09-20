import{callService}from'./firebase.js';
import{esc,todayStr}from'./utils.js';
let next=null,selected=null,busy=false;
export function initArchive(){
  const date=document.getElementById('archiveDate'),button=document.getElementById('archiveLoad'),more=document.getElementById('archiveMore');
  date.value=todayStr();button.addEventListener('click',()=>load(false));more.addEventListener('click',()=>load(true));
  date.addEventListener('change',()=>{next=null;selected=null;more.hidden=true;document.getElementById('archiveResults').replaceChildren();});
  async function load(append){
    if(busy||!date.value)return;
    busy=true;button.disabled=more.disabled=date.disabled=true;
    const message=document.getElementById('archiveMessage'),results=document.getElementById('archiveResults');
    message.textContent='Загружаем чеки…';
    const requested=date.value;
    try{
      const page=await callService('getStaffArchive',{date:requested,after:append&&selected===requested?next:null});
      const html=page.rows.map(({order:o})=>`<article class="archive-receipt"><h3>Стол ${esc(o.table)} · Заказ №${esc(o.num)}</h3><p>${esc(o.date)}</p><ul>${Object.values(o.items||{}).map(i=>`<li>${esc(i.name)} — ${esc(i.qty)} × ${esc(i.price)} ₽ = ${esc(i.qty*i.price)} ₽</li>`).join('')}</ul>${o.note?`<p>${esc(o.note)}</p>`:''}<strong>Итого: ${esc(o.total)} ₽</strong></article>`).join('');
      if(append)results.insertAdjacentHTML('beforeend',html);else results.innerHTML=html;
      selected=requested;next=page.next;more.hidden=!next;
      message.textContent=page.rows.length?'Архивные чеки доступны только для просмотра.':append?'Все чеки загружены.':'Архивных чеков за эту дату нет.';
    }catch{message.textContent='Не удалось загрузить архив. Проверьте связь и повторите.';}
    finally{busy=false;button.disabled=more.disabled=date.disabled=false;}
  }
}
