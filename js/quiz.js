import{db,ref,update}from'./firebase.js';
import{fl,showConfirm}from'./utils.js';
import{genToken}from'./tables.js';

const QUIZ_TABLES=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,'PS1','PS2'];

export async function prepareQuiz(){
  const ok=await showConfirm('🎯 Подготовить квиз?','Будут сгенерированы QR-коды для всех столов.','ПОДГОТОВИТЬ');
  if(!ok)return;
  const base=location.href.substring(0,location.href.lastIndexOf('/')+1);
  const upd={};const tokens={};
  QUIZ_TABLES.forEach(t=>{const tok=genToken();tokens[t]=tok;upd['quiz_tokens/'+tok]={table:String(t),createdAt:Date.now()};});
  await update(ref(db),upd);
  printQuizQR(tokens,base);
  fl('fOk','✅ Квиз подготовлен — QR открываются для печати');
}

export async function finishQuiz(){
  const ok=await showConfirm('🏁 Завершить квиз?','Все QR-коды квиза станут недействительными.','ЗАВЕРШИТЬ');
  if(!ok)return;
  await update(ref(db,'quiz_tokens'),null);
  fl('fOk','✅ Квиз завершён — все QR деактивированы');
}

function printQuizQR(tokens,base){
  const win=window.open('','_blank');
  if(!win){fl('fInfo','Разрешите всплывающие окна для печати');return;}
  const tables=Object.entries(tokens);
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QR для квиза — 1708</title>
  <style>body{font-family:monospace;background:#fff;margin:0;padding:16px;}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;max-width:900px;margin:0 auto;}.card{border:2px solid #000;border-radius:8px;padding:12px;text-align:center;page-break-inside:avoid;}canvas{display:block;margin:0 auto 8px;}h2{margin:0 0 4px;font-size:18px;}p{margin:0;font-size:11px;color:#555;}@media print{body{padding:0;}}</style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script></head>
  <body><div class="grid">${tables.map(([t,tok])=>`<div class="card"><h2>Стол ${t}</h2><div id="qr_${t}"></div><p>${base}guest.html?table=${encodeURIComponent(t)}&token=${tok}</p></div>`).join('')}</div>
  <script>document.querySelectorAll('[id^="qr_"]').forEach(el=>{const t=el.id.replace('qr_','');const tok={"${tables.map(([t,tok])=>`${t}":"${tok}`).join('","')}"}[t];if(tok)new QRCode(el,{text:'${base}guest.html?table='+encodeURIComponent(t)+'&token='+tok,width:160,height:160});});<\/script></body></html>`;
  win.document.write(html);win.document.close();
  setTimeout(()=>win.print(),1000);
}
