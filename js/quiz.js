import{S}from'./state.js';
import{callService}from'./firebase.js';
import{fl,showConfirm}from'./utils.js';
let quizBusy=false,pendingQuiz=null;
try{const saved=JSON.parse(sessionStorage.getItem('bar_pending_quiz')||'null');if(typeof saved?.requestId==='string')pendingQuiz=saved;}catch{}
export async function prepareQuiz(){
  if(quizBusy)return;
  if(!await showConfirm('🎯 Подготовить квиз?','Столы квиза будут открыты, старые QR квиза заменены. Новые коды действуют 18 часов или до завершения квиза.','ПОДГОТОВИТЬ'))return;
  if(quizBusy)return;
  const win=window.open('','_blank');if(!win){fl('fInfo','Разрешите всплывающие окна для печати');return;}
  quizBusy=true;
  try{
    if(!pendingQuiz){pendingQuiz={requestId:crypto.randomUUID()};try{sessionStorage.setItem('bar_pending_quiz',JSON.stringify(pendingQuiz));}catch{pendingQuiz=null;throw new Error('Не удалось сохранить состояние подготовки квиза');}}
    const result=await callService('prepareStaffQuiz',pendingQuiz);
    pendingQuiz=null;try{sessionStorage.removeItem('bar_pending_quiz');}catch{}
    const base=location.href.substring(0,location.href.lastIndexOf('/')+1);
    printQuizQR(win,result.tokens,base);fl('fOk','✅ Квиз подготовлен — QR открываются для печати');
  }catch(e){
    if(['functions/invalid-argument','functions/permission-denied','functions/failed-precondition'].includes(e.code)){pendingQuiz=null;try{sessionStorage.removeItem('bar_pending_quiz');}catch{}}
    win.close();fl('fErr',pendingQuiz?'Не удалось подтвердить подготовку. Повторите: будет проверен тот же запрос.':e.message);
  }finally{quizBusy=false;}
}
export async function finishQuiz(){
  if(quizBusy)return;
  const quizId=S.quizSession?.id??null;
  if(!await showConfirm('🏁 Завершить квиз?','Все QR-коды текущего квиза станут недействительными.','ЗАВЕРШИТЬ'))return;
  if(quizBusy)return;quizBusy=true;
  try{await callService('finishStaffQuiz',{requestId:crypto.randomUUID(),quizId});fl('fOk','✅ Квиз завершён — все QR деактивированы');}
  catch(e){fl('fErr',e.message||'Не удалось подтвердить завершение квиза');}
  finally{quizBusy=false;}
}

function printQuizQR(win,tokens,base){
  if(!win){fl('fInfo','Разрешите всплывающие окна для печати');return;}
  const tables=Object.entries(tokens);
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QR для квиза — 1708</title>
  <style>
    @page{margin:10mm;}
    *{box-sizing:border-box;}
    body{font-family:monospace;background:#fff;margin:0;padding:8mm;}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8mm;width:100%;}
    .card{border:2px solid #000;border-radius:6px;padding:8px;text-align:center;page-break-inside:avoid;break-inside:avoid;}
    canvas{display:block;margin:0 auto 6px;max-width:100%;}
    h2{margin:0;font-size:16px;font-family:monospace;}
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script></head>
  <body><div class="grid">${tables.map(([t,tok])=>`<div class="card"><h2>Стол ${t}</h2><div id="qr_${t}"></div></div>`).join('')}</div>
  <script>const _tok=${JSON.stringify(Object.fromEntries(tables))};document.querySelectorAll('[id^="qr_"]').forEach(el=>{const t=el.id.replace('qr_','');const tok=_tok[t];if(tok)new QRCode(el,{text:'${base}guest.html?table='+encodeURIComponent(t)+'&token='+tok,width:150,height:150});});<\/script></body></html>`;
  win.document.write(html);win.document.close();
  win.addEventListener('load',()=>{if(win.document.querySelectorAll('canvas').length===tables.length)win.print();else fl('fErr','Не все QR загрузились. Повторите подготовку при стабильном интернете.');},{once:true});
}
