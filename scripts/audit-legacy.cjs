'use strict';
const fs=require('node:fs'),path=require('node:path');
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const base=name=>String(name).replace(/\s+[—–-]\s+.+$/,'').replace(/\s+\+\s+.+$/,'').trim().toLowerCase();
const money=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
function auditLegacy(root){
  if(root?.live?.schemaVersion===2)root={...root.live,orders:root.live.orders||{}};
  if(!record(root)||!Object.hasOwn(root,'orders')||(root.orders!=null&&!record(root.orders)))throw new Error('Expected a full RTDB JSON export with an orders object (or orders: null).');
  const issues=[],products=[];
  const add=(code,orderKey,itemKey)=>issues.push({code,...(orderKey!==undefined?{orderKey}:{}),...(itemKey!==undefined?{itemKey}:{})});
  for(const [ck,cat] of Object.entries(root.menu2||{}))for(const [ik,item] of Object.entries(cat?.items||{}))if(item&&typeof item.name==='string')products.push({...item,path:ck+'/'+ik});
  const ids=new Set();for(const item of products)if(item.productId){if(ids.has(item.productId))add('duplicate_catalog_product_id',undefined,item.path);ids.add(item.productId);}
  let legacyTextOrders=0,structuredOrders=0;
  for(const [key,order] of Object.entries(root.orders||{})){
    if(!record(order)){add('invalid_order',key);continue;}
    if(order.id&&order.id!==key)add('order_id_mismatch',key);
    if(!validDate(order.date))add('invalid_date',key);
    if(!order.sid)add('missing_session',key);
    if(typeof order.items==='string'){
      legacyTextOrders++;add('legacy_text_requires_review',key);add('missing_price_snapshots',key);continue;
    }
    if(!order.items||typeof order.items!=='object'||!Object.keys(order.items).length){add('missing_items',key);continue;}
    structuredOrders++;let sum=0,complete=true;const lineIds=new Set();
    for(const [itemKey,line] of Object.entries(order.items)){
      if(!record(line)||typeof line.name!=='string'||!line.name.trim()){add('invalid_item',key,itemKey);complete=false;continue;}
      if(!line.id)add('missing_item_id',key,itemKey);
      else{if(lineIds.has(line.id))add('duplicate_item_id',key,itemKey);lineIds.add(line.id);}
      const qtyOK=Number.isSafeInteger(line.qty)&&line.qty>0;
      if(!qtyOK){add('invalid_quantity',key,itemKey);complete=false;}
      if(!money(line.price)){add(line.price==null?'missing_price_snapshot':'invalid_price',key,itemKey);complete=false;}
      else if(qtyOK)sum+=line.price*line.qty;
      if(!['new','making','ready','done'].includes(line.status))add('invalid_item_status',key,itemKey);
      const service=/^(?:\d+\s+)?круж(?:ка|ки|ек)$/i.test(line.name)||line.name.startsWith('Пробковый сбор — ');
      if(!service){
        const matches=products.filter(p=>line.productId?p.productId===line.productId:line.productName?p.name===line.productName:base(p.name)===base(line.name));
        if(!matches.length)add('product_not_found',key,itemKey);
        else if(matches.length>1)add('ambiguous_product',key,itemKey);
        if(!line.productId)add('missing_product_id',key,itemKey);
      }
      const meta=root.tables?.[order.date+'_'+order.table];
      if(meta&&line.status!=='done'&&((meta.sid||'default')!==(order.sid||'default')||meta.status==='closed'))add('unfinished_order_outside_open_session',key,itemKey);
    }
    if(!money(order.total))add('missing_or_invalid_total',key);
    else if(complete&&Math.abs(sum-order.total)>.005)add('total_mismatch',key);
  }
  const counts={};for(const issue of issues)counts[issue.code]=(counts[issue.code]||0)+1;
  return{readOnly:true,summary:{orders:Object.keys(root.orders||{}).length,structuredOrders,legacyTextOrders,ordersWithIssues:new Set(issues.map(i=>i.orderKey).filter(k=>k!==undefined)).size,issues:issues.length},counts,issues};
}
if(require.main===module){
  try{
    const args=process.argv.slice(2),input=args[args.indexOf('--input')+1],output=args.includes('--output')?args[args.indexOf('--output')+1]:null;
    if(!args.includes('--input')||!input||input.startsWith('--')||args.includes('--output')&&(!output||output.startsWith('--')))throw new Error('Usage: node scripts/audit-legacy.cjs --input export.json [--output report.json]');
    if(output&&(path.resolve(input)===path.resolve(output)||(fs.existsSync(output)&&fs.realpathSync(input)===fs.realpathSync(output))))throw new Error('The report must not overwrite the source export.');
    const report=auditLegacy(JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,''))),json=JSON.stringify(report,null,2)+'\n';
    if(output){fs.writeFileSync(output,json,{flag:'wx'});console.log(JSON.stringify(report.summary));}else process.stdout.write(json);
  }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={auditLegacy};
