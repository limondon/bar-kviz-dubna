import{db,ref,runTransaction}from'./firebase.js';

export const QR_TABLES=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,'PS1','PS2'];
const GUEST_URL='https://limondon.github.io/bar-kviz-dubna/guest.html';
export const qrUrl=(table,token)=>`${GUEST_URL}?table=${encodeURIComponent(table)}&token=${encodeURIComponent(token)}`;

// Printed credentials are separate from dated visits. Concurrent staff devices
// must receive the same code, without replacing any existing printed tokens.
export async function permanentQrTokens(tables){
  const now=Date.now();
  const candidates=Object.fromEntries(tables.map(t=>[String(t),Array.from(crypto.getRandomValues(new Uint8Array(18)),n=>n.toString(16).padStart(2,'0')).join('')]));
  const saved=await runTransaction(ref(db,'quiz_tokens'),current=>{
    const next={...(current||{})},map={...(next._tables||{})};
    for(const table of Object.keys(candidates)){
      const existing=map[table];
      if(existing&&next[existing]?.permanent===true&&String(next[existing].table)===table)continue;
      const token=candidates[table];map[table]=token;
      next[token]={table,permanent:true,createdAt:now};
    }
    next._tables=map;
    if(!next._settings)next._settings={enabled:false,changedAt:now};
    return next;
  },{applyLocally:false});
  if(!saved.committed)throw new Error('QR codes were not saved');
  const records=saved.snapshot.val();
  return Object.fromEntries(tables.map(t=>[String(t),records._tables[String(t)]]));
}

export function qrSvg(url){
  if(!window.qrcode)throw new Error('QR library is unavailable');
  const qr=window.qrcode(0,'M');qr.addData(url);qr.make();
  return qr.createSvgTag({cellSize:4,margin:16,scalable:true});
}

export function printQrCards(win,tokens,copies=1){
  const cards=Object.entries(tokens).flatMap(([table,token])=>Array.from({length:copies},()=>({table,svg:qrSvg(qrUrl(table,token))})));
  win.document.open();
  win.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Постоянные QR столов — 1708</title><style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;background:#fff;color:#000}
    .toolbar{padding:16px;text-align:center}.toolbar button{padding:12px 24px;font-size:18px;cursor:pointer}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm}.card{border:1px dashed #888;padding:4mm;text-align:center;break-inside:avoid}
    h2{margin:0;font-size:20px}.brand{font-size:12px;letter-spacing:3px;margin-bottom:2mm}svg{display:block;width:100%;max-width:48mm;height:auto;margin:1mm auto}p{font-size:12px;margin:0}
    @media print{.toolbar{display:none}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Распечатать</button><p>Коды постоянные. Включайте и выключайте приём заказов на сайте.</p></div><div class="grid">${cards.map(({table,svg})=>`<section class="card"><div class="brand">1708 LOUNGE</div><h2>Стол ${String(table).replace(/[&<>"']/g,'')}</h2>${svg}<p>Меню и заказ за стол</p></section>`).join('')}</div></body></html>`);
  win.document.close();win.focus();win.print();
}
