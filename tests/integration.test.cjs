'use strict';
const {test,before,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {dateAt}=require('../functions/guest-service');
const project='demo-bar-1708';
// Deliberately refuse any external host or production project, even if env is misconfigured.
assert.equal(process.env.GCLOUD_PROJECT,project,'Run through the demo emulator launcher');
assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST,'127.0.0.1:9000');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
const namespace=project+'-default-rtdb';
const date=()=>dateAt(Date.now());
const fixture=()=>({schemaVersion:2,menu2:[{cat:'Пиво',items:[{name:'Corona',price:300,stock:5}]}],tables:{[date()+'_1']:{date:date(),tNum:'1',status:'open',sid:'s1',token:'token'}},orders:{},publicCounters:{orderNum:0}});
const payload=(extra={})=>({requestId:randomUUID(),table:'1',token:'token',sid:'s1',items:[{category:'0',item:'0',name:'Corona',qty:1,option:null,addons:[]}],cups:0,note:'',expectedTotal:300,...extra});
async function database(path='',method='GET',body,token='owner'){
  path=path.startsWith('/')?path.slice(1):'live'+(path?'/'+path:'');
  const url=new URL(`http://127.0.0.1:9000/${path}.json`);url.searchParams.set('ns',namespace);
  if(token!=='owner')url.searchParams.set('auth',token);
  const response=await fetch(url,{method,headers:token==='owner'?{Authorization:'Bearer owner'}:{},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  return {status:response.status,data:await response.json()};
}
async function callable(action,data,token){
  const response=await fetch(`http://127.0.0.1:5001/${project}/us-central1/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({data}),signal:AbortSignal.timeout(45000)});
  return response.json();
}
async function signup(extra={}){
  const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true,...extra})});
  const result=await response.json();assert.ok(result.idToken,'Emulator signup must return a token');return result.idToken;
}
let guest1,guest2,staff;
before(async()=>{
  guest1=await signup();guest2=await signup();staff=await signup({email:'manager@1708.local',password:'Emulator-only-'+randomUUID()});
});
beforeEach(async()=>{const result=await database('/','PUT',{live:fixture()});assert.equal(result.status,200);});

test('real rules deny guest writes and private reads while permitting menu and shared staff access',async()=>{
  for(const path of ['orders/forged','menu2/0/items/0/stock','waiterCalls/forged','tables/forged','quiz_tokens/forged']){
    const res=await database(path,'PUT',{test:true},guest1);assert.equal(res.status,401,`Guest write must fail: ${path}`);
  }
  for(const path of ['tables','quiz_tokens','guestOperations','staffOperations','pushSubscriptions'])assert.equal((await database(path,'GET',undefined,guest1)).status,401,`Guest read must fail: ${path}`);
  assert.equal((await database('menu2','GET',undefined,guest1)).status,200);
  assert.equal((await database('orders','GET',undefined,staff)).status,200);
  assert.equal((await callable('createStaffOrder',{},guest1)).error.status,'PERMISSION_DENIED');
  assert.equal((await callable('openGuestSession',{table:'1',token:'token'})).error.status,'UNAUTHENTICATED');
});

test('staff device registers a private role-scoped push endpoint and can remove it',async()=>{
  const subscription={endpoint:'https://push.example/device',keys:{p256dh:'A'.repeat(65),auth:'B'.repeat(22)}};
  assert.equal((await callable('registerPushSubscription',{subscription,role:'barman'},guest1)).error.status,'PERMISSION_DENIED');
  assert.match((await callable('getPushPublicKey',{},staff)).result?.publicKey||'',/^[A-Za-z0-9_-]+$/);
  const added=await callable('registerPushSubscription',{subscription,role:'barman'},staff);assert.ok(added.result?.id,JSON.stringify(added));
  const saved=(await database('pushSubscriptions/'+added.result.id)).data;assert.equal(saved.role,'barman');assert.equal(saved.subscription.endpoint,subscription.endpoint);
  assert.equal((await database('pushSubscriptions/'+added.result.id,'GET',undefined,staff)).status,401);
  assert.equal((await callable('unregisterPushSubscription',{subscription},staff)).result?.removed,true);
  assert.equal((await database('pushSubscriptions/'+added.result.id)).data,null);
});

test('real callable validates price and returns the active session',async()=>{
  const open=await callable('openGuestSession',{table:'1',token:'token'},guest1);assert.equal(open.result?.sid,'s1');
  const rejected=await callable('placeGuestOrder',payload({expectedTotal:1}),guest1);assert.equal(rejected.error?.status,'FAILED_PRECONDITION');
  const root=(await database()).data;assert.equal(root.menu2[0].items[0].stock,5);assert.equal(root.publicCounters.orderNum,0);
});

test('maintenance atomically blocks new writes, preserves accepted retries and resumes safely',{timeout:60000},async()=>{
  const acceptedPayload=payload(),accepted=await callable('placeGuestOrder',acceptedPayload,guest1);assert.ok(accepted.result,JSON.stringify(accepted));
  assert.equal((await callable('setMaintenanceMode',{requestId:randomUUID(),enabled:true,expectedEnabled:false,reason:'Проверка выпуска'},guest1)).error.status,'PERMISSION_DENIED');
  const enableId=randomUUID(),enabled=await callable('setMaintenanceMode',{requestId:enableId,enabled:true,expectedEnabled:false,reason:'Проверка выпуска'},staff);assert.equal(enabled.result?.enabled,true,JSON.stringify(enabled));
  assert.equal((await callable('placeGuestOrder',payload(),guest2)).error.status,'UNAVAILABLE');
  assert.deepEqual((await callable('placeGuestOrder',acceptedPayload,guest1)).result,accepted.result);
  assert.equal((await callable('runStaffArchive',{},staff)).error.status,'FAILED_PRECONDITION');
  let root=(await database()).data;assert.equal(Object.keys(root.orders).length,1);assert.equal(root.menu2[0].items[0].stock,4);assert.equal(root.maintenance.reason,'Проверка выпуска');
  const disabled=await callable('setMaintenanceMode',{requestId:randomUUID(),enabled:false,expectedEnabled:true,reason:''},staff);assert.equal(disabled.result?.enabled,false,JSON.stringify(disabled));
  assert.ok((await callable('placeGuestOrder',payload(),guest2)).result);root=(await database()).data;assert.equal(root.maintenance,undefined);assert.equal(Object.keys(root.orders).length,2);
});

test('two real clients competing for the last unit produce exactly one order',{timeout:60000},async()=>{
  await database('menu2/0/items/0/stock','PUT',1);
  const results=await Promise.all([callable('placeGuestOrder',payload(),guest1),callable('placeGuestOrder',payload(),guest2)]);
  assert.equal(results.filter(r=>r.result).length,1,JSON.stringify(results));assert.equal(results.filter(r=>r.error?.status==='FAILED_PRECONDITION').length,1);
  const root=(await database()).data;assert.equal(Object.keys(root.orders).length,1);assert.equal(root.menu2[0].items[0].stock,0);assert.equal(root.publicCounters.orderNum,1);
});

test('concurrent retries of one real request return one receipt and one stock deduction',{timeout:60000},async()=>{
  const p=payload(),results=await Promise.all([callable('placeGuestOrder',p,guest1),callable('placeGuestOrder',p,guest1)]);
  assert.ok(results[0].result,JSON.stringify(results));assert.deepEqual(results[0].result,results[1].result);
  const root=(await database()).data;assert.equal(Object.keys(root.orders).length,1);assert.equal(root.menu2[0].items[0].stock,4);assert.equal(root.publicCounters.orderNum,1);
});

test('twelve simultaneous real orders retain distinct numbers and matching stock',{timeout:60000},async()=>{
  await database('menu2/0/items/0/stock','PUT',20);
  const started=Date.now(),results=await Promise.all(Array.from({length:12},()=>callable('placeGuestOrder',payload(),guest1)));
  assert.ok(results.every(r=>r.result),JSON.stringify(results));assert.equal(new Set(results.map(r=>r.result.num)).size,12);
  const root=(await database()).data;assert.equal(Object.keys(root.orders).length,12);assert.equal(root.menu2[0].items[0].stock,8);assert.equal(root.publicCounters.orderNum,12);
  console.log(`Local emulator burst: 12 requests completed in ${Date.now()-started} ms (not production capacity)`);
});

test('real staff callable rejects a stale session but recovers an accepted receipt',async()=>{
  const p={requestId:randomUUID(),table:'1',date:date(),expectedSession:{sid:'s1',status:'open'},items:[{name:'Corona',qty:1}],note:'',priority:'normal'};
  const accepted=await callable('createStaffOrder',p,staff);assert.ok(accepted.result,JSON.stringify(accepted));
  await database('tables/'+date()+'_1/sid','PUT','replacement');
  const retry=await callable('createStaffOrder',p,staff);assert.deepEqual(retry.result,accepted.result);
  const rejected=await callable('createStaffOrder',{...p,requestId:randomUUID()},staff);assert.equal(rejected.error?.status,'ABORTED');
  const root=(await database()).data;assert.equal(Object.keys(root.orders).length,1);assert.equal(root.menu2[0].items[0].stock,4);
});
test('closing immediately compacts a bill and reopening restores the exact snapshot',{timeout:60000},async()=>{
  const created=await callable('createStaffOrder',{requestId:randomUUID(),table:'1',date:date(),expectedSession:{sid:'s1',status:'open'},items:[{name:'Corona',qty:1}],note:'exact',priority:'normal'},staff);
  assert.ok(created.result,JSON.stringify(created));
  const id=created.result.id,root=(await database()).data;
  root.orders[id].items[Object.keys(root.orders[id].items)[0]].status='done';root.orders[id].status='done';root.orders[id].doneAt=Date.now();
  await database('/','PUT',{live:root});
  const requestId=randomUUID(),closed=await callable('closeStaffTable',{requestId,date:date(),table:'1',sid:'s1'},staff);assert.ok(closed.result,JSON.stringify(closed));
  assert.equal((await database('orders/'+id)).data,null);const archived=(await database('/archive/days/'+date()+'/orders/'+id)).data;assert.equal(archived.note,'exact');assert.equal(archived.total,300);
  assert.equal((await callable('getStaffStats',{},guest1)).error.status,'PERMISSION_DENIED');const closedStats=await callable('getStaffStats',{},staff);assert.equal(closedStats.result.today.orders,1);assert.equal(closedStats.result.today.done,1);
  const retry=await callable('closeStaffTable',{requestId,date:date(),table:'1',sid:'s1'},staff);assert.deepEqual(retry.result,closed.result);assert.equal((await database('orders/'+id)).data,null);
  const reopened=await callable('reopenStaffTable',{requestId:randomUUID(),date:date(),table:'1',sid:'s1'},staff);assert.ok(reopened.result,JSON.stringify(reopened));
  assert.deepEqual((await database('orders/'+id)).data,archived);assert.equal((await database('/archive/days/'+date()+'/orders/'+id)).data,null);assert.equal((await database('tables/'+date()+'_1/status')).data,'open');assert.equal((await callable('getStaffStats',{},staff)).result.today.orders,1);
});

test('concurrent menu edit and guest order do not restore the old stock',{timeout:60000},async()=>{
  const expected=fixture().menu2,menu=structuredClone(expected);menu[0].items[0].description='Changed';menu[0].items[0]._originPath='0/0';
  const results=await Promise.all([callable('saveStaffMenu',{requestId:randomUUID(),menu,expected},staff),callable('placeGuestOrder',payload(),guest1)]);
  assert.ok(results[0].result,JSON.stringify(results));
  // Assigning product IDs may reject the older guest cart. Neither outcome may restore stock.
  const root=(await database()).data;
  if(results[1].result){assert.equal(root.menu2[0].items[0].stock,4);assert.equal(Object.keys(root.orders).length,1);}
  else{assert.equal(results[1].error?.status,'FAILED_PRECONDITION');assert.equal(root.menu2[0].items[0].stock,5);assert.equal(Object.keys(root.orders||{}).length,0);}
  assert.equal(root.menu2[0].items[0].description,'Changed');
});

test('real archive copies closed orders, retains unfinished records, and reads private pages',{timeout:60000},async()=>{
  const old=dateAt(Date.now()-60*86400000),base={date:old,table:'2',sid:'old',status:'done',num:9,total:300,items:{i:{name:'Corona',qty:1,price:300,status:'done'}}};
  const orders={};for(let n=0;n<102;n++){const id='history_'+String(n).padStart(3,'0');orders[id]={...base,id};}
  orders.unfinished={...base,id:'unfinished',table:'3',items:{i:{name:'Corona',qty:1,price:300,status:'new'}}};
  orders.sameBill={...base,id:'sameBill',table:'3'};
  await database('orders','PUT',orders);await database('tables/'+old+'_2','PUT',{date:old,tNum:'2',sid:'old',status:'closed'});
  await database('tables/'+old+'_3','PUT',{date:old,tNum:'3',sid:'old',status:'closed'});
  assert.equal((await callable('runStaffArchive',{},guest1)).error.status,'PERMISSION_DENIED');
  const moved=await callable('runStaffArchive',{},staff);assert.equal(moved.result?.moved,102,JSON.stringify(moved));
  assert.deepEqual(Object.keys((await database('orders')).data).sort(),['sameBill','unfinished']);
  for(const token of [guest1,staff]){
    assert.equal((await database('/archive','GET',undefined,token)).status,401);
    assert.equal((await database('/archiveOperations','GET',undefined,token)).status,401);
    assert.equal((await database('menu2/0/items/0/stock','PUT',0,token)).status,401);
    assert.equal((await database('/orders/forged','PUT',{total:0},token)).status,401);
  }
  assert.equal((await callable('getStaffArchive',{date:old},guest1)).error.status,'PERMISSION_DENIED');
  const first=await callable('getStaffArchive',{date:old},staff);assert.equal(first.result.rows.length,100);
  const second=await callable('getStaffArchive',{date:old,after:first.result.next},staff);assert.equal(second.result.rows.length,2);assert.equal(second.result.next,null);
  const restored=Object.fromEntries([...first.result.rows,...second.result.rows].map(row=>[row.key,row.order]));delete orders.unfinished;delete orders.sameBill;assert.deepEqual(restored,orders);
});

test('archived guest and staff receipts recover without duplicate orders or stock changes',{timeout:60000},async()=>{
  const guestPayload=payload(),staffPayload={requestId:randomUUID(),table:'1',date:date(),expectedSession:{sid:'s1',status:'open'},items:[{name:'Corona',qty:1}],note:'',priority:'normal'};
  const g=await callable('placeGuestOrder',guestPayload,guest1),s=await callable('createStaffOrder',staffPayload,staff);
  assert.ok(g.result);assert.ok(s.result);
  for(const name of ['guestOperations','staffOperations']){
    const receipts=(await database(name)).data;for(const receipt of Object.values(receipts))receipt.at=Date.now()-60*86400000;
    await database(name,'PUT',receipts);
  }
  await callable('runStaffArchive',{},staff);
  assert.equal((await database('guestOperations')).data,null);assert.equal((await database('staffOperations')).data,null);
  await database('tables/'+date()+'_1/sid','PUT','replacement');
  assert.deepEqual((await callable('placeGuestOrder',guestPayload,guest1)).result,g.result);
  assert.deepEqual((await callable('createStaffOrder',staffPayload,staff)).result,s.result);
  assert.equal((await callable('guestCallWaiter',{requestId:guestPayload.requestId,table:'1',token:'token'},guest1)).error.status,'INVALID_ARGUMENT');
  assert.equal((await database('menu2/0/items/0/stock')).data,3);assert.equal(Object.keys((await database('orders')).data).length,2);
});

test('a durable archive lock left by an interrupted worker resumes before the next order',{timeout:60000},async()=>{
  await database('archivePending','PUT',{id:'interrupted',at:Date.now()});
  const result=await callable('placeGuestOrder',payload(),guest1);assert.ok(result.result,JSON.stringify(result));
  assert.equal((await database('archivePending')).data,null);assert.equal((await database('archiveEpoch')).data,1);
});

test('a retry racing receipt archival never replays the accepted order',{timeout:60000},async()=>{
  const p=payload(),accepted=await callable('placeGuestOrder',p,guest1);assert.ok(accepted.result);
  const receipts=(await database('guestOperations')).data;
  for(const r of Object.values(receipts))r.at=Date.now()-60*86400000;
  await database('guestOperations','PUT',receipts);
  const results=await Promise.all([callable('runStaffArchive',{},staff),callable('placeGuestOrder',p,guest1),callable('placeGuestOrder',p,guest1)]);
  assert.ok(results[0].result,JSON.stringify(results));
  for(const retry of results.slice(1)){
    if(retry.error)assert.equal(retry.error.status,'UNAVAILABLE');
    else assert.deepEqual(retry.result,accepted.result);
  }
  assert.deepEqual((await callable('placeGuestOrder',p,guest1)).result,accepted.result);
  assert.equal(Object.keys((await database('orders')).data).length,1);assert.equal((await database('menu2/0/items/0/stock')).data,4);
});
