import{S}from'./state.js';
import{db,ref,set,update}from'./firebase.js';
import{BUILTIN_MENU}from'./menu-data.js';
import{esc,escAttr,fl,showConfirm,parseItems,lockScroll,unlockScroll,pl}from'./utils.js';

// ─── PICKER STATE ─────────────────────────────────────
let pickerState={};
let pickerCat=0;
let pickerOpenGroups=new Set();
let pickerCups=0;

export function openMenuPicker(){
  pickerState={};pickerCat=0;pickerOpenGroups=new Set();pickerCups=0;
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const ta=document.getElementById('inpItems');
  if(ta&&ta.value.trim()){
    parseItems(ta.value).forEach(it=>{pickerState[it.name]={qty:it.qty,note:'',addons:{},option:null};});
  }
  renderPickerTabs();renderPickerList();updatePickerBtn();
  document.getElementById('menuPickerOverlay').classList.remove('hidden');
  lockScroll();
}
export function closeMenuPicker(){
  document.getElementById('menuPickerOverlay').classList.add('hidden');
  unlockScroll();
}

export function renderPickerTabs(){
  const el=document.getElementById('menuPickerTabs');if(!el)return;
  const menu=(S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU).filter(c=>!c.hidden);
  el.innerHTML=menu.map((cat,i)=>`
    <button class="menu-picker-tab${i===pickerCat?' active':''}" data-picker-cat="${i}" type="button">${esc(cat.cat)}</button>
  `).join('');
}

export function switchPickerCat(i){
  pickerCat=i;pickerOpenGroups=new Set();
  renderPickerTabs();renderPickerList();
}

export function pickerToggleGroup(group){
  if(pickerOpenGroups.has(group))pickerOpenGroups.delete(group);else pickerOpenGroups.add(group);
  renderPickerList();
}

const TEA_ADDONS=['Чабрец','Лимон','Мята'];
export function renderPickerList(){
  const el=document.getElementById('menuPickerList');if(!el)return;
  const menu=(S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU).filter(c=>!c.hidden);
  const cat=menu[pickerCat];if(!cat)return;
  const isLeafTea=cat.cat.toLowerCase().includes('лист');
  const isTea=cat.cat.toLowerCase().includes('чай');
  const items=cat.items||[];
  const groups=items.reduce((acc,item)=>{const key=item.group?.trim()?item.group.trim():'__no_group__';if(!acc[key])acc[key]=[];acc[key].push(item);return acc;},{});
  const orderedGroups=Object.keys(groups);

  const renderSingleItem=(item,compact)=>{
    const st=pickerState[item.name]||{qty:0,note:''};
    const hasQty=st.qty>0;
    const stock=item.stock===undefined||item.stock===null||item.stock===''?null:Math.max(0,parseInt(item.stock,10)||0);
    const isSoldOut=stock===0;
    const stockLabel=stock===null?'':(isSoldOut?'Нет в наличии':`Осталось: ${stock}`);
    let btn;
    const atLimit=stock!==null&&st.qty>=stock;
    if(isSoldOut)btn=`<span class="picker-soldout">Нет</span>`;
    else btn=`<div class="picker-pill${hasQty?' active':''}" data-pill="${escAttr(item.name)}">
        <div data-picker-action="minus" data-item="${escAttr(item.name)}" class="pill-minus${hasQty?'':' is-hidden'}">−</div>
        <div class="pill-qty${hasQty?'':' is-hidden'}">${st.qty}</div>
        <div data-picker-action="plus" data-item="${escAttr(item.name)}" data-stock-limit="${stock===null?'':stock}" class="pill-plus${atLimit?' at-limit':''}">+</div>
      </div>`;
    const addonHtml=isLeafTea&&hasQty?`<div class="picker-chip-row">${TEA_ADDONS.map(a=>{const sel=st.addons?.[a];return`<div data-picker-addon="${escAttr(item.name)}" data-addon-name="${escAttr(a)}" class="picker-chip addon${sel?' active':''}">${esc(a)} <span class="picker-chip-price">+50₽</span></div>`;}).join('')}</div>`:'';
    const optionsHtml=hasQty&&item.options?.length?`<div class="picker-chip-row">${item.options.map(opt=>{const sel=st.option===opt;return`<div data-picker-option="${escAttr(item.name)}" data-option-val="${escAttr(opt)}" class="picker-chip option${sel?' active':''}">${esc(opt)}</div>`;}).join('')}</div>`:'';
    return`<div class="picker-choice-row${compact?' compact':''}${isSoldOut?' sold-out':''}"><div class="picker-choice-main"><div class="picker-choice-name${hasQty?' selected':''}">${esc(item.name)}</div><div class="picker-choice-meta"><span class="picker-choice-price">${item.price} ₽</span>${stockLabel?`<span class="picker-stock${isSoldOut?' sold-out':''}">${stockLabel}</span>`:''}</div>${addonHtml}${optionsHtml}</div><div class="picker-choice-control">${btn}</div></div>`;
  };

  const anyTeaSelected=isTea&&items.some(i=>(pickerState[i.name]?.qty||0)>0);
  const cupsBarEl=document.getElementById('menuPickerCupsBar');
  if(cupsBarEl)cupsBarEl.innerHTML=anyTeaSelected?`<div class="picker-cups-bar"><div class="picker-cups-copy"><div class="picker-cups-title">☕ КРУЖКИ НА СТОЛ</div><div class="picker-cups-sub">укажи сколько кружек принести</div></div><div data-cups-total-action="minus" class="picker-cups-action">−</div><span class="picker-cups-count">${pickerCups}</span><div data-cups-total-action="plus" class="picker-cups-action plus">+</div></div>`:'';
  el.innerHTML=orderedGroups.map(group=>{
    if(group==='__no_group__')return groups[group].map(i=>renderSingleItem(i,false)).join('');
    const isOpen=pickerOpenGroups.has(group);
    const groupItems=groups[group];
    const cartTotal=groupItems.reduce((s,i)=>s+(pickerState[i.name]?.qty||0),0);
    const allOut=groupItems.every(i=>{const s=i.stock===undefined||i.stock===null||i.stock===''?null:parseInt(i.stock,10);return s!==null&&s===0;});
    const sub=allOut?'Нет в наличии':cartTotal>0?`Выбрано: ${cartTotal}`:`${groupItems.length} вариантов`;
    return`<div data-picker-group="${escAttr(group)}" class="picker-group-row"><div class="picker-group-main"><div class="picker-group-name">${esc(group)}</div><div class="picker-group-sub">${sub}</div></div><span class="picker-group-chevron${isOpen?' open':''}">▼</span></div>${isOpen?`<div>${groupItems.map(i=>renderSingleItem(i,true)).join('')}</div>`:''}`;
  }).join('');
}

export function updatePickerBtn(){
  const btn=document.getElementById('menuPickerBtn');if(!btn)return;
  const total=Object.values(pickerState).reduce((s,v)=>s+(v.qty||0),0);
  btn.textContent=total>0?`ГОТОВО (${total} позиц.)`:'ГОТОВО';
}

export function confirmMenuPicker(){
  const lines=[];
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  menu.forEach(cat=>{
    const isLeafTea=cat.cat.toLowerCase().includes('лист');
    cat.items.forEach(item=>{
      const st=pickerState[item.name];
      if(st&&st.qty>0){
        let name=item.name;
        if(isLeafTea&&st.addons){const selected=TEA_ADDONS.filter(a=>st.addons[a]);if(selected.length)name+=` + ${selected.map(a=>a.toLowerCase()).join(', ')}`;}
        if(st.option)name+=` — ${st.option}`;
        lines.push(`${st.qty} ${name}`);
      }
    });
  });
  if(pickerCups>0)lines.push(`${pickerCups} ${pl(pickerCups,'кружка','кружки','кружек')}`);
  const ta=document.getElementById('inpItems');if(ta)ta.value=lines.join('\n');
  closeMenuPicker();
}

// Обработчик кнопок +/– в пикере
let _pickerRenderTimer=null;

function _handlePickerAction(btn){
  const action=btn.dataset.pickerAction;const itemName=btn.dataset.item;
  if(!pickerState[itemName])pickerState[itemName]={qty:0,note:'',addons:{},option:null};
  let triggerCupsBar=false;
  if(action==='plus'){
    const limitStr=btn.dataset.stockLimit;const limit=limitStr!==undefined&&limitStr!==''?parseInt(limitStr):null;
    if(limit!==null&&pickerState[itemName].qty>=limit)return;
    pickerState[itemName].qty++;const _menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;const _isTea=_menu[pickerCat]?.cat?.toLowerCase().includes('чай');if(pickerCups===0&&_isTea){pickerCups++;triggerCupsBar=true;}
  }
  if(action==='minus'){pickerState[itemName].qty=Math.max(0,pickerState[itemName].qty-1);if(pickerState[itemName].qty===0){pickerState[itemName].addons={};pickerState[itemName].option=null;}}
  const pill=[...document.querySelectorAll('.picker-pill')].find(p=>p.dataset.pill===itemName);
  const newQty=pickerState[itemName].qty;
  if(pill){
    const minusEl=pill.querySelector('.pill-minus');
    const qtyEl=pill.querySelector('.pill-qty');
    const plusEl=pill.querySelector('.pill-plus');
    pill.classList.toggle('active',newQty>0);
    if(minusEl)minusEl.classList.toggle('is-hidden',newQty<=0);
    if(qtyEl){qtyEl.classList.toggle('is-hidden',newQty<=0);qtyEl.textContent=newQty;}
    const limitStr2=plusEl?.dataset.stockLimit;const limit2=limitStr2!==undefined&&limitStr2!==''?parseInt(limitStr2):null;
    if(plusEl&&limit2!==null)plusEl.classList.toggle('at-limit',newQty>=limit2);
  }
  updatePickerBtn();
  clearTimeout(_pickerRenderTimer);
  _pickerRenderTimer=setTimeout(renderPickerList,triggerCupsBar?180:400);
}

// pointerdown — мгновенная реакция без 300мс задержки клика (важно для быстрых тапов)
document.addEventListener('pointerdown',e=>{
  const btn=e.target.closest('[data-picker-action]');if(!btn)return;
  const overlay=document.getElementById('menuPickerOverlay');
  if(!overlay||overlay.classList.contains('hidden'))return;
  e.preventDefault();
  _handlePickerAction(btn);
},true);

document.addEventListener('click',e=>{
  const catTab=e.target.closest('[data-picker-cat]');
  if(catTab){switchPickerCat(Number(catTab.dataset.pickerCat));return;}
  const group=e.target.closest('[data-picker-group]');
  if(group){pickerToggleGroup(group.dataset.pickerGroup);return;}
  const addonPill=e.target.closest('[data-picker-addon]');
  if(addonPill){const itemName=addonPill.dataset.pickerAddon,addon=addonPill.dataset.addonName;if(!pickerState[itemName])pickerState[itemName]={qty:0,note:'',addons:{},option:null};if(!pickerState[itemName].addons)pickerState[itemName].addons={};pickerState[itemName].addons[addon]=!pickerState[itemName].addons[addon];renderPickerList();return;}
  const optPill=e.target.closest('[data-picker-option]');
  if(optPill){const itemName=optPill.dataset.pickerOption,val=optPill.dataset.optionVal;if(!pickerState[itemName])pickerState[itemName]={qty:0,note:'',addons:{},option:null};pickerState[itemName].option=pickerState[itemName].option===val?null:val;renderPickerList();return;}
  const cupsTotal=e.target.closest('[data-cups-total-action]');
  if(cupsTotal){
    if(cupsTotal.dataset.cupsTotalAction==='plus')pickerCups++;
    if(cupsTotal.dataset.cupsTotalAction==='minus')pickerCups=Math.max(0,pickerCups-1);
    renderPickerList();return;
  }
},true);

// ─── MENU EDITOR ──────────────────────────────────────
export function buildMenuButtons(){const el=document.getElementById('menuBtns');if(el)el.innerHTML='';}

export async function saveMenuToFirebase(){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  await set(ref(db,'menu2'),menu);
}
export async function updateMenuCatItem(ci,ii,field,val){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu[ci]||!menu[ci].items[ii])return;
  menu[ci].items[ii][field]=val;await saveMenuToFirebase();
}
export async function removeMenuCatItem(ci,ii){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu[ci])return;menu[ci].items.splice(ii,1);
  await saveMenuToFirebase();renderMenuEditor();fl('fOk','Позиция удалена');
}
export async function addMenuCatItem(ci){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu[ci])return;
  const inp=document.getElementById('newItem_'+ci);
  const name=(inp?.value||'').trim();if(!name){fl('fInfo','Введите название');return;}
  menu[ci].items.push({name,price:0});await saveMenuToFirebase();
  if(inp)inp.value='';renderMenuEditor();fl('fOk','✅ '+name+' добавлено');
}
export async function moveMenuCat(ci,dir){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const ni=ci+dir;if(ni<0||ni>=menu.length)return;
  [menu[ci],menu[ni]]=[menu[ni],menu[ci]];
  await saveMenuToFirebase();renderMenuPage();
}
function reorderMenuItem(ci,fromIndex,toIndex){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu[ci]||!menu[ci].items)return;const items=menu[ci].items;if(fromIndex===toIndex)return;
  const item=items.splice(fromIndex,1)[0];const insertIndex=toIndex>fromIndex?toIndex-1:toIndex;items.splice(insertIndex,0,item);
}
function reorderMenuCategory(fromIndex,toIndex){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu||fromIndex===toIndex)return;const category=menu.splice(fromIndex,1)[0];const insertIndex=toIndex>fromIndex?toIndex-1:toIndex;menu.splice(insertIndex,0,category);
}
export async function addMenuCategory(){
  const emoji=(document.getElementById('newCatEmoji')?.value||'').trim();
  const name=(document.getElementById('newCatName')?.value||'').trim();
  if(!name){fl('fInfo','Введите название категории');return;}
  const cat=emoji?`${emoji} ${name}`:name;
  const menu=S.BUILTIN_MENU_LIVE.length?[...S.BUILTIN_MENU_LIVE]:[...BUILTIN_MENU];
  menu.push({cat,items:[]});S.BUILTIN_MENU_LIVE.length=0;menu.forEach(c=>S.BUILTIN_MENU_LIVE.push(c));
  await saveMenuToFirebase();
  document.getElementById('newCatEmoji').value='';document.getElementById('newCatName').value='';
  renderMenuPage();fl('fOk','✅ Категория "'+cat+'" создана');
}
export async function updateMenuCat(ci,field,val){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu[ci])return;
  if(field==='emoji'||field==='catname'){
    const spaceIdx=menu[ci].cat.indexOf(' ');
    const curEmoji=spaceIdx>0?menu[ci].cat.substring(0,spaceIdx):'';
    const curName=spaceIdx>0?menu[ci].cat.substring(spaceIdx+1):menu[ci].cat;
    menu[ci].cat=field==='emoji'?(val.trim()+' '+curName).trim():(curEmoji?(curEmoji+' '+val.trim()):val.trim());
  } else {
    menu[ci][field]=val;
  }
  await saveMenuToFirebase();
}
export async function toggleMenuCatHidden(ci){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu[ci])return;
  menu[ci].hidden=!menu[ci].hidden;
  await saveMenuToFirebase();renderMenuEditor();
}
export async function removeMenuCategory(ci){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const ok=await showConfirm(`Удалить категорию "${menu[ci]?.cat}"?`,'Все позиции в ней тоже удалятся.');
  if(!ok)return;menu.splice(ci,1);await saveMenuToFirebase();renderMenuPage();fl('fOk','Категория удалена');
}

// ─── ITEM EDITOR SHEET ───────────────────────────────
let _ieCi=null,_ieIi=null;
export function openItemEditor(ci,ii){
  _ieCi=ci;_ieIi=ii;
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const item=menu[ci].items[ii];
  document.getElementById('ieNameInp').value=item.name||'';
  document.getElementById('iePriceInp').value=item.price||0;
  const sv=item.stock;
  document.getElementById('ieStockInp').value=(sv!==null&&sv!==undefined&&sv!=='')?sv:'';
  document.getElementById('ieGroupInp').value=item.group||'';
  document.getElementById('ieOptionsInp').value=(item.options||[]).join(', ');
  document.getElementById('itemEditorOverlay').classList.remove('hidden');
  lockScroll();
  _startSheetVP();
}
export function closeItemEditor(){
  document.getElementById('itemEditorOverlay').classList.add('hidden');
  unlockScroll();_ieCi=null;_ieIi=null;
  _stopSheetVP();
}
function _sheetVPHandler(){
  const sheet=document.querySelector('#itemEditorOverlay .bottom-sheet');if(!sheet)return;
  const kbH=Math.max(0,window.innerHeight-(window.visualViewport?.height||window.innerHeight));
  sheet.style.paddingBottom=kbH>50?(kbH+16)+'px':'40px';
}
let _sheetVPBound=null;
function _startSheetVP(){
  _sheetVPBound=_sheetVPHandler;
  if(window.visualViewport)window.visualViewport.addEventListener('resize',_sheetVPBound);
  else window.addEventListener('resize',_sheetVPBound);
}
function _stopSheetVP(){
  const sheet=document.querySelector('#itemEditorOverlay .bottom-sheet');if(sheet)sheet.style.paddingBottom='';
  if(_sheetVPBound){
    if(window.visualViewport)window.visualViewport.removeEventListener('resize',_sheetVPBound);
    else window.removeEventListener('resize',_sheetVPBound);
    _sheetVPBound=null;
  }
}
export async function saveItemEditor(){
  if(_ieCi===null||_ieIi===null)return;
  const name=document.getElementById('ieNameInp').value.trim();
  if(!name){fl('fInfo','Введите название');return;}
  const price=+document.getElementById('iePriceInp').value||0;
  const sv=document.getElementById('ieStockInp').value;
  const stock=sv===''?null:+sv;
  const group=document.getElementById('ieGroupInp').value.trim()||null;
  const optRaw=document.getElementById('ieOptionsInp').value.trim();
  const options=optRaw?optRaw.split(',').map(s=>s.trim()).filter(Boolean):null;
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const item=menu[_ieCi].items[_ieIi];
  item.name=name;item.price=price;item.stock=stock;item.group=group;item.options=options||undefined;
  await saveMenuToFirebase();renderMenuEditor();closeItemEditor();
  fl('fOk','✅ Сохранено');
}

export function renderMenuEditor(){
  const el=document.getElementById('menuEditorList');if(!el)return;
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu.length){el.innerHTML=`<div class="menu-editor-empty">Меню пусто</div>`;return;}
  el.innerHTML=menu.map((cat,ci)=>{
    const spaceIdx=cat.cat.indexOf(' ');
    const catEmoji=spaceIdx>0?cat.cat.substring(0,spaceIdx):'';
    const catName=spaceIdx>0?cat.cat.substring(spaceIdx+1):cat.cat;
    const isHidden=cat.hidden||false;
    return`
    <div class="menu-editor-category${isHidden?' is-hidden':''}" draggable="true" data-menu-cat="${ci}">
      <div class="menu-editor-cat-head">
        <div class="menu-editor-cat-main">
          <div class="drag-handle menu-editor-cat-drag">≡</div>
          <input class="menu-admin-input menu-editor-cat-emoji" type="text" value="${esc(catEmoji)}" placeholder="🍺" onchange="updateMenuCat(${ci},'emoji',this.value)">
          <input class="menu-admin-input menu-editor-cat-name" type="text" value="${esc(catName)}" onchange="updateMenuCat(${ci},'catname',this.value)">
        </div>
        <div class="menu-editor-cat-actions">
          <button class="menu-editor-icon-btn eye" onclick="toggleMenuCatHidden(${ci})" title="${isHidden?'Показать в меню':'Скрыть из меню'}">${isHidden?'🙈':'👁'}</button>
          ${ci>0?`<button class="menu-editor-icon-btn" onclick="moveMenuCat(${ci},-1)">▲</button>`:'<span class="menu-editor-spacer"></span>'}
          ${ci<menu.length-1?`<button class="menu-editor-icon-btn" onclick="moveMenuCat(${ci},+1)">▼</button>`:'<span class="menu-editor-spacer"></span>'}
          <button class="menu-editor-icon-btn delete" onclick="removeMenuCategory(${ci})">🗑</button>
        </div>
      </div>
      ${window.innerWidth<768?'':`<div class="menu-editor-head-row"><span class="menu-editor-head-drag"></span><span class="menu-editor-head-name">Название</span><span class="menu-editor-head-price">Цена</span><span class="menu-editor-head-stock">Остаток</span><span class="menu-editor-head-group">Группа</span><span class="menu-editor-head-actions"></span></div>`}
      ${cat.items.map((item,ii)=>{
        const sv=item.stock;const hasStock=sv!==null&&sv!==undefined&&sv!=='';
        if(window.innerWidth<768){
          return`<div class="menu-editor-item mobile" draggable="true" data-menu-cat="${ci}" data-menu-item="${ii}" onclick="openItemEditor(${ci},${ii})">
            <div class="drag-handle menu-editor-item-drag" onclick="event.stopPropagation()">⋮⋮</div>
            <div class="menu-editor-mobile-main">
              <div class="menu-editor-mobile-name">${esc(item.name)}</div>
              <div class="menu-editor-mobile-meta">
                <span class="menu-editor-price">${item.price||0} ₽</span>
                ${item.group?`<span class="menu-editor-chip group">${esc(item.group)}</span>`:''}
                ${hasStock?`<span class="menu-editor-chip stock">ост: ${sv}</span>`:''}
              </div>
            </div>
            <button class="menu-editor-remove-mobile" onclick="event.stopPropagation();removeMenuCatItem(${ci},${ii})">✕</button>
          </div>`;
        }
        return`<div class="menu-editor-item desktop" draggable="true" data-menu-cat="${ci}" data-menu-item="${ii}">
          <div class="drag-handle menu-editor-item-drag desktop">⋮⋮</div>
          <input class="menu-editor-line-input name" type="text" value="${esc(item.name)}" onchange="updateMenuCatItem(${ci},${ii},'name',this.value)">
          <input class="menu-editor-line-input price" type="number" value="${item.price||0}" min="0" onchange="updateMenuCatItem(${ci},${ii},'price',+this.value)">
          <span class="menu-editor-currency">₽</span>
          <input class="menu-editor-line-input stock" type="number" value="${hasStock?sv:''}" min="0" placeholder="∞" onchange="updateMenuCatItem(${ci},${ii},'stock',this.value===''?null:+this.value)">
          <input class="menu-editor-line-input group" type="text" value="${esc(item.group||'')}" placeholder="группа" onchange="updateMenuCatItem(${ci},${ii},'group',this.value.trim()||null)">
          <button class="menu-editor-line-btn" onclick="openItemEditor(${ci},${ii})" title="Опции позиции">✏️</button>
          <button class="menu-editor-line-btn remove" onclick="removeMenuCatItem(${ci},${ii})">✕</button>
        </div>`;}).join('')}
      <div class="menu-editor-add-row">
        <input class="menu-editor-add-input" type="text" id="newItem_${ci}" placeholder="Новая позиция" onkeydown="if(event.key==='Enter')addMenuCatItem(${ci})">
        <button class="menu-editor-add-btn" onclick="addMenuCatItem(${ci})">+ Добавить</button>
      </div>
    </div>`;}).join('');
}

// Drag & drop
let dragMenuItemSource=null,dragMenuCategorySource=null;
document.addEventListener('dragstart',e=>{
  const row=e.target.closest('.menu-editor-item');
  if(row){const ci=Number(row.dataset.menuCat),ii=Number(row.dataset.menuItem);dragMenuItemSource={ci,ii};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',JSON.stringify(dragMenuItemSource));row.classList.add('dragging');return;}
  const cat=e.target.closest('.menu-editor-category');
  if(cat){const ci=Number(cat.dataset.menuCat);dragMenuCategorySource={ci};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',JSON.stringify(dragMenuCategorySource));cat.classList.add('dragging');}
});
document.addEventListener('dragend',e=>{
  e.target.closest('.menu-editor-item')?.classList.remove('dragging');
  e.target.closest('.menu-editor-category')?.classList.remove('dragging');
  document.querySelectorAll('.menu-editor-item.drag-over,.menu-editor-category.drag-over').forEach(el=>el.classList.remove('drag-over'));
  dragMenuItemSource=null;dragMenuCategorySource=null;
});
document.addEventListener('dragover',e=>{
  const row=e.target.closest('.menu-editor-item');
  if(row&&dragMenuItemSource){if(Number(row.dataset.menuCat)!==dragMenuItemSource.ci)return;e.preventDefault();row.classList.add('drag-over');return;}
  const cat=e.target.closest('.menu-editor-category');
  if(cat&&dragMenuCategorySource){e.preventDefault();cat.classList.add('drag-over');}
});
document.addEventListener('dragleave',e=>{e.target.closest('.menu-editor-item')?.classList.remove('drag-over');e.target.closest('.menu-editor-category')?.classList.remove('drag-over');});
document.addEventListener('drop',async e=>{
  const row=e.target.closest('.menu-editor-item');
  if(row&&dragMenuItemSource){const ci=Number(row.dataset.menuCat),toIndex=Number(row.dataset.menuItem);if(ci!==dragMenuItemSource.ci)return;e.preventDefault();const fromIndex=dragMenuItemSource.ii;row.classList.remove('drag-over');dragMenuItemSource=null;if(fromIndex===toIndex)return;reorderMenuItem(ci,fromIndex,toIndex);await saveMenuToFirebase();renderMenuEditor();return;}
  const cat=e.target.closest('.menu-editor-category');
  if(cat&&dragMenuCategorySource){const toIndex=Number(cat.dataset.menuCat),fromIndex=dragMenuCategorySource.ci;e.preventDefault();cat.classList.remove('drag-over');dragMenuCategorySource=null;if(fromIndex===toIndex)return;reorderMenuCategory(fromIndex,toIndex);await saveMenuToFirebase();renderMenuEditor();}
});

export async function restructureLemonades(){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const ci=menu.findIndex(c=>c.cat.toLowerCase().includes('лимонад'));
  if(ci===-1){fl('fInfo','Категория лимонадов не найдена');return;}
  const origItems=menu[ci].items;
  const newItems=[];
  origItems.forEach(item=>{
    const baseName=item.name.replace(/\s*\d[\.,]\d\s*л?\.?$/i,'').trim();
    newItems.push({name:baseName+' 0.5л',price:400,group:baseName});
    newItems.push({name:baseName+' 1.0л',price:700,group:baseName});
  });
  menu[ci].items=newItems;
  await saveMenuToFirebase();
  renderMenuPage();
  fl('fOk','✅ Лимонады обновлены — '+origItems.length+' вкусов × 2 размера');
}
export function openMenuEditor(){const overlay=document.getElementById('menuEditorOverlay');if(!overlay)return;renderMenuEditor();overlay.classList.remove('hidden');lockScroll();}
export function closeMenuEditor(){document.getElementById('menuEditorOverlay')?.classList.add('hidden');unlockScroll();}
export async function updateMenuItem(){}
export async function removeMenuItem(){}
export async function addNewMenuItem(){fl('fInfo','Используй кнопку "+ Добавить" в нужной категории');}

export function renderMenuPage(){
  const el=document.getElementById('menuPageContent');if(!el)return;
  el.innerHTML=`
    ${S.role==='admin'?`<div class="menu-admin-card">
      <div class="menu-admin-title purple small">🎯 КВИЗ</div>
      <div class="menu-admin-note">Генерирует QR-коды для всех столов для печати.</div>
      <div class="menu-admin-row">
        <button onclick="prepareQuiz()" class="btn-sm menu-admin-quiz-btn">🎯 ПОДГОТОВИТЬ КВИЗ</button>
        <button onclick="finishQuiz()" class="btn-sm menu-admin-quiz-btn danger">🏁 ЗАВЕРШИТЬ КВИЗ</button>
      </div>
    </div>`:''}
    <div class="menu-admin-card">
      <div class="menu-admin-title">➕ НОВАЯ КАТЕГОРИЯ</div>
      <div class="menu-admin-row">
        <input class="menu-admin-input menu-admin-emoji-input" type="text" id="newCatEmoji" placeholder="🍕" maxlength="4">
        <input class="menu-admin-input menu-admin-name-input" type="text" id="newCatName" placeholder="Пицца, Роллы..." onkeydown="if(event.key==='Enter')addMenuCategory()">
        <button onclick="addMenuCategory()" class="btn-sm bd menu-admin-create">+ Создать</button>
      </div>
    </div>
    <div class="menu-admin-card">
      <div class="menu-admin-title small">📋 ТЕКУЩЕЕ МЕНЮ</div>
      <div class="menu-admin-help">Поле "Группа" — для объединения вкусов в раскрывающийся список.</div>
      <div class="menu-admin-note">Перетащите позицию за ⋮⋮, чтобы поменять порядок.</div>
      <div id="menuEditorList"></div>
    </div>`;
  renderMenuEditor();
}
