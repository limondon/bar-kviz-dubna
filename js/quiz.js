import{db,ref,update,onValue}from'./firebase.js';
import{fl}from'./utils.js';
import{QR_TABLES,permanentQrTokens,printQrCards}from'./qr.js';

let qrEnabled=null,qrBusy=false,watching=false;
export function renderQrControls(){
  const status=document.getElementById('qrEventStatus');
  if(status)status.textContent=qrEnabled===null?'Загружаем состояние…':qrEnabled?'🟢 QR-заказы включены':'⏸ QR-заказы выключены';
  const on=document.getElementById('qrEnable'),off=document.getElementById('qrDisable');
  if(on)on.disabled=qrBusy||qrEnabled===null||qrEnabled===true;
  if(off)off.disabled=qrBusy||qrEnabled===null||qrEnabled===false;
}
export function watchQrControls(){
  if(watching)return;watching=true;
  onValue(ref(db,'quiz_tokens/_settings'),snap=>{
    const settings=snap.val();
    // Preserve legacy behaviour until the operator chooses the new mode.
    qrEnabled=settings?settings.enabled===true:true;renderQrControls();
  },()=>{qrEnabled=null;renderQrControls();});
}
async function setQrEnabled(enabled){
  if(qrBusy)return;qrBusy=true;renderQrControls();
  try{
    await update(ref(db,'quiz_tokens/_settings'),{enabled,changedAt:Date.now()});
    qrEnabled=enabled;
    fl('fOk',enabled?'✅ QR-заказы включены — распечатанные коды работают':'⏸ QR-заказы выключены. Коды сохранены для следующего мероприятия');
  }catch(e){console.error('QR mode',e);fl('fErr','Не удалось изменить режим QR. Проверьте связь и повторите.');}
  finally{qrBusy=false;renderQrControls();}
}
export const prepareQuiz=()=>setQrEnabled(true);
export const finishQuiz=()=>setQrEnabled(false);
export async function printAllQr(){
  const win=window.open('','_blank');
  if(!win){fl('fInfo','Разрешите всплывающие окна для печати');return;}
  win.document.write('<p>Готовим постоянные QR-коды…</p>');
  try{const tokens=await permanentQrTokens(QR_TABLES);printQrCards(win,tokens);}
  catch(e){console.error('print QR',e);win.close();fl('fErr','Не удалось подготовить QR-коды. Проверьте связь и повторите.');}
}
