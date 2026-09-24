const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {setup,staff,guest}=require('./spark-fixture.cjs');

test('staff draft survives reload, including quick table and menu picker',async({page})=>{
  const env=await setup(page);await staff(page);
  await page.evaluate(()=>pickTable('1'));
  await page.locator('#inpNote').fill('Без льда');await page.locator('#inpPriority').selectOption('urgent');
  await page.evaluate(()=>openMenuPicker());
  await page.locator('[data-picker-action=plus][data-item="Вода"]').click();
  await page.locator('#menuPickerBtn').click();
  await expect(page.locator('#inpItems')).toHaveValue('1 Вода');
  await page.reload();await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('new'));
  await expect(page.locator('#inpTable')).toHaveValue('1');await expect(page.locator('#inpItems')).toHaveValue('1 Вода');
  await expect(page.locator('#inpNote')).toHaveValue('Без льда');await expect(page.locator('#inpPriority')).toHaveValue('urgent');
  expect(env.data().orders).toEqual({});expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('staff draft stays after rejected write and clears only after successful submission',async({page})=>{
  const env=await setup(page);await staff(page);
  await page.locator('#inpTable').fill('1');await page.locator('#inpItems').fill('2 Вода');
  await page.evaluate(()=>{window.__failOrder=true;});await page.locator('.btn-add').click();
  await expect(page.locator('.btn-add')).toBeEnabled();await expect(page.locator('#inpItems')).toHaveValue('2 Вода');
  expect(env.data().orders).toEqual({});expect(env.data().menu2[0].items[0].stock).toBe(10);
  expect(await page.evaluate(()=>sessionStorage.getItem('bar_staff_order_draft'))).toContain('2 Вода');
  await page.locator('.btn-add').click();await expect(page.locator('#inpItems')).toHaveValue('');
  expect(Object.keys(env.data().orders)).toHaveLength(1);expect(env.data().menu2[0].items[0].stock).toBe(8);
  expect(await page.evaluate(()=>sessionStorage.getItem('bar_staff_order_draft'))).toBeNull();
  await page.reload();await page.waitForFunction(()=>!!window.sw);await expect(page.locator('#inpItems')).toHaveValue('');
  expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('bad draft does not prevent staff app from opening',async({page})=>{
  const env=await setup(page);await page.addInitScript(()=>sessionStorage.setItem('bar_staff_order_draft','{invalid'));
  await staff(page);await expect(page.locator('#inpItems')).toHaveValue('');expect(env.errors).toEqual([]);
});

test('guest selects cups in cart and staff receives them with the tea order',async({page})=>{
  const env=await setup(page);await guest(page);
  await page.locator('[data-action=setCat][data-index="1"]').click();await page.locator('[data-action=addItem]').click();await page.locator('#cartBar').click();
  await expect(page.locator('.cups-summary')).toHaveText('Кружки — 1 шт.');
  await page.getByRole('button',{name:'Увеличить количество кружек'}).click();
  await expect(page.locator('.cups-summary')).toHaveText('Кружки — 2 шт.');
  await expect(page.locator('#cartGrand')).toHaveText('300 ₽');
  // WebKit may scroll an overflow:hidden ancestor toward an animated off-screen panel.
  await expect.poll(async()=>Math.round((await page.locator('#screen-cart').boundingBox()).x)).toBe(0);
  await page.screenshot({path:test.info().outputPath('tea-cups.png'),animations:'disabled'});
  await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);
  const orders=Object.values(env.data().orders);expect(orders).toHaveLength(1);
  expect(Object.values(orders[0].items)).toEqual(expect.arrayContaining([expect.objectContaining({name:'2 кружки',qty:1})]));
  expect(orders[0].total).toBe(300);expect(env.data().menu2[1].items[0].stock).toBe(9);
  expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('removing the last tea resets cups and a water order has no cups',async({page})=>{
  const env=await setup(page);await guest(page);
  await page.locator('[data-action=setCat][data-index="1"]').click();await page.locator('[data-action=addItem]').click();await page.locator('#cartBar').click();
  await page.getByRole('button',{name:'Увеличить количество кружек'}).click();
  await page.locator('[data-action=cQty][data-delta="-1"]').click();await expect(page.locator('.cups-picker')).toHaveCount(0);
  await page.locator('[data-action=closeCart]').click();await page.locator('[data-action=setCat][data-index="0"]').click();await page.locator('[data-action=addItem]').click();
  await page.locator('#cartBar').click();await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);
  expect(Object.values(Object.values(env.data().orders)[0].items)).toHaveLength(1);expect(env.errors).toEqual([]);
});

test('first order after an empty queue sounds even without notification permission, repeats do not',async({page})=>{
  const env=await setup(page);await staff(page);await page.locator('#inpTable').click();
  await expect.poll(()=>page.evaluate(()=>window.__beeps)).toBe(0);
  await page.evaluate(async()=>{
    const date=new Date().toLocaleDateString('en-CA');
    await window.__remoteSet('orders/new',{id:'new',table:'1',date,sid:'session',num:1,createdAt:Date.now(),items:{water:{id:'water',name:'Вода',qty:1,status:'new'}}});
  });
  await expect.poll(()=>page.evaluate(()=>window.__beeps)).toBe(1);
  await page.evaluate(()=>window.__remoteSet('orders/new/note','Изменён комментарий'));
  expect(await page.evaluate(()=>window.__beeps)).toBe(1);
  await page.evaluate(()=>enableNotifications()); // Mute sound.
  await page.evaluate(()=>window.__remoteSet('orders/second',{id:'second',table:'1',items:{water:{name:'Вода',qty:1,status:'new'}}}));
  expect(await page.evaluate(()=>window.__beeps)).toBe(1);expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('loading old malformed orders does not delete or rewrite the source records',async({page})=>{
  const bad={old:{id:'old',items:{broken:null}},missingTable:{id:'missingTable',table:'2',items:'1 Вода'}};
  const env=await setup(page,{orders:bad});await staff(page);
  await expect(page.locator('#fErr')).toContainText('Исходные записи сохранены');
  expect(env.data().orders).toEqual(bad);expect(Object.keys(env.data().tables)).toHaveLength(1);expect(env.errors).toEqual([]);
});

test('Spark publishing config cannot deploy functions or database rules',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'..','firebase.json'),'utf8'));
  expect(Object.keys(config)).toEqual(['hosting']);expect(config.hosting.public).toBe('dist-spark');
});
