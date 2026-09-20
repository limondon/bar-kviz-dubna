const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function worker(cached){
  const handlers={},matched=[],notifications=[];
  vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{
    URL,Response,fetch:async()=>{throw new Error('offline');},
    caches:{open:async()=>({match:async key=>{matched.push(key);return cached;}})},
    self:{registration:{scope:'https://bar.test/app/',showNotification:async(title,options)=>notifications.push({title,options})},addEventListener:(type,fn)=>handlers[type]=fn}
  });
  return {matched,notifications,request(url,method='GET'){
    let response;
    handlers.fetch({request:{url,method},respondWith:r=>response=r});
    return response;
  },async push(data){
    let pending;handlers.push({data:{json:()=>data},waitUntil:p=>pending=p});await pending;
  }};
}
test('offline QR navigation matches the cached guest shell without token parameters',async()=>{
  const w=worker(new Response('guest shell'));
  assert.equal(await (await w.request('https://bar.test/app/guest.html?table=1&token=secret')).text(),'guest shell');
  assert.deepEqual(w.matched,['https://bar.test/app/guest.html']);
});
test('worker leaves API, POST and external requests to the network',()=>{
  const w=worker();
  for(const [url,method] of [['https://bar.test/app/api/order','POST'],['https://bar.test/app/guest.html','POST'],['https://api.test/guest.html','GET'],['https://bar.test/other/guest.html','GET']])assert.equal(w.request(url,method),undefined);
});
test('missing offline asset produces an explicit response instead of undefined',async()=>{
  const w=worker();assert.equal((await w.request('https://bar.test/app/guest.html?table=1')).status,503);
});
test('background push displays the server title, route and unique tag',async()=>{
  const w=worker();await w.push({title:'Новый заказ #7',body:'Стол 3',tag:'order-id',url:'./?push=orders'});
  assert.equal(w.notifications.length,1);assert.equal(w.notifications[0].title,'Новый заказ #7');
  assert.equal(w.notifications[0].options.tag,'order-id');assert.equal(w.notifications[0].options.data.url,'./?push=orders');
});
