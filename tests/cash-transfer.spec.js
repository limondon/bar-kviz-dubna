const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const assert=require('node:assert/strict');
const date=()=>new Date().toLocaleDateString('en-CA');
// Unload the app's timers before closing WebKit on Windows, after all assertions have completed.
test.afterEach(async({page})=>{await page.goto('about:blank');});
function order(items,extra={}){return{id:'one',table:'1',date:date(),sid:'session',num:1,createdAt:Date.now(),status:'done',items,...extra};}
const ruleKey=name=>require('node:crypto').createHash('sha256').update(name).digest('hex');
function deviceFixture(){
  const items={},settings={schema:1,products:{},addons:{}};
  for(const [id,name,price,kind] of [['water','Вода',100,'products'],['tea','Чай',300,'products'],['sencha','Сенча',300,'products'],['hookah','Кальян классический',1300,'products'],['lemon','лимон',50,'addons']]){
    items[id]={name,priceKopecks:price*100,supported:true,fingerprint:id};
    settings[kind][ruleKey(name)]={name,expectedKopecks:price*100,parts:[{uuid:id,units:1,fingerprint:id}]};
  }
  return {catalog:{deviceName:'Зал',moneyFormat:'kopecks-v1',items},settings};
}
async function seedCash(page){await page.evaluate(d=>window.__remoteSet('config/evotor/v1/devices/hall',d),deviceFixture());}
async function show(page){await staff(page);await seedCash(page);await page.evaluate(()=>sw('tables'));await page.locator('.tb-header').click();await page.locator('[data-action=cashTransfer]').click();await expect(page.locator('[data-cash-send]')).toBeEnabled();}
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

test('mixed table names the missing addon, returns from settings and rechecks the price on send',async({page})=>{
  const env=await setup(page,{orders:{one:order({h:{name:'Кальян классический',qty:1,price:1300},t:{name:'Сенча + лимон',qty:2,price:350}})}});
  await staff(page);
  const device=deviceFixture();delete device.settings.addons[ruleKey('лимон')];
  await page.evaluate(d=>window.__remoteSet('config/evotor/v1/devices/hall',d),device);
  await page.evaluate(()=>sw('tables'));await page.locator('.tb-header').click();await page.locator('[data-action=cashTransfer]').click();
  const send=page.locator('[data-cash-send]'),problem=page.locator('.cash-preflight li');
  await expect(problem).toHaveCount(1);await expect(problem).toContainText('«Сенча + лимон» — в «Касса Эвотор» → «Добавки» добавьте соответствие для «лимон»');
  await expect(send).toBeDisabled();
  await page.locator('[data-settings]').click();await page.locator('[data-kind=addons]').click();
  await page.locator('.cash-settings-row').filter({hasText:'лимон'}).locator('[data-edit]').click();
  await page.locator('[data-card]').selectOption('lemon');await page.locator('[data-save]').click();
  await expect(page.locator('.cash-settings-status')).toContainText('Сохранено');
  await page.locator('.cash-settings [data-close]').click();await expect(send).toBeEnabled();
  await page.evaluate(()=>window.__remoteSet('config/evotor/v1/devices/hall/catalog/items/lemon/priceKopecks',6000));
  await send.click();await expect(send).toBeDisabled();await expect(problem).toContainText('в счёте 350 ₽, по каталогу кассы 360 ₽');
  await expect(problem).toContainText('лимон 60 ₽');expect(env.data().config.evotor.v1.transfers).toBeUndefined();
  await page.evaluate(()=>window.__remoteSet('config/evotor/v1/devices/hall/catalog/items/lemon/priceKopecks',5000));
  await page.locator('[data-recheck]').click();await expect(send).toBeEnabled();await send.click();
  await expect(page.locator('.cash-transfer-status')).toContainText('Передан');
  const [record]=Object.values(env.data().config.evotor.v1.transfers[date()]);
  expect(JSON.parse(record.canonical)[4].map(row=>row.slice(3,6))).toEqual([['Кальян классический',1,130000],['Сенча + лимон',2,35000]]);
  expect(env.errors).toEqual([]);
});

test('exact variants override component rules and changed cards identify the specific item',async({page})=>{
  await setup(page);await staff(page);
  const device=deviceFixture(),variant='Пробковый сбор — Пиво + лимон';
  const result=await page.evaluate(async({device,variant})=>{
    const {checkCashRows}=await import('/js/cash-preflight.js'),{cashRuleKey}=await import('/js/cash-rules.js');
    const rows=[['o','i','',variant,1,130000]];
    const missing=await checkCashRows(rows,device);
    device.settings.products[await cashRuleKey(variant)]={name:variant,parts:[{uuid:'hookah',units:1,fingerprint:'hookah'}]};
    const exact=await checkCashRows(rows,device);
    device.catalog.items.lemon.fingerprint='changed';
    return {missing,exact,changed:await checkCashRows([['o','j','','Сенча + лимон',1,35000]],device)};
  },{device,variant});
  expect(result.missing).toHaveLength(1);expect(result.missing[0]).toContain('«Наши товары»');expect(result.missing[0]).toContain(variant);
  expect(result.exact).toEqual([]);expect(result.changed[0]).toContain('«Добавки» проверьте «лимон»');
});

test('multiple active terminals require a choice and an archived terminal cannot pass the final check',async({page})=>{
  const env=await setup(page,{orders:{one:order({a:{name:'Вода',qty:1,price:100}})}});
  await staff(page);const device=deviceFixture();
  await page.evaluate(d=>window.__remoteSet('config/evotor/v1/devices',{hall:d,bar:structuredClone(d),old:{...d,registration:{archived:true}}}),device);
  await page.evaluate(()=>sw('tables'));await page.locator('.tb-header').click();await page.locator('[data-action=cashTransfer]').click();
  const select=page.getByLabel('Касса для проверки'),send=page.locator('[data-cash-send]');
  await expect(select).toBeEnabled();await expect(send).toBeDisabled();await expect(select.locator('option')).toHaveCount(3);
  await select.selectOption('bar');await expect(send).toBeEnabled();
  await page.evaluate(()=>window.__remoteSet('config/evotor/v1/devices/bar/registration',{archived:true}));
  await send.click();await expect(page.locator('.cash-preflight')).toContainText('касса больше недоступна');await expect(send).toBeDisabled();
  expect(env.data().config.evotor.v1.transfers).toBeUndefined();
  await page.locator('[data-recheck]').click();await expect(send).toBeEnabled();
});

test('staff tea with an addon keeps its price across a menu change and a later order',async({page})=>{
  const env=await setup(page);await staff(page);await seedCash(page);
  async function addTea(quantity){
    await page.locator('#inpTable').fill('1');
    await page.locator('#inpItems').fill(quantity+' Сенча + лимон');
    await page.locator('.btn-add').click();
    await expect(page.locator('#inpItems')).toHaveValue('');
  }
  await addTea(2);
  await page.evaluate(()=>window.__remoteSet('menu2/1/items/0/price',350));
  await addTea(1);
  const prices=Object.values(env.data().orders).map(o=>Object.values(o.items)[0].price);
  expect(prices.sort()).toEqual([350,400]);
  await page.evaluate(()=>sw('tables'));await page.locator('.tb-header').click();
  await expect(page.locator('.sum-total .sum-tot')).toHaveText('1100₽');
  await page.locator('[data-action=cashTransfer]').click();
  await expect(page.locator('.cash-transfer-lines p')).toHaveText(['Сенча + лимон ×2 — 700 ₽','Сенча + лимон ×1 — 400 ₽']);
  await expect(page.locator('.cash-preflight li')).toHaveCount(1);
  await expect(page.locator('.cash-preflight li')).toContainText('в счёте 400 ₽, по каталогу кассы 350 ₽');
  await expect(page.locator('[data-cash-send]')).toBeDisabled();
  expect(env.data().config.evotor.v1.transfers).toBeUndefined();
});

test('only a cleared receipt can be refreshed after an opening and its attempt history survives',async()=>{
  const {buildCashBill,queueCashBill}=helpers();
  const bill=await buildCashBill({date:date(),table:'1',sid:'session',orders:[order([{id:'a',name:'Чай',qty:1,price:500}])],priceFor:()=>null});
  for(const state of ['opening','opened','unknown','rejected'])expect(queueCashBill({state},bill,1000)).toBeUndefined();
  expect(queueCashBill({state:'cleared'},bill,1000)).toBeUndefined();
  const history=[{nonce:'old-attempt',receiptUuid:'old-receipt',digest:'old-digest',clearedAt:10}];
  const fresh=queueCashBill({state:'cleared',needsRefresh:true,clearedAttempts:history},bill,1000);
  expect(fresh.state).toBe('queued');expect(fresh.createdAt).toBe(1000);expect(fresh.canonical).toBe(bill.canonical);
  expect(fresh.clearedAttempts).toEqual(history);expect(fresh.needsRefresh).toBeUndefined();
  expect(queueCashBill(fresh,bill,2000).clearedAttempts).toEqual(history);
});

test('a receipt cleared on the terminal can be refreshed from the website without losing history',async({page})=>{
  const env=await setup(page,{orders:{one:order({a:{name:'Вода',qty:1,price:100}})}});await show(page);
  await page.locator('[data-cash-send]').click();await expect(page.locator('.cash-transfer-status')).toContainText('Передан');
  const [id,entry]=Object.entries(env.data().config.evotor.v1.transfers[date()])[0];
  const history=[{nonce:'old-attempt',receiptUuid:'old-receipt',digest:entry.digest,clearedAt:Date.now()}];
  await page.evaluate(({day,id,entry,history})=>window.__remoteSet(`config/evotor/v1/transfers/${day}/${id}`,{...entry,state:'cleared',needsRefresh:true,clearedAttempts:history}),{day:date(),id,entry,history});
  await expect(page.locator('.cash-transfer-status')).toContainText('Прежний чек очищен');
  await expect(page.locator('[data-cash-send]')).toBeEnabled();await page.locator('[data-cash-send]').click();
  await expect(page.locator('.cash-transfer-status')).toContainText('Передан');
  const fresh=env.data().config.evotor.v1.transfers[date()][id];
  expect(fresh.state).toBe('queued');expect(fresh.clearedAttempts).toEqual(history);expect(fresh.needsRefresh).toBeUndefined();
  expect(env.errors).toEqual([]);
});
test('a changed bill requires a new preview and a failed write can retry without a new id',async({page})=>{
  const env=await setup(page,{orders:{one:order({a:{name:'Вода',qty:1,price:100}})}});await show(page);
  await page.evaluate(()=>window.__remoteSet('orders/one/items/a/qty',2));
  await page.locator('[data-cash-send]').click();
  await expect(page.locator('.cash-transfer-status')).toContainText('Состав или цена изменились');
  await expect(page.locator('[data-cash-send]')).toBeDisabled();expect(env.data().config.evotor.v1.transfers).toBeUndefined();
  await page.locator('[data-cash-close]').click();await page.locator('[data-action=cashTransfer]').click();
  await expect(page.locator('[data-cash-send]')).toBeEnabled();await page.evaluate(()=>{window.__failCash=true;});
  await page.locator('[data-cash-send]').click();await expect(page.locator('.cash-transfer-status')).toContainText('Не удалось подтвердить');
  expect(env.data().config.evotor.v1.transfers).toBeUndefined();
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
  await page.locator('[data-cash-close]').click();await page.locator('[data-action=cashTransfer]').click();
  await expect(page.locator('[data-cash-send]')).toBeDisabled();await expect(page.locator('.cash-transfer-status')).toContainText('Открыт на кассе');
  await expect(page.locator('.cash-transfer-status')).toContainText('отличается от последней передачи');
  expect(Object.keys(env.data().config.evotor.v1.transfers[date()])).toHaveLength(1);expect(env.errors).toEqual([]);
});
test('an unacknowledged transfer can be hidden without blocking the rest of the app',async({page})=>{
  const env=await setup(page,{orders:{one:order({a:{name:'Вода',qty:1,price:100}})}});await show(page);
  await page.clock.install();await page.evaluate(()=>{window.__delayCash=60000;});
  await page.locator('[data-cash-send]').click();await expect(page.locator('.cash-transfer-status')).toContainText('Жду подтверждения базы');await page.clock.runFor(12001);
  await expect(page.locator('.cash-transfer-status')).toContainText('Подтверждения пока нет');
  await page.getByRole('button',{name:'Скрыть окно'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.runFor(60000);
  expect(Object.keys(env.data().config.evotor.v1.transfers[date()])).toHaveLength(1);expect(env.errors).toEqual([]);
});
