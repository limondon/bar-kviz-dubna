const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const assert=require('node:assert/strict');
const date=()=>new Date().toLocaleDateString('en-CA');
// Unload the app's timers before closing WebKit on Windows, after all assertions have completed.
test.afterEach(async({page})=>{await page.goto('about:blank');});
function order(items,extra={}){return{id:'one',table:'1',date:date(),sid:'session',num:1,createdAt:Date.now(),status:'done',items,...extra};}
async function show(page){await staff(page);await page.evaluate(()=>sw('tables'));await page.locator('.tb-header').click();await page.locator('[data-action=cashTransfer]').click();await expect(page.locator('[data-cash-send]')).toBeEnabled();}
function helpers(){
  const source=fs.readFileSync(path.join(__dirname,'../js/cash-bill.js'),'utf8').replace(/export /g,'');
  const sandbox={crypto:webcrypto,TextEncoder};vm.runInNewContext(source+'; result={buildCashBill,cashBillId,queueCashBill};',sandbox);return sandbox.result;
}
test('wire contract keeps original prices, variants and identities and omits cups only',async()=>{
  const {buildCashBill}=helpers();
  const items=[{id:'a',name:'Чай',qty:2,price:300},{id:'b',name:'Чай',qty:1,price:350},{id:'c',name:'Чай + лимон',qty:1,price:350},{id:'d',name:'2 кружки',qty:1},{id:'e',name:'Чай',menuItemId:'another-product',qty:1,price:300}];
  const build=orders=>buildCashBill({date:date(),table:'1',sid:'session',orders,priceFor:()=>null});
  items.push(...['1 кружка','5 кружек','12 кружек'].map((name,n)=>({id:'cup'+n,name,qty:1})));
  const bill=await build([order(items)]);
  expect(bill.total).toBe(160000);expect(bill.rows).toHaveLength(4);
  expect(bill.rows.map(r=>r[3])).toEqual(['Чай','Чай','Чай + лимон','Чай']);
  expect(bill.rows[3][2]).toBe('another-product');
  expect((await build([order([...items].reverse())])).digest).toBe(bill.digest);
  await assert.rejects(build([order([{id:'a',name:'Неизвестный товар',qty:1}])]),/Уточните цену/);
  await assert.rejects(build([order([{id:'a',name:'Чай',qty:0.5,price:300}])]),/Количество/);
});
test('sending several rows uses one slot and never marks orders or table paid',async({page},testInfo)=>{
  const env=await setup(page,{orders:{one:order({a:{name:'Вода',qty:2,price:100},b:{name:'Чай',qty:1,price:300},cup:{name:'2 кружки',qty:1}})}});
  const original=env.data();await show(page);
  await expect(page.getByRole('dialog')).toContainText('2 строк, 500');
  await expect(page.locator('.cash-transfer-lines')).not.toContainText('кружки');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('cash-preview.png'),fullPage:true});
  await page.evaluate(()=>{window.__delayCash=100;});
  await page.locator('[data-cash-send]').click();
  await expect(page.locator('[data-cash-send]')).toBeDisabled();
  await expect(page.locator('.cash-transfer-status')).toContainText('Передан');
  await page.locator('[data-cash-send]').click();
  await expect(page.locator('.cash-transfer-status')).toContainText('Передан');
  const transfers=env.data().config.evotor.v1.transfers[date()];expect(Object.keys(transfers)).toHaveLength(1);
  const entry=Object.values(transfers)[0];expect(JSON.parse(entry.canonical)[4]).toHaveLength(2);expect(entry.state).toBe('queued');
  expect(env.data().orders).toEqual(original.orders);expect(env.data().tables).toEqual(original.tables);
  expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});
test('shared golden fixture is still produced by the website',async()=>{
  const wire=JSON.parse(fs.readFileSync(path.join(__dirname,'../integrations/evotor/fixtures/bill.json'),'utf8'));
  const [v,date,table,sid,rows]=JSON.parse(wire.canonical),orders=new Map();expect(v).toBe(1);
  for(const [oid,id,productId,name,qty,kopecks]of rows){if(!orders.has(oid))orders.set(oid,{id:oid,date,table,sid,items:[]});orders.get(oid).items.push({id,menuItemId:productId,name,qty,price:kopecks/100});}
  const bill=await helpers().buildCashBill({date,table,sid,orders:[...orders.values()],priceFor:()=>null});
  expect(bill.canonical).toBe(wire.canonical);expect(bill.digest).toBe(wire.digest);expect(bill.id).toBe(wire.id);
});
test('a changed bill requires a new preview and a failed write can retry without a new id',async({page})=>{
  const env=await setup(page,{orders:{one:order({a:{name:'Вода',qty:1,price:100}})}});await show(page);
  await page.evaluate(()=>window.__remoteSet('orders/one/items/a/qty',2));
  await page.locator('[data-cash-send]').click();
  await expect(page.locator('.cash-transfer-status')).toContainText('Состав или цена изменились');
  await expect(page.locator('[data-cash-send]')).toBeDisabled();expect(env.data().config.evotor).toBeUndefined();
  await page.locator('[data-cash-close]').click();await page.locator('.tb-header').click();await page.locator('[data-action=cashTransfer]').click();
  await expect(page.locator('[data-cash-send]')).toBeEnabled();await page.evaluate(()=>{window.__failCash=true;});
  await page.locator('[data-cash-send]').click();await expect(page.locator('.cash-transfer-status')).toContainText('Не удалось подтвердить');
  expect(env.data().config.evotor).toBeUndefined();
  await page.locator('[data-cash-send]').click();await expect(page.locator('.cash-transfer-status')).toContainText('Передан');
  expect(Object.keys(env.data().config.evotor.v1.transfers[date()])).toHaveLength(1);
  expect(env.errors).toEqual([]);
});
test('opening/unknown/opened states synchronize and block replay including later additions',async({page})=>{
  const env=await setup(page,{orders:{one:order({a:{name:'Вода',qty:1,price:100}})}});await show(page);
  await page.locator('[data-cash-send]').click();await expect(page.locator('.cash-transfer-status')).toContainText('Передан');
  const id=Object.keys(env.data().config.evotor.v1.transfers[date()])[0];
  for(const state of ['opening','unknown','opened']){
    await page.evaluate(({p,state})=>window.__remoteSet(p,state),{p:`config/evotor/v1/transfers/${date()}/${id}/state`,state});
    await expect(page.locator('[data-cash-send]')).toBeDisabled();
  }
  await page.evaluate(()=>window.__remoteSet('orders/one/items/b',{name:'Вода',qty:2,price:100}));
  await page.locator('[data-cash-close]').click();await page.locator('.tb-header').click();await page.locator('[data-action=cashTransfer]').click();
  await expect(page.locator('[data-cash-send]')).toBeDisabled();await expect(page.locator('.cash-transfer-status')).toContainText('Открыт на кассе');
  expect(Object.keys(env.data().config.evotor.v1.transfers[date()])).toHaveLength(1);expect(env.errors).toEqual([]);
});
test('an unacknowledged transfer can be hidden without blocking the rest of the app',async({page})=>{
  const env=await setup(page,{orders:{one:order({a:{name:'Вода',qty:1,price:100}})}});await show(page);
  await page.clock.install();await page.evaluate(()=>{window.__delayCash=60000;});
  await page.locator('[data-cash-send]').click();await page.clock.runFor(12001);
  await expect(page.locator('.cash-transfer-status')).toContainText('Подтверждения пока нет');
  await page.getByRole('button',{name:'Скрыть окно'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.runFor(60000);
  expect(Object.keys(env.data().config.evotor.v1.transfers[date()])).toHaveLength(1);expect(env.errors).toEqual([]);
});
