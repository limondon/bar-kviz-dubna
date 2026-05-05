import{S}from'./state.js';
import{db,update,ref}from'./firebase.js';
import{BUILTIN_MENU}from'./menu-data.js';

export async function applyStockDeltas(deltas){
  const menu=S.BUILTIN_MENU_LIVE.length?S.BUILTIN_MENU_LIVE:BUILTIN_MENU;
  const upd={};
  for(const{name,delta}of deltas){
    if(!delta)continue;
    const key=name.trim().toLowerCase();
    for(let ci=0;ci<menu.length;ci++){
      const catItems=menu[ci].items||[];
      for(let ii=0;ii<catItems.length;ii++){
        const it=catItems[ii];
        if(it.name.trim().toLowerCase()===key){
          const s=it.stock===undefined||it.stock===null||it.stock===''?null:Math.max(0,parseInt(it.stock)||0);
          if(s!==null){
            const ns=Math.max(0,s-delta);
            upd[`menu2/${ci}/items/${ii}/stock`]=ns;
            it.stock=ns;
          }
        }
      }
    }
  }
  if(Object.keys(upd).length)await update(ref(db),upd);
}

export async function deductMenuStock(orderItems){
  await applyStockDeltas(orderItems.map(it=>({name:it.name,delta:it.qty})));
}
