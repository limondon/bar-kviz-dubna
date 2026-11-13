// Receipt snapshots are independent of preparation/payment statuses. No DB writes here.
const compare=(a,b)=>a<b?-1:a>b?1:0;
const clean=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]/.test(value);
export const cashPath='config/evotor/v1/transfers';
export const isCashCup=name=>/^\s*(?:\d+\s*)?(?:кружк[аиу]|кружек)\s*$/iu.test(name);
export async function cashHash(value){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function cashBillId(date,table,sid){return cashHash([date,table,sid].join('\u001f'));}
export async function buildCashBill({date,table,sid,orders,priceFor}){
  table=String(table);
  if(/[.#$\[\]/]/.test(table))throw Error('Недопустимое название стола.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!clean(table)||!clean(sid))throw Error('Не удалось определить посещение стола.');
  const selected=orders.filter(o=>o.date===date&&String(o.table)===table&&(o.sid||'default')===sid&&!['cancelled','canceled','deleted'].includes(o.status));
  if(!selected.length)throw Error('У стола нет заказов.');
  const rows=[],seen=new Set();let estimated=false;
  for(const order of selected){
    if(!clean(order.id)||!Array.isArray(order.items))throw Error('Обновите страницу: состав заказа не распознан.');
    for(const item of order.items){
      if(isCashCup(item.name))continue;
      const id=String(item._fbKey??item.id??'');
      const productId=String(item.menuItemId??item.productId??'');
      if(!clean(id)||!clean(item.name)||(productId&&!clean(productId)))throw Error('В заказе есть неподдерживаемая позиция.');
      const qty=Number(item.qty);
      if(!Number.isSafeInteger(qty)||qty<1||qty>100)throw Error('Количество каждой строки должно быть от 1 до 100.');
      const saved=item.price!=null&&item.price!=='';
      const price=saved?Number(item.price):priceFor(item.name);
      if(price==null||!Number.isFinite(price)||price<0||Math.abs(price*100-Math.round(price*100))>0.00001)throw Error('Уточните цену позиции «'+item.name+'» в меню.');
      const kopecks=Math.round(price*100),key=JSON.stringify([order.id,id]);
      if(seen.has(key))throw Error('В заказе повторяется идентификатор строки.');
      seen.add(key);estimated||=!saved;
      rows.push([order.id,id,productId,item.name,qty,kopecks,!saved]);
    }
  }
  rows.sort((a,b)=>compare(a[0],b[0])||compare(a[1],b[1]));
  if(!rows.length||rows.length>100)throw Error('В счёте должно быть от 1 до 100 строк без кружек.');
  const total=rows.reduce((sum,row)=>sum+row[4]*row[5],0);
  if(!Number.isSafeInteger(total)||total<=0||total>100000000)throw Error('Сумма счёта вне допустимого диапазона.');
  const canonical=JSON.stringify([1,date,table,sid,rows]);
  return{schema:1,id:await cashBillId(date,table,sid),date,table,sid,canonical,digest:await cashHash(canonical),total,estimated,rows};
}
export function queueCashBill(current,bill,now){
  if(current&&current.state!=='queued'&&!(current.state==='cleared'&&Array.isArray(current.clearedAttempts)&&current.clearedAttempts.length))return;
  return{...(Array.isArray(current?.clearedAttempts)?{clearedAttempts:current.clearedAttempts}:{}),schema:1,id:bill.id,date:bill.date,table:bill.table,sid:bill.sid,canonical:bill.canonical,digest:bill.digest,state:'queued',createdAt:now};
}
