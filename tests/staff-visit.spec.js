const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');
test.afterEach(async({page})=>page.goto('about:blank'));

test('a lost confirmation of a staff order keeps exactly one order and one deduction',async({page})=>{
  const env=await setup(page);await staff(page);
  await page.locator('#inpTable').fill('PS1');await page.locator('#inpItems').fill('2 Вода');
  await page.evaluate(()=>{window.__ackLostOrder=true;});await page.locator('.btn-add').click();
  await expect(page.locator('#inpItems')).toHaveValue('');
  const data=env.data(),orders=Object.values(data.orders);
  expect(orders).toHaveLength(1);
  expect(data.tables[orders[0].date+'_PS1'].sid).toBe(orders[0].sid);
  expect(data.menu2[0].items[0].stock).toBe(8);
});

test('a second employee opening the same table preserves the first visit and the draft',async({page})=>{
  const env=await setup(page);await staff(page);
  await page.locator('#inpTable').fill('PS1');await page.locator('#inpItems').fill('2 Вода');
  await page.evaluate(()=>{window.__staffRace={path:'tables/'+new Date().toLocaleDateString('en-CA')+'_PS1',value:{sid:'other',status:'open',openedAt:Date.now(),note:'У окна'}};});
  await page.locator('.btn-add').click();
  await expect(page.locator('#fErr')).toContainText('Заказ не подтверждён');
  expect(env.data().orders).toEqual({});expect(env.data().menu2[0].items[0].stock).toBe(10);
  await expect(page.locator('#inpItems')).toHaveValue('2 Вода');
  await page.locator('.btn-add').click();await expect(page.locator('#inpItems')).toHaveValue('');
  const [order]=Object.values(env.data().orders);
  expect(order.sid).toBe('other');expect(env.data().tables[order.date+'_PS1'].note).toBe('У окна');
});

test('confirming a stale close cannot mark the next visit paid',async({page})=>{
  const date=new Date().toLocaleDateString('en-CA');
  const env=await setup(page,{orders:{one:{num:1,date,sid:'session',table:'1',createdAt:Date.now(),items:{w:{name:'Вода',qty:1,status:'done',price:100}}}}});
  await staff(page);await page.evaluate(()=>sw('tables'));
  const header=page.locator('.tb-header');await header.focus();await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded','true');
  await page.locator('.btn-pay').click();
  await page.evaluate(date=>{window.__tableRace={path:'tables/'+date+'_1',value:{status:'open',sid:'next',openedAt:Date.now()}};},date);
  await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#fInfo')).toContainText('Посещение изменилось');
  expect(env.data().tables[date+'_1'].status).toBe('open');
});
test('manual items with no menu price can be corrected before creating the order',async({page})=>{
  const env=await setup(page);await staff(page);
  await page.locator('#inpTable').fill('1');await page.locator('#inpItems').fill('1 Ручная позиция');
  await page.locator('.btn-add').click();
  await expect(page.locator('#confirmMsg')).toContainText('Ручная позиция');
  expect(env.data().orders).toEqual({});
  await page.evaluate(()=>closeConfirmModal());
  await expect(page.locator('#inpItems')).toHaveValue('1 Ручная позиция');
});
