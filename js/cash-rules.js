import{cashHash}from'./cash-bill.js';
export const cashDevicesPath='config/evotor/v1/devices';
export const addonName=name=>name.trim().toLocaleLowerCase('ru-RU');
export const cashRuleKey=(name,addon=false)=>cashHash(addon?addonName(name):name.trim());
export function cashPartsTotal(parts,catalog){
  if(!Array.isArray(parts)||!parts.length||parts.length>12)throw Error('Выберите от 1 до 12 карточек кассы.');
  let total=0;
  for(const part of parts){
    const card=catalog?.items?.[part.uuid];
    if(!card||card.supported!==true)throw Error('Карточка отсутствует или не поддерживается. Обновите каталог с кассы.');
    if(card.fingerprint!==part.fingerprint)throw Error('Карточка изменилась. Выберите её заново из обновлённого каталога.');
    if(!Number.isSafeInteger(part.units)||part.units<1||part.units>10)throw Error('Количество карточки на одну позицию: от 1 до 10.');
    if(!Number.isSafeInteger(card.priceKopecks)||card.priceKopecks<0)throw Error('У карточки некорректная цена.');
    total+=card.priceKopecks*part.units;
  }
  if(!Number.isSafeInteger(total)||total>100000000)throw Error('Некорректная сумма.');
  return total;
}
export function cashRuleState(rule,catalog,price){
  if(!rule)return'Не настроено';
  try{return cashPartsTotal(rule.parts,catalog)===Math.round(price*100)?'Настроено':'Цены различаются';}catch{return'Нужно проверить';}
}
const stable=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])):value??null);
export function editCashRules(current,changes,now){
  const next=structuredClone(current||{schema:1,revision:0});
  if(next.schema!==1)throw Error('Версия настроек не поддерживается.');
  for(const c of changes){
    if(!['products','addons'].includes(c.kind)||!/^[a-f0-9]{64}$/.test(c.key))throw Error('Неверное соответствие.');
    if(stable(next[c.kind]?.[c.key]??null)!==stable(c.before??null))return;
  }
  for(const c of changes){next[c.kind]??={};if(c.rule)next[c.kind][c.key]={...c.rule,updatedAt:now};else delete next[c.kind][c.key];}
  next.revision=(Number(next.revision)||0)+1;return next;
}
