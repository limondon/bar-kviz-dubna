import{S}from'./state.js';
import{fl}from'./utils.js';

let audioCtx=null;
let audioUnlocked=false;
export let swReg=null;
export let notifMuted=localStorage.getItem('bar_notif_muted')==='1';
export const knownOrderIds=new Set();

export async function registerSW(){
  if(!('serviceWorker' in navigator))return;
  try{swReg=await navigator.serviceWorker.register('./sw.js',{scope:'./'});}
  catch(e){console.warn('SW registration failed',e);}
}

export function unlockAudio(){
  if(audioUnlocked)return;
  try{
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const buf=audioCtx.createBuffer(1,1,22050);
    const src=audioCtx.createBufferSource();
    src.buffer=buf;src.connect(audioCtx.destination);src.start(0);
    audioUnlocked=true;
  }catch(e){}
}
document.addEventListener('touchstart',unlockAudio,{once:true,passive:true});
document.addEventListener('click',unlockAudio,{once:true,passive:true});

export function updateNotifBtn(){
  const btns=document.querySelectorAll('.notif-btn');
  if(!('Notification' in window)&&!('vibrate' in navigator)){btns.forEach(b=>b.style.display='none');return;}
  const perm=typeof Notification!=='undefined'?Notification.permission:'granted';
  btns.forEach(b=>{
    b.style.pointerEvents='auto';b.style.opacity='1';
    if(perm==='denied'){
      b.textContent='🔕 Запрещено';b.style.color='var(--red)';
      b.style.opacity='0.6';b.style.pointerEvents='none';
    } else if(notifMuted){
      b.textContent='🔕 Ув. выкл.';b.style.color='var(--muted)';
    } else if(perm==='granted'){
      b.textContent='🔔 Ув. вкл.';b.style.color='var(--green)';
    } else {
      b.textContent='🔔 Ув. вкл.';b.style.color='var(--accent)';
    }
  });
}

async function requestNotificationPermission(){
  if(!('Notification' in window))return false;
  if(Notification.permission==='granted')return true;
  if(Notification.permission==='denied')return false;
  const result=await Notification.requestPermission();
  updateNotifBtn();
  return result==='granted';
}

export async function enableNotifications(){
  const perm=typeof Notification!=='undefined'?Notification.permission:'default';
  if(perm==='denied')return;
  if(notifMuted){
    notifMuted=false;localStorage.setItem('bar_notif_muted','0');
    updateNotifBtn();fl('fOk','🔔 Уведомления включены');return;
  }
  if(perm==='granted'){
    notifMuted=true;localStorage.setItem('bar_notif_muted','1');
    updateNotifBtn();fl('fInfo','🔕 Уведомления выключены');return;
  }
  unlockAudio();
  await requestNotificationPermission();
  notifMuted=false;localStorage.setItem('bar_notif_muted','0');
  updateNotifBtn();
}

export function playBeep(){
  try{
    if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const play=()=>{
      const osc=audioCtx.createOscillator();
      const gain=audioCtx.createGain();
      osc.connect(gain);gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(1000,audioCtx.currentTime);
      osc.frequency.setValueAtTime(700,audioCtx.currentTime+0.15);
      osc.type='sine';
      gain.gain.setValueAtTime(0,audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5,audioCtx.currentTime+0.02);
      gain.gain.setValueAtTime(0.5,audioCtx.currentTime+0.13);
      gain.gain.linearRampToValueAtTime(0,audioCtx.currentTime+0.15);
      gain.gain.linearRampToValueAtTime(0.4,audioCtx.currentTime+0.17);
      gain.gain.linearRampToValueAtTime(0,audioCtx.currentTime+0.32);
      osc.start(audioCtx.currentTime);osc.stop(audioCtx.currentTime+0.35);
    };
    if(audioCtx.state==='suspended')audioCtx.resume().then(play);else play();
  }catch(e){}
}

export function notifyNewOrder(order){
  if(notifMuted)return;
  if(navigator.vibrate)navigator.vibrate([150,80,150,80,150]);
  playBeep();
  const table=order?.table||'?';
  const count=order?.items?Object.keys(order.items).length:'';
  if(swReg&&Notification.permission==='granted'){
    swReg.active?.postMessage({type:'NOTIFY_NEW_ORDER',table,count});
  } else if(Notification.permission==='granted'){
    new Notification('🍺 Новый заказ!',{body:`Стол ${table} — ${count} позиц.`,icon:'icons/icon-192.png'});
  }
}

export function checkNewOrders(newOrders){
  if(knownOrderIds.size===0){newOrders.forEach(o=>knownOrderIds.add(o.id));return;}
  const newOnes=[];
  newOrders.forEach(o=>{if(!knownOrderIds.has(o.id)){knownOrderIds.add(o.id);newOnes.push(o);}});
  if(newOnes.length&&(S.role==='barman'||S.role==='admin')){
    notifyNewOrder(newOnes[newOnes.length-1]);
  }
}
