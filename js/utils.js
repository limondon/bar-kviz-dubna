// ─── DATE ────────────────────────────────────────────
export function todayStr(){const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
export function pad(n){return String(n).padStart(2,'0');}
export function dateLbl(s){
  const[y,m,d]=s.split('-');
  if(s===todayStr())return'Сегодня, '+d+'.'+m;
  if(s===shiftDS(todayStr(),-1))return'Вчера, '+d+'.'+m;
  return d+'.'+m+'.'+y;
}
export function shiftDS(s,n){const d=new Date(s);d.setDate(d.getDate()+n);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}

// ─── PARSE / STATUS ──────────────────────────────────
export function parseItems(text){
  return text.split('\n').map(l=>l.trim()).filter(Boolean).map((line,i)=>{
    let qty=1,name=line;
    const m1=line.match(/^(\d+)\s*[xXхХ]\s+(.+)/);
    const m2=line.match(/^(\d+)\s+(.+)/);
    const m3=line.match(/^(.+?)\s+[xXхХ](\d+)$/);
    if(m1){qty=parseInt(m1[1]);name=m1[2].trim();}
    else if(m2){qty=parseInt(m2[1]);name=m2[2].trim();}
    else if(m3){qty=parseInt(m3[2]);name=m3[1].trim();}
    return{id:Date.now().toString(36)+'_'+i+'_'+Math.random().toString(36).slice(2,5),name,qty,status:'new'};
  });
}
export function aggStatus(items){
  if(!items||!items.length)return'new';
  const n=items.length;
  const done=items.filter(i=>i.status==='done').length;
  const ready=items.filter(i=>i.status==='ready').length;
  const making=items.filter(i=>i.status==='making').length;
  if(done===n)return'done';
  if(done+ready===n)return'ready';
  if(making>0||ready>0||done>0)return'making';
  return'new';
}
export function normalizeOrder(o){
  if(typeof o.items==='string'){
    o.items=parseItems(o.items);
  } else if(o.items&&!Array.isArray(o.items)){
    o.items=Object.entries(o.items)
      .filter(([k,v])=>v&&typeof v==='object'&&v.name)
      .map(([k,v])=>{const it={...v};it._fbKey=k;if(!it.id)it.id=k;return it;});
  } else if(Array.isArray(o.items)){
    o.items=o.items.filter(it=>it&&it.name).map((it,i)=>{
      const r={...it};
      if(!r._fbKey)r._fbKey=r.id||String(i);
      if(!r.id)r.id=String(i);
      return r;
    });
  }
  if(!Array.isArray(o.items))o.items=[];
  o.items.forEach(it=>{if(!it.status)it.status='new';});
  o.status=aggStatus(o.items);
  return o;
}

// ─── FORMATTERS ──────────────────────────────────────
export function fmt(ts){return ts?new Date(ts).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):'-';}
export function fmt2(ts){return ts?new Date(ts).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):'-';}
export function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
export function empty(icon,msg){return`<div class="empty"><div class="ei">${icon}</div><p>${msg}</p></div>`;}
export function pl(n,a,b,c){return n%10===1&&n%100!==11?a:n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?b:c;}

// ─── DOM HELPERS ─────────────────────────────────────
export function setBadge(id,val){
  const el=document.getElementById(id);
  if(el){el.textContent=val;el.style.display=val>0?'inline-block':'none';}
  const bn=document.getElementById('bnb-'+id);
  if(bn){bn.textContent=val;bn.classList.toggle('vis',val>0);}
  const sb=document.getElementById('sbb-'+id);
  if(sb){sb.textContent=val;sb.classList.toggle('vis',val>0);}
}
export function setEl(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}

let ft={};
export function fl(id,msg){
  const el=document.getElementById(id);if(!el)return;
  el.textContent=msg;el.classList.add('show');
  clearTimeout(ft[id]);ft[id]=setTimeout(()=>el.classList.remove('show'),2800);
}

// ─── CONFIRM MODAL ───────────────────────────────────
let _confirmResolve=null;
export function showConfirm(title,msg,okLabel='ОК'){
  return new Promise(resolve=>{
    _confirmResolve=resolve;
    const overlay=document.getElementById('confirmOverlay');
    if(!overlay){resolve(window.confirm(title+'\n'+msg));_confirmResolve=null;return;}
    document.getElementById('confirmTitle').textContent=title;
    document.getElementById('confirmMsg').textContent=msg;
    const okBtn=document.getElementById('confirmOkBtn');
    okBtn.textContent=okLabel;
    okBtn.style.background='var(--red)';
    okBtn.style.color='#fff';
    overlay.classList.remove('hidden');
  });
}
export function confirmOk(){
  const cb=_confirmResolve;_confirmResolve=null;
  document.getElementById('confirmOverlay').classList.add('hidden');
  if(cb)cb(true);
}
export function closeConfirmModal(){
  const cb=_confirmResolve;_confirmResolve=null;
  document.getElementById('confirmOverlay').classList.add('hidden');
  if(cb)cb(false);
}
