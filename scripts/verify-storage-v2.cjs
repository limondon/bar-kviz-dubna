'use strict';
const fs=require('node:fs'),{createHash}=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {restore}=require('./prepare-storage-v2.cjs');
const {auditLegacy}=require('./audit-legacy.cjs');
const {selectClosedBackfill,hasWork}=require('../functions/archive-service');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function verifyStorage({source,migrated,migrationReport}){
  const issues=[],add=(code,path,detail)=>issues.push({code,...(path?{path}:{}),...(detail?{detail}: {})});
  if(!record(source)||!record(source.orders)&&source.orders!==null)add('invalid_source','orders');
  if(!record(migrated)||migrated.live?.schemaVersion!==2)add('invalid_schema','live/schemaVersion');
  if(migrated.live?.archivePending)add('unfinished_archive','live/archivePending');
  const sourceHash=hash(source),migratedHash=hash(migrated);
  let audit=null;
  try{audit=auditLegacy(source);}catch(e){add('source_audit_failed','source',e.message);}
  if(!record(migrationReport))add('missing_migration_report','migration-report');
  else{
    if(migrationReport.version!==2)add('report_version_mismatch','migration-report/version');
    if(migrationReport.sourceSha256!==sourceHash)add('source_hash_mismatch','migration-report/sourceSha256');
    if(migrationReport.outputSha256!==migratedHash)add('output_hash_mismatch','migration-report/outputSha256');
    if(audit&&!isDeepStrictEqual(migrationReport.audit,audit))add('audit_report_mismatch','migration-report/audit');
  }
  const locations=new Map(),liveOrders=migrated.live?.orders||{},archiveDays=migrated.archive?.days||{};
  const addOrder=(id,order,location)=>{const list=locations.get(id)||[];list.push({order,location});locations.set(id,list);};
  for(const [id,order] of Object.entries(liveOrders))addOrder(id,order,'live/orders/'+id);
  for(const [day,value] of Object.entries(archiveDays))for(const [id,order] of Object.entries(value?.orders||{})){
    const location='archive/days/'+day+'/orders/'+id;addOrder(id,order,location);
    if(order?.date!==day)add('archive_day_mismatch',location);
    const table=value?.tables?.[order?.date+'_'+order?.table];
    if(!table)add('missing_archive_table',location);
    if(!record(order)||order.id!==id||!validDate(order.date)||!record(order.items)||!Object.keys(order.items).length)add('invalid_archived_order',location);
    else{
      let total=0,valid=true;
      for(const line of Object.values(order.items)){if(!record(line)||line.status!=='done'||!Number.isSafeInteger(line.qty)||line.qty<1||typeof line.price!=='number'||!Number.isFinite(line.price)||line.price<0){valid=false;break;}total+=line.qty*line.price;}
      if(!valid||!Number.isFinite(order.total)||Math.abs(total-order.total)>.005)add('invalid_archived_total',location);
    }
  }
  for(const [id,list] of locations)if(list.length!==1)add('duplicate_order_id',id,list.map(v=>v.location).join(', '));
  const sourceOrders=source.orders||{};
  for(const [id,order] of Object.entries(sourceOrders)){
    const list=locations.get(id)||[];
    if(!list.length)add('missing_order',id);
    else if(list.length===1&&!isDeepStrictEqual(list[0].order,order))add('changed_order',id,list[0].location);
  }
  for(const id of locations.keys())if(!Object.hasOwn(sourceOrders,id))add('unexpected_order',id);
  if(migrated.live?.schemaVersion===2&&hasWork(selectClosedBackfill(migrated.live)))add('closed_orders_left_live','live/orders');
  const productIds=new Set();
  for(const [ck,cat] of Object.entries(migrated.live?.menu2||{}))for(const [ik,item] of Object.entries(cat?.items||{}))if(item){
    const p='live/menu2/'+ck+'/items/'+ik;
    if(item.stock!==undefined&&item.stock!==null&&item.stock!==''&&(!Number.isSafeInteger(Number(item.stock))||Number(item.stock)<0))add('invalid_stock',p+'/stock');
    if(item.productId){if(productIds.has(item.productId))add('duplicate_product_id',p+'/productId');productIds.add(item.productId);}
  }
  if(migrated.live?.publicCounters?.orderNum!==undefined&&(!Number.isSafeInteger(migrated.live.publicCounters.orderNum)||migrated.live.publicCounters.orderNum<0))add('invalid_order_counter','live/publicCounters/orderNum');
  try{const restored=restore(migrated).output;if(!isDeepStrictEqual(restored,source))add('rollback_not_exact','rollback');}catch(e){add('rollback_failed','rollback',e.message);}
  const archivedOrders=[...locations.values()].filter(list=>list[0]?.location.startsWith('archive/')).length;
  if(migrationReport){if(migrationReport.archivedOrders!==archivedOrders)add('archived_count_mismatch','migration-report/archivedOrders');if(migrationReport.remainingOrders!==Object.keys(liveOrders).length)add('live_count_mismatch','migration-report/remainingOrders');}
  const counts={};for(const issue of issues)counts[issue.code]=(counts[issue.code]||0)+1;
  return {ok:issues.length===0,version:2,sourceSha256:sourceHash,outputSha256:migratedHash,summary:{sourceOrders:Object.keys(sourceOrders).length,liveOrders:Object.keys(liveOrders).length,archivedOrders,integrityIssues:issues.length,auditIssues:audit?.summary?.issues??null},auditCounts:audit?.counts||{},counts,issues};
}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
if(require.main===module){
  try{
    const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:null,source=arg('--source'),migration=arg('--migration'),report=arg('--migration-report'),output=arg('--output');
    if(!source||!migration||!report||!output||[source,migration,report,output].some(v=>v.startsWith('--')))throw new Error('Usage: npm run verify:storage -- --source export.json --migration migrated.json --migration-report migration-report.json --output verification.json');
    if(fs.existsSync(output))throw new Error('Verification output already exists: '+output);
    const result=verifyStorage({source:read(source),migrated:read(migration),migrationReport:read(report)});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result.summary));if(!result.ok)process.exitCode=2;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={verifyStorage};
