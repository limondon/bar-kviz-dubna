// Derived view only: rows retain their original order and item references.
const text=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);

function closedOrder(order,tables){
  if(['done','completed','cancelled','canceled','closed','deleted'].includes(order.status))return true;
  const meta=tables[order.date+'_'+order.table];
  if(!meta)return false;
  const sid=order.sid||'default';
  if((meta.closedSessions||[]).some(s=>s.sid===sid))return true;
  return meta.status==='closed'&&(meta.sid||'default')===sid;
}

function identity(item,order,names){
  // id / _fbKey identify an ORDER LINE, never a menu product in the legacy model.
  const productField=['menuItemId','productId','itemId'].find(k=>item[k]!=null&&item[k]!=='');
  const name=text(item.name);
  const variants=[name,item.option??null,item.options??null,item.addons??null,item.variantId??null];
  if(productField)return stable(['product',productField,item[productField],variants]);
  // Legacy names include selected flavours/addons. Never strip their suffixes.
  // Ambiguous legacy products have no reliable identity: keep separate lines.
  const base=name.split(/\s+[—–-]\s+|\s+\+\s+/)[0];
  const menuName=names.has(name)?name:base;
  if((names.get(menuName)||0)>1)return stable(['line',order.id,item._fbKey||item.id]);
  // Staff text orders omit price; guest orders include it. A unique menu match
  // lets both sources share a group without treating price as product identity.
  if(names.get(menuName)===1)return stable(['legacy-menu',variants]);
  return stable(['legacy',variants,item.price??null,item.categoryId??null]);
}

export function groupQueueItems(orders,tables={},menu=[],filter='all'){
  const names=new Map();
  for(const category of menu)for(const item of category.items||[]){
    const name=text(item.name);names.set(name,(names.get(name)||0)+1);
  }
  const groups=new Map();
  // FIFO, then existing item iteration order; quantities never affect priority.
  const active=orders.filter(o=>!closedOrder(o,tables)).slice().sort((a,b)=>(Number(a.createdAt)||0)-(Number(b.createdAt)||0));
  for(const order of active)for(const item of order.items||[]){
    if(!['new','making','ready'].includes(item.status)||!(Number(item.qty)>0))continue;
    const key=identity(item,order,names);
    if(!groups.has(key))groups.set(key,{key,name:item.name,rows:[]});
    groups.get(key).rows.push({order,item});
  }
  return [...groups.values()].map(group=>{
    const rows=group.rows.filter(({order,item})=>filter==='all'||filter===item.status||filter==='t'+order.table);
    const counts={new:0,making:0,ready:0};
    rows.forEach(({item})=>counts[item.status]+=Number(item.qty));
    return {...group,rows,counts,total:counts.new+counts.making+counts.ready,remaining:counts.new+counts.making};
  }).filter(group=>group.rows.length);
}
