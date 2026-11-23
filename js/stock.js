import{S}from'./state.js';
import{db,ref,runTransaction}from'./firebase.js';
import{BUILTIN_MENU}from'./menu-data.js';
import{itemKey}from'./utils.js';

// Firebase applies these increments in the same commit as the order.
export function staffStockWrites(items,increment){
  const quantities=new Map();
  for(const item of items){
    const key=itemKey(item.name);
    quantities.set(key,(quantities.get(key)||0)+item.qty);
  }
  const writes={},stockRows=[];
  S.BUILTIN_MENU_LIVE.forEach((category,ci)=>(category.items||[]).forEach((item,ii)=>{
    const qty=quantities.get(itemKey(item.name));
    if(!qty||item.stock==null||item.stock==='')return;
    if(Number(item.stock)<qty)throw Error('Недостаточно остатков: '+item.name);
    writes['menu2/'+ci+'/items/'+ii+'/stock']=increment(-qty);
    stockRows.push({category:String(ci),item:String(ii),name:item.name});
  }));
  return {writes,stockRows};
}

export async function applyStockDeltas(deltas){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const txs=[];
  for(const{name,delta}of deltas){
    if(!delta)continue;
    const key=itemKey(name);
    for(let ci=0;ci<menu.length;ci++){
      const catItems=menu[ci].items||[];
      for(let ii=0;ii<catItems.length;ii++){
        const it=catItems[ii];
        if(itemKey(it.name)===key){
          const s=it.stock===undefined||it.stock===null||it.stock===''?null:Math.max(0,parseInt(it.stock)||0);
          if(s!==null){
            txs.push({path:`menu2/${ci}/items/${ii}/stock`,item:it,delta,name:it.name});
          }
        }
      }
    }
  }
  const applied=[];
  try{
    for(const tx of txs){
      const res=await runTransaction(ref(db,tx.path),cur=>{
        if(cur===undefined||cur===null||cur==='')return cur;
        const n=Math.max(0,parseInt(cur,10)||0);
        if(tx.delta>0&&n<tx.delta)return;
        return Math.max(0,n-tx.delta);
      });
      if(!res.committed)throw new Error(`Недостаточно остатков: ${tx.name}`);
      tx.item.stock=res.snapshot.val();
      applied.push(tx);
    }
  }catch(e){
    for(const tx of applied.reverse()){
      await runTransaction(ref(db,tx.path),cur=>{
        if(cur===undefined||cur===null||cur==='')return cur;
        const n=Math.max(0,parseInt(cur,10)||0);
        return Math.max(0,n+tx.delta);
      }).catch(()=>{});
    }
    throw e;
  }
}

export async function deductMenuStock(orderItems){
  await applyStockDeltas(orderItems.map(it=>({name:it.name,delta:it.qty})));
}
