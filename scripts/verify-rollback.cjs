'use strict';
const fs=require('node:fs'),{createHash}=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {restore}=require('./prepare-storage-v2.cjs');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function verifyRollback({source,rollback,rollbackReport}){
  const issues=[],add=(code,path,detail)=>issues.push({code,path,...(detail?{detail}:{})});
  const sourceHash=hash(source),outputHash=hash(rollback);
  if(source?.live?.schemaVersion!==2)add('source_schema_mismatch','source/live/schemaVersion');
  if(source?.live?.archivePending)add('unfinished_archive_batch','source/live/archivePending');
  if(!record(rollbackReport))add('missing_rollback_report','rollback-report');
  else{
    if(rollbackReport.version!==1)add('report_version_mismatch','rollback-report/version');
    if(rollbackReport.sourceSha256!==sourceHash)add('source_hash_mismatch','rollback-report/sourceSha256');
    if(rollbackReport.outputSha256!==outputHash)add('output_hash_mismatch','rollback-report/outputSha256');
  }
  for(const key of ['live','archive','archiveOperations'])if(Object.hasOwn(rollback||{},key))add('reserved_v2_path_left',key);

  const locations=new Map();
  const addOrder=(id,order,location)=>{const list=locations.get(id)||[];list.push({order,location});locations.set(id,list);};
  for(const [id,order] of Object.entries(source?.live?.orders||{}))addOrder(id,order,'live/orders/'+id);
  for(const [day,value] of Object.entries(source?.archive?.days||{}))for(const [id,order] of Object.entries(value?.orders||{}))addOrder(id,order,'archive/days/'+day+'/orders/'+id);
  for(const [id,list] of locations)if(list.length!==1)add('duplicate_source_order',id,list.map(value=>value.location).join(', '));

  const restoredOrders=rollback?.orders||{};
  for(const [id,list] of locations){
    if(!Object.hasOwn(restoredOrders,id))add('missing_restored_order','orders/'+id);
    else if(list.length===1&&!isDeepStrictEqual(restoredOrders[id],list[0].order))add('changed_restored_order','orders/'+id,list[0].location);
  }
  for(const id of Object.keys(restoredOrders))if(!locations.has(id))add('unexpected_restored_order','orders/'+id);
  if(rollbackReport&&rollbackReport.orders!==Object.keys(restoredOrders).length)add('restored_count_mismatch','rollback-report/orders');

  try{
    const expected=restore(source).output;
    if(!isDeepStrictEqual(expected,rollback))add('rollback_not_exact','rollback');
  }catch(error){add('rollback_source_rejected','source',error.message);}

  const counts={};for(const issue of issues)counts[issue.code]=(counts[issue.code]||0)+1;
  return {ok:issues.length===0,version:1,sourceSha256:sourceHash,outputSha256:outputHash,summary:{sourceOrders:locations.size,restoredOrders:Object.keys(restoredOrders).length,integrityIssues:issues.length},counts,issues};
}

const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
if(require.main===module){
  try{
    const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
    const source=arg('--source'),rollback=arg('--rollback'),report=arg('--rollback-report'),output=arg('--output');
    if(!source||!rollback||!report||!output||[source,rollback,report,output].some(value=>value.startsWith('--')))throw new Error('Usage: npm run verify:rollback -- --source fresh-v2.json --rollback rollback.json --rollback-report rollback-report.json --output rollback-verification.json');
    if(fs.existsSync(output))throw new Error('Verification output already exists: '+output);
    const result=verifyRollback({source:read(source),rollback:read(rollback),rollbackReport:read(report)});
    fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(result.summary));if(!result.ok)process.exitCode=2;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={verifyRollback};
