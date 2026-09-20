'use strict';
const {createHash}=require('node:crypto');

const ROLES=new Set(['admin','barman','waiter']);
const keyPattern=/^[A-Za-z0-9_-]{16,256}$/;
const subscriptionId=endpoint=>createHash('sha256').update(endpoint).digest('hex');

function normalizeSubscription(value){
  if(!value||typeof value!=='object')throw new Error('Некорректная push-подписка');
  const endpoint=String(value.endpoint||'');let url;
  try{url=new URL(endpoint);}catch{throw new Error('Некорректный адрес push-подписки');}
  if(url.protocol!=='https:'||endpoint.length>2048)throw new Error('Некорректный адрес push-подписки');
  const p256dh=String(value.keys?.p256dh||''),auth=String(value.keys?.auth||'');
  if(!keyPattern.test(p256dh)||!keyPattern.test(auth))throw new Error('Некорректные ключи push-подписки');
  return {endpoint,keys:{p256dh,auth}};
}

function makeSubscriptionRecord(value,{uid,role,now,previous}={}){
  const subscription=normalizeSubscription(value);
  if(typeof uid!=='string'||!uid||!ROLES.has(role))throw new Error('Некорректная роль push-подписки');
  return {
    id:subscriptionId(subscription.endpoint),
    record:{uid,role,subscription,createdAt:Number(previous?.createdAt)||now,updatedAt:now}
  };
}

function notificationFor(kind,value,id){
  if(kind==='order'){
    const num=Number.isFinite(Number(value?.num))?' #'+Number(value.num):'';
    return {title:'🍺 Новый заказ'+num,body:`Стол ${String(value?.table||'?')}`,tag:'order-'+id,url:'./?push=orders'};
  }
  if(kind==='waiterCall')return {title:'🔔 Вызов официанта',body:`Стол ${String(value?.table||'?')} зовёт официанта`,tag:'call-'+id,url:'./?push=calls'};
  throw new Error('Неизвестный тип уведомления');
}

function selectRecipients(records,{kind,eventAt}){
  const roles=kind==='order'?new Set(['admin','barman']):new Set(['admin','waiter']);
  return Object.entries(records||{}).filter(([,record])=>
    record&&roles.has(record.role)&&Number(record.createdAt)<=eventAt&&record.subscription
  );
}

async function deliverNotifications({records,kind,value,id,eventAt,webpush,credentials}){
  const recipients=selectRecipients(records,{kind,eventAt});
  if(!recipients.length)return {sent:0,expired:[],failed:0};
  if(!credentials?.publicKey||!credentials?.privateKey)throw new Error('Push-ключи не настроены');
  webpush.setVapidDetails(credentials.subject,credentials.publicKey,credentials.privateKey);
  const payload=JSON.stringify(notificationFor(kind,value,id));
  const results=await Promise.allSettled(recipients.map(([,record])=>webpush.sendNotification(record.subscription,payload,{TTL:120,urgency:'high'})));
  const expired=[],sentIds=[];
  results.forEach((result,index)=>{
    const recipientId=recipients[index][0];
    if(result.status==='fulfilled')sentIds.push(recipientId);
    else if([404,410].includes(Number(result.reason?.statusCode)))expired.push(recipientId);
  });
  return {sent:sentIds.length,sentIds,expired,failed:results.length-sentIds.length-expired.length};
}

module.exports={normalizeSubscription,subscriptionId,makeSubscriptionRecord,notificationFor,selectRecipients,deliverNotifications};
