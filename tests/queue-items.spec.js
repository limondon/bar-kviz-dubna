const {test,expect}=require('@playwright/test');
const {setup,staff,guest}=require('./spark-fixture.cjs');
const date=()=>new Date().toLocaleDateString('en-CA');
const line=(name,qty=1,status='new',extra={})=>({name,qty,status,...extra});
function order(table,minutes,items,extra={}){
 return {table:String(table),num:table,createdAt:Date.now()-minutes*60000,date:date(),sid:'session',priority:'normal',status:'new',items:Object.fromEntries(items.map((it,i)=>['row'+i,{id:'line'+i,...it}])),...extra};
}
async function queue(page,orders,role='barman',options={}){
 const env=await setup(page,{orders,...options});await staff(page);
 await page.evaluate(async role=>{const {S}=await import('/js/state.js');const {applyRole}=await import('/js/ui.js');S.role=role;applyRole();renderAll();sw('queue');},role);
 return env;
}
const itemsView=page=>page.getByRole('button',{name:'По позициям',exact:true}).click();
const ordersView=page=>page.getByRole('button',{name:'По заказам',exact:true}).click();
const group=(page,name)=>page.locator('.queue-item-card').filter({has:page.locator('h3',{hasText:name})});
const row=(page,id,item='row0')=>page.locator(`.queue-position[data-order-id="${id}"][data-item-id="${item}"]`);

test('FIFO groups preserve item order and quantities do not jump the queue',async({page})=>{
 const env=await queue(page,{
  o1:order(1,11,[line('Облепиховый чай'),line('Сидр')]),
  o2:order(2,8,[line('Козёл'),line('Лимонад клубничный',2),line('Лимонад манго')]),
  o3:order(3,4,[line('Облепиховый чай'),line('Сидр'),line('Лимонад манго')]),
  o4:order(4,1,[line('Поздний лимонад',8)],{priority:'urgent'})
 });
 const before=env.data().orders;
 await expect(page.locator('#queueItemsHint')).toBeHidden();
 const oldCards=await page.locator('#qList').innerHTML();
 await itemsView(page);
 await expect(page.locator('.queue-group-header h3')).toHaveText(['Облепиховый чай','Сидр','Козёл','Лимонад клубничный','Лимонад манго','Поздний лимонад']);
 await expect(group(page,'Облепиховый чай').locator('.queue-group-total')).toHaveText('2 шт.');
 await expect(group(page,'Лимонад клубничный').locator('.item-qty')).toHaveText('2');
 await expect(row(page,'o1').locator('.wait-chip')).toContainText('11 мин');
 await ordersView(page);expect(await page.locator('#qList').innerHTML()).toBe(oldCards);
 expect(env.data().orders).toEqual(before);expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('independent lines, late arrivals and both views share existing statuses',async({page},testInfo)=>{
 const env=await queue(page,{o1:order(1,11,[line('Облепиховый чай')]),o3:order(3,7,[line('Облепиховый чай')]),o7:order(7,4,[line('Облепиховый чай')])});
 await itemsView(page);
 for(const id of ['o1','o3','o7'])await row(page,id).locator('[data-st=making]').click();
 await page.evaluate(o=>window.__remoteSet('orders/o8',o),order(8,0,[line('Облепиховый чай')]));
 await expect(page.locator('.queue-group-summary')).toContainText('3 в работе • 1 новый');
 await expect(row(page,'o8').locator('.queue-row-status')).toHaveText('● Новый');
 expect(env.data().orders.o8.items.row0.status).toBe('new');
 await page.screenshot({path:testInfo.outputPath('queue-new-arrival.png'),fullPage:true});
 for(const id of ['o1','o3','o7'])await row(page,id).locator('[data-st=ready]').click();
 await expect(page.locator('.queue-group-remaining')).toHaveText('Приготовить: 1');
 await expect(page.locator('.queue-position-ready')).toHaveCount(3);
 await ordersView(page);
 await expect(page.locator('#qList [data-oid=o1][data-st=making]')).toHaveCount(1);
 await page.locator('#qList [data-oid=o8][data-st=making]').click();
 await itemsView(page);await expect(row(page,'o8').locator('.queue-row-status')).toHaveText('◐ В работе');
 expect(env.data().orders.o1.items.row0.status).toBe('ready');
 expect(env.data().orders.o3.items.row0.status).toBe('ready');
 expect(env.data().orders.o7.items.row0.status).toBe('ready');
 expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('quantity two stays one independent row; live quantities and filters recalculate',async({page})=>{
 const env=await queue(page,{o4:order(4,6,[line('Чай',2)]),o7:order(7,2,[line('Чай')])});
 await itemsView(page);await expect(page.locator('.queue-group-total')).toHaveText('3 шт.');
 await row(page,'o4').locator('[data-st=making]').click();
 expect(env.data().orders.o4.items.row0.status).toBe('making');expect(env.data().orders.o7.items.row0.status).toBe('new');
 await page.locator('#qFilters').getByRole('button',{name:'🆕 Новые',exact:true}).click();
 await expect(page.locator('.queue-position')).toHaveCount(1);await expect(page.locator('.queue-group-total')).toHaveText('1 шт.');
 await page.locator('#qFilters').getByRole('button',{name:'Все',exact:true}).click();
 await page.evaluate(()=>window.__remoteSet('orders/o7/items/row0/qty',3));
 await expect(page.locator('.queue-group-total')).toHaveText('5 шт.');
 await page.locator('#qFilters').getByRole('button',{name:'Стол 4',exact:true}).click();
 await expect(page.locator('.queue-position')).toHaveCount(1);await expect(page.locator('.queue-group-total')).toHaveText('2 шт.');
 expect(env.errors).toEqual([]);
});

test('cancellation, payment, delivered rows and deletion recalculate live',async({page})=>{
 const env=await queue(page,{o1:order(1,9,[line('Чай')]),o2:order(2,7,[line('Чай')]),o3:order(3,4,[line('Чай','1','ready'),line('Сидр',1,'done')])},'admin');
 await itemsView(page);
 await expect(page.locator('.queue-item-card')).toHaveCount(1);
 await page.evaluate(d=>window.__remoteSet('tables/'+d+'_1',{sid:'session',status:'closed',closedSessions:[{sid:'session'}]}),date());
 await expect(row(page,'o1')).toHaveCount(1);
 // Existing cancellation action is order deletion with confirmation.
 await page.evaluate(()=>{window.__cancel=delOrder('o2');});await page.locator('#confirmOkBtn').click();await page.evaluate(()=>window.__cancel);
 await expect(row(page,'o2')).toHaveCount(0);
 await row(page,'o3').locator('[data-action=deliver]').click();
 await expect(page.locator('.queue-item-card')).toHaveCount(1);
 expect(env.data().orders.o3.items.row0.status).toBe('done');
 await page.evaluate(o=>window.__remoteSet('orders/o4',o),order(4,2,[line('Вода')]));
 await expect(page.locator('.queue-item-card')).toHaveCount(2);
 await page.evaluate(()=>window.__remoteSet('orders/o4',null));await expect(page.locator('.queue-item-card')).toHaveCount(1);
 await row(page,'o1').locator('[data-st=ready]').click();await row(page,'o1').locator('[data-action=deliver]').click();
 await expect(page.locator('.queue-item-card')).toHaveCount(0);
 expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('paying the table keeps unfinished drinks in both queue views until delivery',async({page})=>{
 const env=await queue(page,{cocktail:order(1,6,[line('Джин тоник',1,'making')])},'admin');
 await itemsView(page);await expect(row(page,'cocktail')).toHaveCount(1);
 await page.evaluate(d=>window.__remoteSet('tables/'+d+'_1',{sid:'session',status:'closed',closedSessions:[{sid:'session'}]}),date());
 await expect(row(page,'cocktail')).toHaveCount(1);
 await ordersView(page);await expect(page.locator('.order-card')).toHaveCount(1);
 await itemsView(page);await row(page,'cocktail').locator('[data-st=ready]').click();
 await row(page,'cocktail').locator('[data-action=deliver]').click();
 await expect(row(page,'cocktail')).toHaveCount(0);
 expect(env.data().orders.cocktail.items.row0.status).toBe('done');expect(env.errors).toEqual([]);
});

test('item-view counters and table filters keep paid unfinished orders aligned with order view',async({page})=>{
 const env=await queue(page,{o1:order(1,9,[line('Чай')]),o2:order(2,4,[line('Сидр')])});
 await page.evaluate(d=>window.__remoteSet('tables/'+d+'_1',{sid:'session',status:'closed',closedSessions:[{sid:'session'}]}),date());
 // Existing view remains unchanged, as requested.
 await expect(page.locator('#sN')).toHaveText('2');await expect(page.locator('.order-card')).toHaveCount(2);
 await itemsView(page);
 await expect(page.locator('#sN')).toHaveText('2');await expect(page.locator('#sNew')).toHaveText('2');await expect(page.locator('#bQ')).toHaveText('2');
 await expect(page.locator('.queue-item-card')).toHaveCount(2);await expect(row(page,'o1')).toHaveCount(1);
 await expect(page.locator('#qFilters')).toContainText('Стол 1');await expect(page.locator('#qFilters')).toContainText('Стол 2');
 await ordersView(page);await expect(page.locator('#sN')).toHaveText('2');await expect(page.locator('#bQ')).toHaveText('2');await expect(page.locator('.order-card')).toHaveCount(2);
 expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('different product IDs and ambiguous legacy names stay separate; addons share a base',async({page})=>{
 const env=await queue(page,{
  o1:order(1,8,[line('Чай',1,'new',{productId:'a'}),line('Чай',1,'new',{productId:'b'})]),
  o2:order(2,6,[line('Чай + лимон',1,'new',{productId:'a'}),line('Чай + мята'),line('Чай + лимон')]),
  o3:order(3,4,[line('Одинаковое имя',1,'new',{price:100})]),
  o4:order(4,2,[line('Одинаковое имя',1,'new',{price:100})])
 },'barman',{menu2:[{cat:'А',items:[{name:'Одинаковое имя',price:100}]},{cat:'Б',items:[{name:'Одинаковое имя',price:100}]}]});
 await itemsView(page);
 await expect(page.locator('.queue-item-card')).toHaveCount(5);
 await expect(page.locator('.queue-group-total').first()).toHaveText('2 шт.');
 await expect(page.locator('.queue-group-total').nth(1)).toHaveText('1 шт.');
 expect(env.errors).toEqual([]);
});

test('green tea modifiers share one base without losing rows, quantities or independent progress',async({page},testInfo)=>{
 const env=await queue(page,{
  a:order(1,12,[line('Зелёный чай')]),
  b:order(2,10,[line('Зелёный чай + лимон',2,'new',{price:350})]),
  c:order(3,8,[line('Зелёный чай + мята')]),
  d:order(3,6,[line('Зелёный чай + лимон + мята')]),
  e:order(4,4,[line('Капучино')])
 });
 await itemsView(page);
 await expect(page.locator('.queue-group-header h3')).toHaveText(['Зелёный чай','Капучино']);
 await expect(group(page,'Зелёный чай').locator('.queue-group-total')).toHaveText('5 шт.');
 await expect(row(page,'b').locator('.queue-row-variant')).toHaveText('Зелёный чай + лимон');
 await expect(row(page,'d').locator('.queue-row-variant')).toHaveText('Зелёный чай + лимон + мята');
 await row(page,'b').locator('[data-st=making]').click();
 await expect(row(page,'b').locator('.queue-row-status')).toContainText('В работе');
 expect(env.data().orders.b.items.row0).toMatchObject({name:'Зелёный чай + лимон',qty:2,price:350,status:'making'});
 for(const id of ['a','c','d'])expect(env.data().orders[id].items.row0.status).toBe('new');
 await ordersView(page);await expect(page.locator('#qList [data-oid=b][data-st=ready]')).toHaveCount(1);
 await itemsView(page);
 await page.screenshot({path:testInfo.outputPath('base-tea-modifiers.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(env.errors).toEqual([]);
});

test('rejected status and delivery writes do not change either view or produce delivery logs',async({page})=>{
 const env=await queue(page,{a:order(1,5,[line('Сенча')])},'admin');
 await itemsView(page);await page.evaluate(()=>{window.__failStatus=true;});
 await row(page,'a').locator('[data-st=ready]').click();
 await expect(page.locator('#fErr')).toContainText('Не удалось обновить статус');
 await ordersView(page);await itemsView(page);
 await expect(row(page,'a').locator('.queue-row-status')).toContainText('Новый');
 expect(env.data().orders.a.items.row0.status).toBe('new');
 await row(page,'a').locator('[data-st=ready]').click();
 await expect(row(page,'a').locator('.queue-row-status')).toContainText('Готов');
 await page.evaluate(async()=>{window.__failStatus=true;await waiterDeliverItem('a','row0');});
 expect(env.data().orders.a.items.row0.status).toBe('ready');
 expect(env.data().config.deliveryLog).toBeUndefined();
 await page.evaluate(async()=>{window.__failStatus=true;await waiterDeliverAll('a');});
 expect(env.data().orders.a.items.row0.status).toBe('ready');
 expect(env.data().config.deliveryLog).toBeUndefined();
 await row(page,'a').locator('[data-action=deliver]').click();
 await expect(row(page,'a')).toHaveCount(0);
 expect(env.data().orders.a.status).toBe('done');
 await expect.poll(()=>Object.keys(env.data().config.deliveryLog||{}).length).toBe(1);
 expect(env.errors).toEqual([]);
});

test('transaction retry keeps another row update and refuses deleted or changed target rows',async({page})=>{
 const env=await queue(page,{a:order(1,5,[line('Сенча'),line('Сенча + лимон')])});
 await itemsView(page);
 await page.evaluate(()=>{window.__orderRace={path:'orders/a/items/row1/status',value:'making'};});
 await row(page,'a').locator('[data-st=ready]').click();
 await expect(row(page,'a','row1').locator('.queue-row-status')).toContainText('В работе');
 expect(env.data().orders.a.items.row0.status).toBe('ready');
 await page.evaluate(()=>{window.__orderRace={path:'orders/a/items/row1/status',value:'done'};});
 await row(page,'a','row1').locator('[data-st=ready]').click();
 await expect(row(page,'a','row1')).toHaveCount(0);
 expect(env.data().orders.a.items.row1.status).toBe('done');
 await page.evaluate(()=>{window.__orderRace={path:'orders/a',value:null};});
 await row(page,'a').locator('[data-st=making]').click();
 await expect(row(page,'a')).toHaveCount(0);expect(env.data().orders.a).toBeUndefined();
 expect(env.errors).toEqual([]);
});

test('two different lines of one order can be actioned while the first write is pending',async({page})=>{
 const env=await queue(page,{a:order(1,5,[line('Сенча'),line('Сенча + лимон')])});
 await page.evaluate(async()=>{window.__delayStatus=100;await Promise.all([barItemAction('a','row0','ready'),barItemAction('a','row1','making')]);});
 expect(env.data().orders.a.items.row0.status).toBe('ready');
 expect(env.data().orders.a.items.row1.status).toBe('making');
 expect(env.errors).toEqual([]);
});

test('guest addon order and newly created staff plain tea meet in the same queue group',async({page})=>{
 const env=await setup(page);await guest(page);
 await page.locator('[data-action=setCat][data-index="1"]').click();await page.locator('[data-action=addItem]').click();
 await page.locator('[data-action=toggleAddon][data-addon="Лимон"]').click();
 await page.locator('[data-action=toggleAddon][data-addon="Мята"]').click();
 await page.locator('#cartBar').click();await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);
 const guestOrder=Object.values(env.data().orders)[0];
 const guestLine=Object.values(guestOrder.items).find(it=>it.name.startsWith('Сенча'));
 expect(guestLine).toMatchObject({name:'Сенча + лимон, мята',price:400,qty:1,status:'new'});
 await staff(page);await page.locator('#inpTable').fill('2');await page.locator('#inpItems').fill('2 Сенча');
 await page.locator('.btn-add').click();await expect(page.locator('#inpItems')).toHaveValue('');
 await page.evaluate(()=>sw('queue'));await itemsView(page);
 await expect(group(page,'Сенча')).toHaveCount(1);await expect(group(page,'Сенча').locator('.queue-group-total')).toHaveText('3 шт.');
 await expect(group(page,'Сенча').locator('.queue-row-variant')).toHaveText('Сенча + лимон, мята');
 expect(Object.keys(env.data().orders)).toHaveLength(2);expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('legacy sparse arrays use database indices and text orders convert only on explicit action',async({page})=>{
 const array=[null,{id:'not-an-index',name:'Сенча + лимон',qty:2,status:'new',price:350}];
 const env=await queue(page,{
  a:order(1,5,[],{items:array}),b:order(2,3,[],{items:'1 Сенча\n2 Сенча + мята'}),old:order(3,10,[],{items:'1 Сенча',status:'done'})
 });
 await itemsView(page);expect(env.data().orders.a.items).toEqual(array);
 await expect(row(page,'old','legacy_0')).toHaveCount(0);
 expect(env.data().orders.b.items).toBe('1 Сенча\n2 Сенча + мята');
 await row(page,'a','1').locator('[data-st=making]').click();
 expect(env.data().orders.a.items['1']).toMatchObject({id:'not-an-index',status:'making',qty:2,price:350});
 expect(env.data().orders.a.items['not-an-index']).toBeUndefined();
 await row(page,'b','legacy_1').locator('[data-st=ready]').click();
 expect(env.data().orders.b.items.legacy_1.status).toBe('ready');
 expect(env.data().orders.b.items.legacy_0.status).toBe('new');
 await page.reload();await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('queue'));await itemsView(page);
 await expect(row(page,'b','legacy_1').locator('.queue-row-status')).toContainText('Готов');
 expect(env.errors).toEqual([]);
});

test('editing quantity retains the saved unit price and identity, while changed active rows restart',async({page})=>{
 const env=await queue(page,{a:order(1,5,[line('Сенча + лимон',1,'ready',{price:350,productId:'tea',readyAt:123})])},'admin');
 await page.evaluate(()=>openEditModal('a'));await page.locator('.edit-qty-input').fill('2');await page.locator('#editNote').click();
 await page.evaluate(()=>saveEditOrder());await expect(page.locator('#editOverlay')).toHaveClass(/hidden/);
 expect(env.data().orders.a.items.row0).toMatchObject({price:350,productId:'tea',qty:2,status:'new'});
 expect(env.data().orders.a.items.row0.readyAt).toBeUndefined();
 expect(env.data().menu2[1].items[0].stock).toBe(9);expect(env.errors).toEqual([]);
});

test('editing a comment preserves line IDs, prices, modifiers, ready and delivered statuses',async({page})=>{
 const env=await queue(page,{a:order(1,5,[line('Сенча + лимон',2,'ready',{price:350,readyAt:123}),line('Вода',1,'done',{doneAt:456})])},'admin');
 const before=env.data().orders.a.items;
 await page.evaluate(()=>openEditModal('a'));await page.locator('#editNote').fill('Без сахара');
 await page.evaluate(()=>saveEditOrder());await expect(page.locator('#editOverlay')).toHaveClass(/hidden/);
 expect(env.data().orders.a.items).toEqual(before);expect(env.data().orders.a.note).toBe('Без сахара');
 expect(env.data().orders.a.status).toBe('ready');
 await itemsView(page);await expect(row(page,'a').locator('.queue-row-status')).toContainText('Готов');
 await page.evaluate(()=>openEditModal('a',true));await page.evaluate(()=>saveEditOrder());
 expect(env.data().orders.a.items.row0).toMatchObject({price:350,status:'done',name:'Сенча + лимон',qty:2});
 expect(env.data().orders.a.items.row1).toEqual(before.row1);
 expect(env.errors).toEqual([]);
});

test('stale edits and rejected writes preserve the latest order and roll back stock',async({page})=>{
 const env=await queue(page,{a:order(1,5,[line('Сенча',1,'making')])},'admin');
 const before=env.data().orders.a;
 await page.evaluate(()=>openEditModal('a'));await page.locator('.edit-qty-input').fill('2');await page.locator('#editNote').click();
 await page.evaluate(async()=>{window.__failStatus=true;await saveEditOrder();});
 expect(env.data().orders.a).toEqual(before);expect(env.data().menu2[1].items[0].stock).toBe(10);
 await page.evaluate(async()=>{window.__orderRace={path:'orders/a/items/row0/status',value:'ready'};await saveEditOrder();});
 expect(env.data().orders.a.items.row0.status).toBe('ready');expect(env.data().orders.a.items.row0.qty).toBe(1);
 expect(env.data().orders.a.history).toBeUndefined();expect(env.data().menu2[1].items[0].stock).toBe(10);
 await page.evaluate(()=>saveEditOrder());await expect(page.locator('#fInfo')).toContainText('Заказ изменился');
 expect(env.errors).toEqual([]);
});

test('ready rows stay visible until delivered, waiter actions retain their role',async({page})=>{
 const env=await queue(page,{o1:order(1,5,[line('Сенча',1,'ready')]),o2:order(2,2,[line('Сенча')])},'waiter');
 await itemsView(page);
 await expect(page.locator('#qList [data-st]')).toHaveCount(0);
 await expect(row(page,'o1').locator('[data-action=deliver]')).toHaveCount(1);
 await row(page,'o1').locator('[data-action=deliver]').click();
 await expect(row(page,'o1')).toHaveCount(0);await expect(row(page,'o2')).toHaveCount(1);
 expect(env.data().orders.o2.items.row0.status).toBe('new');expect(env.errors).toEqual([]);
});

test('staff and guest lines for one unique menu product group despite absent staff price',async({page})=>{
 const env=await queue(page,{staff:order(1,5,[line('Сенча')]),guest:order(2,3,[line('Сенча',2,'new',{price:300})],{source:'guest'})});
 await itemsView(page);await expect(page.locator('.queue-item-card')).toHaveCount(1);
 await expect(page.locator('.queue-group-total')).toHaveText('3 шт.');
 await row(page,'staff').locator('[data-st=ready]').click();expect(env.data().orders.guest.items.row0.status).toBe('new');
 expect(env.errors).toEqual([]);
});

test('old paid session stays until delivery; separate orders at one table stay independent',async({page})=>{
 const env=await queue(page,{old:order(4,15,[line('Чай')],{sid:'old'}),a:order(4,4,[line('Чай')]),b:order(4,2,[line('Чай')])});
 await page.evaluate(d=>window.__remoteSet('tables/'+d+'_4',{sid:'session',status:'open',closedSessions:[{sid:'old'}]}),date());
 await itemsView(page);await expect(page.locator('.queue-position')).toHaveCount(3);
 await row(page,'a').locator('[data-st=ready]').click();
 expect(env.data().orders.b.items.row0.status).toBe('new');expect(env.data().orders.old.items.row0.status).toBe('new');
 await row(page,'b').locator('[data-st=ready]').click();
 await expect(page.locator('.queue-group-remaining')).toHaveText('Приготовить: 1');
 await expect(page.locator('.queue-position-ready')).toHaveCount(2);expect(env.errors).toEqual([]);
});

test('long names and notes render safely without horizontal overflow',async({page},testInfo)=>{
 const name='Облепиховый чай с мятой и лимоном <img src=x onerror=alert(1)>';
 const env=await queue(page,{o1:order(1,15,[line(name,2)],{note:'Без сахара <script>alert(1)</script>'}),o2:order(2,0,[line(name)])});
 await itemsView(page);await expect(page.locator('.queue-group-header h3')).toHaveText(name);
 await expect(page.locator('.queue-row-note').first()).toContainText('<script>');
 expect(await page.locator('#qList img,#qList script').count()).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('queue-items.png'),fullPage:true});
 expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});
