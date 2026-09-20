'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
const {randomUUID,createHash}=require('node:crypto');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {onValueCreated}=require('firebase-functions/v2/database');
const {defineSecret}=require('firebase-functions/params');
const webpush=require('web-push');
const {archiveOnce,backfillClosedOnce,compactClosedSession,readArchivedSession,mergeArchivedSession,removeArchivedSession}=require('./archive-service');
const {transition,OrderError,dateAt}=require('./guest-service');
const {staffTransition}=require('./staff-service');
const {summarizeOrders}=require('./stats-service');
const {createTransactionQueue}=require('./transaction-queue');
const {maintenanceTransition,maintenanceEnabled}=require('./maintenance-service');
const {normalizeSubscription,subscriptionId,makeSubscriptionRecord,deliverNotifications}=require('./push-service');
const runTransaction=createTransactionQueue();
initializeApp();
function staffRole(auth){return auth?.token?.email==='manager@1708.local'?'admin':auth?.token?.role;}
const pushPublicKey=defineSecret('WEB_PUSH_PUBLIC_KEY'),pushPrivateKey=defineSecret('WEB_PUSH_PRIVATE_KEY');
const isStaff=auth=>['admin','waiter','barman'].includes(staffRole(auth));
const pushSecrets=[pushPublicKey,pushPrivateKey];
const pushSubject='https://project-3061022303410047846.web.app';

exports.getPushPublicKey=onCall({region:'us-central1',secrets:[pushPublicKey]},async request=>{
  if(!isStaff(request.auth))throw new HttpsError('permission-denied','Уведомления доступны сотрудникам');
  const publicKey=pushPublicKey.value();
  if(!publicKey)throw new HttpsError('failed-precondition','Фоновые уведомления ещё не настроены');
  return {publicKey};
});
exports.registerPushSubscription=onCall({region:'us-central1'},async request=>{
  if(!isStaff(request.auth))throw new HttpsError('permission-denied','Уведомления доступны сотрудникам');
  try{
    const now=Date.now(),normalized=normalizeSubscription(request.data?.subscription),id=subscriptionId(normalized.endpoint),ref=getDatabase().ref('live/pushSubscriptions');
    let full=false;
    const tx=await ref.transaction(current=>{
      current=current||{};
      for(const [key,record] of Object.entries(current))if(!record||now-Number(record.updatedAt||record.createdAt)>180*86400000)delete current[key];
      if(!current[id]&&Object.keys(current).length>=100){full=true;return undefined;}
      current[id]=makeSubscriptionRecord(normalized,{uid:request.auth.uid,role:request.data?.role,now,previous:current[id]}).record;
      return current;
    });
    if(!tx.committed){if(full)throw new HttpsError('resource-exhausted','Слишком много подключённых устройств');throw new HttpsError('aborted','Повторите включение уведомлений');}
    return {id};
  }catch(error){
    if(error instanceof HttpsError)throw error;
    throw new HttpsError('invalid-argument',error.message||'Некорректная push-подписка');
  }
});
exports.unregisterPushSubscription=onCall({region:'us-central1'},async request=>{
  if(!isStaff(request.auth))throw new HttpsError('permission-denied','Уведомления доступны сотрудникам');
  try{
    const normalized=normalizeSubscription(request.data?.subscription),id=subscriptionId(normalized.endpoint),ref=getDatabase().ref('live/pushSubscriptions/'+id);
    await ref.transaction(current=>current?.uid===request.auth.uid?null:current);
    return {removed:true};
  }catch(error){throw new HttpsError('invalid-argument',error.message||'Некорректная push-подписка');}
});

async function sendOutboxPush(event,eventId){
  const {kind,value,id,eventAt}=event||{};
  if(!['order','waiterCall'].includes(kind)||!Number.isFinite(Number(eventAt)))return;
  const db=getDatabase(),eventPath='live/pushOutbox/'+eventId;
  const [eventSnapshot,subscriptionSnapshot]=await Promise.all([db.ref(eventPath).get(),db.ref('live/pushSubscriptions').get()]);
  const currentEvent=eventSnapshot.val();
  if(!currentEvent)return;
  const records=subscriptionSnapshot.val()||{},delivered=currentEvent.delivered||{};
  if(!Object.keys(records).length){await db.ref('live/pushOutbox/'+eventId).remove();return;}
  const pendingRecords=Object.fromEntries(Object.entries(records).filter(([key])=>!delivered[key]));
  let credentials;
  try{credentials={subject:pushSubject,publicKey:pushPublicKey.value(),privateKey:pushPrivateKey.value()};}
  catch(error){console.error('push-configuration-unavailable',{kind,code:error.code||'unknown'});throw error;}
  try{
    const result=await deliverNotifications({records:pendingRecords,kind,value,id,eventAt:Number(eventAt),webpush,credentials}),updates={};
    for(const key of result.sentIds)updates[eventPath+'/delivered/'+key]=true;
    for(const key of result.expired)updates['live/pushSubscriptions/'+key]=null;
    if(!result.failed)updates[eventPath]=null;
    await db.ref().update(updates);
    if(result.failed){console.error('push-delivery-partial-failure',{kind,failed:result.failed,sent:result.sent});throw new Error('Временная ошибка доставки уведомления');}
  }catch(error){console.error('push-delivery-failed',{kind,code:error.code||'unknown'});throw error;}
}
exports.deliverPushOutbox=onValueCreated({ref:'/live/pushOutbox/{eventId}',region:'us-central1',secrets:pushSecrets,retry:true},event=>sendOutboxPush(event.data.val(),event.params.eventId));
exports.archiveOldOrders=onSchedule({schedule:'0 6 * * *',timeZone:'Europe/Moscow',region:'us-central1',timeoutSeconds:540,retryCount:3},async()=>{
  if((await getDatabase().ref('live/maintenance/enabled').get()).val()===true)return;
  for(let i=0;i<40;i++){const result=await backfillClosedOnce(getDatabase(),Date.now(),randomUUID());if(!result.completed)break;}
  for(let i=0;i<40;i++){const result=await archiveOnce(getDatabase(),Date.now(),randomUUID());if(!result.completed)break;}
});
exports.runStaffArchive=onCall({region:'us-central1',timeoutSeconds:120},async request=>{
  if(staffRole(request.auth)!=='admin')throw new HttpsError('permission-denied','Архивацию запускает менеджер');
  if((await getDatabase().ref('live/maintenance/enabled').get()).val()===true)throw new HttpsError('failed-precondition','Сначала завершите режим обслуживания');
  let moved=0;
  for(let i=0;i<40;i++){const result=await backfillClosedOnce(getDatabase(),Date.now(),randomUUID());moved+=result.moved||0;if(!result.completed)break;}
  const maintenance=await archiveOnce(getDatabase(),Date.now(),randomUUID());
  return {moved:moved+(maintenance.moved||0),completed:maintenance.completed!==false};
});
exports.setMaintenanceMode=onCall({region:'us-central1',timeoutSeconds:30},async request=>{
  if(!request.auth)throw new HttpsError('unauthenticated','Войдите заново');
  return runTransaction(async()=>{
    let result,validationError;
    const tx=await getDatabase().ref('live').transaction(current=>{
      if(current===null)return current;
      try{const next=maintenanceTransition(current,request.data,request.auth,Date.now());result=next.result;validationError=null;return next.root;}
      catch(error){validationError=error;return undefined;}
    });
    if(!tx.committed){
      if(validationError instanceof OrderError)throw new HttpsError(validationError.code,validationError.message);
      throw new HttpsError('aborted','Повторите запрос');
    }
    return result;
  });
});
exports.getStaffArchive=onCall({region:'us-central1'},async request=>{
  if(!['admin','waiter','barman'].includes(staffRole(request.auth)))throw new HttpsError('permission-denied','Нет доступа сотрудника');
  const {date,after}=request.data||{};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||after!=null&&(typeof after!=='string'||!/^[-\w]{1,160}$/.test(after)))throw new HttpsError('invalid-argument','Некорректная дата или страница');
  let query=getDatabase().ref('archive/days/'+date+'/orders').orderByKey();
  if(after)query=query.startAfter(after);
  const rows=[];(await query.limitToFirst(101).get()).forEach(s=>{rows.push({key:s.key,order:s.val()});});
  const tables=(await getDatabase().ref('archive/days/'+date+'/tables').get()).val()||{};
  return {rows:rows.slice(0,100),next:rows.length>100?rows[99].key:null,tables};
});
exports.getStaffStats=onCall({region:'us-central1'},async request=>{
  if(staffRole(request.auth)!=='admin')throw new HttpsError('permission-denied','Статистика доступна менеджеру');
  const db=getDatabase(),now=Date.now(),dates=Array.from({length:30},(_,i)=>dateAt(now-i*86400000));
  const [live,...days]=await Promise.all([db.ref('live/orders').get(),...dates.map(date=>db.ref('archive/days/'+date).get())]);
  return summarizeOrders(live.val()||{},days.map(s=>s.val()||{}),now);
});
for(const action of ['openGuestSession','placeGuestOrder','guestCallWaiter','createStaffOrder','editStaffOrder','deleteStaffOrder','deleteStaffTable','closeStaffTable','reopenStaffTable','resetStaffCounter','saveStaffMenu','openStaffTable','updateStaffItems','corkageStaffTable','renameStaffTable','updateStaffTableDetails','prepareStaffQuiz','finishStaffQuiz','checkInStaffCall','clearStaffCalls']){
  exports[action]=onCall({region:'us-central1',timeoutSeconds:30,maxInstances:10},async request=>{
    if(!request.auth)throw new HttpsError('unauthenticated','Откройте меню заново');
    return runTransaction(async()=>{
      const now=Date.now(),nonce=randomUUID();let result,validationError;
      try{
        const db=getDatabase(),live=db.ref('live');
        if((await live.child('archivePending').get()).exists())await archiveOnce(db,now,nonce);
        const canRestore=action==='reopenStaffTable'&&/^\d{4}-\d{2}-\d{2}$/.test(request.data?.date||'')&&/^[A-ZА-ЯЁ0-9 -]{1,30}$/.test(request.data?.table||'')&&typeof request.data?.sid==='string';
        const restored=canRestore?await readArchivedSession(db,request.data.date,String(request.data.table),request.data.sid):null;
        const epoch=(await live.child('archiveEpoch').get()).val()||0;
        const collection=action.includes('Staff')?'staffOperations':'guestOperations';
        const op=typeof request.data?.requestId==='string'&&/^[-\w]{1,80}$/.test(request.data.requestId)?createHash('sha256').update(request.auth.uid+':'+request.data.requestId).digest('hex'):null;
        const archived=op?(await db.ref('archiveOperations/'+collection+'/'+op).get()).val():null;
        const tx=await live.transaction(current=>{
          if(current===null)return current;
          try{
            if(current.schemaVersion!==2)throw new HttpsError('failed-precondition','Требуется перенос данных на новую версию');
            if(current.archivePending||(current.archiveEpoch||0)!==epoch)throw new HttpsError('unavailable','История переносится в архив. Повторите тот же запрос.');
            const prior=op?(current[collection]?.[op]||archived):null;
            if(maintenanceEnabled(current)&&!prior)throw new HttpsError('unavailable','Система временно в режиме обслуживания. Повторите тот же запрос после возобновления работы.');
            let source=archived?{...current,[collection]:{...current[collection],[op]:archived}}:current;
            if(restored)source=mergeArchivedSession(source,restored);
            const next=action.includes('Staff')?staffTransition(source,action,request.data,request.auth,now,nonce):transition(source,action,request.data,request.auth.uid,now,nonce);
            if(archived&&!current[collection]?.[op])delete next.root[collection][op];
            if(!prior&&(action==='placeGuestOrder'||action==='createStaffOrder')){
              const order=next.root.orders?.[next.result.id],eventId='order_'+next.result.id;
              (next.root.pushOutbox??={})[eventId]={kind:'order',id:next.result.id,eventAt:now,value:{num:order?.num??next.result.num,table:String(order?.table??request.data?.table??'?')}};
            }else if(!prior&&action==='guestCallWaiter'&&!current.waiterCalls?.[next.result.id]){
              const eventId='call_'+next.result.id;(next.root.pushOutbox??={})[eventId]={kind:'waiterCall',id:next.result.id,eventAt:now,value:{table:next.root.waiterCalls[next.result.id].table}};
            }
            result=next.result;validationError=null;return next.root;
          }
          catch(e){validationError=e;return undefined;}
        });
        if(!tx.committed){if(validationError)throw validationError;throw new HttpsError('aborted','Повторите запрос');}
        if(!result)throw new HttpsError('failed-precondition','Меню ещё не подготовлено');
        if(action==='closeStaffTable')await compactClosedSession(db,{date:request.data.date,table:String(request.data.table),sid:request.data.sid},now,randomUUID());
        if(action==='reopenStaffTable')await removeArchivedSession(db,restored);
        return result;
      }catch(e){
        if(e instanceof OrderError)throw new HttpsError(e.code,e.message);
        if(e instanceof HttpsError)throw e;
        console.error('guest-operation-failed',{action,code:e.code||'unknown'});
        throw new HttpsError('unavailable','Не удалось подтвердить операцию. Повторите запрос.');
      }
    });
  });
}
