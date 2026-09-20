'use strict';
const {createHash}=require('node:crypto');
const {OrderError,dateAt,isCurrentCall,cancelStaleCalls}=require('./guest-service');
const {mergeMenu,linkMenuOrders}=require('./menu-service');
const fail=(code,message)=>{throw new OrderError(code,message);};
const base=name=>String(name).replace(/\s+[—–-]\s+.+$/,'').replace(/\s+\+\s+.+$/,'').trim().toLowerCase();
function roleOf(auth){return auth?.token?.email==='manager@1708.local'?'admin':auth?.token?.role;}
function findProduct(root,name,productId){
  const matches=[];
  for(const [ck,cat] of Object.entries(root.menu2||{}))for(const [ik,item] of Object.entries(cat.items||{}))if(item&&(productId?item.productId===productId:base(item.name)===base(name)))matches.push({cat,item,ck,ik});
  if(matches.length!==1)fail('failed-precondition','Позиция не найдена однозначно в меню: '+name);
  return matches[0];
}
function quote(root,name,productId){
  if(/^(?:\d+\s+)?круж(?:ка|ки|ек)$/i.test(name))return{price:0};
  const p=findProduct(root,name,productId);let price=Number(p.item.price);
  if(!Number.isFinite(price)||price<0||p.cat.hidden)fail('failed-precondition','Товар недоступен: '+name);
  const addon=String(name).match(/\s\+\s(.+?)(?:\s+[—–-]\s+|$)/);
  if(addon){
    const list=addon[1].split(',').map(x=>x.trim().toLowerCase());
    if(!String(p.cat.cat).toLowerCase().includes('лист')||list.some(x=>!['чабрец','лимон','мята'].includes(x))||new Set(list).size!==list.length)fail('invalid-argument','Проверьте добавки: '+name);
    price+=list.length*50;
  }
  const option=String(name).match(/\s+[—–-]\s+(.+)$/)?.[1];
  if(option){
    if(!(p.item.options||[]).includes(option))fail('invalid-argument','Проверьте опцию: '+name);
    price+=Number(option.match(/(?:\+|=|:)\s*(\d+)\s*₽?$/)?.[1]||0);
  }
  return{price,productName:p.item.name,categoryKey:p.ck,itemKey:p.ik,...(p.item.productId?{productId:p.item.productId}:{})};
}
function stock(root,line,delta){
  if(!delta||/^(?:\d+\s+)?круж(?:ка|ки|ек)$/i.test(line.name))return;
  const p=findProduct(root,line.productName||line.name,line.productId),v=p.item.stock;
  if(v===undefined||v===null||v==='')return;
  const n=Number(v);
  if(!Number.isInteger(n)||n-delta<0)fail('failed-precondition','Недостаточно остатков: '+p.item.name);
  p.item.stock=n-delta;
}
const signature=items=>JSON.stringify(Object.values(items||{}).map(i=>({id:i.id,name:i.name,qty:i.qty,status:i.status||'new',price:i.price??null})).sort((a,b)=>String(a.id).localeCompare(String(b.id))));
const statusOf=items=>{const a=Object.values(items);return a.every(i=>i.status==='done')?'done':a.every(i=>['ready','done'].includes(i.status))?'ready':a.some(i=>i.status!=='new')?'making':'new';};
function requireOpenSession(root,date,table,sid){
  const meta=root.tables?.[date+'_'+table];
  if(!meta||(meta.sid||'default')!==sid)fail('aborted','Сессия стола изменилась. Обновите список.');
  if(meta.status==='closed')fail('failed-precondition','Стол закрыт. Сначала переоткройте его для исправлений.');
  return meta;
}
function staffTransition(current,action,input,auth,now,nonce){
  const role=roleOf(auth);
  if(!['admin','waiter','barman'].includes(role))fail('permission-denied','Нет доступа сотрудника');
  if(role==='barman'&&action!=='updateStaffItems')fail('permission-denied','Действие недоступно бармену');
  if(!input||!/^[-\w]{1,80}$/.test(input.requestId||''))fail('invalid-argument','Некорректный номер операции');
  const root=structuredClone(current||{}),op=createHash('sha256').update(auth.uid+':'+input.requestId).digest('hex');
  if(root.staffOperations?.[op]){
    if(root.staffOperations[op].action!==action)fail('invalid-argument','Номер операции уже использован');
    if(action==='prepareStaffQuiz'&&(root.config?.quizSession?.id!==op||!root.config.quizSession.active))fail('failed-precondition','Этот набор QR уже заменён или отозван. Подготовьте квиз заново.');
    return{root,result:root.staffOperations[op].result};
  }
  let result;
  if(action==='prepareStaffQuiz'){
    if(role!=='admin')fail('permission-denied','Квиз готовит менеджер');
    const date=dateAt(now),tokens={};root.quiz_tokens={};
    for(const table of [...Array.from({length:17},(_,i)=>String(i+1)),'PS1','PS2']){
      const token=createHash('sha256').update(op+':'+table).digest('hex'),key=date+'_'+table,old=root.tables?.[key];
      const meta={...old,date,tNum:table,status:'open',token,autoOpened:true};
      if(old?.status!=='open'){meta.sid=token;meta.openedAt=now;delete meta.note;delete meta.loggedAt;}else{meta.sid||=token;meta.openedAt||=now;}
      delete meta.closedAt;(root.tables??={})[key]=meta;
      root.quiz_tokens[token]={table,createdAt:now,expiresAt:now+18*60*60*1000};tokens[table]=token;
    }
    (root.config??={}).quizSession={id:op,active:true,createdAt:now};result={quizId:op,tokens};
  }else if(action==='finishStaffQuiz'){
    if(role!=='admin')fail('permission-denied','Квиз завершает менеджер');
    if((root.config?.quizSession?.id??null)!==(input.quizId??null))fail('aborted','Квиз уже изменился. Обновите страницу.');
    delete root.quiz_tokens;
    if(root.config?.quizSession){root.config.quizSession.active=false;root.config.quizSession.finishedAt=now;}
    result={finished:true};
  }else if(action==='checkInStaffCall'){
    const call=root.waiterCalls?.[input.callId];if(!call)fail('not-found','Вызов уже удалён');
    if(!isCurrentCall(root,call,now)||call.status==='cancelled')fail('failed-precondition','Сессия этого вызова уже завершена');
    if(call.status==='pending'){call.status='done';call.doneAt=now;call.doneBy=auth.uid;}
    result={id:input.callId};
  }else if(action==='clearStaffCalls'){
    if(!Array.isArray(input.ids)||input.ids.length>1000||input.ids.some(id=>typeof id!=='string'||!/^[-\w]{1,160}$/.test(id)))fail('invalid-argument','Некорректный список вызовов');
    let count=0;
    for(const id of input.ids){const call=root.waiterCalls?.[id];if(call&&(call.status!=='pending'||!isCurrentCall(root,call,now))){delete root.waiterCalls[id];count++;}}
    result={count};
  }else if(action==='updateStaffItems'){
    const o=root.orders?.[input.orderId];if(!o)fail('not-found','Заказ не найден');
    requireOpenSession(root,o.date,o.table,o.sid||'default');
    if(!Array.isArray(input.changes)||!input.changes.length||input.changes.length>100)fail('invalid-argument','Нет позиций для обновления');
    for(const change of input.changes){
      const item=Object.values(o.items||{}).find(i=>i.id===change.id);if(!item)fail('not-found','Позиция не найдена');
      if(item.status!==change.from)fail('aborted','Статус уже изменён другим сотрудником');
      if(!['new','making','ready','done'].includes(change.to))fail('invalid-argument','Некорректный статус');
      if(role==='barman'&&change.to==='done')fail('permission-denied','Выдачу отмечает официант');
      if(role==='waiter'&&change.to!=='done')fail('permission-denied','Приготовление отмечает бармен');
      if(change.to==='done'){
        if(item.status!=='ready'){
          const cat=findProduct(root,item.productName||item.name,item.productId).cat;
          const instant=['пиво','напитки','закуски'].some(t=>String(cat.cat).toLowerCase().includes(t));
          if(!instant)fail('failed-precondition','Позиция ещё не готова');
        }
        item.doneAt=now;(root.config??={}).deliveryLog??={};
        root.config.deliveryLog[op+'_'+item.id]={at:now,table:o.table,orderNum:o.num,name:item.name,qty:item.qty,actor:auth.uid};
      }
      if(change.to==='making')item.makingAt=now;
      if(['making','ready','done'].includes(item.status)||['making','ready','done'].includes(change.to))item.stockConsumed=true;
      if(change.to==='ready')item.readyAt=now;
      if(change.to==='new'){delete item.makingAt;delete item.readyAt;delete item.doneAt;}
      item.status=change.to;
    }
    o.status=statusOf(o.items);if(o.status==='done')o.doneAt=now;else delete o.doneAt;o.version=(o.version||0)+1;result={count:input.changes.length};
  }else if(action==='updateStaffTableDetails'){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||typeof input.table!=='string'||!/^[A-ZА-ЯЁ0-9 -]{1,30}$/.test(input.table))fail('invalid-argument','Некорректный стол');
    if(!['note','loggedAt'].includes(input.field))fail('invalid-argument','Некорректное поле');
    const meta=requireOpenSession(root,input.date,input.table,input.sid);
    if((meta[input.field]??null)!==(input.expected??null))fail('aborted','Данные стола уже изменены. Откройте окно заново.');
    if(input.field==='note'){
      if(typeof input.value!=='string'||input.value.length>1000)fail('invalid-argument','Заметка должна быть не длиннее 1000 символов');
      if(input.value)meta.note=input.value;else delete meta.note;
    }else{
      if(typeof input.value!=='boolean')fail('invalid-argument','Некорректная отметка');
      if(input.value)meta.loggedAt=now;else delete meta.loggedAt;
    }
    result={value:meta[input.field]??null};
  }else if(action==='saveStaffMenu'){
    if(role!=='admin')fail('permission-denied','Меню меняет менеджер');
    const next=mergeMenu(root.menu2,input.expected,input.menu,op);
    linkMenuOrders(root,root.menu2,input.menu,next);
    root.menu2=next;result={saved:true};
  }else if(action==='openStaffTable'){
    const table=String(input.table||'');if(!/^[A-ZА-ЯЁ0-9 -]{1,30}$/.test(table))fail('invalid-argument','Проверьте номер стола');
    const date=dateAt(now),key=date+'_'+table;let meta=root.tables?.[key];
    if(meta?.status==='closed')fail('failed-precondition','Сначала переоткройте закрытый стол');
    if(!meta)meta={date,tNum:table,status:'open',openedAt:now,sid:nonce,token:nonce.replace(/-/g,''),autoOpened:false};
    if(!meta.sid)meta.sid=nonce;if(!meta.token)meta.token=nonce.replace(/-/g,'');
    (root.tables??={})[key]=meta;result={meta};
  }else if(action==='corkageStaffTable'){
    const table=String(input.table||'');if(!/^[A-ZА-ЯЁ0-9 -]{1,30}$/.test(table))fail('invalid-argument','Проверьте номер стола');
    const date=dateAt(now),key=date+'_'+table;let meta=root.tables?.[key];
    if(input.date!==date||(meta?(meta.sid||'default'):null)!==input.sid)fail('aborted','Сессия стола изменилась. Откройте пробковый сбор заново.');
    if(meta?.status==='closed')fail('failed-precondition','Стол закрыт');
    if(!meta)meta={date,tNum:table,status:'open',openedAt:now,sid:nonce,token:nonce.replace(/-/g,''),autoOpened:false};
    if(!meta.sid)meta.sid=nonce;(root.tables??={})[key]=meta;
    const names=['Пиво / Лимонады / Напитки','Вино / Шампанское','Крепкий алкоголь'].map(n=>'Пробковый сбор — '+n),prices=[100,700,1000];
    if(!Array.isArray(input.quantities)||input.quantities.length!==3||input.quantities.some(q=>!Number.isInteger(q)||q<0||q>99))fail('invalid-argument','Проверьте количество');
    const orders=Object.values(root.orders||{}).filter(o=>o.date===date&&String(o.table)===table&&(o.sid||'default')===meta.sid);
    const quantities=names.map(name=>orders.reduce((s,o)=>s+Object.values(o.items||{}).filter(i=>i.name===name).reduce((n,i)=>n+i.qty,0),0));
    if(JSON.stringify(quantities)!==JSON.stringify(input.expected))fail('aborted','Пробковый сбор уже изменён. Откройте окно заново.');
    const removed=[];
    for(const o of orders){
      for(const [id,item] of Object.entries(o.items||{}))if(names.includes(item.name)){removed.push({orderId:o.id,item});delete o.items[id];}
      if(!Object.keys(o.items).length)delete root.orders[o.id];
      else o.total=Object.values(o.items).reduce((s,i)=>s+(i.price??quote(root,i.name,i.productId).price)*i.qty,0);
    }
    const items={};input.quantities.forEach((qty,i)=>{if(qty)items['c'+i]={id:'c'+i,name:names[i],qty,price:prices[i],status:'done',doneAt:now};});
    if(Object.keys(items).length){
      const num=Number(root.publicCounters?.orderNum||0)+1;(root.publicCounters??={}).orderNum=num;
      const id='c_'+op;(root.orders??={})[id]={id,num,date,table,sid:meta.sid,items,total:input.quantities.reduce((s,q,i)=>s+q*prices[i],0),createdAt:now,doneAt:now,status:'done',priority:'normal',source:'staff',note:'Пробковый сбор'};
    }
    (root.config??={}).corkageHistory??={};root.config.corkageHistory[op]={at:now,actor:auth.uid,table,sid:meta.sid,before:quantities,after:input.quantities,removed};result={saved:true};
  }else if(action==='renameStaffTable'){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||![input.table,input.newTable].every(t=>typeof t==='string'&&/^[A-ZА-ЯЁ0-9 -]{1,30}$/.test(t)))fail('invalid-argument','Проверьте название стола');
    const old=input.date+'_'+input.table,next=input.date+'_'+input.newTable,meta=root.tables?.[old];
    if(!meta||(meta.sid||'default')!==input.sid)fail('aborted','Стол или сессия изменились');
    if(root.tables[next])fail('already-exists','Такой стол уже существует');
    for(const o of Object.values(root.orders||{}))if(o.date===input.date&&String(o.table)===input.table&&(o.sid||'default')===input.sid)o.table=input.newTable;
    root.tables[next]={...meta,tNum:input.newTable,token:nonce.replace(/-/g,''),autoOpened:false,closedSessions:(meta.closedSessions||[]).filter(s=>s.sid===input.sid)};
    const history=Object.values(root.orders||{}).filter(o=>o.date===input.date&&String(o.table)===input.table);
    if(history.length)root.tables[old]={...meta,status:'closed',sid:history[history.length-1].sid||'default',closedAt:now,closedSessions:(meta.closedSessions||[]).filter(s=>s.sid!==input.sid)};
    else delete root.tables[old];result={saved:true};
  }else if(action==='resetStaffCounter'){
    if(role!=='admin')fail('permission-denied','Сброс доступен менеджеру');
    (root.publicCounters??={}).orderNum=0;(root.config??={}).orderNumResetAt=now;result={next:1};
  }else if(['deleteStaffTable','closeStaffTable','reopenStaffTable'].includes(action)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||!/^[A-ZА-ЯЁ0-9 -]{1,30}$/.test(input.table||''))fail('invalid-argument','Некорректный стол');
    const key=input.date+'_'+input.table,meta=root.tables?.[key];
    if(!meta)fail('not-found','Стол не найден');
    if((meta.sid||'default')!==input.sid)fail('aborted','Сессия стола изменилась. Обновите список.');
    const orders=Object.values(root.orders||{}).filter(o=>o.date===input.date&&String(o.table)===input.table&&(o.sid||'default')===input.sid);
    if(action==='deleteStaffTable'){
      if(role!=='admin')fail('permission-denied','Удаление доступно менеджеру');
      for(const o of orders){for(const item of Object.values(o.items||{}))if((item.status||'new')==='new'&&!item.stockConsumed)stock(root,item,-item.qty);delete root.orders[o.id];}
      const history=Object.values(root.orders||{}).filter(o=>o.date===input.date&&String(o.table)===input.table);
      if(history.length){
        const sessions=(meta.closedSessions||[]).filter(s=>s.sid!==input.sid);
        const previous=sessions[sessions.length-1];
        root.tables[key]={date:input.date,tNum:input.table,status:'closed',sid:previous?.sid||history[history.length-1].sid||'default',closedSessions:sessions,closedAt:previous?.closedAt||now,openedAt:previous?.openedAt||now};
      }else delete root.tables[key];
    }else if(action==='closeStaffTable'){
      if(orders.some(o=>Object.values(o.items||{}).some(i=>i.status!=='done')))fail('failed-precondition','Сначала выдайте или отмените все позиции стола');
      if(meta.status!=='closed'){
        for(const o of orders)for(const i of Object.values(o.items||{}))if(i.price==null)i.price=quote(root,i.name,i.productId).price;
        meta.status='closed';meta.closedAt=now;
        meta.closedSessions=[...(meta.closedSessions||[]),{sid:input.sid,closedAt:now,openedAt:meta.openedAt||now}];
      }
    }else{
      if(meta.status!=='closed')fail('failed-precondition','Стол уже открыт. Обновите список.');
      meta.status='open';delete meta.closedAt;meta.token=nonce.replace(/-/g,'');meta.autoOpened=false;
      meta.closedSessions=(meta.closedSessions||[]).filter(s=>s.sid!==input.sid);
    }
    result={key};
  }else if(action==='deleteStaffOrder'){
    if(role!=='admin')fail('permission-denied','Удаление доступно менеджеру');
    if(!/^[-\w]{1,160}$/.test(input.orderId||''))fail('invalid-argument','Некорректный заказ');
    const o=root.orders?.[input.orderId];
    if(o){for(const item of Object.values(o.items||{}))if((item.status||'new')==='new'&&!item.stockConsumed)stock(root,item,-item.qty);delete root.orders[input.orderId];}
    result={id:input.orderId};
  }else{
    if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)fail('invalid-argument','Укажите от 1 до 100 позиций');
    if(typeof input.note!=='string'||input.note.length>1000||!['normal','urgent'].includes(input.priority))fail('invalid-argument','Проверьте примечание и приоритет');
    let o;
    if(action==='editStaffOrder'){
      o=root.orders?.[input.orderId];if(!o)fail('not-found','Заказ удалён');
      requireOpenSession(root,o.date,o.table,o.sid||'default');
      if((o.version||0)!==input.expectedVersion)fail('aborted','Заказ уже изменился. Закройте редактор и откройте его заново.');
      if(signature(o.items)!==signature(input.expectedItems))fail('aborted','Заказ уже изменился. Закройте редактор и откройте его заново.');
    }else if(action==='createStaffOrder'){
      const table=String(input.table||'').trim().toUpperCase();
      if(!/^[A-ZА-ЯЁ0-9 -]{1,30}$/.test(table))fail('invalid-argument','Проверьте номер стола');
      const date=dateAt(now),key=date+'_'+table;let meta=root.tables?.[key];
      if(input.date!==date)fail('failed-precondition','Дата заказа изменилась. Проверьте стол и отправьте заказ заново.');
      const expected=input.expectedSession;
      if(expected!==null&&(!expected||typeof expected.sid!=='string'||!['open','closed'].includes(expected.status)))fail('invalid-argument','Обновите страницу и проверьте сессию стола перед отправкой.');
      if(meta?(!expected||expected.sid!==(meta.sid||'default')||expected.status!==(meta.status==='closed'?'closed':'open')):expected!==null)fail('aborted','Сессия стола изменилась. Проверьте гостей за столом перед повторной отправкой.');
      if(!meta||meta.status==='closed'){
        meta={...meta,date,tNum:table,status:'open',sid:nonce,token:nonce.replace(/-/g,''),openedAt:now,autoOpened:false};delete meta.closedAt;
        delete meta.note;delete meta.loggedAt;
        (root.tables??={})[key]=meta;
      }
      if(!meta.sid)meta.sid=nonce;
      const num=Number(root.publicCounters?.orderNum||0)+1;(root.publicCounters??={}).orderNum=num;
      o={id:'s_'+op,num,table,date,sid:meta.sid,createdAt:now,source:'staff',items:{}};
    }else fail('invalid-argument','Неизвестное действие');
    const old=o.items||{},items={},used=new Set();
    input.items.forEach((row,index)=>{
      if(!row||typeof row.name!=='string'||!row.name.trim()||row.name.length>250||!Number.isInteger(row.qty)||row.qty<1||row.qty>99)fail('invalid-argument','Проверьте название и количество (1–99)');
      const prev=row.id?Object.values(old).find(i=>i.id===row.id):null;
      if(prev&&used.has(prev.id))fail('invalid-argument','Повтор позиции');
      if(prev)used.add(prev.id);
      const same=prev&&prev.name===row.name;
      if(prev&&(prev.status!=='new'||prev.stockConsumed)&&(!same||prev.qty!==row.qty))fail('failed-precondition','Уже начатую или выданную позицию нельзя менять. Добавьте новую строку.');
      const id=prev?.id||'i'+index+'_'+nonce;
      const next=same?{...prev,qty:row.qty,price:prev.price??quote(root,row.name,prev.productId).price}:{id,name:row.name,qty:row.qty,status:'new',...quote(root,row.name)};
      if(prev&&!same)stock(root,prev,-prev.qty);
      stock(root,next,same?row.qty-prev.qty:row.qty);items[id]=next;
    });
    for(const prev of Object.values(old))if(!used.has(prev.id)){
      if(prev.status!=='new'||prev.stockConsumed)fail('failed-precondition','Уже начатую или выданную позицию нельзя удалять из редактора');
      stock(root,prev,-prev.qty);
    }
    if(action==='editStaffOrder')(o.history??={})[nonce]={items:old,note:o.note||'',priority:o.priority||'normal',editedAt:now,editedBy:auth.uid};
    o.items=items;o.note=input.note;o.priority=input.priority;o.version=(o.version||0)+1;o.status=statusOf(items);o.total=Object.values(items).reduce((s,i)=>s+i.price*i.qty,0);
    (root.orders??={})[o.id]=o;result={id:o.id,num:o.num,total:o.total};
  }
  cancelStaleCalls(root,now);
  (root.staffOperations??={})[op]={result,at:now,action};return{root,result};
}
module.exports={staffTransition,signature,roleOf};
