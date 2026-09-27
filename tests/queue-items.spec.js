const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');
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

test('cancellation, closed sessions, delivered rows and deletion disappear live',async({page})=>{
 const env=await queue(page,{o1:order(1,9,[line('Чай')]),o2:order(2,7,[line('Чай')]),o3:order(3,4,[line('Чай','1','ready'),line('Сидр',1,'done')])},'admin');
 await itemsView(page);
 await expect(page.locator('.queue-item-card')).toHaveCount(1);
 await page.evaluate(d=>window.__remoteSet('tables/'+d+'_1',{sid:'session',status:'closed',closedSessions:[{sid:'session'}]}),date());
 await expect(row(page,'o1')).toHaveCount(0);
 // Existing cancellation action is order deletion with confirmation.
 await page.evaluate(()=>{window.__cancel=delOrder('o2');});await page.locator('#confirmOkBtn').click();await page.evaluate(()=>window.__cancel);
 await expect(row(page,'o2')).toHaveCount(0);
 await row(page,'o3').locator('[data-action=deliver]').click();
 await expect(page.locator('.queue-item-card')).toHaveCount(0);
 expect(env.data().orders.o3.items.row0.status).toBe('done');
 await page.evaluate(o=>window.__remoteSet('orders/o4',o),order(4,2,[line('Вода')]));
 await expect(page.locator('.queue-item-card')).toHaveCount(1);
 await page.evaluate(()=>window.__remoteSet('orders/o4',null));await expect(page.locator('.queue-item-card')).toHaveCount(0);
 expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('item-view counters and table filters exclude closed orders without changing order view',async({page})=>{
 const env=await queue(page,{o1:order(1,9,[line('Чай')]),o2:order(2,4,[line('Сидр')])});
 await page.evaluate(d=>window.__remoteSet('tables/'+d+'_1',{sid:'session',status:'closed',closedSessions:[{sid:'session'}]}),date());
 // Existing view remains unchanged, as requested.
 await expect(page.locator('#sN')).toHaveText('2');await expect(page.locator('.order-card')).toHaveCount(2);
 await itemsView(page);
 await expect(page.locator('#sN')).toHaveText('1');await expect(page.locator('#sNew')).toHaveText('1');await expect(page.locator('#bQ')).toHaveText('1');
 await expect(page.locator('.queue-item-card')).toHaveCount(1);await expect(row(page,'o1')).toHaveCount(0);
 await expect(page.locator('#qFilters')).not.toContainText('Стол 1');await expect(page.locator('#qFilters')).toContainText('Стол 2');
 await ordersView(page);await expect(page.locator('#sN')).toHaveText('2');await expect(page.locator('#bQ')).toHaveText('2');await expect(page.locator('.order-card')).toHaveCount(2);
 expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('product IDs, variations and ambiguous legacy names do not merge incorrectly',async({page})=>{
 const env=await queue(page,{
  o1:order(1,8,[line('Чай',1,'new',{productId:'a'}),line('Чай',1,'new',{productId:'b'})]),
  o2:order(2,6,[line('Чай',1,'new',{productId:'a'}),line('Чай + мята'),line('Чай + лимон')]),
  o3:order(3,4,[line('Одинаковое имя',1,'new',{price:100})]),
  o4:order(4,2,[line('Одинаковое имя',1,'new',{price:100})])
 },'barman',{menu2:[{cat:'А',items:[{name:'Одинаковое имя',price:100}]},{cat:'Б',items:[{name:'Одинаковое имя',price:100}]}]});
 await itemsView(page);
 await expect(page.locator('.queue-item-card')).toHaveCount(6);
 await expect(page.locator('.queue-group-total').first()).toHaveText('2 шт.');
 await expect(page.locator('.queue-group-total').nth(1)).toHaveText('1 шт.');
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

test('old closed session stays excluded when table reopens; separate orders at one table stay independent',async({page})=>{
 const env=await queue(page,{old:order(4,15,[line('Чай')],{sid:'old'}),a:order(4,4,[line('Чай')]),b:order(4,2,[line('Чай')])});
 await page.evaluate(d=>window.__remoteSet('tables/'+d+'_4',{sid:'session',status:'open',closedSessions:[{sid:'old'}]}),date());
 await itemsView(page);await expect(page.locator('.queue-position')).toHaveCount(2);
 await row(page,'a').locator('[data-st=ready]').click();
 expect(env.data().orders.b.items.row0.status).toBe('new');expect(env.data().orders.old.items.row0.status).toBe('new');
 await row(page,'b').locator('[data-st=ready]').click();
 await expect(page.locator('.queue-group-remaining')).toHaveText('Всё готово — ждёт выдачи');
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
