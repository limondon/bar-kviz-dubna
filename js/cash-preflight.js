import{addonName,cashCatalogReady,cashPartsTotal,cashRuleKey}from'./cash-rules.js';

const money=k=>(k/100).toLocaleString('ru-RU')+' ₽';
const section=addon=>addon?'Добавки':'Наши товары';

// Match CashMappings.resolve on the terminal: a full variant takes precedence.
export async function checkCashRows(rows,device){
  if(!cashCatalogReady(device?.catalog))return ['На Эвоторе откройте «Счета с сайта» и обновите каталог для сайта. Затем повторите проверку.'];
  const settings=device.settings;
  if(!settings||settings.schema!==1)return ['Откройте «Касса Эвотор» и настройте соответствия для этой кассы.'];
  const issues=new Set(),quantities=new Map(),keys=new Map();
  function key(name,addon){
    const id=JSON.stringify([name,addon]);
    if(!keys.has(id))keys.set(id,cashRuleKey(name,addon));
    return keys.get(id);
  }
  for(const [, , ,name,qty,kopecks] of rows){
    const exact=settings.products?.[await key(name,false)];
    const plus=name.indexOf(' + ');
    const composite=!exact&&!/\s[—–-]\s/u.test(name)&&plus!==-1;
    const components=composite?
      [[name.slice(0,plus).trim(),false],...name.slice(plus+3).split(',').map(a=>[a.trim(),true])]:
      [[name,false]];
    let ok=true,sum=0,partsCount=0;
    const breakdown=[];
    for(const [component,addon] of components){
      const problem=message=>{issues.add('«'+name+'» — '+message);ok=false;};
      if(!component){problem('пустое название. Исправьте состав позиции в заказе.');continue;}
      const rule=settings[addon?'addons':'products']?.[await key(component,addon)];
      const where='«Касса Эвотор» → «'+section(addon)+'»';
      if(!rule){
        problem('в '+where+' добавьте соответствие для «'+component+'».');continue;
      }
      try{
        const normalized=s=>addon?addonName(s):s.trim();
        if(typeof rule.name!=='string'||normalized(rule.name)!==normalized(component)||
          !Array.isArray(rule.parts)||rule.parts.some(p=>!p||typeof p.uuid!=='string'||!p.uuid||typeof p.fingerprint!=='string'||!p.fingerprint))
          throw Error('Сохраните соответствие заново.');
        const total=cashPartsTotal(rule.parts,device.catalog);
        sum+=total;partsCount+=rule.parts.length;
        breakdown.push(component+' '+money(total));
        for(const part of rule.parts)quantities.set(part.uuid,(quantities.get(part.uuid)||0)+qty*part.units);
      }catch(e){problem('в '+where+' проверьте «'+component+'». '+e.message);}
    }
    if(partsCount>24)issues.add('«'+name+'» — больше 24 компонентов. Проверьте количество карточек в соответствиях.');
    if(ok&&sum!==kopecks)issues.add('«'+name+'» — за штуку в счёте '+money(kopecks)+', по каталогу кассы '+money(sum)+
      (composite?' ('+breakdown.join(' + ')+')':'')+'. Сверьте цену заказа и выбранные карточки в «Касса Эвотор».');
  }
  if(!issues.size&&[...quantities.values()].reduce((n,qty)=>n+Math.ceil(qty/100),0)>200)
    issues.add('После объединения карточек в чеке больше 200 строк. Проверьте количества товаров и карточек в соответствиях.');
  return [...issues];
}
