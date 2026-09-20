'use strict';
const {dateAt}=require('./guest-service');
const {isDeepStrictEqual}=require('node:util');
const DAY=86400000;
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const put=(target,key,value)=>Object.defineProperty(target,key,{value,enumerable:true,configurable:true,writable:true});
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function eligible(order,root,cutoff){
  if(!record(order)||!validDate(order.date)||(cutoff&&order.date>=cutoff)||!order.sid)return false;
  const meta=root.tables?.[order.date+'_'+order.table];
  if(!meta||!(meta.sid===order.sid&&meta.status==='closed'||(Array.isArray(meta.closedSessions)?meta.closedSessions:[]).some(s=>s?.sid===order.sid)))return false;
  if(!record(order.items)||!Object.keys(order.items).length)return false;
  const lines=Object.values(order.items);
  if(!lines.every(i=>record(i)&&typeof i.name==='string'&&i.name.trim()&&i.status==='done'&&Number.isSafeInteger(i.qty)&&i.qty>0&&typeof i.price==='number'&&Number.isFinite(i.price)&&i.price>=0))return false;
  return Number.isFinite(order.total)&&Math.abs(lines.reduce((s,i)=>s+i.qty*i.price,0)-order.total)<.005;
}
function selectClosedBackfill(root){
  const batch={orders:{},tables:{},guestOperations:{},staffOperations:{},waiterCalls:{},guestRateLimits:{},deliveryLog:{}};
  let count=0;
  for(const [id,meta] of Object.entries(root.tables||{}).sort(([a],[b])=>a.localeCompare(b))){
    if(meta?.status!=='closed'||!validDate(meta.date)||id!==meta.date+'_'+meta.tNum)continue;
    const orders=Object.entries(root.orders||{}).filter(([,o])=>o?.date===meta.date&&String(o.table)===String(meta.tNum));
    if(!orders.length||!orders.every(([key,o])=>o?.id===key&&eligible(o,root)))continue;
    if(count&&count+orders.length>500)continue;
    for(const [key,o] of orders)put(batch.orders,key,o);
    batch.tables[id]=meta;count+=orders.length;
    if(count>=500)break;
  }
  return structuredClone(batch);
}
// Selection is deterministic for crash recovery. No record is rewritten or repriced.
function selectArchive(root,now){
  const cutoff=dateAt(now-30*DAY),batch={orders:{},tables:{},guestOperations:{},staffOperations:{},waiterCalls:{},guestRateLimits:{},deliveryLog:{}};
  // Move a whole table/day, including all its guest sessions. A broken or
  // unfinished record keeps the entire bill live; never split a bill in two.
  let count=0;
  for(const [id,meta] of Object.entries(root.tables||{}).sort(([a],[b])=>a.localeCompare(b))){
    if(meta?.status!=='closed'||!validDate(meta.date)||meta.date>=cutoff||id!==meta.date+'_'+meta.tNum)continue;
    const orders=Object.entries(root.orders||{}).filter(([,o])=>o?.date===meta.date&&String(o.table)===String(meta.tNum));
    if(!orders.every(([key,o])=>o?.id===key&&eligible(o,root,cutoff)))continue;
    if(count&&count+orders.length>500)continue;
    for(const [key,o] of orders)put(batch.orders,key,o);
    batch.tables[id]=meta;count+=orders.length;
    if(count>=500)break;
  }
  for(const collection of ['guestOperations','staffOperations'])for(const [id,value] of Object.entries(root[collection]||{})){
    if(Object.keys(batch[collection]).length>=1000)break;
    if(record(value)&&Number.isFinite(value.at)&&value.at<now-30*DAY&&value.action&&value.result)put(batch[collection],id,value);
  }
  for(const [id,value] of Object.entries(root.waiterCalls||{}))if(value?.date<cutoff&&value.status!=='pending')put(batch.waiterCalls,id,value);
  for(const [id,value] of Object.entries(root.guestRateLimits||{}))if(Number.isFinite(value?.start)&&value.start<now-DAY)put(batch.guestRateLimits,id,value);
  for(const [id,value] of Object.entries(root.config?.deliveryLog||{}))if(Number.isFinite(value?.at)&&value.at<now-30*DAY)put(batch.deliveryLog,id,value);
  return structuredClone(batch);
}
function selectClosedSession(root,date,table,sid){
  const batch={orders:{},tables:{},guestOperations:{},staffOperations:{},waiterCalls:{},guestRateLimits:{},deliveryLog:{}};
  const key=date+'_'+table,meta=root.tables?.[key];
  if(!meta||meta.status!=='closed'||String(meta.tNum)!==String(table)||(meta.sid||'default')!==sid)return batch;
  const orders=Object.entries(root.orders||{}).filter(([,o])=>o?.date===date&&String(o.table)===String(table)&&(o.sid||'default')===sid);
  if(!orders.length)return batch;
  // Closing already rejects unfinished items. Recheck the frozen snapshot before
  // it is copied so a malformed bill can never disappear from the live set.
  if(!orders.every(([id,o])=>o?.id===id&&record(o.items)&&Object.keys(o.items).length&&Object.values(o.items).every(i=>record(i)&&i.status==='done'&&Number.isSafeInteger(i.qty)&&i.qty>0&&typeof i.price==='number'&&Number.isFinite(i.price)&&i.price>=0)&&Number.isFinite(o.total)&&Math.abs(Object.values(o.items).reduce((s,i)=>s+i.qty*i.price,0)-o.total)<.005))return batch;
  for(const [id,o] of orders)put(batch.orders,id,o);
  batch.tables[key]=meta;
  return structuredClone(batch);
}
const hasWork=batch=>Object.values(batch).some(v=>Object.keys(v).length);
function archiveWrites(batch,batchId){
  const updates={};
  for(const [id,o] of Object.entries(batch.orders))updates['archive/days/'+o.date+'/orders/'+id]=o;
  for(const [id,t] of Object.entries(batch.tables))updates['archive/days/'+t.date+'/tables/'+id]=t;
  for(const name of ['guestOperations','staffOperations'])for(const [id,value] of Object.entries(batch[name]))updates['archiveOperations/'+name+'/'+id]=value;
  for(const name of ['waiterCalls','guestRateLimits','deliveryLog'])for(const [id,value] of Object.entries(batch[name]))updates['archive/maintenance/'+batchId+'/'+name+'/'+id]=value;
  return updates;
}
function pruneArchive(current,batch){
  const root=structuredClone(current);
  for(const [name,values] of Object.entries(batch)){
    const target=name==='deliveryLog'?root.config?.deliveryLog:root[name];
    for(const [id,value] of Object.entries(values)){
      if(!isDeepStrictEqual(target?.[id],value))throw new Error('Archive source changed; removal refused');
      delete target[id];
    }
  }
  root.archiveEpoch=(root.archiveEpoch||0)+1;delete root.archivePending;
  return root;
}
function pruneClosedSession(current,batch){
  const root=structuredClone(current);
  for(const [id,value] of Object.entries(batch.orders)){
    if(!isDeepStrictEqual(root.orders?.[id],value))throw new Error('Archive source changed; removal refused');
    delete root.orders[id];
  }
  root.archiveEpoch=(root.archiveEpoch||0)+1;delete root.archivePending;
  return root;
}
function pendingBatch(root,pending){
  if(pending.kind==='closed-session')return selectClosedSession(root,pending.date,pending.table,pending.sid);
  if(pending.kind==='closed-backfill')return selectClosedBackfill(root);
  return selectArchive(root,pending.at);
}
async function finishPending(db,frozen){
  const pending=frozen.archivePending;if(!pending)return {moved:0};
  const batch=pendingBatch(frozen,pending);
  if(pending.kind==='closed-session'&&!Object.keys(batch.orders).length)throw new Error('Closed session archive snapshot is no longer valid');
  const updates=archiveWrites(batch,pending.id);
  if(Object.keys(updates).length)await db.ref().update(updates);
  const done=await db.ref('live').transaction(root=>{
    if(root===null)return null;
    if(root?.archivePending?.id!==pending.id)return;
    return ['closed-session','closed-backfill'].includes(pending.kind)?pruneClosedSession(root,batch):pruneArchive(root,batch);
  });
  return {moved:done.committed?Object.keys(batch.orders).length:0,completed:done.committed};
}
// The short durable lock protects the copy/verify/prune sequence across instances.
// If interrupted, the next scheduler/manual run resumes the same frozen snapshot.
async function archiveOnce(db,now,batchId){
  const ref=db.ref('live');
  const lock=await ref.transaction(root=>{
    // A cold Admin SDK cache starts at null. Returning null requests a server
    // comparison and retry; aborting here would skip an existing database.
    if(root===null)return null;
    if(!root||root.schemaVersion!==2||root.maintenance?.enabled)return;
    if(root.archivePending)return root;
    if(!hasWork(selectArchive(root,now)))return;
    return {...root,archivePending:{id:batchId,at:now,kind:'maintenance'}};
  });
  if(!lock.committed||!lock.snapshot.val()?.archivePending)return {moved:0};
  return finishPending(db,lock.snapshot.val());
}
async function compactClosedSession(db,{date,table,sid},now,batchId){
  for(let attempt=0;attempt<3;attempt++){
    const ref=db.ref('live');
    const lock=await ref.transaction(root=>{
      if(root===null)return null;
      if(!root||root.schemaVersion!==2||root.maintenance?.enabled)return;
      if(root.archivePending)return root;
      if(!hasWork(selectClosedSession(root,date,table,sid)))return;
      return {...root,archivePending:{id:batchId,at:now,kind:'closed-session',date,table:String(table),sid}};
    });
    const frozen=lock.snapshot?.val?.(),pending=frozen?.archivePending;
    if(!lock.committed||!pending)return {moved:0,completed:true};
    const completed=await finishPending(db,frozen);
    if(pending.kind==='closed-session'&&pending.date===date&&String(pending.table)===String(table)&&pending.sid===sid)return completed;
  }
  throw new Error('Archive queue is busy');
}
async function backfillClosedOnce(db,now,batchId){
  const ref=db.ref('live');
  const lock=await ref.transaction(root=>{
    if(root===null)return null;
    if(!root||root.schemaVersion!==2||root.maintenance?.enabled)return;
    if(root.archivePending)return root;
    if(!hasWork(selectClosedBackfill(root)))return;
    return {...root,archivePending:{id:batchId,at:now,kind:'closed-backfill'}};
  });
  if(!lock.committed||!lock.snapshot.val()?.archivePending)return {moved:0};
  return finishPending(db,lock.snapshot.val());
}
async function readArchivedSession(db,date,table,sid){
  const value=(await db.ref('archive/days/'+date+'/orders').get()).val()||{},orders={};
  for(const [id,o] of Object.entries(value))if(o?.date===date&&String(o.table)===String(table)&&(o.sid||'default')===sid)put(orders,id,o);
  return {date,table:String(table),sid,orders:structuredClone(orders)};
}
function mergeArchivedSession(current,snapshot){
  if(!snapshot||!Object.keys(snapshot.orders||{}).length)return current;
  const root=structuredClone(current),orders=root.orders??={};
  for(const [id,o] of Object.entries(snapshot.orders)){
    if(orders[id]&&!isDeepStrictEqual(orders[id],o))throw new Error('Archived order conflicts with live order');
    put(orders,id,structuredClone(o));
  }
  return root;
}
async function removeArchivedSession(db,snapshot){
  if(!snapshot||!Object.keys(snapshot.orders||{}).length)return {removed:0};
  let conflict=false,removed=0;
  const tx=await db.ref('archive/days/'+snapshot.date+'/orders').transaction(current=>{
    if(current===null)return null;
    const next=structuredClone(current||{});
    for(const [id,o] of Object.entries(snapshot.orders)){
      if(next[id]===undefined)continue;
      if(!isDeepStrictEqual(next[id],o)){conflict=true;return;}
      delete next[id];removed++;
    }
    return next;
  });
  if(conflict||!tx.committed)throw new Error('Archived order changed; removal refused');
  return {removed};
}
module.exports={eligible,selectArchive,selectClosedBackfill,selectClosedSession,archiveWrites,pruneArchive,pruneClosedSession,hasWork,archiveOnce,backfillClosedOnce,compactClosedSession,readArchivedSession,mergeArchivedSession,removeArchivedSession};
