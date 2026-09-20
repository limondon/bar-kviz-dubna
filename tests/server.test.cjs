const {test}=require('node:test');
const assert=require('node:assert/strict');
const {transition,dateAt}=require('../functions/guest-service');
const {staffTransition}=require('../functions/staff-service');
const {createTransactionQueue}=require('../functions/transaction-queue');
const {maintenanceTransition}=require('../functions/maintenance-service');
test('runtime transaction queue waits for prior work and recovers after rejection',async()=>{
  const queue=createTransactionQueue(),events=[];let release;
  const first=queue(async()=>{events.push('first');await new Promise(resolve=>release=resolve);throw new Error('rejected');});
  const caught=assert.rejects(first,/rejected/);
  const second=queue(async()=>{events.push('second');return 'accepted';});
  await Promise.resolve();assert.deepEqual(events,['first']);release();await caught;
  assert.equal(await second,'accepted');assert.deepEqual(events,['first','second']);
});
const now=Date.UTC(2026,8,13,16),date=dateAt(now);
const admin={uid:'staff',token:{role:'admin'}};
function fixture(){return{menu2:[{cat:'Пиво',items:[{name:'Corona',price:300,stock:5,options:['С лаймом','Добавка +50']}]},{cat:'Листовой чай',items:[{name:'Сенча',price:400,stock:2}]}],tables:{[date+'_1']:{date,tNum:'1',status:'open',sid:'s1',token:'token'}},publicCounters:{orderNum:0}};}
const input=(extra={})=>({requestId:'op1',table:'1',token:'token',sid:'s1',items:[{category:'0',item:'0',name:'Corona',qty:1,option:null,addons:[]}],cups:0,note:'',expectedTotal:300,...extra});
const place=(r,p=input(),uid='guest')=>transition(r,'placeGuestOrder',p,uid,now,'nonce');
const staff=(r,action,p,auth=admin)=>staffTransition(r,action,p,auth,now,'nonce');
const create=(r,extra={})=>{const meta=r.tables?.[date+'_'+(extra.table||'1')];return staff(r,'createStaffOrder',{requestId:'create1',table:'1',date,expectedSession:meta?{sid:meta.sid||'default',status:meta.status==='closed'?'closed':'open'}:null,items:[{name:'Corona',qty:1}],note:'',priority:'normal',...extra});};

test('maintenance mode is atomic, idempotent and restricted to a manager',()=>{
  const root={...fixture(),schemaVersion:2},enable={requestId:'maintenance-on',enabled:true,expectedEnabled:false,reason:'Обновление системы'};
  assert.throws(()=>maintenanceTransition(root,enable,{uid:'guest',token:{}},now),/менеджеру/);
  const first=maintenanceTransition(root,enable,admin,now);assert.equal(first.result.enabled,true);assert.equal(first.root.maintenance.reason,'Обновление системы');
  const retry=maintenanceTransition(first.root,enable,admin,now+1);assert.deepEqual(retry.result,first.result);assert.deepEqual(retry.root,first.root);
  assert.throws(()=>maintenanceTransition(first.root,{...enable,requestId:'stale'},admin,now+1),/уже изменён/);
  const disabled=maintenanceTransition(first.root,{requestId:'maintenance-off',enabled:false,expectedEnabled:true,reason:''},admin,now+2);assert.equal(disabled.result.enabled,false);assert.equal(disabled.root.maintenance,undefined);
  const busy={...root,archivePending:{id:'archive'}};assert.throws(()=>maintenanceTransition(busy,enable,admin,now),/архив/);
});

test('delayed staff creation rejects a closed or replacement session without changing stock',()=>{
  for(const change of [{status:'closed'},{sid:'replacement'}]){
    const root=fixture();Object.assign(root.tables[date+'_1'],change);const before=structuredClone(root);
    assert.throws(()=>create(root,{expectedSession:{sid:'s1',status:'open'}}),/Сессия стола/);assert.deepEqual(root,before);
  }
  assert.throws(()=>create(fixture(),{expectedSession:null}),/Сессия стола/);
  assert.throws(()=>create(fixture(),{date:'2026-09-12'}),/Дата заказа/);
});

test('accepted staff creation can recover its receipt after session replacement',()=>{
  const first=create(fixture());first.root.tables[date+'_1'].sid='replacement';
  const retry=create(first.root,{expectedSession:{sid:'s1',status:'open'}});
  assert.deepEqual(retry.result,first.result);assert.equal(Object.keys(retry.root.orders).length,1);assert.equal(retry.root.menu2[0].items[0].stock,4);
});

test('reopening a superseded or already open session cannot rotate the current QR',()=>{
  const root=fixture(),before=structuredClone(root);
  assert.throws(()=>staff(root,'reopenStaffTable',{requestId:'old',date,table:'1',sid:'previous'}),/Сессия стола/);
  assert.throws(()=>staff(root,'reopenStaffTable',{requestId:'current',date,table:'1',sid:'s1'}),/уже открыт/);
  assert.deepEqual(root,before);
});
test('guest prices are calculated from catalog, paid and free options stay explicit',()=>{
  for(const [option,total] of [['С лаймом',300],['Добавка +50',350]]){
    const p=input();p.items[0].option=option;p.expectedTotal=total;
    const {root,result}=place(fixture(),p);assert.equal(result.total,total);assert.equal(root.orders[result.id].items.i0.price,total);assert.match(root.orders[result.id].items.i0.name,new RegExp(option.replace('+','\\+')));
  }
});
test('two tea additions multiply by quantity',()=>{
  const p=input({items:[{category:'1',item:'0',name:'Сенча',qty:2,addons:['Лимон','Мята']}],expectedTotal:1000});
  assert.equal(place(fixture(),p).result.total,1000);
});
test('forged total, negative/decimal quantities, hidden item and wrong table token are rejected',()=>{
  assert.throws(()=>place(fixture(),input({expectedTotal:1})),/Цены/);
  for(const qty of [0,-1,1.5,100]){const p=input();p.items[0].qty=qty;assert.throws(()=>place(fixture(),p),/Количество/);}
  const r=fixture();r.menu2[0].hidden=true;assert.throws(()=>place(r),/Меню/);
  assert.throws(()=>place(fixture(),input({token:'wrong'})),/QR/);
});
test('partial stock failure does not mutate input or leave an order/counter',()=>{
  const r=fixture(),before=structuredClone(r),p=input({items:[...input().items,{category:'1',item:'0',name:'Сенча',qty:3}],expectedTotal:1500});
  assert.throws(()=>place(r,p),/остатков/);assert.deepEqual(r,before);
});
test('last unit: serialized competing transitions accept exactly one',()=>{
  const r=fixture();r.menu2[0].items[0].stock=1;
  const first=place(r);assert.equal(first.root.menu2[0].items[0].stock,0);
  assert.throws(()=>place(first.root,input({requestId:'op2'}),'guest2'),/остатков/);
  assert.equal(Object.keys(first.root.orders).length,1);
});
test('retry after committed response loss returns same receipt without a second deduction',()=>{
  const first=place(fixture()),retry=place(first.root);
  assert.deepEqual(retry.result,first.result);assert.equal(retry.root.menu2[0].items[0].stock,4);assert.equal(retry.root.publicCounters.orderNum,1);
  delete first.root.orders[first.result.id];assert.deepEqual(place(first.root).result,first.result);
});
test('new attempts after closing or changing a session are rejected',()=>{
  const r=fixture();r.tables[date+'_1'].status='closed';assert.throws(()=>place(r),/закрыт/);
  r.tables[date+'_1'].status='open';r.tables[date+'_1'].sid='other';assert.throws(()=>place(r),/Сессия/);
});
test('quiz token must still exist even after auto-open, and expires',()=>{
  const r=fixture();delete r.tables;r.quiz_tokens={quiz:{table:'1',createdAt:now-1000,expiresAt:now+1000}};
  const opened=transition(r,'openGuestSession',{table:'1',token:'quiz'},'guest',now,'s1');
  const p=input({token:'quiz'});assert.equal(place(opened.root,p).result.total,300);
  delete opened.root.quiz_tokens;assert.throws(()=>place(opened.root,p),/QR/);
  r.quiz_tokens.quiz.expiresAt=now;assert.throws(()=>transition(r,'openGuestSession',{table:'1',token:'quiz'},'guest',now,'s1'),/QR/);
});
test('wrong catalog index/name after reordering cannot debit another product',()=>{
  const r=fixture();r.menu2.reverse();assert.throws(()=>place(r),/Меню/);
});
test('waiter calls coalesce per table and pending state',()=>{
  const first=transition(fixture(),'guestCallWaiter',input(),'guest',now,'nonce');
  const second=transition(first.root,'guestCallWaiter',input({requestId:'op2'}),'guest2',now,'nonce');
  assert.equal(first.result.id,second.result.id);assert.equal(Object.keys(second.root.waiterCalls).length,1);
});
test('staff creation fixes price; editing unchanged prepared item retains its status and price',()=>{
  let {root,result}=create(fixture());let o=root.orders[result.id];const id=Object.keys(o.items)[0];
  o.items[id].status='making';root.menu2[0].items[0].price=500;
  const edited=staff(root,'editStaffOrder',{requestId:'edit',orderId:o.id,expectedVersion:o.version||0,expectedItems:o.items,items:Object.values(o.items),note:'note',priority:'normal'});
  assert.equal(edited.root.orders[o.id].items[id].price,300);assert.equal(edited.root.orders[o.id].items[id].status,'making');assert.equal(edited.root.menu2[0].items[0].stock,4);
});
test('concurrent edit is rejected instead of overwriting status',()=>{
  const {root,result}=create(fixture()),o=root.orders[result.id],expected=structuredClone(o.items);Object.values(o.items)[0].status='ready';
  assert.throws(()=>staff(root,'editStaffOrder',{requestId:'edit',orderId:o.id,expectedVersion:o.version||0,expectedItems:expected,items:Object.values(expected),note:'',priority:'normal'}),/изменился/);
});
test('deleting twice returns stock once; delivered goods do not return',()=>{
  for(const status of ['new','done','making']){
    let {root,result}=create(fixture());Object.values(root.orders[result.id].items)[0].status=status;
    const p={requestId:'delete',orderId:result.id};root=staff(root,'deleteStaffOrder',p).root;
    root=staff(root,'deleteStaffOrder',{...p,requestId:'delete2'}).root;
    assert.equal(root.menu2[0].items[0].stock,status==='new'?5:4);
  }
});
test('waiter cannot delete an order, guest cannot use staff API',()=>{
  assert.throws(()=>staff(fixture(),'deleteStaffOrder',{requestId:'d',orderId:'o'},{uid:'w',token:{role:'waiter'}}),/менеджеру/);
  assert.throws(()=>staff(fixture(),'createStaffOrder',{}, {uid:'g',token:{}}),/доступа/);
});
test('table cannot be closed with pending items; close and reopen retain order price',()=>{
  const {root,result}=create(fixture()),p={requestId:'close',date,table:'1',sid:'s1'};
  assert.throws(()=>staff(root,'closeStaffTable',p),/Сначала/);
  Object.values(root.orders[result.id].items)[0].status='done';
  const closed=staff(root,'closeStaffTable',p);assert.equal(closed.root.tables[date+'_1'].status,'closed');
  const opened=staff(closed.root,'reopenStaffTable',{...p,requestId:'open'});assert.equal(opened.root.tables[date+'_1'].status,'open');assert.notEqual(opened.root.tables[date+'_1'].token,'token');assert.equal(opened.root.orders[result.id].total,300);
});
test('reset changes number and reset timestamp in the same state transition',()=>{
  const {root}=create(fixture());const reset=staff(root,'resetStaffCounter',{requestId:'reset'});
  assert.equal(reset.root.publicCounters.orderNum,0);assert.equal(reset.root.config.orderNumResetAt,now);assert.equal(Object.keys(reset.root.orders).length,1);
});
test('saving a menu description preserves stock deducted concurrently',()=>{
  const {mergeMenu}=require('../functions/menu-service');
  const expected=fixture().menu2,proposed=structuredClone(expected),current=structuredClone(expected);
  proposed[0].items[0]._originPath='0/0';proposed[1].items[0]._originPath='1/0';
  proposed[0].items[0].desc='Описание';current[0].items[0].stock=4;
  const result=mergeMenu(current,expected,proposed);assert.equal(result[0].items[0].stock,4);
  proposed[0].items[0].stock=10;assert.throws(()=>mergeMenu(current,expected,proposed),/Остаток изменился/);
});
test('delivery and its log are one operation; repeat after response loss is harmless',()=>{
  const {root,result}=create(fixture()),o=root.orders[result.id],item=Object.values(o.items)[0];
  const p={requestId:'deliver',orderId:o.id,changes:[{id:item.id,from:'new',to:'done'}]};
  const delivered=staff(root,'updateStaffItems',p),retry=staff(delivered.root,'updateStaffItems',p);
  assert.equal(Object.values(retry.root.orders[o.id].items)[0].status,'done');assert.equal(Object.keys(retry.root.config.deliveryLog).length,1);
  assert.throws(()=>staff(retry.root,'updateStaffItems',{...p,requestId:'other'}),/изменён/);
});
test('corkage correction preserves other items in a mixed historical order',()=>{
  const {root,result}=create(fixture()),o=root.orders[result.id];o.items.fee={id:'fee',name:'Пробковый сбор — Вино / Шампанское',qty:1,price:700,status:'done'};
  const corrected=staff(root,'corkageStaffTable',{requestId:'fee',table:'1',date,sid:'s1',expected:[0,1,0],quantities:[0,0,0]});
  assert.equal(Object.values(corrected.root.orders[o.id].items).length,1);assert.equal(corrected.root.orders[o.id].total,300);assert.equal(corrected.root.menu2[0].items[0].stock,4);
});

test('reopening a historical delivered item clears completion but never restores consumed stock',()=>{
  const {root,result}=create(fixture()),o=root.orders[result.id],item=Object.values(o.items)[0];
  item.status='done';item.doneAt=now;o.status='done';o.doneAt=now;
  const reopened=staff(root,'updateStaffItems',{requestId:'undo',orderId:o.id,changes:[{id:item.id,from:'done',to:'new'}]});
  assert.equal(reopened.root.orders[o.id].doneAt,undefined);
  assert.equal(Object.values(reopened.root.orders[o.id].items)[0].stockConsumed,true);
  const removed=staff(reopened.root,'deleteStaffOrder',{requestId:'remove',orderId:o.id});
  assert.equal(removed.root.menu2[0].items[0].stock,4);
});

test('staff request identifiers cannot be reused for a different action',()=>{
  const {root}=create(fixture());
  assert.throws(()=>staff(root,'resetStaffCounter',{requestId:'create1'}),/уже использован/);
  assert.equal(root.publicCounters.orderNum,1);
});

test('menu conflict comparison ignores object property order while preserving array order',()=>{
  const {mergeMenu}=require('../functions/menu-service');
  const expected=fixture().menu2,proposed=structuredClone(expected);
  proposed.forEach((cat,ci)=>cat.items.forEach((item,ii)=>item._originPath=ci+'/'+ii));
  const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverse(v)])):value;
  const current=reverse(expected);current[0].items[0].stock=4;
  assert.equal(mergeMenu(current,expected,proposed)[0].items[0].stock,4);
  assert.throws(()=>mergeMenu([...current].reverse(),expected,proposed),/Меню изменено/);
});

test('closed and superseded sessions reject status changes and order edits',()=>{
  const {root,result}=create(fixture()),o=root.orders[result.id],item=Object.values(o.items)[0];
  const status={requestId:'status',orderId:o.id,changes:[{id:item.id,from:'new',to:'making'}]};
  const edit={requestId:'edit',orderId:o.id,expectedVersion:o.version,expectedItems:o.items,items:Object.values(o.items),note:'test',priority:'normal'};
  root.tables[date+'_1'].status='closed';
  assert.throws(()=>staff(root,'updateStaffItems',status),/Стол закрыт/);assert.throws(()=>staff(root,'editStaffOrder',edit),/Стол закрыт/);
  root.tables[date+'_1'].status='open';root.tables[date+'_1'].sid='new-session';
  assert.throws(()=>staff(root,'updateStaffItems',status),/Сессия стола/);
});
test('table details use session and expected value checks, with server timestamps',()=>{
  const root=fixture(),p={requestId:'note',date,table:'1',sid:'s1',field:'note',expected:null,value:'Без льда'};
  const saved=staff(root,'updateStaffTableDetails',p);
  assert.equal(saved.root.tables[date+'_1'].note,'Без льда');
  assert.throws(()=>staff(saved.root,'updateStaffTableDetails',{...p,requestId:'other',value:'Другое'}),/уже изменены/);
  const logged=staff(saved.root,'updateStaffTableDetails',{...p,requestId:'log',field:'loggedAt',value:true});assert.equal(logged.root.tables[date+'_1'].loggedAt,now);
  logged.root.tables[date+'_1'].sid='new-session';assert.throws(()=>staff(logged.root,'updateStaffTableDetails',{...p,requestId:'late'}),/Сессия стола/);
});
test('stale corkage dialog cannot write to a new session with the same fee counts',()=>{
  const root=fixture();root.tables[date+'_1'].sid='new-session';
  assert.throws(()=>staff(root,'corkageStaffTable',{requestId:'fee',table:'1',date,sid:'s1',expected:[0,0,0],quantities:[1,0,0]}),/Сессия стола/);
  assert.equal(root.orders,undefined);
});
test('deleting the current table session preserves previous closed bills',()=>{
  const {root,result}=create(fixture());
  root.orders.old={id:'old',date,table:'1',sid:'old-session',items:{i:{id:'i',name:'Corona',qty:1,price:300,status:'done'}}};
  root.tables[date+'_1'].closedSessions=[{sid:'old-session',closedAt:now-100,openedAt:now-200}];
  const removed=staff(root,'deleteStaffTable',{requestId:'delete-table',date,table:'1',sid:'s1'});
  assert.equal(removed.root.orders[result.id],undefined);assert.ok(removed.root.orders.old);
  assert.equal(removed.root.tables[date+'_1'].sid,'old-session');assert.equal(removed.root.tables[date+'_1'].status,'closed');
  assert.equal(removed.root.menu2[0].items[0].stock,5);
});
test('a new table session does not inherit the previous guests note or logged marker',()=>{
  const root=fixture();Object.assign(root.tables[date+'_1'],{status:'closed',note:'Старые гости',loggedAt:now-100});
  const next=create(root);assert.equal(next.root.tables[date+'_1'].note,undefined);assert.equal(next.root.tables[date+'_1'].loggedAt,undefined);assert.notEqual(next.root.tables[date+'_1'].sid,'s1');
});

function menuDraft(menu){return Object.values(menu).map((cat,ci)=>({...structuredClone(cat),items:Object.values(cat.items).map((item,ii)=>({...structuredClone(item),_originPath:ci+'/'+ii}))}));}
test('renaming and reordering a reserved product preserves the stock return destination and order price',()=>{
  const {root,result}=create(fixture()),menu=menuDraft(root.menu2);menu[0].items[0].name='Corona renamed';menu[0].items[0].price=900;menu.reverse();
  const saved=staff(root,'saveStaffMenu',{requestId:'menu1',expected:root.menu2,menu});
  const order=saved.root.orders[result.id],product=saved.root.menu2[1].items[0];
  assert.equal(Object.values(order.items)[0].productId,product.productId);assert.equal(Object.values(order.items)[0].name,'Corona');assert.equal(order.total,300);
  const deleted=staff(saved.root,'deleteStaffOrder',{requestId:'delete-after-rename',orderId:order.id});
  assert.equal(deleted.root.menu2[1].items[0].stock,5);assert.equal(deleted.root.menu2[0].items[0].stock,2);
});
test('reusing an old product name cannot receive a return reserved for another product ID',()=>{
  const {root,result}=create(fixture()),menu=menuDraft(root.menu2);menu[0].items[0].name='Original renamed';
  let saved=staff(root,'saveStaffMenu',{requestId:'rename',expected:root.menu2,menu}).root;
  const next=menuDraft(saved.menu2);next[0].items.push({name:'Corona',price:700,stock:10});
  saved=staff(saved,'saveStaffMenu',{requestId:'new-name',expected:saved.menu2,menu:next}).root;
  const removed=staff(saved,'deleteStaffOrder',{requestId:'delete',orderId:result.id}).root;
  assert.equal(removed.menu2[0].items[0].stock,5);assert.equal(removed.menu2[0].items[1].stock,10);assert.notEqual(removed.menu2[0].items[0].productId,removed.menu2[0].items[1].productId);
});
test('deleting a product from unfinished orders rejects the entire menu change',()=>{
  const {root}=create(fixture()),menu=menuDraft(root.menu2);menu[0].items=[];menu[1].cat='Changed';const before=structuredClone(root);
  assert.throws(()=>staff(root,'saveStaffMenu',{requestId:'remove-reserved',expected:root.menu2,menu}),/незавершённых/);assert.deepEqual(root,before);
});
test('guest orders preserve catalog product IDs and menu edits cannot replace them',()=>{
  const root=fixture(),menu=menuDraft(root.menu2);
  const saved=staff(root,'saveStaffMenu',{requestId:'identify',expected:root.menu2,menu}).root,pid=saved.menu2[0].items[0].productId;
  const request=input();request.items[0].productId=pid;
  const order=place(saved,request);assert.equal(Object.values(order.root.orders[order.result.id].items)[0].productId,pid);
  const next=menuDraft(order.root.menu2);next[0].items[0].productId='forged';
  const changed=staff(order.root,'saveStaffMenu',{requestId:'keep-identity',expected:order.root.menu2,menu:next}).root;assert.equal(changed.menu2[0].items[0].productId,pid);
});

test('guest submission cannot substitute a new product sharing the same name and index',()=>{
  const root=fixture();root.menu2[0].items[0].productId='replacement';const request=input();request.items[0].productId='old-product';
  assert.throws(()=>place(root,request),/Товар в меню изменился/);assert.equal(root.menu2[0].items[0].stock,5);
});
test('renaming a product referenced by an unconverted text order is rejected safely',()=>{
  const root=fixture();root.orders={old:{items:'2 Corona',status:'new'}};const menu=menuDraft(root.menu2);menu[0].items[0].name='Renamed';
  assert.throws(()=>staff(root,'saveStaffMenu',{requestId:'legacy-rename',expected:root.menu2,menu}),/старом текстовом заказе/);
  assert.equal(root.menu2[0].items[0].name,'Corona');
});

test('new table session gets a new waiter call and the old pending call is cancelled',()=>{
  const first=transition(fixture(),'guestCallWaiter',input(),'guest',now,'nonce');
  first.root.tables[date+'_1'].sid='new-session';
  const next=transition(first.root,'guestCallWaiter',input({requestId:'new-call',sid:'new-session'}),'guest',now,'nonce');
  assert.notEqual(next.result.id,first.result.id);assert.equal(next.root.waiterCalls[first.result.id].status,'cancelled');
});
test('clearing a selected call history cannot delete pending or newly arrived calls',()=>{
  const root=fixture();root.waiterCalls={old:{status:'done'},pending:{date,table:'1',sid:'s1',status:'pending'},newdone:{status:'done'},stale:{date,table:'1',sid:'old-session',status:'pending'}};
  const next=staff(root,'clearStaffCalls',{requestId:'clear',ids:['old','pending','stale']}).root;
  assert.equal(next.waiterCalls.old,undefined);assert.equal(next.waiterCalls.stale,undefined);assert.equal(next.waiterCalls.pending.status,'pending');assert.ok(next.waiterCalls.newdone);
  assert.throws(()=>staff(next,'checkInStaffCall',{requestId:'ack',callId:'old'}),/удалён/);assert.equal(next.waiterCalls.old,undefined);
});
test('closing a table cancels pending waiter calls atomically',()=>{
  const first=transition(fixture(),'guestCallWaiter',input(),'guest',now,'nonce');
  const closed=staff(first.root,'closeStaffTable',{requestId:'close-call',date,table:'1',sid:'s1'}).root;
  assert.equal(closed.waiterCalls[first.result.id].status,'cancelled');
});
test('quiz preparation preserves live open table metadata and resets closed table guest details',()=>{
  const root=fixture();Object.assign(root.tables[date+'_1'],{note:'Живая заметка',loggedAt:now-10});root.tables[date+'_2']={date,tNum:'2',status:'closed',sid:'old',note:'Старые гости',loggedAt:now-20,closedSessions:[{sid:'old',closedAt:now-20}]};
  const prepared=staff(root,'prepareStaffQuiz',{requestId:'quiz'});
  assert.equal(Object.keys(prepared.result.tokens).length,19);assert.equal(prepared.root.tables[date+'_1'].sid,'s1');assert.equal(prepared.root.tables[date+'_1'].note,'Живая заметка');
  assert.equal(prepared.root.tables[date+'_2'].note,undefined);assert.notEqual(prepared.root.tables[date+'_2'].sid,'old');assert.equal(prepared.root.tables[date+'_2'].closedSessions[0].sid,'old');
  assert.deepEqual(staff(prepared.root,'prepareStaffQuiz',{requestId:'quiz'}).result,prepared.result);
});
test('a stale finish dialog cannot revoke a newer quiz and revoked open menus cannot order',()=>{
  const first=staff(fixture(),'prepareStaffQuiz',{requestId:'quiz1'}),second=staff(first.root,'prepareStaffQuiz',{requestId:'quiz2'});
  assert.throws(()=>staff(second.root,'finishStaffQuiz',{requestId:'finish-old',quizId:first.result.quizId}),/Квиз уже изменился/);
  const finished=staff(second.root,'finishStaffQuiz',{requestId:'finish',quizId:second.result.quizId});
  const request=input({token:second.result.tokens['1']});assert.throws(()=>place(finished.root,request),/QR недействителен/);
  assert.throws(()=>staff(finished.root,'prepareStaffQuiz',{requestId:'quiz2'}),/отозван/);
});
