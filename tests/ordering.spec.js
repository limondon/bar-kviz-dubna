const {test,expect}=require('@playwright/test');
const {dateAt}=require('../functions/guest-service');
const {setup,guest}=require('./browser-fixture.cjs');
test('rejected restored guest request reloads menu and preserves draft for corrected submission',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();
  await page.locator('[data-option="Добавка +50"]').click();await page.locator('#cartBar').click();await page.locator('#orderNote').fill('Без льда');
  env.fail();await page.locator('#placeBtn').click();await expect(page.locator('#placeBtn')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');
  env.root().menu2[0].items[0].price=400;await page.reload();await page.locator('#placeBtn').click();
  await expect(page.locator('#conflictBox')).toContainText('Цены изменились');await expect(page.locator('#cartGrand')).toHaveText('450 ₽');
  await expect(page.locator('#orderNote')).toHaveValue('Без льда');await expect(page.locator('#orderNote')).toBeEditable();
  await page.locator('[data-action=closeCart]').click();await expect(page.locator('#menuList')).toContainText('Corona');
  await page.locator('#cartBar').click();await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);
  expect(Object.keys(env.root().orders)).toHaveLength(1);expect(Object.values(env.root().orders)[0]).toMatchObject({total:450,note:'Без льда',sid:'s1'});expect(env.errors).toEqual([]);
});
test('restored guest stock rejection allows quantity correction and receives later menu updates',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();
  await page.locator('[data-action=cQty][data-delta="1"]').click();env.fail();await page.locator('#placeBtn').click();await expect(page.locator('#placeBtn')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');
  env.root().menu2[0].items[0].stock=1;await page.reload();await page.locator('#placeBtn').click();await expect(page.locator('#conflictBox')).toContainText('Недостаточно остатков');
  await expect(page.locator('#placeBtn')).toHaveText('ОТПРАВИТЬ ЗАКАЗ');await page.locator('[data-action=cQty][data-delta="-1"]').click();
  env.root().menu2[0].items[0].price=350;await publishFixture(page,env.root());await expect(page.locator('#cartGrand')).toHaveText('350 ₽');
  await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);
  expect(Object.keys(env.root().orders)).toHaveLength(1);expect(env.root().menu2[0].items[0].stock).toBe(0);expect(env.errors).toEqual([]);
});

test('pending guest request keeps its displayed total and note through realtime updates and reload',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();await page.locator('#orderNote').fill('Без льда');
  env.lose();await page.locator('#placeBtn').click();await expect(page.locator('#placeBtn')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');await expect(page.locator('#orderNote')).not.toBeEditable();
  env.root().menu2[0].items[0].price=500;await publishFixture(page,env.root());await expect(page.locator('#cartGrand')).toHaveText('300 ₽');
  await page.reload();await expect(page.locator('#cartGrand')).toHaveText('300 ₽');await expect(page.locator('#orderNote')).toHaveValue('Без льда');await expect(page.locator('#orderNote')).not.toBeEditable();
  await page.locator('#placeBtn').click();await expect(page.locator('#confirmInfo')).toContainText('300 ₽');expect(Object.keys(env.root().orders)).toHaveLength(1);expect(env.errors).toEqual([]);
});

test('uncommitted restored guest request on a closed table leaves the draft and shows closure',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();await page.locator('#orderNote').fill('Сохранить');
  env.fail();await page.locator('#placeBtn').click();await expect(page.locator('#placeBtn')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');Object.values(env.root().tables)[0].status='closed';
  await page.reload();await page.locator('#placeBtn').click();await expect(page.locator('#invalidTitle')).toHaveText('Стол закрыт');await expect(page.locator('#app')).toBeHidden();
  const draft=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('bar_guest:1:token')));expect(draft.pendingOrder).toBeNull();expect(draft.note).toBe('Сохранить');expect(Object.keys(env.root().orders)).toHaveLength(0);expect(env.errors).toEqual([]);
});

test('rapid guest cart round trip does not let the previous transition hide the active menu',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();
  await page.evaluate(()=>{document.querySelector('#cartBar').click();document.querySelector('[data-action=closeCart]').click();});
  await page.waitForTimeout(500); // The previous screen's delayed hide must have run.
  await expect(page.locator('#screen-menu')).toHaveClass('screen active');await expect(page.locator('#screen-menu')).toBeVisible();
  await page.locator('#cartBar').click();await expect(page.locator('#screen-cart')).toHaveClass(/active/);expect(env.errors).toEqual([]);
});

test('a damaged guest cart preserves valid rows and the note without breaking menu load',async({page})=>{
  const env=await setup(page);await page.addInitScript(()=>sessionStorage.setItem('bar_guest:1:token',JSON.stringify({cart:{'0:0':{name:'Corona',price:300,qty:1,addons:{},option:null},'1:0':null},note:'Сохранить',guestCups:-3})));
  await guest(page);await page.locator('#cartBar').click();await expect(page.locator('.cart-row')).toHaveCount(1);await expect(page.locator('#cartGrand')).toHaveText('300 ₽');await expect(page.locator('#orderNote')).toHaveValue('Сохранить');
  await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);expect(Object.keys(env.root().orders)).toHaveLength(1);expect(env.errors).toEqual([]);
});

test('a damaged uncertain guest submission is preserved and does not silently become a new order',async({page})=>{
  const env=await setup(page),raw=JSON.stringify({cart:{'0:0':null},pendingOrder:{requestId:'unknown',table:'1',token:'token',items:[{}],expectedTotal:300}});
  await page.addInitScript(raw=>sessionStorage.setItem('bar_guest:1:token',raw),raw);await guest(page);
  await expect(page.locator('#invalidTitle')).toHaveText('Не удалось восстановить заказ');await expect(page.locator('#app')).toBeHidden();
  expect(await page.evaluate(()=>sessionStorage.getItem('bar_guest:1:token'))).toBe(raw);expect(Object.keys(env.root().orders)).toHaveLength(0);expect(env.errors).toEqual([]);
});

test('guest order and waiter call are not sent if their retry identifiers cannot be saved',async({page})=>{
  const env=await setup(page);await guest(page);await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Storage unavailable');};});
  await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();await page.locator('#placeBtn').click();
  await expect(page.locator('#conflictBox')).toContainText('Браузер не сохраняет');await expect(page.locator('#placeBtn')).toHaveText('ОТПРАВИТЬ ЗАКАЗ');await expect(page.locator('#orderNote')).toBeEditable();
  await page.locator('[data-action=closeCart]').click();await page.locator('#waiterBtn').click();await expect(page.locator('#flash')).toContainText('Браузер не сохраняет');
  expect(Object.keys(env.root().orders)).toHaveLength(0);expect(Object.keys(env.root().waiterCalls||{})).toHaveLength(0);expect(env.root().menu2[0].items[0].stock).toBe(5);expect(env.errors).toEqual([]);
});

test('guest total and cart describe paid/free options; hidden categories excluded',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();
  await page.locator('[data-option="Добавка +50"]').click();await expect(page.locator('#cartTotal')).toHaveText('350 ₽');
  await page.locator('#cartBar').click();await expect(page.locator('#cartList')).toContainText('Добавка');await expect(page.locator('#cartGrand')).toHaveText('350 ₽');
  await page.setViewportSize({width:375,height:812});await page.screenshot({animations:'disabled',path:test.info().outputPath('cart-fixed.png')});
  await expect(page.locator('#catTabs')).not.toContainText('Скрыто');expect(env.errors).toEqual([]);
});
test('one product can be ordered with different options',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();
  await page.locator('[data-option="С лаймом"]').click();await page.locator('[data-action=anotherVariant]').click();await page.locator('[data-option="Добавка +50"]').click();
  await page.locator('#cartBar').click();await expect(page.locator('.cart-row')).toHaveCount(2);await expect(page.locator('#cartGrand')).toHaveText('650 ₽');
  await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);expect(env.root().menu2[0].items[0].stock).toBe(3);
});
test('tea cups are chosen in the cart and reset when the last tea is removed',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=setCat][data-index="1"]').click();await page.locator('[data-action=addItem]').click();await page.locator('#cartBar').click();
  await expect(page.locator('.cups-picker')).toContainText('Сколько кружек принести');await expect(page.locator('.cups-summary')).toHaveText('Кружки — 1 шт.');
  await page.locator('.cups-picker [data-action=adjustCups][data-delta="1"]').click();await expect(page.locator('.cups-summary')).toHaveText('Кружки — 2 шт.');
  await page.locator('[data-action=cQty][data-delta="-1"]').click();await expect(page.locator('.cups-picker')).toHaveCount(0);
  await page.locator('[data-action=closeCart]').click();await page.locator('[data-action=setCat][data-index="0"]').click();await page.locator('[data-action=addItem]').click();await page.locator('#cartBar').click();await page.locator('#placeBtn').click();
  await expect(page.locator('#screen-confirm')).toHaveClass(/active/);expect(Object.values(env.root().orders)[0].items.cups).toBeUndefined();expect(env.errors).toEqual([]);
});
test('selected tea cups are included in the order for staff',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=setCat][data-index="1"]').click();await page.locator('[data-action=addItem]').click();await page.locator('#cartBar').click();
  await page.locator('.cups-picker [data-action=adjustCups][data-delta="1"]').click();await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);
  expect(Object.values(env.root().orders)[0].items.cups).toMatchObject({name:'Кружки',qty:2,price:0,status:'new'});expect(env.errors).toEqual([]);
});
test('lost accepted response can be retried without duplicate order or stock loss',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();
  env.lose();await page.locator('#placeBtn').click();await expect(page.locator('#placeBtn')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');
  await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);
  expect(Object.keys(env.root().orders)).toHaveLength(1);expect(env.root().menu2[0].items[0].stock).toBe(4);expect(env.errors).toEqual([]);
});
test('failure before commit leaves stock intact and refresh restores pending operation',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();
  env.fail();await page.locator('#placeBtn').click();await expect(page.locator('#placeBtn')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');expect(env.root().menu2[0].items[0].stock).toBe(5);
  await page.reload();await expect(page.locator('#screen-cart')).toHaveClass(/active/);await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);expect(Object.keys(env.root().orders)).toHaveLength(1);
});
test('receipt is recoverable after reload even when the table was closed',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();
  env.lose();await page.locator('#placeBtn').click();await expect(page.locator('#placeBtn')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');
  Object.values(env.root().tables)[0].status='closed';
  await page.reload();await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);
  expect(Object.keys(env.root().orders)).toHaveLength(1);expect(env.root().menu2[0].items[0].stock).toBe(4);
});
test('landscape and small mobile cart allow scrolling to the entire send button',async({page})=>{
  await setup(page);await page.setViewportSize({width:667,height:375});await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();
  await page.locator('#placeBtn').scrollIntoViewIfNeeded();let box=await page.locator('#placeBtn').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(375);
  await page.screenshot({animations:'disabled',path:test.info().outputPath('landscape-fixed.png')});
  await page.setViewportSize({width:320,height:568});await page.locator('#placeBtn').scrollIntoViewIfNeeded();box=await page.locator('#placeBtn').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(568);
});
test('staff app loads with an empty open table and creates an order via service',async({page})=>{
  const env=await setup(page);await page.goto('https://bar.test/');await page.waitForFunction(()=>!!window.sw);await page.waitForTimeout(350);
  await page.evaluate(()=>sw('tables'));await expect(page.locator('#tablesBillList')).toContainText('Открыт');
  await page.evaluate(()=>sw('new'));await page.locator('#inpTable').fill('1');await page.locator('#inpItems').fill('2 Corona');await page.locator('.btn-add').click();
  await expect.poll(()=>Object.keys(env.root().orders).length).toBe(1);expect(Object.values(env.root().orders)[0].total).toBe(600);expect(env.errors).toEqual([]);
});

test('accepted guest confirmation survives reload and a new order starts a fresh session check',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();await page.locator('#placeBtn').click();
  await expect(page.locator('#screen-confirm')).toHaveClass(/active/);const receipt=await page.locator('#confirmInfo').textContent();
  await page.reload();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);await expect(page.locator('#confirmInfo')).toHaveText(receipt);
  await page.locator('[data-action=newOrder]').click();await expect(page.locator('[data-action=addItem]').first()).toBeVisible();
  expect(Object.keys(env.root().orders)).toHaveLength(1);expect(env.errors).toEqual([]);
});

async function editFirstProduct(page){
  await page.goto('https://bar.test/');await page.waitForFunction(()=>!!window.openItemEditor);
  await page.waitForFunction(()=>document.querySelector('.dot'));
  await page.evaluate(()=>openItemEditor(0,0));
}
async function publishFixture(page,root){await page.evaluate(r=>{window.fixture=r;window.dispatchEvent(new Event('fixture-change'));},root);}
test('saving an open product sheet preserves a stock deduction received meanwhile',async({page})=>{
  const env=await setup(page);await editFirstProduct(page);
  env.root().menu2[0].items[0].stock=4;await publishFixture(page,env.root());
  await page.locator('#ieGroupInp').fill('Импортное');await page.locator('.item-editor-save').click();
  await expect(page.locator('#itemEditorOverlay')).toHaveClass(/hidden/);
  expect(env.root().menu2[0].items[0].stock).toBe(4);expect(env.root().menu2[0].items[0].group).toBe('Импортное');expect(env.errors).toEqual([]);
});
test('stale explicit stock correction is rejected without mutating the live menu',async({page})=>{
  const env=await setup(page);await editFirstProduct(page);await page.locator('#ieStockInp').fill('10');
  env.root().menu2[0].items[0].stock=4;await publishFixture(page,env.root());
  await page.locator('.item-editor-save').click();await expect(page.locator('#ieError')).toContainText('Остаток изменился');
  expect(env.root().menu2[0].items[0].stock).toBe(4);await expect(page.locator('#ieStockInp')).toHaveValue('10');expect(env.errors).toEqual([]);
});
test('reordering the menu while a product sheet is open cannot edit a different product',async({page})=>{
  const env=await setup(page);await editFirstProduct(page);await page.locator('#iePriceInp').fill('900');
  [env.root().menu2[0],env.root().menu2[1]]=[env.root().menu2[1],env.root().menu2[0]];await publishFixture(page,env.root());
  await page.locator('.item-editor-save').click();await expect(page.locator('#ieError')).toContainText('Меню изменено');
  expect(env.root().menu2[0].items[0].price).toBe(400);expect(env.root().menu2[1].items[0].price).toBe(300);expect(env.errors).toEqual([]);
});

async function openMenuPage(page){await page.goto('https://bar.test/');await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('menu'));await expect(page.locator('.menu-editor-line-input.name').first()).toHaveValue('Corona');}
test('failed item deletion cannot leak into a later successful menu edit',async({page})=>{
  const env=await setup(page);await openMenuPage(page);env.fail();await page.evaluate(()=>removeMenuCatItem(0,0));
  await expect(page.locator('#menuSaveError')).toContainText('не подтверждено');await expect(page.locator('.menu-editor-line-input.name').first()).toHaveValue('Corona');
  await page.evaluate(()=>updateMenuCatItem(0,0,'group','Импортное'));
  expect(env.root().menu2[0].items[0].name).toBe('Corona');expect(env.root().menu2[0].items[0].group).toBe('Импортное');expect(env.errors).toEqual([]);
});
test('live stock events preserve a focused inline draft and reject its stale stock overwrite',async({page})=>{
  const env=await setup(page);await openMenuPage(page);const field=page.locator('.menu-editor-line-input.stock').first();await field.fill('10');
  env.root().menu2[0].items[0].stock=4;await publishFixture(page,env.root());await expect(field).toHaveValue('10');
  await field.press('Tab');await expect(page.locator('#menuSaveError')).toContainText('Остаток изменился');
  expect(env.root().menu2[0].items[0].stock).toBe(4);await expect(page.locator('.menu-editor-line-input.stock').first()).toHaveValue('4');expect(env.errors).toEqual([]);
});
test('failed category reorder leaves the confirmed order intact',async({page})=>{
  const env=await setup(page);await openMenuPage(page);env.fail();await page.evaluate(()=>moveMenuCat(0,1));
  await expect(page.locator('#menuSaveError')).toContainText('не подтверждено');expect(env.root().menu2[0].cat).toBe('Пиво');
  await page.evaluate(()=>toggleMenuCatHidden(0));expect(env.root().menu2[0].cat).toBe('Пиво');expect(env.root().menu2[0].hidden).toBe(true);expect(env.errors).toEqual([]);
});

test('deleting all categories leaves an empty catalog and permits creating a new one',async({page})=>{
  const env=await setup(page);await openMenuPage(page);
  for(let i=0;i<3;i++){
    await page.evaluate(()=>{void removeMenuCategory(0);});await page.locator('#confirmOkBtn').click();
    await expect.poll(()=>env.root().menu2.length).toBe(2-i);
    await expect(page.locator('.menu-editor-category')).toHaveCount(2-i);
    await expect(page.locator('#menuEditorList')).not.toHaveAttribute('aria-busy','true');
  }
  await expect(page.locator('#menuEditorList')).toContainText('Меню пусто');
  await page.reload();await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('menu'));await expect(page.locator('#menuEditorList')).toContainText('Меню пусто');
  await page.locator('#newCatName').fill('Новое меню');await page.evaluate(()=>addMenuCategory());
  expect(env.root().menu2).toEqual([{cat:'Новое меню',items:[]}]);expect(env.errors).toEqual([]);
});

async function newStaffOrder(page){await page.goto('https://bar.test/');await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('new'));}
test('staff response loss locks the submitted draft through reload and retries exactly once',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);await page.locator('#inpTable').fill('1');await page.locator('#inpItems').fill('2 Corona');await page.locator('#inpNote').fill('Без льда');
  env.lose();await page.locator('.btn-add').click();await expect(page.locator('.btn-add')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');await expect(page.locator('#inpItems')).toBeDisabled();
  await page.evaluate(()=>pickTable('9'));await expect(page.locator('#inpTable')).toHaveValue('1');
  await page.reload();await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('new'));await expect(page.locator('#inpItems')).toBeDisabled();await expect(page.locator('#inpNote')).toHaveValue('Без льда');
  await page.locator('.btn-add').click();await expect(page.locator('#inpItems')).toBeEnabled();await expect(page.locator('#inpItems')).toHaveValue('');
  expect(Object.keys(env.root().orders)).toHaveLength(1);expect(env.root().menu2[0].items[0].stock).toBe(3);expect(env.root().publicCounters.orderNum).toBe(1);expect(env.errors).toEqual([]);
});
test('delayed staff request cannot move into a replacement session after reload',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);await page.locator('#inpTable').fill('1');await page.locator('#inpItems').fill('1 Corona');await page.locator('#inpNote').fill('Первым гостям');
  env.fail();await page.locator('.btn-add').click();await expect(page.locator('.btn-add')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');
  Object.values(env.root().tables)[0].sid='replacement';await page.reload();await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('new'));
  await page.locator('.btn-add').click();await expect(page.locator('#fErr')).toContainText('Сессия стола изменилась');await expect(page.locator('#inpItems')).toBeEnabled();
  expect(Object.keys(env.root().orders)).toHaveLength(0);expect(env.root().menu2[0].items[0].stock).toBe(5);await expect(page.locator('#inpNote')).toHaveValue('Первым гостям');
  await page.locator('#inpNote').fill('Новым гостям');await page.locator('.btn-add').click();await expect.poll(()=>Object.keys(env.root().orders).length).toBe(1);
  expect(Object.values(env.root().orders)[0]).toMatchObject({sid:'replacement',note:'Новым гостям'});expect(env.errors).toEqual([]);
});

test('accepted staff request still recovers its original receipt after guests change',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);await page.locator('#inpTable').fill('1');await page.locator('#inpItems').fill('1 Corona');
  env.lose();await page.locator('.btn-add').click();await expect(page.locator('.btn-add')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');
  Object.values(env.root().tables)[0].sid='replacement';await page.reload();await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('new'));await page.locator('.btn-add').click();
  await expect(page.locator('#inpItems')).toHaveValue('');expect(Object.keys(env.root().orders)).toHaveLength(1);expect(Object.values(env.root().orders)[0].sid).toBe('s1');expect(env.root().menu2[0].items[0].stock).toBe(4);expect(env.errors).toEqual([]);
});

test('the reopen button on an archived bill cannot reopen a different closed session',async({page})=>{
  const env=await setup(page),date=dateAt(Date.now());
  Object.assign(Object.values(env.root().tables)[0],{status:'closed',closedAt:Date.now(),closedSessions:[{sid:'previous',closedAt:Date.now()-1000}]});
  env.root().orders.old={id:'old',num:1,date,table:'1',sid:'previous',createdAt:Date.now()-2000,status:'done',items:{i:{id:'i',name:'Corona',qty:1,price:300,status:'done'}}};
  await newStaffOrder(page);await page.evaluate(()=>sw('done'));await page.locator('#cl-1_previous .tb-header').click();
  await page.locator('#cl-1_previous [data-action=reopenTable]').click();await expect(page.locator('#fErr')).toContainText('Сессия стола изменилась');
  expect(Object.values(env.root().tables)[0]).toMatchObject({sid:'s1',status:'closed',token:'token'});expect(env.errors).toEqual([]);
});
test('manager can stop and resume operations with a persistent maintenance banner',async({page})=>{
  const env=await setup(page);await page.goto('https://bar.test/');
  await page.locator('#sidebar').getByText(/Режим обслуживания/).click();
  await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#maintenanceBanner')).toBeVisible();
  await expect(page.locator('#maintenanceText')).toHaveText('Обновление системы');
  expect(env.root().maintenance?.enabled).toBe(true);
  await page.locator('#maintenanceResume').click();await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#maintenanceBanner')).toBeHidden();expect(env.root().maintenance).toBeUndefined();
});

test('closed screen loads a compacted bill automatically and keeps corrections behind reopen',async({page})=>{
  const env=await setup(page),date=dateAt(Date.now()),meta=Object.values(env.root().tables)[0];
  Object.assign(meta,{status:'closed',closedAt:Date.now()});env.root().orders={};env.root().archiveTestTables={[date+'_1']:structuredClone(meta)};
  env.root().archiveTestRows=[{key:'archived',order:{id:'archived',num:7,date,table:'1',sid:'s1',createdAt:Date.now()-1000,status:'done',total:300,items:{i:{id:'i',name:'Corona',qty:1,price:300,status:'done'}}}}];
  await newStaffOrder(page);await page.evaluate(()=>sw('done'));await expect(page.locator('#cl-1_s1')).toContainText('Corona');
  await expect(page.locator('#cl-1_s1 [data-action=reopenTable]')).toHaveCount(1);await expect(page.locator('#cl-1_s1 [data-action=edit]')).toHaveCount(0);await expect(page.locator('#cl-1_s1')).toContainText('сначала переоткройте');expect(env.errors).toEqual([]);
});

test('reopening can recover a lost response without rotating the new QR again',async({page})=>{
  const env=await setup(page),date=dateAt(Date.now());Object.values(env.root().tables)[0].status='closed';await newStaffOrder(page);
  env.lose();await page.evaluate(date=>reopenTable(date,'1','s1'),date);const token=Object.values(env.root().tables)[0].token;
  await page.evaluate(date=>reopenTable(date,'1','s1'),date);await expect(page.locator('#fOk')).toContainText('Стол переоткрыт');
  expect(Object.values(env.root().tables)[0]).toMatchObject({status:'open',token});expect(Object.keys(env.root().staffOperations)).toHaveLength(1);expect(env.errors).toEqual([]);
});

test('staff validation rejection unlocks fields for correcting the order',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);await page.locator('#inpTable').fill('1');await page.locator('#inpItems').fill('99 Corona');await page.locator('.btn-add').click();
  await expect(page.locator('.btn-add')).toHaveText('ДОБАВИТЬ ЗАКАЗ');await expect(page.locator('#inpItems')).toBeEnabled();await expect(page.locator('#inpItems')).toHaveValue('99 Corona');
  await page.locator('#inpItems').fill('1 Corona');await page.locator('.btn-add').click();await expect.poll(()=>Object.keys(env.root().orders).length).toBe(1);expect(env.errors).toEqual([]);
});
test('one unreadable legacy order does not stop the queue and is reported without deleting data',async({page})=>{
  const env=await setup(page),date=dateAt(Date.now());
  env.root().orders={good:{num:7,table:'1',date,sid:'s1',createdAt:Date.now(),items:'120 Corona'},bad:{num:8,table:'1',date,items:'0 Corona'},invalid:'broken'};
  await newStaffOrder(page);await page.evaluate(()=>sw('queue'));
  await expect(page.locator('#qList')).toContainText('Corona');await expect(page.locator('#qList')).toContainText('120');
  await expect(page.locator('#orderDataWarning')).toContainText('2 записей');expect(Object.keys(env.root().orders)).toHaveLength(3);expect(env.errors).toEqual([]);
});
test('malformed saved staff draft does not prevent the app from loading',async({page})=>{
  const env=await setup(page);await page.addInitScript(()=>sessionStorage.setItem('bar_pending_staff_order','{"requestId":"x","items":null}'));
  await newStaffOrder(page);await expect(page.locator('#inpItems')).toBeEnabled();await expect(page.locator('.btn-add')).toHaveText('ДОБАВИТЬ ЗАКАЗ');expect(env.errors).toEqual([]);
});

test('table note editor preserves its draft when another employee changes the note',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);await page.evaluate(date=>editTableNote(date,'1'),dateAt(Date.now()));
  await page.locator('#_tnInp').fill('Моя заметка');Object.values(env.root().tables)[0].note='Уже обновлено';await publishFixture(page,env.root());
  await page.locator('#_tnOk').click();await expect(page.locator('#_tnError')).toContainText('уже изменены');await expect(page.locator('#_tnInp')).toHaveValue('Моя заметка');
  expect(Object.values(env.root().tables)[0].note).toBe('Уже обновлено');expect(env.errors).toEqual([]);
});
test('table note retries the same operation after an accepted response was lost',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);await page.evaluate(date=>editTableNote(date,'1'),dateAt(Date.now()));await page.locator('#_tnInp').fill('Без льда');
  env.lose();await page.locator('#_tnOk').click();await expect(page.locator('#_tnError')).not.toBeEmpty();await page.locator('#_tnOk').click();await expect(page.locator('#_tnInp')).toHaveCount(0);
  expect(Object.values(env.root().tables)[0].note).toBe('Без льда');expect(Object.keys(env.root().staffOperations)).toHaveLength(1);expect(env.errors).toEqual([]);
});
test('an open corkage dialog cannot charge guests in a replacement session',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);await page.evaluate(()=>openCorkagePicker('1'));await page.locator('[data-corkage-index="0"][data-corkage-delta="1"]').click();
  Object.values(env.root().tables)[0].sid='replacement';await publishFixture(page,env.root());await page.evaluate(()=>confirmCorkage());
  expect(Object.keys(env.root().orders)).toHaveLength(0);await expect(page.locator('#corkageOverlay')).not.toHaveClass(/hidden/);expect(env.errors).toEqual([]);
});
test('recording a table in the external system waits for server confirmation',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);env.fail();await page.evaluate(date=>logTable(date,'1'),dateAt(Date.now()));
  expect(Object.values(env.root().tables)[0].loggedAt).toBeUndefined();
  expect(await page.evaluate(async()=>Object.values((await import('/js/state.js')).S.tablesMeta)[0].loggedAt)).toBeUndefined();
  await page.evaluate(date=>logTable(date,'1'),dateAt(Date.now()));expect(Object.values(env.root().tables)[0].loggedAt).toBeGreaterThan(0);expect(env.errors).toEqual([]);
});

test('corkage can open a previously unused table without a phantom local session',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);await page.evaluate(()=>openCorkagePicker('29'));await page.locator('[data-corkage-index="0"][data-corkage-delta="1"]').click();
  await page.evaluate(()=>confirmCorkage());await expect(page.locator('#corkageOverlay')).toHaveClass(/hidden/);
  expect(Object.values(env.root().orders)[0].table).toBe('29');expect(Object.values(env.root().orders)[0].total).toBe(100);expect(env.errors).toEqual([]);
});

test('renaming a reserved product in the UI still returns stock to that product on cancellation',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);await page.locator('#inpTable').fill('1');await page.locator('#inpItems').fill('1 Corona');await page.locator('.btn-add').click();await expect.poll(()=>Object.keys(env.root().orders).length).toBe(1);
  await page.evaluate(()=>sw('menu'));await page.evaluate(()=>updateMenuCatItem(0,0,'name','Corona renamed'));
  expect(env.root().menu2[0].items[0].stock).toBe(4);
  await page.evaluate(id=>{void delOrder(id);},Object.keys(env.root().orders)[0]);await page.locator('#confirmOkBtn').click();await expect.poll(()=>Object.keys(env.root().orders).length).toBe(0);
  expect(env.root().menu2[0].items[0].stock).toBe(5);expect(env.root().menu2[0].items[0].name).toBe('Corona renamed');expect(env.errors).toEqual([]);
});
test('guest cart rejects a replacement product even if its name and price are identical',async({page})=>{
  const env=await setup(page);env.root().menu2[0].items[0].productId='original';await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();
  env.root().menu2[0].items[0].productId='replacement';await publishFixture(page,env.root());await page.locator('#placeBtn').click();await expect(page.locator('#conflictBox')).toContainText('Меню изменилось');
  expect(Object.keys(env.root().orders)).toHaveLength(0);expect(env.root().menu2[0].items[0].stock).toBe(5);expect(env.errors).toEqual([]);
});

test('clearing call history preserves calls arriving during the confirmation dialog',async({page})=>{
  const env=await setup(page),date=dateAt(Date.now());env.root().waiterCalls={old:{date,table:'1',sid:'s1',status:'done',calledAt:Date.now()},pending:{date,table:'1',sid:'s1',status:'pending',calledAt:Date.now()}};
  await newStaffOrder(page);await page.evaluate(()=>sw('calls'));await page.evaluate(()=>{window.clearAttempt=clearCalls();});
  env.root().waiterCalls.arrived={date,table:'1',sid:'s1',status:'pending',calledAt:Date.now()};await publishFixture(page,env.root());
  await page.locator('#confirmOkBtn').click();await page.evaluate(()=>window.clearAttempt);
  expect(Object.keys(env.root().waiterCalls).sort()).toEqual(['arrived','pending']);expect(env.errors).toEqual([]);
});
test('acknowledging a call can recover a lost response without another operation',async({page})=>{
  const env=await setup(page),date=dateAt(Date.now());env.root().waiterCalls={call1:{date,table:'1',sid:'s1',status:'pending',calledAt:Date.now()}};
  await newStaffOrder(page);env.lose();await page.evaluate(()=>checkInCall('call1'));await page.evaluate(()=>checkInCall('call1'));
  expect(env.root().waiterCalls.call1.status).toBe('done');expect(Object.keys(env.root().staffOperations)).toHaveLength(1);expect(env.errors).toEqual([]);
});
test('quiz preparation recovers the same QR set after response loss and preserves live metadata',async({page})=>{
  const env=await setup(page);await newStaffOrder(page);
  await page.evaluate(()=>{window.open=()=>({document:{write:html=>window.printedQuiz=html,close(){}},addEventListener(){},close(){}});});
  Object.values(env.root().tables)[0].note='Свежая заметка';env.lose();
  await page.evaluate(()=>{window.quizAttempt=prepareQuiz();});await page.locator('#confirmOkBtn').click();await page.evaluate(()=>window.quizAttempt);
  const id=env.root().config.quizSession.id,tokens=structuredClone(env.root().quiz_tokens);expect(Object.keys(tokens)).toHaveLength(19);
  await page.evaluate(()=>{window.quizAttempt=prepareQuiz();});await page.locator('#confirmOkBtn').click();await page.evaluate(()=>window.quizAttempt);
  expect(env.root().config.quizSession.id).toBe(id);expect(env.root().quiz_tokens).toEqual(tokens);expect(Object.values(env.root().tables)[0].note).toBe('Свежая заметка');
  expect(await page.evaluate(()=>window.printedQuiz)).toContain(Object.keys(tokens)[0]);expect(env.errors).toEqual([]);
});
test('an old finish confirmation cannot revoke a replacement quiz',async({page})=>{
  const env=await setup(page);env.root().config.quizSession={id:'first',active:true};env.root().quiz_tokens={current:{table:'1'}};
  await newStaffOrder(page);await page.evaluate(()=>{window.finishAttempt=finishQuiz();});env.root().config.quizSession.id='second';await publishFixture(page,env.root());
  await page.locator('#confirmOkBtn').click();await page.evaluate(()=>window.finishAttempt);
  expect(env.root().quiz_tokens.current).toBeDefined();expect(env.root().config.quizSession.active).toBe(true);expect(env.errors).toEqual([]);
});

test('a guest call retry after reload does not ring again after the original call was handled',async({page})=>{
  const env=await setup(page);await guest(page);await expect(page.locator('#waiterBtn')).toBeVisible();env.lose();await page.locator('#waiterBtn').click();await expect(page.locator('#waiterBtn')).toHaveText('Проверить вызов');
  Object.values(env.root().waiterCalls)[0].status='done';await page.reload();await expect(page.locator('#waiterBtn')).toHaveText('Проверить вызов');await page.locator('#waiterBtn').click();
  await expect(page.locator('#waiterBtn')).toHaveText('🔔 Позвать официанта');expect(Object.keys(env.root().waiterCalls)).toHaveLength(1);expect(Object.values(env.root().waiterCalls)[0].status).toBe('done');expect(env.errors).toEqual([]);
});
