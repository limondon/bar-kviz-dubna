import{S}from'./state.js';
import{callService}from'./firebase.js';
import{fl}from'./utils.js';

let audioCtx=null;
let audioUnlocked=false;
export let swReg=null;
export let notifMuted=localStorage.getItem('bar_notif_muted')==='1';
export const knownOrderIds=new Set();
let remotePushActive=localStorage.getItem('bar_push_active')==='1';
const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const isStandalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const pushSupported=()=>!!(swReg&&'PushManager'in window&&swReg.pushManager);
const applicationKey=value=>{
  const padded=value+'='.repeat((4-value.length%4)%4),raw=atob(padded.replaceAll('-','+').replaceAll('_','/'));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
const plainSubscription=sub=>sub?.toJSON?sub.toJSON():{endpoint:sub.endpoint,keys:sub.keys};
async function readyRegistration(){
  let timer;
  try{return await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Service Worker не готов')),8000);})]);}
  finally{clearTimeout(timer);}
}

export async function registerSW(){
  if(!('serviceWorker' in navigator))return;
  try{
    swReg=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    updateNotifBtn();
    if(remotePushActive)syncPushRole();
  }
  catch(e){console.warn('SW registration failed',e);}
}

async function subscribeRemotePush(){
  if(!swReg&&navigator.serviceWorker)swReg=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
  if(!pushSupported())return false;
  if(!swReg.active)swReg=await readyRegistration();
  const {publicKey}=await callService('getPushPublicKey',{});
  let subscription=await swReg.pushManager.getSubscription();
  if(!subscription)subscription=await swReg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(publicKey)});
  await callService('registerPushSubscription',{subscription:plainSubscription(subscription),role:S.role});
  remotePushActive=true;localStorage.setItem('bar_push_active','1');updateNotifBtn();return true;
}

async function unsubscribeRemotePush(){
  if(!pushSupported())return;
  const subscription=await swReg.pushManager.getSubscription();
  if(!subscription){remotePushActive=false;localStorage.removeItem('bar_push_active');return;}
  try{await callService('unregisterPushSubscription',{subscription:plainSubscription(subscription)});}catch(e){console.warn('Push unregister failed',e);}
  await subscription.unsubscribe();remotePushActive=false;localStorage.removeItem('bar_push_active');updateNotifBtn();
}

export async function syncPushRole(){
  if(!remotePushActive||notifMuted||!S.role||typeof Notification==='undefined'||Notification.permission!=='granted')return;
  try{
    if(!swReg&&navigator.serviceWorker)swReg=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    if(!pushSupported())return;
    const subscription=await swReg.pushManager.getSubscription();
    if(subscription){await callService('registerPushSubscription',{subscription:plainSubscription(subscription),role:S.role});remotePushActive=true;updateNotifBtn();}
  }catch(e){console.warn('Push role sync failed',e);}
}
export const hasRemotePush=()=>remotePushActive;

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
window.addEventListener('pagehide',()=>{try{audioCtx?.close();}catch{}audioCtx=null;audioUnlocked=false;});

export function updateNotifBtn(){
  const btns=document.querySelectorAll('.notif-btn');
  if(!('Notification' in window)&&!isIos()&&!('vibrate' in navigator)){btns.forEach(b=>b.style.display='none');return;}
  const perm=typeof Notification!=='undefined'?Notification.permission:'granted';
  btns.forEach(b=>{
    b.style.pointerEvents='auto';b.style.opacity='1';
    if(perm==='denied'){
      b.textContent='🔕 Запрещено';b.style.color='var(--red)';
      b.style.opacity='0.6';b.style.pointerEvents='none';
    } else if(notifMuted){
      b.textContent='🔕 Ув. выкл.';b.style.color='var(--muted)';
    } else if(perm==='granted'){
      b.textContent=remotePushActive?'🔔 Фон вкл.':'🔔 Ув. вкл.';b.style.color='var(--green)';
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
  if(isIos()&&!isStandalone()){
    fl('fInfo','На iPhone сначала: Поделиться → На экран «Домой», затем откройте приложение с иконки.');return;
  }
  const perm=typeof Notification!=='undefined'?Notification.permission:'default';
  if(perm==='denied')return;
  if(notifMuted){
    const granted=perm==='granted'||await requestNotificationPermission();if(!granted)return;
    notifMuted=false;localStorage.setItem('bar_notif_muted','0');
    try{const background=await subscribeRemotePush();fl(background?'fOk':'fInfo',background?'🔔 Фоновые уведомления включены':'Уведомления включены, фоновая доставка недоступна');}
    catch(e){console.warn('Push subscribe failed',e);fl('fInfo','Уведомления включены, фоновая доставка пока недоступна');}
    updateNotifBtn();return;
  }
  if(perm==='granted'){
    await unsubscribeRemotePush();
    notifMuted=true;localStorage.setItem('bar_notif_muted','1');
    updateNotifBtn();fl('fInfo','🔕 Уведомления выключены');return;
  }
  unlockAudio();
  const granted=await requestNotificationPermission();
  if(!granted)return;
  notifMuted=false;localStorage.setItem('bar_notif_muted','0');
  try{const background=await subscribeRemotePush();fl(background?'fOk':'fInfo',background?'🔔 Фоновые уведомления включены':'Уведомления включены, фоновая доставка недоступна');}
  catch(e){console.warn('Push subscribe failed',e);fl('fInfo','Уведомления включены, фоновая доставка пока недоступна');}
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
  if(remotePushActive)return;
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
