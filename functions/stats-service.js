'use strict';
const {dateAt}=require('./guest-service');
const DAY=86400000;
function summarizeOrders(liveOrders,archiveDays,now){
  const today=dateAt(now),byId=new Map();
  for(const day of archiveDays||[])for(const [id,o] of Object.entries(day?.orders||{}))if(o&&typeof o==='object')byId.set(id,o);
  // A restored bill can briefly exist in both places while archive cleanup is
  // retried. The live version wins and the receipt is counted exactly once.
  for(const [id,o] of Object.entries(liveOrders||{}))if(o&&typeof o==='object')byId.set(id,o);
  const start=dateAt(now-29*DAY),recent=[...byId.values()].filter(o=>typeof o.date==='string'&&o.date>=start&&o.date<=today);
  const todayOrders=recent.filter(o=>o.date===today),popular=new Map(),sevenDays=[];
  for(const o of recent)for(const i of Object.values(o.items||{})){
    if(!i||typeof i.name!=='string'||!Number.isFinite(Number(i.qty)))continue;
    const key=i.name.trim().toLowerCase(),row=popular.get(key)||{name:i.name,count:0};row.count+=Number(i.qty);popular.set(key,row);
  }
  for(let i=6;i>=0;i--){
    const date=dateAt(now-i*DAY),orders=recent.filter(o=>o.date===date);
    sevenDays.push({date,orders:orders.length,tables:new Set(orders.map(o=>String(o.table))).size});
  }
  return {
    generatedAt:now,
    today:{orders:todayOrders.length,done:todayOrders.filter(o=>o.status==='done').length,tables:new Set(todayOrders.map(o=>String(o.table))).size},
    sevenDays,
    popular:[...popular.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,10)
  };
}
module.exports={summarizeOrders};
