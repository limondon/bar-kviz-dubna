import{S}from'./state.js';
import{db,ref,set,update}from'./firebase.js';
import{BUILTIN_MENU}from'./menu-data.js';
import{esc,fl,showConfirm,parseItems}from'./utils.js';

// ─── PICKER STATE ─────────────────────────────────────
let pickerState={};
let pickerCat=0;
let pickerOpenGroups=new Set();

export function openMenuPicker(){
  pickerState={};pickerCat=0;pickerOpenGroups=new Set();
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const ta=document.getElementById('inpItems');
  if(ta&&ta.value.trim()){
    parseItems(ta.value).forEach(it=>{pickerState[it.name]={qty:it.qty,note:''};});
  }
  renderPickerTabs();renderPickerList();updatePickerBtn();
  document.getElementById('menuPickerOverlay').classList.remove('hidden');
  document.body.classList.add('modal-open');
}
export function closeMenuPicker(){
  document.getElementById('menuPickerOverlay').classList.add('hidden');
  document.body.classList.remove('modal-open');
}

export function renderPickerTabs(){
  const el=document.getElementById('menuPickerTabs');if(!el)return;
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  el.innerHTML=menu.map((cat,i)=>`
    <div onclick="switchPickerCat(${i})" style="flex-shrink:0;padding:8px 16px;cursor:pointer;white-space:nowrap;font-size:12px;font-weight:500;font-family:'IBM Plex Mono',monospace;border-radius:100px;min-height:44px;display:flex;align-items:center;border:1px solid ${i===pickerCat?'var(--accent)':'rgba(255,255,255,.08)'};background:${i===pickerCat?'var(--accent)':'transparent'};color:${i===pickerCat?'#000':'var(--muted)'};transition:all .2s;">${cat.cat}</div>
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

export function renderPickerList(){
  const el=document.getElementById('menuPickerList');if(!el)return;
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const cat=menu[pickerCat];if(!cat)return;
  const items=cat.items||[];
  const groups=items.reduce((acc,item)=>{const key=item.group?.trim()?item.group.trim():'__no_group__';if(!acc[key])acc[key]=[];acc[key].push(item);return acc;},{});
  const orderedGroups=Object.keys(groups);

  const renderSingleItem=(item,compact)=>{
    const st=pickerState[item.name]||{qty:0,note:''};
    const hasQty=st.qty>0;
    const stock=item.stock===undefined||item.stock===null||item.stock===''?null:Math.max(0,parseInt(item.stock,10)||0);
    const isSoldOut=stock===0;
    const stockLabel=stock===null?'':(isSoldOut?'Нет в наличии':`Осталось: ${stock}`);
    const showNote=hasQty&&item.note;
    const pad=compact?'10px 20px 10px 32px':'13px 20px';
    let btn;
    if(isSoldOut)btn=`<span style="font-size:10px;color:var(--red);background:rgba(229,57,53,.12);border:1px solid rgba(229,57,53,.25);border-radius:8px;padding:2px 7px;">Нет</span>`;
    else if(!hasQty)btn=`<div data-picker-action="plus" data-item="${esc(item.name)}" data-stock="1" style="width:40px;height:40px;min-width:44px;min-height:44px;border-radius:50%;border:1.5px solid var(--accent);background:transparent;color:var(--accent);font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</div>`;
    else btn=`<div style="display:flex;align-items:center;background:rgba(245,166,35,.12);border:1.5px solid var(--accent);border-radius:100px;overflow:hidden;"><div data-picker-action="minus" data-item="${esc(item.name)}" style="width:40px;height:40px;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;background:transparent;color:var(--accent);font-size:20px;cursor:pointer;">−</div><div style="font-size:14px;font-weight:600;color:var(--text);min-width:24px;text-align:center;font-family:'IBM Plex Mono',monospace;">${st.qty}</div><div data-picker-action="plus" data-item="${esc(item.name)}" data-stock="1" style="width:40px;height:40px;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;background:transparent;color:var(--accent);font-size:20px;cursor:pointer;font-weight:700;">+</div></div>`;
    return`<div style="display:flex;align-items:center;padding:${pad};gap:12px;border-bottom:1px solid rgba(255,255,255,.045);${isSoldOut?'opacity:.5;':''}"><div style="flex:1;min-width:0;"><div style="font-size:${compact?'13px':'15px'};color:var(--text);${hasQty?'font-weight:600;':''}margin-bottom:3px;">${esc(item.name)}</div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-size:${compact?'12px':'13px'};color:var(--accent);font-family:'IBM Plex Mono',monospace;">${item.price} ₽</span>${stockLabel?`<span style="font-size:11px;color:${isSoldOut?'var(--red)':'var(--muted)'};">${stockLabel}</span>`:''}</div>${showNote?`<input type="text" placeholder="${esc(item.notePlaceholder||'уточнить...')}" value="${esc(st.note||'')}" data-picker-note="${esc(item.name)}" style="width:100%;margin-top:8px;padding:7px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:'IBM Plex Mono',monospace;font-size:13px;">`:''}
    </div><div style="flex-shrink:0;">${btn}</div></div>`;
  };

  el.innerHTML=orderedGroups.map(group=>{
    if(group==='__no_group__')return groups[group].map(i=>renderSingleItem(i,false)).join('');
    const isOpen=pickerOpenGroups.has(group);
    const groupItems=groups[group];
    const cartTotal=groupItems.reduce((s,i)=>s+(pickerState[i.name]?.qty||0),0);
    const allOut=groupItems.every(i=>{const s=i.stock===undefined||i.stock===null||i.stock===''?null:parseInt(i.stock,10);return s!==null&&s===0;});
    const sub=allOut?'Нет в наличии':cartTotal>0?`Выбрано: ${cartTotal}`:`${groupItems.length} вариантов`;
    return`<div onclick="pickerToggleGroup('${esc(group)}')" style="display:flex;align-items:center;padding:13px 20px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.045);"><div style="flex:1;"><div style="font-size:15px;color:var(--text);margin-bottom:3px;">${esc(group)}</div><div style="font-size:11px;color:var(--muted);">${sub}</div></div><span style="font-size:13px;color:var(--accent);display:inline-block;transition:transform .2s;${isOpen?'transform:rotate(180deg);':''}">▼</span></div>${isOpen?`<div>${groupItems.map(i=>renderSingleItem(i,true)).join('')}</div>`:''}`;
  }).join('');
}

export function updatePickerBtn(){
  const btn=document.getElementById('menuPickerBtn');if(!btn)return;
  const total=Object.values(pickerState).reduce((s,v)=>s+(v.qty||0),0);
  btn.textContent=total>0?`ГОТОВО (${total} позиц.)`:'ГОТОВО';
}

export function confirmMenuPicker(){
  document.querySelectorAll('[data-picker-note]').forEach(inp=>{const name=inp.dataset.pickerNote;if(pickerState[name])pickerState[name].note=inp.value.trim();});
  const lines=[];
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  menu.forEach(cat=>{cat.items.forEach(item=>{const st=pickerState[item.name];if(st&&st.qty>0){const note=st.note?` (${st.note})`:'';lines.push(`${st.qty} ${item.name}${note}`);}});});
  const ta=document.getElementById('inpItems');if(ta)ta.value=lines.join('\n');
  closeMenuPicker();
}

// Обработчик кнопок +/– в пикере
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-picker-action]');if(!btn)return;
  const action=btn.dataset.pickerAction;const itemName=btn.dataset.item;
  if(!pickerState[itemName])pickerState[itemName]={qty:0,note:''};
  if(action==='plus'&&btn.dataset.stock==='0')return;
  if(action==='plus')pickerState[itemName].qty++;
  if(action==='minus')pickerState[itemName].qty=Math.max(0,pickerState[itemName].qty-1);
  renderPickerList();updatePickerBtn();
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
export async function removeMenuCategory(ci){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const ok=await showConfirm(`Удалить категорию "${menu[ci]?.cat}"?`,'Все позиции в ней тоже удалятся.');
  if(!ok)return;menu.splice(ci,1);await saveMenuToFirebase();renderMenuPage();fl('fOk','Категория удалена');
}

export function renderMenuEditor(){
  const el=document.getElementById('menuEditorList');if(!el)return;
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  if(!menu.length){el.innerHTML=`<div style="color:var(--muted);font-size:12px;padding:8px 0;">Меню пусто</div>`;return;}
  el.innerHTML=menu.map((cat,ci)=>`
    <div class="menu-editor-category" draggable="true" data-menu-cat="${ci}" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="drag-handle" style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:grab;color:var(--muted);font-size:14px;user-select:none;flex-shrink:0;">≡</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;color:var(--accent);letter-spacing:1px;">${esc(cat.cat)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          ${ci>0?`<button onclick="moveMenuCat(${ci},-1)" style="background:transparent;border:1px solid var(--border);color:var(--muted);cursor:pointer;border-radius:4px;padding:2px 7px;font-size:12px;">▲</button>`:'<span style="width:28px;"></span>'}
          ${ci<menu.length-1?`<button onclick="moveMenuCat(${ci},+1)" style="background:transparent;border:1px solid var(--border);color:var(--muted);cursor:pointer;border-radius:4px;padding:2px 7px;font-size:12px;">▼</button>`:'<span style="width:28px;"></span>'}
          <button onclick="removeMenuCategory(${ci})" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:12px;padding:2px 6px;">🗑</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;padding:2px 0 4px;font-size:9px;color:var(--muted);letter-spacing:.5px;text-transform:uppercase;"><span style="flex:1;">Название</span><span style="width:65px;text-align:center;">Цена</span><span style="width:52px;text-align:center;color:var(--accent);">Остаток</span><span style="width:80px;text-align:center;color:var(--purple);">Группа</span><span style="width:30px;"></span></div>
      ${cat.items.map((item,ii)=>`
        <div class="menu-editor-item" draggable="true" data-menu-cat="${ci}" data-menu-item="${ii}" style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);">
          <div class="drag-handle" style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:grab;color:var(--muted);font-size:14px;user-select:none;flex-shrink:0;">⋮⋮</div>
          <input type="text" value="${esc(item.name)}" onchange="updateMenuCatItem(${ci},${ii},'name',this.value)" style="flex:1;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:5px 8px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);">
          <input type="number" value="${item.price||0}" min="0" onchange="updateMenuCatItem(${ci},${ii},'price',+this.value)" style="width:65px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:5px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--muted);">
          <span style="font-size:11px;color:var(--muted);">₽</span>
          <input type="number" value="${item.stock!==undefined&&item.stock!==null&&item.stock!==''?item.stock:''}" min="0" placeholder="∞" onchange="updateMenuCatItem(${ci},${ii},'stock',this.value===''?null:+this.value)" style="width:52px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:5px;background:var(--bg);border:1px solid rgba(245,166,35,.3);border-radius:5px;color:var(--accent);">
          <input type="text" value="${esc(item.group||'')}" placeholder="группа" onchange="updateMenuCatItem(${ci},${ii},'group',this.value.trim()||null)" style="width:80px;font-family:'IBM Plex Mono',monospace;font-size:11px;padding:5px;background:var(--bg);border:1px solid rgba(156,39,176,.3);border-radius:5px;color:var(--purple);">
          <button onclick="removeMenuCatItem(${ci},${ii})" style="background:rgba(229,57,53,.15);color:var(--red);border:1px solid rgba(229,57,53,.3);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;flex-shrink:0;">✕</button>
        </div>`).join('')}
      <div style="display:flex;gap:6px;margin-top:6px;">
        <input type="text" id="newItem_${ci}" placeholder="Новая позиция" style="flex:1;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:5px 8px;background:var(--bg);border:1px dashed var(--border);border-radius:5px;color:var(--text);" onkeydown="if(event.key==='Enter')addMenuCatItem(${ci})">
        <button onclick="addMenuCatItem(${ci})" style="background:rgba(76,175,80,.15);color:var(--green);border:1px solid rgba(76,175,80,.3);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;">+ Добавить</button>
      </div>
    </div>`).join('');
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

export function openMenuEditor(){const overlay=document.getElementById('menuEditorOverlay');if(!overlay)return;renderMenuEditor();overlay.classList.remove('hidden');}
export function closeMenuEditor(){document.getElementById('menuEditorOverlay')?.classList.add('hidden');}
export async function updateMenuItem(){}
export async function removeMenuItem(){}
export async function addNewMenuItem(){fl('fInfo','Используй кнопку "+ Добавить" в нужной категории');}

export function renderMenuPage(){
  const el=document.getElementById('menuPageContent');if(!el)return;
  el.innerHTML=`
    ${S.role==='admin'?`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-md);margin-bottom:var(--sp-md);"><div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;color:var(--purple);margin-bottom:var(--sp-sm);">🎯 КВИЗ</div><div style="font-size:11px;color:var(--muted);margin-bottom:var(--sp-sm);">Генерирует QR-коды для всех столов для печати.</div><div style="display:flex;gap:var(--sp-sm);flex-wrap:wrap;"><button onclick="prepareQuiz()" style="min-height:44px;padding:8px 16px;background:rgba(156,39,176,.15);color:var(--purple);border:1px solid rgba(156,39,176,.4);border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;cursor:pointer;">🎯 ПОДГОТОВИТЬ КВИЗ</button><button onclick="finishQuiz()" style="min-height:44px;padding:8px 16px;background:rgba(229,57,53,.1);color:var(--red);border:1px solid rgba(229,57,53,.3);border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;cursor:pointer;">🏁 ЗАВЕРШИТЬ КВИЗ</button></div></div>`:''}
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-md);margin-bottom:var(--sp-md);"><div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;color:var(--accent);margin-bottom:var(--sp-md);">➕ НОВАЯ КАТЕГОРИЯ</div><div style="display:flex;gap:var(--sp-sm);flex-wrap:wrap;"><input type="text" id="newCatEmoji" placeholder="🍕" maxlength="4" style="width:58px;text-align:center;font-size:20px;padding:8px;font-family:'IBM Plex Mono',monospace;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);"><input type="text" id="newCatName" placeholder="Пицца, Роллы..." style="flex:1;min-width:150px;font-family:'IBM Plex Mono',monospace;font-size:14px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);" onkeydown="if(event.key==='Enter')addMenuCategory()"><button onclick="addMenuCategory()" class="btn-sm bd" style="min-width:100px;">+ Создать</button></div></div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-md);"><div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;color:var(--accent);margin-bottom:var(--sp-sm);">📋 ТЕКУЩЕЕ МЕНЮ</div><div style="font-size:10px;color:var(--muted);margin-bottom:8px;">Поле "Группа" — для объединения вкусов в раскрывающийся список.</div><div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Перетащите позицию за ⋮⋮, чтобы поменять порядок.</div><div id="menuEditorList"></div></div>`;
  renderMenuEditor();
}
