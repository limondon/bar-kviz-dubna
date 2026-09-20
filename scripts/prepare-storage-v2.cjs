'use strict';
const fs=require('node:fs'),{createHash}=require('node:crypto');
const {selectArchive,selectClosedBackfill,archiveWrites,pruneArchive,pruneClosedSession,hasWork}=require('../functions/archive-service');
const {auditLegacy}=require('./audit-legacy.cjs');
const {isDeepStrictEqual}=require('node:util');
const KEYS=['menu2','orders','tables','config','quiz_tokens','waiterCalls','publicCounters','guestOperations','staffOperations','guestRateLimits','maintenance','pushSubscriptions','pushOutbox'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const put=(target,key,value)=>Object.defineProperty(target,key,{value,enumerable:true,configurable:true,writable:true});
function prepare(source,now=Date.now()){
  if(source?.live||source?.archive||source?.archiveOperations||source?.schemaVersion)throw new Error('Expected an unmigrated full export; reserved v2 paths already exist.');
  const audit=auditLegacy(source),output=structuredClone(source),live={schemaVersion:2,archiveEpoch:0};
  for(const key of KEYS)if(Object.hasOwn(output,key)){live[key]=output[key];delete output[key];}
  output.live=live;
  let batches=0,moved=0;
  while(true){
    const batch=selectClosedBackfill(output.live);if(!hasWork(batch))break;
    for(const [path,value] of Object.entries(archiveWrites(batch,'migration_closed_'+batches))){
      const parts=path.split('/');let target=output;
      for(const part of parts.slice(0,-1))target=target[part]??={};
      put(target,parts.at(-1),value);
    }
    output.live=pruneClosedSession(output.live,batch);batches++;moved+=Object.keys(batch.orders).length;
  }
  while(true){
    const batch=selectArchive(output.live,now);if(!hasWork(batch))break;
    for(const [path,value] of Object.entries(archiveWrites(batch,'migration_'+batches))){
      const parts=path.split('/');let target=output;
      for(const part of parts.slice(0,-1))target=target[part]??={};
      put(target,parts.at(-1),value);
    }
    output.live=pruneArchive(output.live,batch);batches++;moved+=Object.keys(batch.orders).length;
  }
  const report={version:2,at:new Date(now).toISOString(),sourceSha256:hash(source),outputSha256:hash(output),archivedOrders:moved,remainingOrders:Object.keys(output.live.orders||{}).length,batches,audit};
  return {output,report};
}
function restore(source){
  if(source?.live?.schemaVersion!==2||source.live.archivePending)throw new Error('Expected v2 export with no unfinished archive batch. Resume archiving before rollback.');
  for(const key of Object.keys(source.live))if(![...KEYS,'schemaVersion','archiveEpoch','archivePending'].includes(key))throw new Error('Unknown live path; manual rollback review required: '+key);
  const output=structuredClone(source);delete output.live;delete output.archive;delete output.archiveOperations;
  for(const key of KEYS){if(Object.hasOwn(output,key))throw new Error('Conflicting legacy path: '+key);if(Object.hasOwn(source.live,key))output[key]=structuredClone(source.live[key]);}
  const merge=(name,values)=>{for(const [id,value] of Object.entries(values||{})){const target=output[name]??={};if(Object.hasOwn(target,id)&&!isDeepStrictEqual(target[id],value))throw new Error('Conflicting archived record: '+name+'/'+id);put(target,id,structuredClone(value));}};
  for(const day of Object.values(source.archive?.days||{})){merge('orders',day.orders);merge('tables',day.tables);}
  for(const name of ['guestOperations','staffOperations'])merge(name,source.archiveOperations?.[name]);
  for(const batch of Object.values(source.archive?.maintenance||{}))for(const [name,values] of Object.entries(batch)){
    const target=name==='deliveryLog'?((output.config??={}).deliveryLog??={}):(output[name]??={});
    for(const [id,value] of Object.entries(values))if(!Object.hasOwn(target,id))put(target,id,structuredClone(value));
  }
  return {output,report:{version:1,sourceSha256:hash(source),outputSha256:hash(output),orders:Object.keys(output.orders||{}).length}};
}
if(require.main===module){
  try{
    const args=process.argv.slice(2),arg=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
    const input=arg('--input'),output=arg('--output'),report=arg('--report');
    if(!input||!output||!report||[input,output,report].some(x=>x.startsWith('--')))throw new Error('Usage: npm run prepare:storage -- --input export.json --output migrated.json --report migration-report.json');
    if(output===report||fs.existsSync(output)||fs.existsSync(report))throw new Error('Output and report must be different, new files.');
    const result=(args.includes('--rollback')?restore:prepare)(JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'')));
    fs.writeFileSync(output,JSON.stringify(result.output,null,2)+'\n',{flag:'wx'});
    fs.writeFileSync(report,JSON.stringify(result.report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({archivedOrders:result.report.archivedOrders,remainingOrders:result.report.remainingOrders,issues:result.report.audit?.summary.issues,restoredOrders:result.report.orders}));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={prepare,restore};
