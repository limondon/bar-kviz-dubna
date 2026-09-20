const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeSubscription,makeSubscriptionRecord,notificationFor,selectRecipients,deliverNotifications}=require('../functions/push-service');

const subscription=(name='device')=>({endpoint:`https://push.example/${name}`,keys:{p256dh:'A'.repeat(65),auth:'B'.repeat(22)}});

test('push subscriptions accept only HTTPS endpoints with browser keys',()=>{
  assert.deepEqual(normalizeSubscription(subscription()),subscription());
  assert.throws(()=>normalizeSubscription({...subscription(),endpoint:'http://push.example/device'}),/адрес/);
  assert.throws(()=>normalizeSubscription({...subscription(),keys:{p256dh:'short',auth:'short'}}),/ключи/);
});

test('push subscription keeps its first activation time while changing the selected role',()=>{
  const first=makeSubscriptionRecord(subscription(),{uid:'staff',role:'barman',now:100});
  const changed=makeSubscriptionRecord(subscription(),{uid:'staff',role:'waiter',now:200,previous:first.record});
  assert.equal(changed.id,first.id);assert.deepEqual(changed.record,{...first.record,role:'waiter',updatedAt:200});
});

test('new orders and waiter calls select only eligible device roles',()=>{
  const records={oldBar:{role:'barman',createdAt:10,subscription:subscription('bar')},newBar:{role:'barman',createdAt:30,subscription:subscription('new')},waiter:{role:'waiter',createdAt:10,subscription:subscription('waiter')},admin:{role:'admin',createdAt:10,subscription:subscription('admin')}};
  assert.deepEqual(selectRecipients(records,{kind:'order',eventAt:20}).map(([id])=>id),['oldBar','admin']);
  assert.deepEqual(selectRecipients(records,{kind:'waiterCall',eventAt:20}).map(([id])=>id),['waiter','admin']);
});

test('push delivery does not expose order contents and marks expired devices for removal',async()=>{
  let configured,payload;
  const webpush={setVapidDetails:(...args)=>configured=args,sendNotification:async(sub,body)=>{payload=JSON.parse(body);if(sub.endpoint.endsWith('/gone'))throw{statusCode:410};if(sub.endpoint.endsWith('/later'))throw{statusCode:503};}};
  const records={ok:{role:'barman',createdAt:1,subscription:subscription('ok')},gone:{role:'admin',createdAt:1,subscription:subscription('gone')},later:{role:'barman',createdAt:1,subscription:subscription('later')},waiter:{role:'waiter',createdAt:1,subscription:subscription('waiter')}};
  const result=await deliverNotifications({records,kind:'order',value:{num:7,table:'3',note:'секрет',items:{x:{name:'товар'}}},id:'order',eventAt:2,webpush,credentials:{subject:'https://bar.test',publicKey:'public',privateKey:'private'}});
  assert.deepEqual(configured,['https://bar.test','public','private']);assert.deepEqual(result,{sent:1,sentIds:['ok'],expired:['gone'],failed:1});
  assert.deepEqual(payload,notificationFor('order',{num:7,table:'3'},'order'));assert.equal(JSON.stringify(payload).includes('секрет'),false);
});
