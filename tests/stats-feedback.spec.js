const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');
const day=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const order=(offset,items)=>({table:'1',date:day(offset),createdAt:Date.now()+offset*86400000,items:Object.fromEntries(items.map(([name,qty],i)=>['row'+i,{id:'line'+i,name,qty,status:'done'}]))});

test('top periods use inclusive dates, exclude cups and refresh without losing the selection',async({page})=>{
 const env=await setup(page,{orders:{
  today:order(0,[['Stella Artois',2],['1 кружка',100],['2 кружки',100],['5 кружек',100],['Кружки',100]]),
  week:order(-6,[['Corona Extra',3]]),outsideWeek:order(-7,[['Spaten',4]]),
  fortnight:order(-13,[['Сенча',5]]),outsideFortnight:order(-14,[['Мохито',6]]),
  month:order(-29,[['Вода',7]]),outsideMonth:order(-30,[['Старый товар',100]]),future:order(1,[['Будущий товар',100]])
 }});await staff(page);await page.evaluate(()=>sw('stats'));
 const top=page.locator('.stats-card').filter({hasText:'ТОП ПОЗИЦИЙ'});
 await expect(top.locator('.stats-pop-name')).toHaveText(['1Вода','2Мохито','3Сенча','4Spaten','5Corona Extra','6Stella Artois']);
 await top.getByRole('button',{name:'7 дней',exact:true}).click();
 await expect(top.locator('.stats-pop-name')).toHaveText(['1Corona Extra','2Stella Artois']);
 await top.getByRole('button',{name:'14 дней',exact:true}).click();
 await expect(top.locator('.stats-pop-name')).toHaveText(['1Сенча','2Spaten','3Corona Extra','4Stella Artois']);
 await page.evaluate(o=>window.__remoteSet('orders/late',o),order(0,[['Stella Artois',10]]));
 await expect(top.locator('.stats-pop-count').first()).toHaveText('12');
 await expect(top.getByRole('button',{name:'14 дней',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>{sw('queue');sw('stats');});
 await expect(top.getByRole('button',{name:'14 дней',exact:true})).toHaveAttribute('aria-pressed','true');
 await top.getByRole('button',{name:'Месяц',exact:true}).click();
 await expect(top.locator('.stats-pop-row')).toHaveCount(6);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});

test('a cups-only period has no top positions and never changes the saved order',async({page})=>{
 const env=await setup(page,{orders:{cups:order(0,[['3 кружки',1]])}});const before=env.data().orders;
 await staff(page);await page.evaluate(()=>sw('stats'));
 await expect(page.locator('.stats-empty')).toHaveText('Нет данных');
 expect(env.data().orders).toEqual(before);expect(env.errors).toEqual([]);
});

test('a long error wraps inside the screen and sits above mobile navigation',async({page},testInfo)=>{
 await setup(page);await staff(page);
 await page.evaluate(()=>{const e=document.getElementById('fErr');e.textContent='Не удалось загрузить приложение. Проверьте интернет и повторите открытие страницы.';e.classList.add('show');});
 const box=await page.locator('#fErr').boundingBox();const nav=await page.locator('#bottomNav').boundingBox();
 const metrics=await page.locator('#fErr').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,height:el.clientHeight,line:parseFloat(getComputedStyle(el).lineHeight),width:innerWidth}));
 expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(metrics.width);
 expect(metrics.scroll).toBeLessThanOrEqual(metrics.client);
 if(metrics.width<768){expect(box.y+box.height).toBeLessThanOrEqual(nav.y);expect(metrics.height).toBeGreaterThan(metrics.line*2);}
 await page.screenshot({path:testInfo.outputPath('readable-error.png')});
});

test('late module startup clears its fallback warning once the app loads',async({page})=>{
 const env=await setup(page);let release;const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/js/main.js',async route=>{await gate;await route.fallback();});
 await page.goto('https://bar.test/',{waitUntil:'commit'});
 await expect(page.locator('#fErr')).toHaveClass(/show/,{timeout:10000});
 release();await page.waitForFunction(()=>!!window.sw);
 await expect(page.locator('#hRole')).toContainText('Менеджер');
 await expect(page.locator('#fErr')).not.toHaveClass(/show/);
 expect(env.errors).toEqual([]);
});

test('chart day opens details, updates live and excludes cups from daily products',async({page},testInfo)=>{
 const env=await setup(page,{orders:{today:order(0,[['Stella Artois',2],['1 кружка',20]]),yesterday:{...order(-1,[['Сенча',3]]),table:'2',num:2}}});
 await staff(page);await page.evaluate(()=>sw('stats'));
 await page.locator(`[data-stats-date="${day(-1)}"]`).click();
 const detail=page.getByRole('region',{name:'Подробности дня'});
 await expect(detail.locator('.stats-day-summary')).toContainText('Заказов: 1 · Столов: 1');
 await expect(detail.locator('.stats-pop-name')).toHaveText(['1Сенча']);await expect(detail.locator('.stats-day-order')).toContainText('Стол 2 · #2');
 await page.evaluate(o=>window.__remoteSet('orders/late',o),{...order(-1,[['Сенча',1],['2 кружки',10]]),table:'3',num:3});
 await expect(detail.locator('.stats-day-summary')).toContainText('Заказов: 2 · Столов: 2');await expect(detail.locator('.stats-pop-count')).toHaveText('4');
 await page.getByRole('button',{name:'7 дней',exact:true}).click();await expect(detail).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('daily-details.png'),fullPage:true});
 await page.locator(`[data-stats-date="${day(-2)}"]`).focus();await page.keyboard.press('Enter');
 await expect(detail.locator('.stats-day-summary')).toContainText('Заказов: 0');await expect(detail.locator('.stats-empty')).toHaveText('Нет данных');
 await detail.getByRole('button',{name:'Скрыть',exact:true}).click();await expect(detail).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(env.errors).toEqual([]);
});
