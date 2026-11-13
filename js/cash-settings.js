import{S}from'./state.js';
import{auth,db,ref,onValue,runTransaction}from'./firebase.js';
import{esc,escAttr,lockScroll,unlockScroll}from'./utils.js';
import{cashDevicesPath,cashRuleKey,addonName,cashPartsTotal,cashRuleState,editCashRules,cashCatalogReady,cashSuggestion}from'./cash-rules.js';

let opened=false;
export function openCashSettings(){
  if(opened||S.role!=='admin'||auth.currentUser?.email!=='manager@1708.local')return;
  opened=true;lockScroll();
  const overlay=document.createElement('div');overlay.className='app-modal-overlay cash-settings';
  const previousFocus=document.activeElement;
  overlay.innerHTML=`<section class="app-modal-panel cash-settings-panel" role="dialog" aria-modal="true" aria-label="Касса Эвотор"><div class="cash-settings-head"><div><h2>Касса Эвотор</h2><p>Выберите, как наши товары называются на кассе.</p></div><button class="app-modal-btn" data-close>Закрыть</button></div><div class="cash-settings-body"><div data-content>Загружаю настройки…</div><p role="status" class="cash-settings-status"></p></div><div class="cash-editor-actions" data-editor-actions hidden></div></section>`;
  document.body.appendChild(overlay);
  overlay.querySelector('section').tabIndex=-1;overlay.querySelector('section').focus();
  overlay.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();overlay.querySelector('[data-close]').click();}
    if(e.key!=='Tab')return;
    const controls=[...overlay.querySelectorAll('button,input,select')].filter(el=>!el.disabled&&el.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  });
  const content=overlay.querySelector('[data-content]'),status=overlay.querySelector('[role=status]'),scrollBody=overlay.querySelector('.cash-settings-body'),editorActions=overlay.querySelector('[data-editor-actions]');
  let devices={},devicesReady=false,deviceId='',deviceChosen=false,query='',kind='products',editing=null,pending=false,closed=false,menu=S.BUILTIN_MENU_LIVE;
  const selected=new Set();
  const device=()=>devices[deviceId]||{};
  const settings=()=>device().settings||{schema:1,revision:0};
  const catalog=()=>device().catalog;
  const deviceOptions=()=>Object.entries(devices).map(([id,d])=>`<option value="${escAttr(id)}"${id===deviceId?' selected':''}>${esc(d.catalog?.deviceName||id)}${cashCatalogReady(d.catalog)?'':d.catalog?' — старый каталог':' — каталог не получен'}</option>`).join('');
  const message=s=>{status.textContent=s;};
  const money=k=>(k/100).toLocaleString('ru-RU')+' ₽';
  const menuRows=()=>menu.flatMap(c=>(c.items||[]).filter(i=>i&&typeof i.name==='string').map(i=>({name:i.name,price:i.price,category:c.cat,group:i.group||''})));
  async function rows(){
    const list=kind==='products'?menuRows():[];
    const names=new Set(list.map(x=>x.name));
    for(const rule of Object.values(settings()[kind]||{}))if(rule&&typeof rule.name==='string'&&!names.has(rule.name)){list.push({name:rule.name,price:rule.expectedKopecks/100,category:'Свои соответствия'});names.add(rule.name);}
    return Promise.all(list.map(async r=>({...r,key:await cashRuleKey(r.name,kind==='addons')})));
  }
  let renderToken=0;
  async function render(){
    if(closed||editing||!devicesReady)return;const token=++renderToken;
    if(!cashCatalogReady(catalog())){
      selected.clear();
      content.innerHTML=`<div class="cash-connect" role="region" aria-label="Подключение кассы"><h3>${catalog()?'Обновите приложение кассы':'Каталог ещё не получен'}</h3><p>${catalog()?'В каталоге версии 0.3 цены передавались с ошибкой: 250 ₽ отображались как 25 000 ₽. Цены товаров менять не нужно. Получите исправленный каталог.':'Сначала передайте товары с самого терминала Эвотор. После этого здесь можно будет настроить соответствия.'}</p><ol><li>На терминале обновите приложение «1708 — касса (тест)» до версии 0.4 или новее.</li><li>Откройте «Счета с сайта» и войдите с логином и паролем сотрудника нашего сайта.</li><li>Нажмите «Обновить каталог для сайта» и оставьте этот экран открытым на терминале.</li></ol><p class="cash-settings-note">Когда каталог поступит, список товаров появится здесь автоматически. Перезагружать страницу не нужно.</p></div>${Object.keys(devices).length?`<div class="cash-settings-toolbar"><label>Касса<select data-device>${deviceOptions()}</select></label><button class="app-modal-btn" data-refresh${pending?' disabled':''}>Обновить каталог кассы</button></div>`:''}`;
      bindDeviceControls();return;
    }
    const wasWaiting=!!content.querySelector('.cash-connect');
    const list=await rows();if(closed||editing||token!==renderToken)return;
    const cat=catalog(),current=settings();
    const filtered=list.filter(r=>(r.name+' '+r.category+' '+r.group).toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
    content.innerHTML=`<div class="cash-settings-toolbar"><label>Касса<select data-device>${deviceOptions()}</select></label><button class="app-modal-btn" data-refresh${pending||!deviceId?' disabled':''}>Обновить каталог кассы</button></div>${cat?`<p class="cash-settings-note">Каталог от ${esc(new Date(cat.exportedAt).toLocaleString('ru-RU'))}. ${Object.keys(cat.items||{}).length} карточек.</p>`:'<p>Каталог ещё не получен. На Эвоторе откройте «Счета с сайта», войдите и нажмите «Обновить каталог для сайта».</p>'}<div class="cash-settings-tabs"><button class="app-modal-btn ${kind==='products'?'primary':''}" data-kind="products">Наши товары</button><button class="app-modal-btn ${kind==='addons'?'primary':''}" data-kind="addons">Добавки</button></div><div class="cash-settings-filter"><input data-search type="search" aria-label="Найти наш товар" placeholder="Название, категория или группа" value="${escAttr(query)}"><button class="app-modal-btn" data-new${!cat?' disabled':''}>Добавить соответствие</button></div><div class="cash-settings-bulk"><button class="app-modal-btn" data-select${!filtered.length?' disabled':''}>Выбрать найденные (${filtered.length})</button><button class="app-modal-btn primary" data-bulk${!selected.size||!cat?' disabled':''}>Назначить выбранным (${selected.size})</button></div><div class="cash-settings-list">${filtered.map(r=>{
      const rule=current[kind]?.[r.key],state=cashRuleState(rule,cat,Number(r.price));
      const suggestion=!rule&&list.filter(x=>x.name===r.name).length===1?cashSuggestion(r,cat):null;
      const target=(Array.isArray(rule?.parts)?rule.parts:suggestion?[suggestion]:[]).map(p=>`${cat?.items?.[p.uuid]?.name||'Карточка недоступна'}${p.units>1?' ×'+p.units:''}`).join(' + ');
      return`<article class="cash-settings-row"><label><input type="checkbox" data-pick="${r.key}"${selected.has(r.key)?' checked':''}><span><b>${esc(r.name)}</b><small>${esc(r.category)} · ${money(Math.round(Number(r.price)*100))}</small></span></label><div><span class="cash-rule-state${state==='Настроено'?' good':''}">${suggestion?'Совпало название и цена':state}</span><p>${esc(target||'Выберите товар Эвотора')}${suggestion?' — проверьте и сохраните':''}</p></div><button class="app-modal-btn" data-edit="${r.key}"${!cat?' disabled':''}>${rule?'Изменить':'Настроить'}</button></article>`;
    }).join('')||'<p>Нет соответствий. Добавьте товар или добавку.</p>'}</div>`;
    if(wasWaiting)scrollBody.scrollTop=0;
    bindDeviceControls();
    content.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;selected.clear();query='';render();});
    content.querySelector('[data-search]').oninput=e=>{query=e.target.value;const start=e.target.selectionStart;render().then(()=>{const input=content.querySelector('[data-search]');input?.focus();if(input?.type!=='search')input?.setSelectionRange(start,start);});};
    function updateSelection(input){
      input.checked?selected.add(input.dataset.pick):selected.delete(input.dataset.pick);
      content.querySelectorAll('[data-pick]').forEach(box=>{
        box.checked=selected.has(box.dataset.pick);box.closest('.cash-settings-row').classList.toggle('is-selected',box.checked);
      });
      const button=content.querySelector('[data-bulk]');button.textContent=`Назначить выбранным (${selected.size})`;button.disabled=!selected.size||pending;
    }
    content.querySelectorAll('[data-pick]').forEach(input=>{input.closest('.cash-settings-row').classList.toggle('is-selected',input.checked);input.onchange=()=>updateSelection(input);});
    content.querySelectorAll('.cash-settings-row').forEach(row=>row.onclick=e=>{
      if(e.target.closest('button,input,select,a,label'))return;
      const input=row.querySelector('[data-pick]');input.checked=!input.checked;updateSelection(input);
    });
    content.querySelector('[data-select]').onclick=()=>{filtered.forEach(r=>selected.add(r.key));render();};
    content.querySelector('[data-bulk]').onclick=()=>edit(list.filter(r=>selected.has(r.key)));
    content.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(list.filter(r=>r.key===b.dataset.edit),filtered.map(r=>r.key)));
    content.querySelector('[data-new]').onclick=()=>edit([]);
  }
  function bindDeviceControls(){
    const picker=content.querySelector('[data-device]'),refresh=content.querySelector('[data-refresh]');
    if(picker)picker.onchange=e=>{deviceId=e.target.value;deviceChosen=true;selected.clear();render();};
    if(refresh)refresh.onclick=requestCatalog;
  }
  async function requestCatalog(){
    if(pending||!deviceId)return;
    pending=true;const id=crypto.randomUUID();message('Запрос отправляется…');render();
    try{await runTransaction(ref(db,`${cashDevicesPath}/${deviceId}/refreshRequest`),()=>({id,at:Date.now()}),{applyLocally:false});message('Откройте «Счета с сайта» на Эвоторе. Каталог обновится, пока этот экран открыт.');}
    catch{message('Не удалось запросить каталог. Проверьте соединение.');}finally{pending=false;render();}
  }
  async function edit(targets,sequence=[],returnState=null){
    if(closed||editing||!cashCatalogReady(catalog()))return;
    const returnTo=returnState||{top:scrollBody.scrollTop,key:targets[0]?.key||''};
    const index=targets.length===1?sequence.indexOf(targets[0].key):-1,nextKey=index>=0?sequence[index+1]:null;
    const originalDevice=deviceId,originalKind=kind,cat=structuredClone(catalog());
    const baseline=structuredClone(settings()),originalTargets=targets;
    let parts=structuredClone(targets.length===1?baseline[kind]?.[targets[0].key]?.parts||[]:[]);
    const suggestion=targets.length===1&&!parts.length?cashSuggestion(targets[0],cat):null;
    if(suggestion)parts=[suggestion];
    let advanced=parts.length>1||parts.some(p=>p.units!==1);
    editing={};++renderToken;
    content.innerHTML=`<div class="cash-rule-editor">
      <h3 tabindex="-1">${targets.length?targets.length===1?esc(targets[0].name):'Одно соответствие для '+targets.length+' товаров':'Новое соответствие'}</h3>
      ${targets.length?`<p>На сайте: ${money(Math.round(Number(targets[0].price)*100))}${targets.length>1?' за каждый товар':''}</p>`:`<label>Название ${kind==='addons'?'добавки в заказе':'на сайте, точно как в заказе'}<input data-name maxlength="200" placeholder="${kind==='addons'?'лимон':'Название товара или варианта'}"></label><label>Цена на сайте, ₽<input data-price type="number" min="0" step="0.01"></label>`}
      ${suggestion?'<p class="cash-settings-note">Найдено единственное совпадение названия и цены. Проверьте товар и нажмите «Сохранить».</p>':''}
      <label>Найти товар на кассе<input data-find type="search" placeholder="Название или категория"></label>
      <label>Товар в Эвоторе<select data-card aria-label="Карточка Эвотора"></select></label>
      <div data-parts></div><button class="app-modal-btn" data-add>Добавить карточку</button><p data-total></p>
      <button class="app-modal-btn" data-mode></button><p data-mode-note class="cash-settings-note"></p>
      <button class="app-modal-btn" data-delete${targets.length!==1||!baseline[kind]?.[targets[0]?.key]?' disabled':''}>Удалить соответствие</button>
    </div>`;
    editorActions.innerHTML=`<p data-error role="alert"></p><div class="app-modal-actions"><button class="app-modal-btn" data-back>Назад</button><button class="app-modal-btn primary" data-save>Сохранить</button>${nextKey?'<button class="app-modal-btn primary cash-save-next" data-save-next>Сохранить и следующий</button>':''}</div>`;
    editorActions.hidden=false;scrollBody.scrollTop=0;content.querySelector('h3').focus({preventScroll:true});
    const error=editorActions.querySelector('[data-error]'),save=editorActions.querySelector('[data-save]'),back=editorActions.querySelector('[data-back]');
    const finish=async()=>{
      if(pending)return;editing=null;editorActions.hidden=true;editorActions.replaceChildren();await render();
      if(closed||editing)return;
      scrollBody.scrollTop=returnTo.top;
      const button=returnTo.key?content.querySelector(`[data-edit="${returnTo.key}"]`):content.querySelector('[data-new]');
      button?.focus({preventScroll:true});
      const row=button?.closest('.cash-settings-row');
      if(row){
        const bounds=scrollBody.getBoundingClientRect(),rect=row.getBoundingClientRect();
        if(rect.top<bounds.top)scrollBody.scrollTop+=rect.top-bounds.top;
        else if(rect.bottom>bounds.bottom)scrollBody.scrollTop+=rect.bottom-bounds.bottom;
      }
    };back.onclick=finish;
    function cards(){
      const q=content.querySelector('[data-find]').value.trim().toLocaleLowerCase('ru');
      const chosen=!advanced?parts[0]?.uuid:content.querySelector('[data-card]').value;
      content.querySelector('[data-card]').innerHTML='<option value="">Выберите товар кассы</option>'+Object.entries(cat.items||{}).filter(([id,p])=>p.supported===true&&(id===chosen||(p.name+' '+p.category).toLocaleLowerCase('ru').includes(q))).map(([id,p])=>`<option value="${escAttr(id)}">${esc(p.category||'Без категории')} / ${esc(p.name)} · ${money(p.priceKopecks)} · …${esc(id.slice(-8))}</option>`).join('');
      content.querySelector('[data-card]').value=chosen||'';
    }
    function paint(){
      content.querySelector('[data-parts]').hidden=!advanced;content.querySelector('[data-add]').hidden=!advanced;
      content.querySelector('[data-mode]').textContent=advanced?'Один товар кассы':'Составить из нескольких товаров';
      content.querySelector('[data-mode-note]').textContent=advanced?'Добавьте все составляющие на одну позицию сайта. Например, чай и лимон.':'Выберите один товар Эвотора и сохраните. Количество в заказе перенесётся автоматически.';
      content.querySelector('[data-parts]').innerHTML=parts.map((p,i)=>`<div class="cash-rule-part"><span>${esc(cat.items[p.uuid]?.name||'Карточка удалена')} · ${money(cat.items[p.uuid]?.priceKopecks||0)}</span><label>Количество<input type="number" min="1" max="10" value="${p.units}" data-units="${i}"></label><button class="app-modal-btn" data-remove="${i}" aria-label="Убрать карточку ${i+1}">Убрать</button></div>`).join('');
      content.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{parts.splice(Number(b.dataset.remove),1);paint();});
      content.querySelectorAll('[data-units]').forEach(input=>input.onchange=()=>{parts[Number(input.dataset.units)].units=Number(input.value);sum();});sum();
    }
    function sum(){try{content.querySelector('[data-total]').textContent='На кассе: '+money(cashPartsTotal(parts,cat));}catch(e){content.querySelector('[data-total]').textContent=e.message;}}
    content.querySelector('[data-find]').oninput=cards;
    content.querySelector('[data-card]').onchange=e=>{if(!advanced){const uuid=e.target.value;parts=uuid?[{uuid,units:1,fingerprint:cat.items[uuid].fingerprint}]:[];paint();}};
    content.querySelector('[data-mode]').onclick=()=>{advanced=!advanced;if(!advanced)parts=parts.length?[{...parts[0],units:1}]:[];cards();paint();};
    content.querySelector('[data-add]').onclick=()=>{const uuid=content.querySelector('[data-card]').value;if(!uuid||parts.length>=12)return;parts.push({uuid,units:1,fingerprint:cat.items[uuid].fingerprint});paint();};
    async function persist(remove=false,goNext=false){
      if(pending)return;pending=true;error.textContent='';let list=originalTargets;
      const controls=[...content.querySelectorAll('button,input,select'),...editorActions.querySelectorAll('button')].map(el=>[el,el.disabled]);
      controls.forEach(([el])=>{el.disabled=true;});overlay.querySelector('[data-close]').textContent='Скрыть окно';
      try{
        if(!list.length){
          const name=content.querySelector('[data-name]').value.trim(),priceText=content.querySelector('[data-price]').value;
          if(!name||name.length>200||/[\u0000-\u001f]/.test(name)||priceText==='')throw Error('Укажите название и цену.');
          const price=Number(priceText);if(!Number.isFinite(price)||price<0||Math.abs(price*100-Math.round(price*100))>0.00001)throw Error('Укажите цену с точностью до копейки.');
          const normalized=originalKind==='addons'?addonName(name):name;
          list=[{name:normalized,price,key:await cashRuleKey(normalized,originalKind==='addons')}];
          if(baseline[originalKind]?.[list[0].key])throw Error('Такое соответствие уже есть. Откройте его через «Изменить».');
        }
        const total=remove?0:cashPartsTotal(parts,catalog());
        const duplicates=menuRows().reduce((r,x)=>(r[x.name]=(r[x.name]||0)+1,r),{});
        for(const row of list){
          const liveRow=menuRows().find(r=>r.name===row.name);
          if(liveRow&&Number(liveRow.price)!==Number(row.price))throw Error('Цена на сайте изменилась. Откройте соответствие заново.');
          if(duplicates[row.name]>1)throw Error('На сайте несколько товаров с названием «'+row.name+'». Сначала различите их названия.');
          if(!remove&&total!==Math.round(Number(row.price)*100))throw Error('Цена кассы не совпадает с «'+row.name+'»: на сайте '+row.price+' ₽. Измените карточки или цену через меню.');
        }
        const changes=list.map(row=>({kind:originalKind,key:row.key,before:baseline[originalKind]?.[row.key]||null,rule:remove?null:{name:row.name,expectedKopecks:Math.round(Number(row.price)*100),parts}}));
        message('Сохраняю соответствия…');
        // Compare only touched rules, preserving changes made elsewhere by another employee.
        const result=await runTransaction(ref(db,`${cashDevicesPath}/${originalDevice}/settings`),current=>editCashRules(current,changes,Date.now()),{applyLocally:false});
        if(!result.committed)throw Error('Соответствие изменилось на другом устройстве. Вернитесь и откройте его заново.');
        message(remove?'Соответствие удалено.':'Сохранено. Касса получит настройки при следующем выборе счёта.');
        pending=false;selected.clear();
        if(goNext&&nextKey&&!closed){
          const next=(await rows()).find(row=>row.key===nextKey);
          if(next&&!closed){editing=null;await edit([next],sequence,{...returnTo,key:next.key});return;}
        }
        await finish();
      }catch(e){error.textContent=e.message;message('Настройки не сохранены.');}finally{pending=false;controls.forEach(([el,disabled])=>{el.disabled=disabled;});overlay.querySelector('[data-close]').textContent='Закрыть';}
    }
    save.onclick=()=>persist();content.querySelector('[data-delete]').onclick=()=>persist(true);
    const nextButton=editorActions.querySelector('[data-save-next]');if(nextButton)nextButton.onclick=()=>persist(false,true);
    cards();paint();
  }
  overlay.querySelector('[data-close]').onclick=()=>{closed=true;opened=false;unsubscribe();unsubscribeMenu();overlay.remove();unlockScroll();if(previousFocus?.isConnected)previousFocus.focus();};
  const unsubscribe=onValue(ref(db,cashDevicesPath),snapshot=>{
    devices=snapshot.val()||{};devicesReady=true;
    if(!devices[deviceId]||(!deviceChosen&&!cashCatalogReady(catalog()))){
      const ready=Object.entries(devices).filter(([,d])=>cashCatalogReady(d.catalog)).sort((a,b)=>(Number(b[1].catalog.exportedAt)||0)-(Number(a[1].catalog.exportedAt)||0));
      const nextId=ready[0]?.[0]||(devices[deviceId]?deviceId:Object.keys(devices)[0]||'');
      if(nextId!==deviceId){deviceId=nextId;selected.clear();}
    }
    if(cashCatalogReady(catalog())&&device().catalog?.requestId&&device().catalog.requestId===device().refreshRequest?.id)message('Каталог кассы обновлён.');
    render();
  },()=>{message('Не удалось прочитать настройки. Проверьте вход сотрудника и соединение.');});
  const unsubscribeMenu=onValue(ref(db,'menu2'),snapshot=>{const value=snapshot.val();if(value){menu=Object.values(value).filter(c=>c&&c.items).map(c=>({...c,items:Object.values(c.items)}));render();}});
}
