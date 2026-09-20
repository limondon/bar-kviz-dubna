'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {prepare}=require('./prepare-storage-v2.cjs');
const {dateAt}=require('../functions/guest-service');
const {guard,database,callable,signup}=require('./emulator-client.cjs');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const liveHistory=process.argv.includes('--live-history');
const output=path.resolve(__dirname,liveHistory?'../audit-2026-09-19/load-live-history.json':'../audit-2026-09-19/load-after-archive.json');
const counts=liveHistory?[0,1000,2000]:[0,1000,5000];
function fixture(count){
  const date=dateAt(Date.now()),oldDate=liveHistory?date:dateAt(Date.now()-60*86400000);
  const root={menu2:[{cat:'Пиво',items:[{name:'Corona',price:300,stock:200,productId:'beer-1'}]}],orders:{},tables:{[date+'_1']:{date,tNum:'1',status:'open',sid:'s1',token:'token'}},publicCounters:{orderNum:count},guestOperations:{},staffOperations:{}};
  for(let n=0;n<count;n++){
    const id='history_'+n,sid='past_'+n,table=String(2+n%18);
    root.orders[id]={id,num:n+1,date:oldDate,table,sid,status:'done',createdAt:(liveHistory?Date.now()-n:Date.now()-60*86400000+n),version:1,note:'Синтетическая история',total:900,items:{a:{id:'a',name:'Corona',qty:2,price:300,productId:'beer-1',status:'done',stockConsumed:true},b:{id:'b',name:'Corona',qty:1,price:300,productId:'beer-1',status:'done',stockConsumed:true}}};
    const tableKey=oldDate+'_'+table;root.tables[tableKey]??={date:oldDate,tNum:table,status:'closed',sid,closedSessions:[]};root.tables[tableKey].closedSessions.push({sid});
    root.guestOperations['old_'+n]={action:'placeGuestOrder',at:n,result:{id,num:n+1,total:900,table,sid,date:oldDate}};
    root.staffOperations['old_'+n]={action:'updateStaffItems',at:n,result:{id}};
  }
  return root;
}
async function run(){
  guard();fs.mkdirSync(path.dirname(output),{recursive:true});
  const guests=await Promise.all(Array.from({length:4},()=>signup()));
  const staff=await signup({email:'manager@1708.local',password:'Emulator-only-'+randomUUID()});
  const report={at:new Date().toISOString(),runtime:process.version,environment:'local Firebase Emulator; synthetic history; not production capacity',historyPlacement:liveHistory?'current-day closed orders compacted during preparation':'archive older closed orders',profiles:[]};
  for(const count of counts){
    const root=fixture(count),historyHash=digest(root.orders),date=dateAt(Date.now());
    const migrated=prepare(root);await database('/','PUT',migrated.output);
    const warm=await callable('openGuestSession',{table:'1',token:'token'},guests[0]);assert.ok(warm.result,JSON.stringify(warm));
    const menu=structuredClone(root.menu2);menu[0].items[0].description='Load test';menu[0].items[0]._originPath='0/0';
    const started=performance.now();
    const requests=Array.from({length:12},(_,i)=>callable('placeGuestOrder',{requestId:randomUUID(),table:'1',token:'token',sid:'s1',items:[{category:'0',item:'0',name:'Corona',productId:'beer-1',qty:1,option:null,addons:[]}],cups:0,note:'',expectedTotal:300},guests[i%guests.length]));
    requests.push(callable('createStaffOrder',{requestId:randomUUID(),date,table:'1',expectedSession:{sid:'s1',status:'open'},items:[{name:'Corona',qty:1}],note:'',priority:'normal'},staff));
    requests.push(callable('saveStaffMenu',{requestId:randomUUID(),expected:root.menu2,menu},staff));
    const results=await Promise.all(requests),elapsedMs=Math.round(performance.now()-started),latencies=results.map(r=>r.ms).sort((a,b)=>a-b);
    const row={historyOrders:count,seedBytes:Buffer.byteLength(JSON.stringify(root)),liveBytes:Buffer.byteLength(JSON.stringify(migrated.output.live)),archivedOrders:migrated.report.archivedOrders,concurrentRequests:results.length,elapsedMs,p50Ms:latencies[Math.ceil(latencies.length*.5)-1],p95Ms:latencies[Math.ceil(latencies.length*.95)-1],errors:results.flatMap((r,i)=>r.error?[{request:i,status:r.error.status}]:[])};
    report.profiles.push(row);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(row));
    assert.equal(row.errors.length,0,'Every request must have a confirmed result');
    const expectedLiveOrders=0;
    let live=await database();assert.equal(live.menu2[0].items[0].stock,187);assert.equal(live.publicCounters.orderNum,count+13);assert.equal(Object.keys(live.orders).length,expectedLiveOrders+13);
    const ids=results.slice(0,13).map(r=>r.result.id);assert.equal(new Set(ids.map(id=>live.orders[id].num)).size,13);
    const edit=live.orders[ids[12]],line=Object.values(edit.items)[0];
    const edits=await Promise.all([
      callable('deleteStaffOrder',{requestId:randomUUID(),orderId:ids[0]},staff),
      callable('deleteStaffOrder',{requestId:randomUUID(),orderId:ids[0]},staff),
      callable('editStaffOrder',{requestId:randomUUID(),orderId:edit.id,expectedVersion:edit.version,expectedItems:edit.items,items:[{...line,qty:2}],note:'',priority:'normal'},staff)
    ]);
    assert.ok(edits.every(r=>r.result),JSON.stringify(edits));live=await database();
    assert.equal(live.menu2[0].items[0].stock,187);assert.equal(Object.keys(live.orders).length,expectedLiveOrders+12);assert.equal(live.orders[edit.id].total,600);
    const allHistory=(await database('/archive/days/'+(liveHistory?date:dateAt(Date.now()-60*86400000))+'/orders'))||{};
    const unchanged=Object.fromEntries(Object.entries(allHistory).filter(([id])=>id.startsWith('history_')));
    // RTDB reorders object keys, so compare values rather than their wire ordering.
    assert.deepEqual(unchanged,root.orders);assert.equal(digest(root.orders),historyHash);
    row.integrity='passed: orders, unique numbers, stock, double cancellation, edit, unchanged history';fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
