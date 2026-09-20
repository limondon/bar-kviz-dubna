'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {guard,database,callable,signup}=require('./emulator-client.cjs');
const {dateAt}=require('../functions/guest-service');

async function main(){
  guard();
  const input=process.env.REHEARSAL_INPUT;
  if(!input||!fs.existsSync(input))throw new Error('Provide an existing prepared v2 export');
  const prepared=JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,''));
  assert.equal(prepared?.live?.schemaVersion,2,'Rehearsal requires a prepared v2 export');
  assert.equal(prepared.live.archivePending,undefined,'Rehearsal refuses an unfinished archive batch');
  const originalOrders=structuredClone(prepared.live.orders||{}),originalCount=Object.keys(originalOrders).length;
  await database('/','PUT',prepared);
  const staff=await signup({email:'manager@1708.local',password:'Emulator-rehearsal-'+randomUUID()});
  const products=Object.values(prepared.live.menu2||{}).flatMap(category=>Object.values(category?.items||{}));
  const product=products.find(item=>item&&typeof item.name==='string'&&Number.isFinite(item.price)&&item.price>=0&&(item.stock===undefined||item.stock===null||item.stock===''));
  assert.ok(product,'Rehearsal needs one available catalog item without a stock limit');
  const date=dateAt(Date.now()),started=Date.now();
  const results=await Promise.all(Array.from({length:6},(_,index)=>callable('createStaffOrder',{requestId:randomUUID(),table:'ZREH'+(index+1),date,expectedSession:null,items:[{name:product.name,qty:1}],note:'',priority:'normal'},staff)));
  const elapsedMs=Date.now()-started;
  assert.ok(results.every(result=>result.result),JSON.stringify(results.map(result=>result.error||null)));
  assert.equal(new Set(results.map(result=>result.result.num)).size,6,'Rehearsal order numbers must be unique');
  let root=await database();
  assert.equal(Object.keys(root.orders||{}).length,originalCount+6,'Every rehearsal order must be stored once');
  for(const [id,order] of Object.entries(originalOrders))assert.deepEqual(root.orders[id],order,'Historical order changed: '+id);
  const enabled=await callable('setMaintenanceMode',{requestId:randomUUID(),enabled:true,expectedEnabled:false,reason:'Локальная репетиция переноса'},staff);assert.equal(enabled.result?.enabled,true,JSON.stringify(enabled));
  const blocked=await callable('createStaffOrder',{requestId:randomUUID(),table:'ZREH7',date,expectedSession:null,items:[{name:product.name,qty:1}],note:'',priority:'normal'},staff);assert.equal(blocked.error?.status,'UNAVAILABLE',JSON.stringify(blocked));
  const disabled=await callable('setMaintenanceMode',{requestId:randomUUID(),enabled:false,expectedEnabled:true,reason:''},staff);assert.equal(disabled.result?.enabled,false,JSON.stringify(disabled));
  root=await database();for(const [id,order] of Object.entries(originalOrders))assert.deepEqual(root.orders[id],order,'Historical order changed after maintenance: '+id);
  console.log(JSON.stringify({environment:'local Firebase Emulator; prepared production export copy',originalLiveOrders:originalCount,archivedOrders:Object.values(prepared.archive?.days||{}).reduce((sum,day)=>sum+Object.keys(day?.orders||{}).length,0),rehearsalOrders:6,uniqueNumbers:6,blockedDuringMaintenance:true,elapsedMs,liveBytes:Buffer.byteLength(JSON.stringify(root))}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
