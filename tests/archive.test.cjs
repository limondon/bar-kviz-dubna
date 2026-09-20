const {test}=require('node:test'),assert=require('node:assert/strict');
const {selectArchive,selectClosedBackfill,selectClosedSession,pruneArchive,pruneClosedSession,archiveOnce,compactClosedSession}=require('../functions/archive-service');
const {summarizeOrders}=require('../functions/stats-service');
const {prepare,restore}=require('../scripts/prepare-storage-v2.cjs');
const now=Date.parse('2026-09-17T12:00:00Z');
const fixture=()=>({schemaVersion:2,menu2:[],orders:{a:{id:'a',date:'2026-07-01',table:'1',sid:'s',num:1,total:0,items:{i:{name:'Вода',qty:1,price:0,status:'done'}}}},tables:{'2026-07-01_1':{date:'2026-07-01',tNum:'1',sid:'s',status:'closed'}},guestOperations:{receipt:{at:1,action:'placeGuestOrder',result:{id:'a'}}}});
test('archive preserves exact price snapshots, receipts and source; ignores current or unfinished orders',()=>{
  const root=fixture(),before=structuredClone(root),batch=selectArchive(root,now);
  assert.deepEqual(batch.orders,root.orders);assert.deepEqual(batch.guestOperations,root.guestOperations);
  const next=pruneArchive(root,batch);assert.deepEqual(next.orders,{});assert.equal(next.archiveEpoch,1);assert.deepEqual(root,before);
  for(const edit of [o=>o.date='2026-09-17',o=>o.items.i.status='new',o=>delete o.items.i.price,o=>o.total=9,o=>o.items='Вода',o=>o.date='bad',o=>o.date='2026-99-99']){
    const r=fixture();edit(r.orders.a);assert.deepEqual(selectArchive(r,now).orders,{});
  }
});
test('open sessions, missing metadata and altered snapshots cannot be removed',()=>{
  const root=fixture();root.tables['2026-07-01_1'].status='open';assert.deepEqual(selectArchive(root,now).orders,{});
  delete root.tables;assert.deepEqual(selectArchive(root,now).orders,{});
  const r=fixture(),batch=selectArchive(r,now);r.orders.a.total=1;assert.throws(()=>pruneArchive(r,batch),/changed/);
});
test('large closed bills are moved whole and unfinished bills remain wholly live',()=>{
  const r=fixture();for(let n=0;n<502;n++)r.orders['o'+n]={...r.orders.a,id:'o'+n};
  const first=selectArchive(r,now);assert.equal(Object.keys(first.orders).length,503);assert.deepEqual(first.tables,r.tables);
  r.orders.bad={...r.orders.a,id:'bad',items:'Некорректная строка'};
  assert.deepEqual(selectArchive(r,now).orders,{});assert.deepEqual(selectArchive(r,now).tables,{});
});
test('a newly closed session is selected immediately and pruning retains its table metadata',()=>{
  const r=fixture();r.orders.a.date='2026-09-17';r.tables={'2026-09-17_1':{date:'2026-09-17',tNum:'1',sid:'s',status:'closed',closedAt:now}};
  const batch=selectClosedSession(r,'2026-09-17','1','s');assert.deepEqual(batch.orders,r.orders);
  const next=pruneClosedSession(r,batch);assert.deepEqual(next.orders,{});assert.deepEqual(next.tables,r.tables);assert.equal(next.archiveEpoch,1);
});
test('backfill moves recent complete closed bills but leaves open and malformed bills live',()=>{
  const r=fixture();r.orders.a.date='2026-09-17';r.tables={'2026-09-17_1':{date:'2026-09-17',tNum:'1',sid:'s',status:'closed'}};
  assert.deepEqual(selectClosedBackfill(r).orders,r.orders);
  r.tables['2026-09-17_1'].status='open';assert.deepEqual(selectClosedBackfill(r).orders,{});
});
test('statistics merge live and archive without double-counting a restored order',()=>{
  const order={id:'a',date:'2026-09-17',table:'1',status:'done',items:{i:{name:'Вода',qty:2}}};
  const result=summarizeOrders({a:order},[{orders:{a:structuredClone(order),b:{...order,id:'b',table:'2'}}}],Date.parse('2026-09-17T12:00:00Z'));
  assert.deepEqual(result.today,{orders:2,done:2,tables:2});assert.deepEqual(result.popular,[{name:'Вода',count:4}]);
});
test('offline preparation retains all data and unknown paths and refuses a second migration',()=>{
  const source=fixture();delete source.schemaVersion;source.otherApp={keep:true};const before=structuredClone(source);
  const {output,report}=prepare(source,now);assert.equal(report.archivedOrders,1);assert.deepEqual(output.archive.days['2026-07-01'].orders,source.orders);
  assert.deepEqual(output.archiveOperations.guestOperations,source.guestOperations);assert.deepEqual(output.otherApp,source.otherApp);assert.deepEqual(source,before);
  assert.throws(()=>prepare(output,now),/unmigrated/);
});
test('rollback preparation restores archived records and retains orders accepted after migration',()=>{
  const source=fixture();delete source.schemaVersion;
  const migrated=prepare(source,now).output;
  assert.deepEqual(restore(migrated).output,source);
  migrated.live.orders.new={id:'new',total:100};
  const restored=restore(migrated).output;assert.deepEqual(restored.orders.a,source.orders.a);assert.deepEqual(restored.orders.new,{id:'new',total:100});
  migrated.live.orders.a={id:'a',total:999};assert.throws(()=>restore(migrated),/Conflicting/);
  migrated.live.archivePending={id:'pending'};assert.throws(()=>restore(migrated),/unfinished/);
});
test('valid RTDB keys matching JavaScript prototype names survive migration and rollback',()=>{
  const source=fixture();delete source.schemaVersion;
  source.orders=JSON.parse(JSON.stringify({['__proto__']:{...source.orders.a,id:'__proto__'}}));
  source.guestOperations=JSON.parse('{"__proto__":{"action":"placeGuestOrder","at":1,"result":{"id":"__proto__"}}}');
  const migrated=prepare(source,now).output;
  assert.ok(Object.hasOwn(migrated.archive.days['2026-07-01'].orders,'__proto__'));
  assert.deepEqual(restore(migrated).output,source);assert.equal({}.id,undefined);
});
function fakeDb(initial){
  let root={live:structuredClone(initial)},fail=false,failFinal=false;
  return {get root(){return root;},failCopy(){fail=true;},failPrune(){failFinal=true;},ref(path=''){
    return {transaction:async fn=>{
      // Model the empty local cache before the RTDB server supplies the value.
      if(fn(null)===undefined)return {committed:false};
      if(failFinal&&root.archive){failFinal=false;throw new Error('Stopped after copy');}
      const value=fn(structuredClone(root[path]));if(value===undefined)return {committed:false};root[path]=value;return {committed:true,snapshot:{val:()=>structuredClone(value)}};
    },update:async updates=>{if(fail){fail=false;throw new Error('Network lost');}for(const [p,v] of Object.entries(updates)){let t=root;const parts=p.split('/');for(const part of parts.slice(0,-1))t=t[part]??={};t[parts.at(-1)]=structuredClone(v);}}};
  }};
}
test('failed archive copy retains live data and durable lock; retry safely completes same batch',async()=>{
  const db=fakeDb(fixture());db.failCopy();await assert.rejects(archiveOnce(db,now,'first'),/Network lost/);
  assert.ok(db.root.live.orders.a);assert.equal(db.root.live.archivePending.id,'first');
  const result=await archiveOnce(db,now+1,'retry');assert.equal(result.moved,1);assert.equal(db.root.live.archivePending,undefined);
  assert.deepEqual(db.root.archive.days['2026-07-01'].orders,fixture().orders);assert.equal(db.root.live.orders.a,undefined);
  assert.equal((await archiveOnce(db,now+2,'again')).moved,0);
});
test('interruption after durable copy resumes without losing or duplicating archived bills',async()=>{
  const db=fakeDb(fixture());db.failPrune();await assert.rejects(archiveOnce(db,now,'first'),/after copy/);
  assert.deepEqual(db.root.archive.days['2026-07-01'].orders,db.root.live.orders);
  assert.equal((await archiveOnce(db,now+1,'retry')).moved,1);
  assert.deepEqual(db.root.archive.days['2026-07-01'].orders,fixture().orders);assert.deepEqual(db.root.live.orders,{});
});
test('immediate close keeps the bill live when copy fails and resumes the same session safely',async()=>{
  const r=fixture();r.orders.a.date='2026-09-17';r.tables={'2026-09-17_1':{date:'2026-09-17',tNum:'1',sid:'s',status:'closed',closedAt:now}};
  const db=fakeDb(r),target={date:'2026-09-17',table:'1',sid:'s'};db.failCopy();
  await assert.rejects(compactClosedSession(db,target,now,'close-1'),/Network lost/);assert.ok(db.root.live.orders.a);assert.equal(db.root.live.archivePending.kind,'closed-session');
  const result=await compactClosedSession(db,target,now+1,'retry');assert.equal(result.moved,1);assert.equal(db.root.live.orders.a,undefined);assert.equal(db.root.live.tables['2026-09-17_1'].status,'closed');assert.deepEqual(db.root.archive.days['2026-09-17'].orders.a,r.orders.a);
});
test('maintenance mode prevents scheduled and immediate archive writes',async()=>{
  const old=fixture();old.maintenance={enabled:true,enabledAt:now,reason:'Обновление системы'};
  const db=fakeDb(old),before=structuredClone(db.root);
  assert.deepEqual(await archiveOnce(db,now,'scheduled'),{moved:0});
  const recent=fixture();recent.orders.a.date='2026-09-17';recent.tables={'2026-09-17_1':{date:'2026-09-17',tNum:'1',sid:'s',status:'closed'}};recent.maintenance=old.maintenance;
  const closeDb=fakeDb(recent);assert.deepEqual(await compactClosedSession(closeDb,{date:'2026-09-17',table:'1',sid:'s'},now,'close'),{moved:0,completed:true});
  assert.deepEqual(db.root,before);assert.equal(closeDb.root.live.orders.a.id,'a');
});
