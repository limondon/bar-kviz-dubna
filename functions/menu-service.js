'use strict';
const {OrderError}=require('./guest-service');
const {createHash}=require('node:crypto');
const clean=value=>JSON.parse(JSON.stringify(value, (key,v)=>key==='_originPath'?undefined:v));
// Object property order is not part of a Firebase document's version.
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>key!=='stock'&&key!=='_originPath'&&value[key]!==undefined).map(key=>[key,canonical(value[key])]));
  return value;
}
const withoutStock=value=>JSON.stringify(canonical(value));
function mergeMenu(current,expected,proposed,revision='menu'){
  const normalize=menu=>Object.values(menu||{}).map(cat=>({...cat,items:Object.values(cat.items||{})}));
  current=normalize(current);expected=normalize(expected);
  if(withoutStock(current)!==withoutStock(expected))throw new OrderError('aborted','Меню изменено другим сотрудником. Обновите редактор.');
  if(!Array.isArray(proposed)||proposed.length>100)throw new OrderError('invalid-argument','Некорректное меню');
  const seen=new Set(),origins=new Set();
  return proposed.map((cat,ci)=>{
    if(!cat||typeof cat.cat!=='string'||!cat.cat.trim()||!Array.isArray(cat.items))throw new OrderError('invalid-argument','Укажите название категории');
    return {...clean(cat),items:cat.items.map((item,ii)=>{
      if(!item||typeof item.name!=='string'||!item.name.trim()||!Number.isFinite(item.price)||item.price<0)throw new OrderError('invalid-argument','Проверьте название и цену');
      const key=item.name.trim().toLowerCase();
      if(seen.has(key))throw new OrderError('invalid-argument','Название товара должно быть уникальным: '+item.name);seen.add(key);
      const row=clean(item),origin=item._originPath;
      // Only the server assigns identity; edits and reordering retain it.
      row.productId='p_'+createHash('sha256').update(revision+':'+ci+':'+ii).digest('hex');
      if(origin){
        if(origins.has(origin)||!/^\d+\/\d+$/.test(origin))throw new OrderError('invalid-argument','Некорректная исходная позиция');origins.add(origin);
        const [ci,ii]=origin.split('/'),before=expected?.[ci]?.items?.[ii],live=current?.[ci]?.items?.[ii];
        if(!before||!live)throw new OrderError('aborted','Товар изменился. Обновите редактор.');
        if(live.productId)row.productId=live.productId;
        if((item.stock??null)===(before.stock??null)){if(live.stock===undefined)delete row.stock;else row.stock=live.stock;}
        else if((live.stock??null)!==(before.stock??null))throw new OrderError('aborted','Остаток изменился во время редактирования. Проверьте его заново.');
      }
      if(row.stock!==undefined&&row.stock!==null&&(!Number.isInteger(row.stock)||row.stock<0))throw new OrderError('invalid-argument','Остаток должен быть целым неотрицательным числом');
      return row;
    })};
  });
}
function linkMenuOrders(root,current,proposed,next){
  const old=Object.values(current||{}).flatMap((cat,ci)=>Object.values(cat.items||{}).map((item,ii)=>({...item,origin:ci+'/'+ii})));
  const replacement=new Map();
  proposed.forEach((cat,ci)=>cat.items.forEach((item,ii)=>{if(item._originPath)replacement.set(item._originPath,next[ci].items[ii]);}));
  const base=name=>String(name||'').replace(/\s+[—–-]\s+.+$/,'').replace(/\s+\+\s+.+$/,'').trim().toLowerCase();
  for(const order of Object.values(root.orders||{})){
    if(order&&typeof order.items==='string'&&order.status!=='done'){
      const names=order.items.split('\n').map(line=>base(line.replace(/^\d+\s*(?:[xXхХ]\s+)?/,'').replace(/\s+[xXхХ]\d+$/,'')));
      for(const item of old)if(names.includes(base(item.name))&&replacement.get(item.origin)?.name!==item.name)throw new OrderError('failed-precondition','Товар есть в старом текстовом заказе: '+item.name+'. Сначала требуется проверка и преобразование этого заказа.');
    }
    if(!order||typeof order.items!=='object')continue;
    for(const line of Object.values(order.items||{})){
      if(!line||typeof line!=='object')continue;
      const matches=old.filter(item=>line.productId?item.productId===line.productId:line.productName?item.name===line.productName:base(item.name)===base(line.name));
      if(matches.length!==1)continue;
      const item=replacement.get(matches[0].origin);
      if(!item){
        if((line.status||'new')!=='done')throw new OrderError('failed-precondition','Товар есть в незавершённых заказах: '+matches[0].name+'. Сначала завершите или отмените позиции.');
      }else if(!line.productId)line.productId=item.productId;
    }
  }
}
module.exports={mergeMenu,linkMenuOrders};
