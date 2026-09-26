const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');
test('stale editor cannot overwrite a category added by another client',async({page})=>{
 const env=await setup(page);await staff(page);
 const current=env.data().menu2;current.push({cat:'Бар',items:[{name:'Джин тоник',price:549}]});
 await page.evaluate(async menu=>{window.__pauseMenuListener=true;await window.__remoteSet('menu2',menu);},current);
 await page.evaluate(()=>updateMenuCatItem(0,0,'price',200));
 await expect(page.locator('#fErr')).toContainText('Меню изменилось');expect(env.data().menu2).toEqual(current);
 await page.evaluate(()=>{window.__pauseMenuListener=false;});
 await page.evaluate(()=>updateMenuCatItem(0,0,'price',200));
 expect(env.data().menu2[0].items[0].price).toBe(200);expect(env.data().menu2[2]).toEqual(current[2]);expect(env.errors).toEqual([]);
});
test('a transaction retry preserves concurrent stock changes',async({page})=>{
 const env=await setup(page);await staff(page);const current=env.data().menu2;current[0].items[0].stock=9;
 await page.evaluate(menu=>{window.__menuRace=menu;},current);
 await page.evaluate(()=>updateMenuCatItem(0,0,'price',200));
 await expect(page.locator('#fErr')).toContainText('обновились остатки');expect(env.data().menu2).toEqual(current);expect(env.errors).toEqual([]);
});

for(const change of ['stock','reorder'])test(`open item form cannot overwrite a received ${change} update`,async({page})=>{
 const env=await setup(page);await staff(page);await page.evaluate(()=>openItemEditor(0,0));
 const current=env.data().menu2;
 if(change==='stock')current[0].items[0].stock=9;else current.reverse();
 await page.evaluate(menu=>window.__remoteSet('menu2',menu),current);
 await page.locator('#ieNameInp').fill('Старое поле');await page.evaluate(()=>saveItemEditor());
 await expect(page.locator('#fErr')).toContainText('откройте товар заново');
 expect(env.data().menu2).toEqual(current);expect(env.errors).toEqual([]);
});

test('category deletion stops when menu changes during confirmation',async({page})=>{
 const env=await setup(page);await staff(page);
 await page.evaluate(()=>{window.__deletion=removeMenuCategory(0);});
 await expect(page.locator('#confirmOverlay')).toBeVisible();const current=env.data().menu2;current.reverse();
 await page.evaluate(menu=>window.__remoteSet('menu2',menu),current);
 await page.locator('#confirmOkBtn').click();await page.evaluate(()=>window.__deletion);
 await expect(page.locator('#fErr')).toContainText('повторите удаление');
 expect(env.data().menu2).toEqual(current);expect(env.errors).toEqual([]);
});
test('item editor saves absent options and switches unlimited stock to stop and back',async({page})=>{
 const env=await setup(page);await staff(page);await page.evaluate(()=>openItemEditor(0,0));
 await page.locator('#ieNameInp').fill('Вода новая');await page.locator('#ieStockInp').fill('');
 await page.evaluate(()=>saveItemEditor());
 expect(env.data().menu2[0].items[0].name).toBe('Вода новая');expect(env.data().menu2[0].items[0].stock).toBeNull();expect(env.data().menu2[0].items[0].options).toBeUndefined();
 await page.evaluate(()=>openItemEditor(0,0));await page.locator('#ieStockInp').fill('0');await page.evaluate(()=>saveItemEditor());
 expect(env.data().menu2[0].items[0].stock).toBe(0);
 await page.evaluate(()=>openItemEditor(0,0));await page.locator('#ieStockInp').fill('');await page.evaluate(()=>saveItemEditor());
 expect(env.data().menu2[0].items[0].stock).toBeNull();expect(env.errors).toEqual([]);
});
test('failed save reports failure and does not claim a new category was created',async({page})=>{
 const env=await setup(page);await staff(page);const before=env.data().menu2;
 await page.evaluate(()=>sw('menu'));await page.locator('#newCatName').fill('Бар');
 await page.evaluate(()=>{window.__failMenu=true;});await page.evaluate(()=>addMenuCategory());
 await expect(page.locator('#fErr')).toContainText('не сохранено');expect(env.data().menu2).toEqual(before);
 await expect(page.locator('#newCatName')).toHaveValue('Бар');
 await page.evaluate(()=>addMenuCategory());expect(env.data().menu2.at(-1).cat).toBe('Бар');expect(env.errors).toEqual([]);
});
test('missing remote menu cannot be replaced by builtin defaults',async({page})=>{
 const env=await setup(page,{menu2:null});await staff(page);await page.evaluate(()=>sw('menu'));
 await page.locator('#newCatName').fill('Бар');await page.evaluate(()=>addMenuCategory());
 await expect(page.locator('#fErr')).toContainText('Меню ещё не загружено');expect(env.data().menu2).toBeNull();expect(env.errors).toEqual([]);
});
