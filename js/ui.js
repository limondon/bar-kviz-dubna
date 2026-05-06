import{S}from'./state.js';
import{db,ref,set,onValue}from'./firebase.js';
import{fl}from'./utils.js';
import{updateNotifBtn,enableNotifications}from'./notifications.js';
import{renderAll,buildQuickTableBtns,renderStats}from'./render.js';
import{renderTables,renderClosed,showQR,openQrPicker}from'./tables.js';
import{renderMenuPage}from'./menu.js';
import{renderCalls}from'./calls.js';

// ─── TAB SWITCH ───────────────────────────────────────
export function sw(tab){
  S.activeTab=tab;
  document.querySelectorAll('#tabsBar .tab').forEach(t=>t.classList.toggle('active',(t.getAttribute('onclick')||'').includes("'"+tab+"'")));
  document.querySelectorAll('.bnav-item').forEach(t=>t.classList.toggle('active',t.id==='bn-'+tab));
  document.querySelectorAll('.sidebar-item').forEach(t=>t.classList.toggle('active',t.id==='sb-'+tab));
  document.querySelectorAll('.section-page').forEach(p=>p.classList.remove('active'));
  const pg=document.getElementById('page-'+tab);if(pg)pg.classList.add('active');
  if(tab==='tables')renderTables();
  if(tab==='done')renderClosed();
  if(tab==='stats')renderStats();
  if(tab==='menu')renderMenuPage();
  if(tab==='calls')renderCalls();
}
export function setQF(f){S.qf=f;renderAll();}
export function pickTable(val){const inp=document.getElementById('inpTable');if(inp)inp.value=val;buildQuickTableBtns();}

// ─── DEVICE / TABS ────────────────────────────────────
function getDevice(){const w=window.innerWidth;if(w>=1024)return'desktop';if(w>=768)return'tablet';return'phone';}

function getTabDefs(){
  if(S.role==='barman')return[{id:'queue',label:'Очередь',ico:'📋',badge:'bQ'},{id:'tables',label:'Столики',ico:'🪑',badge:'bT',badgeCls:'bp'},{id:'done',label:'Закрытые',ico:'✅',badge:'bD'},{id:'calls',label:'Вызовы',ico:'🔔',badge:'bC',badgeCls:'bg'}];
  if(S.role==='waiter')return[{id:'new',label:'+ Заказ',ico:'➕'},{id:'ready',label:'Забрать',ico:'🛎️',badge:'bR',badgeCls:'bg'},{id:'queue',label:'Очередь',ico:'📋',badge:'bQ'},{id:'tables',label:'Столики',ico:'🪑',badge:'bT',badgeCls:'bp'},{id:'done',label:'Закрытые',ico:'✅',badge:'bD'},{id:'calls',label:'Вызовы',ico:'🔔',badge:'bC',badgeCls:'bg'}];
  return[{id:'new',label:'+ Заказ',ico:'➕'},{id:'queue',label:'Очередь',ico:'📋',badge:'bQ'},{id:'ready',label:'Забрать',ico:'🛎️',badge:'bR',badgeCls:'bg'},{id:'tables',label:'Столики',ico:'🪑',badge:'bT',badgeCls:'bp'},{id:'done',label:'Закрытые',ico:'✅',badge:'bD'},{id:'calls',label:'Вызовы',ico:'🔔',badge:'bC',badgeCls:'bg'}];
}

export function buildTabs(){
  const tabDefs=getTabDefs();
  const bar=document.getElementById('tabsBar');
  bar.innerHTML=tabDefs.map(t=>`<div class="tab" onclick="sw('${t.id}')">${t.label}${t.badge?` <span class="bdg${t.badgeCls?` ${t.badgeCls}`:''}" id="${t.badge}">0</span>`:''}</div>`).join('');
  buildBottomNav(tabDefs);buildSidebar(tabDefs);
  applyDeviceLayout(getDevice());
}

function buildBottomNav(tabs){
  const nav=document.getElementById('bottomNav');
  nav.innerHTML=tabs.map(t=>`<div class="bnav-item" id="bn-${t.id}" onclick="sw('${t.id}')"><span class="bnav-ico">${t.ico}</span><span class="bnav-lbl">${t.label.replace('+ ','')}</span>${t.badge?`<span class="bnav-badge${t.badgeCls==='.bg'?' green':t.badgeCls==='.bp'?' purple':''}" id="bnb-${t.badge}"></span>`:''}</div>`).join('')+`<div class="bnav-item" id="bn-settings" onclick="toggleSettingsMenu()"><span class="bnav-ico">⚙️</span><span class="bnav-lbl">Ещё</span></div>`;
}

function buildSidebar(tabs){
  const sb=document.getElementById('sidebar');
  const roleNames={waiter:'🛎️ Официант',barman:'🍹 Бармен',admin:'👑 Менеджер'};
  sb.innerHTML=`<div style="padding:0 20px 16px;border-bottom:1px solid var(--border);margin-bottom:8px;"><div style="display:flex;align-items:center;gap:8px;"><span style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:var(--accent);letter-spacing:2px;">1708</span></div><div style="font-size:11px;color:var(--muted);margin-top:2px;">${roleNames[S.role]||''}</div></div>
    ${tabs.map(t=>`<div class="sidebar-item" id="sb-${t.id}" onclick="sw('${t.id}')"><span class="sidebar-ico">${t.ico}</span><span>${t.label}</span>${t.badge?`<span class="sidebar-badge${t.badgeCls==='.bg'?' green':t.badgeCls==='.bp'?' purple':''}" id="sbb-${t.badge}"></span>`:''}</div>`).join('')}
    ${S.role==='admin'?`<div class="sidebar-item" id="sb-stats" onclick="sw('stats')"><span class="sidebar-ico">📊</span><span>Статистика</span></div><div class="sidebar-item" id="sb-menu" onclick="sw('menu')"><span class="sidebar-ico">📋</span><span>Меню</span></div>`:''}
    <div style="margin-top:auto;padding:16px 20px 0;border-top:1px solid var(--border);margin-top:16px;">
      <div onclick="openRoleModal()" style="font-size:11px;color:var(--muted);cursor:pointer;padding:8px 0;">⚙️ Сменить роль</div>
      ${S.role==='admin'?`<div onclick="changePassword()" style="font-size:11px;color:var(--muted);cursor:pointer;padding:8px 0;">🔐 Сменить пароль</div>`:''}
      <div class="notif-btn" onclick="enableNotifications()" style="font-size:11px;cursor:pointer;padding:8px 0;"></div>
    </div>`;
  updateNotifBtn();
}

function applyDeviceLayout(device){
  const bottomNav=document.getElementById('bottomNav');const sidebar=document.getElementById('sidebar');
  const tabsBar=document.getElementById('tabsBar');const desktopLayout=document.getElementById('desktopLayout');
  if(device==='phone'){bottomNav.style.display='flex';sidebar.style.display='none';tabsBar.style.display='none';desktopLayout.style.display='block';}
  else if(device==='tablet'){bottomNav.style.display='none';sidebar.style.display='none';tabsBar.style.display='flex';desktopLayout.style.display='block';}
  else{bottomNav.style.display='none';sidebar.style.display='flex';tabsBar.style.display='none';desktopLayout.style.display='grid';}
}

let resizeTimer;
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(S.role)applyDeviceLayout(getDevice());},120);});

export function toggleSettingsMenu(){
  let popup=document.getElementById('settingsPopup');if(popup){popup.remove();return;}
  popup=document.createElement('div');popup.id='settingsPopup';
  popup.style.cssText=`position:fixed;bottom:70px;right:8px;z-index:300;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:8px;min-width:180px;box-shadow:0 -4px 24px rgba(0,0,0,.4);animation:slideUp .2s ease;`;
  const items=[...(S.role==='admin'?[{ico:'📊',label:'Статистика',action:()=>{sw('stats');popup.remove();}},{ico:'📋',label:'Меню',action:()=>{sw('menu');popup.remove();}}]:[]),{ico:'🛎️',label:'Сменить роль',action:()=>{openRoleModal();popup.remove();},...(S.role==='admin'?[{ico:'🔐',label:'Сменить пароль',action:()=>{changePassword();popup.remove();}}]:[])}];
  popup.innerHTML=items.map((it,i)=>`<div id="spItem${i}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--text);font-family:'IBM Plex Mono',monospace;">${it.ico} ${it.label}</div>`).join('');
  document.body.appendChild(popup);
  items.forEach((it,i)=>{const el=document.getElementById('spItem'+i);if(el)el.addEventListener('click',it.action);});
  setTimeout(()=>{document.addEventListener('click',function h(e){if(!popup.contains(e.target)&&!e.target.closest('#bn-settings')){popup.remove();}document.removeEventListener('click',h);});},0);
}

// ─── ROLE ─────────────────────────────────────────────
export function openRoleModal(){
  S.pendingRole=S.role;
  document.querySelectorAll('.rc').forEach(c=>c.classList.remove('sel'));
  if(S.role){const m={waiter:'rw',barman:'rb',admin:'ra'};document.querySelector('.rc.'+m[S.role])?.classList.add('sel');}
  document.getElementById('roleClose').style.display=S.role?'block':'none';
  document.getElementById('roleOverlay').classList.remove('hidden');
  document.body.classList.add('modal-open');
}
export function closeRoleModal(){document.getElementById('roleOverlay').classList.add('hidden');document.body.classList.remove('modal-open');}
export function pickRole(r){
  S.pendingRole=r;
  document.querySelectorAll('.rc').forEach(c=>c.classList.remove('sel'));
  const m={waiter:'rw',barman:'rb',admin:'ra'};
  document.querySelector('.rc.'+m[r])?.classList.add('sel');
}
export function confirmRole(){
  if(!S.pendingRole){fl('fInfo','Выберите роль!');return;}
  S.role=S.pendingRole;localStorage.setItem('bar_role',S.role);
  closeRoleModal();applyRole();
  fl('fOk','Роль: '+{waiter:'Официант',barman:'Бармен',admin:'Менеджер'}[S.role]);
}
export function applyRole(){
  const lbl={waiter:'🛎️ Официант',barman:'🍹 Бармен',admin:'👑 Менеджер'};
  const cls={waiter:'rb-waiter',barman:'rb-barman',admin:'rb-admin'};
  const hr=document.getElementById('hRole');hr.textContent=lbl[S.role];hr.className='rbadge '+cls[S.role];
  buildTabs();renderAll();buildQuickTableBtns();
  let hnotif=document.getElementById('hNotif');
  if(!hnotif){hnotif=document.createElement('span');hnotif.id='hNotif';hnotif.className='notif-btn';hnotif.style.cssText='font-size:11px;cursor:pointer;padding:4px 8px;border-radius:12px;border:1px solid;white-space:nowrap;display:none;';hnotif.onclick=enableNotifications;document.querySelector('.hright').insertBefore(hnotif,document.querySelector('.dot'));}
  hnotif.style.display=(S.role==='barman'||S.role==='admin')?'flex':'none';
  if(S.role==='barman'||S.role==='admin')updateNotifBtn();
  let hQR=document.getElementById('hQR');
  if(!hQR){hQR=document.createElement('span');hQR.id='hQR';hQR.onclick=()=>{if(!S.qf||S.qf==='all')openQrPicker();else showQR(S.qf);};hQR.style.cssText='font-size:20px;cursor:pointer;padding:4px 6px;min-height:44px;display:none;align-items:center;';hQR.title='Показать QR гостям';hQR.textContent='📱';document.querySelector('.hright').insertBefore(hQR,document.querySelector('.dot'));}
  hQR.style.display=(S.role==='waiter'||S.role==='admin')?'flex':'none';
}

// ─── PASSWORD ─────────────────────────────────────────
export function checkPassword(){
  const val=document.getElementById('passwordInput')?.value||'';
  if(!S.appPassword){localStorage.setItem('bar_auth',Date.now().toString());document.getElementById('passwordOverlay').classList.add('hidden');const sr=localStorage.getItem('bar_role');if(!sr)openRoleModal();return;}
  if(val===S.appPassword){localStorage.setItem('bar_auth',Date.now().toString());document.getElementById('passwordOverlay').classList.add('hidden');const sr=localStorage.getItem('bar_role');if(!sr)openRoleModal();}
  else{const err=document.getElementById('passwordError');if(err){err.textContent='❌ Неверный пароль';setTimeout(()=>err.textContent='',2000);}const inp=document.getElementById('passwordInput');if(inp){inp.value='';inp.focus();}}
}
export function openPasswordModal(){document.getElementById('passwordOverlay').classList.remove('hidden');setTimeout(()=>document.getElementById('passwordInput')?.focus(),100);}
export function checkAuth(){
  if(!S.appPassword)return true;
  const savedAuth=localStorage.getItem('bar_auth');if(!savedAuth)return false;
  return Date.now()-parseInt(savedAuth)<30*24*60*60*1000;
}
export async function changePassword(){
  const newPass=await new Promise(resolve=>{
    const overlay=document.getElementById('confirmOverlay');
    if(!overlay){resolve(window.prompt('Новый пароль (оставьте пустым чтобы убрать пароль):',''));return;}
    document.getElementById('confirmTitle').textContent='🔐 Смена пароля';
    document.getElementById('confirmMsg').innerHTML=`<input type="password" id="newPasswordInput" placeholder="Новый пароль" style="width:100%;padding:10px;margin-top:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:'IBM Plex Mono',monospace;font-size:16px;text-align:center;letter-spacing:3px;" onkeydown="if(event.key==='Enter')confirmOk()"><div style="font-size:11px;color:var(--muted);margin-top:8px;">Оставьте пустым чтобы убрать пароль</div>`;
    document.getElementById('confirmOkBtn').textContent='СОХРАНИТЬ';
    document.getElementById('confirmOkBtn').style.background='var(--accent)';
    document.getElementById('confirmOkBtn').style.color='#000';
    overlay.classList.remove('hidden');
    setTimeout(()=>document.getElementById('newPasswordInput')?.focus(),100);
    window._confirmResolve=()=>{const val=document.getElementById('newPasswordInput')?.value||'';overlay.classList.add('hidden');resolve(val);};
  });
  if(newPass===null)return;
  if(newPass===''){await set(ref(db,'config/password'),null);S.appPassword=null;fl('fOk','🔓 Пароль удалён');}
  else{await set(ref(db,'config/password'),newPass);S.appPassword=newPass;fl('fOk','🔐 Пароль установлен');}
}

export function toggleBill(cardId){
  const b=document.getElementById('body-'+cardId),c=document.getElementById('chev-'+cardId);
  if(!b)return;const open=b.classList.contains('open');b.classList.toggle('open',!open);c.classList.toggle('open',!open);
}
