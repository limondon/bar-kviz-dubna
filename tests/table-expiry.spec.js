const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');
const date=()=>new Date().toLocaleDateString('en-CA'),key=()=>date()+'_1',limit=12*3600000;
const meta=openedAt=>({status:'open',date:date(),tNum:'1',token:'test-token',sid:'session',openedAt});
const order={table:'1',sid:'session',num:1,createdAt:Date.now(),date:date(),status:'ready',items:{tea:{id:'tea',name:'Сенча',qty:2,status:'ready'}}};
const check=async(page,now)=>page.evaluate(async now=>{const {autoCloseExpiredTables}=await import('./js/tables.js');await autoCloseExpiredTables(now);},now);

test('expired tables close on startup without payment, stock changes or losing queued drinks',async({page})=>{
 const env=await setup(page,{orders:{one:order},tables:{[key()]:meta(Date.now()-limit-10000)}});
 const before=env.data();await staff(page);
 await expect.poll(()=>env.data().tables[key()].status).toBe('closed');
 const closed=env.data().tables[key()];expect(closed.autoClosed).toBe(true);expect(closed.closedSessions).toHaveLength(1);
 expect(closed.closedSessions[0].autoClosed).toBe(true);expect(env.data().orders).toEqual(before.orders);expect(env.data().menu2).toEqual(before.menu2);
 await page.evaluate(()=>sw('done'));await expect(page.locator('.tb-st')).toContainText('Закрыт автоматически');
 await page.evaluate(()=>sw('queue'));await expect(page.locator('#qList')).toContainText('Сенча');
 await page.locator('[data-queue-view=items]').click();await expect(page.locator('#qList')).toContainText('Сенча');
 await check(page,Date.now()+1000);expect(env.data().tables[key()].closedSessions).toHaveLength(1);
 expect(env.errors).toEqual([]);
});

test('boundary check preserves young, unknown-age and paid tables; reopening resets the clock',async({page})=>{
 const started=Date.now(),env=await setup(page,{orders:{one:order},tables:{[key()]:meta(started),unknown:{status:'open'},paid:{...meta(started-limit*2),status:'closed'}}});
 await staff(page);await check(page,started+limit-1);expect(env.data().tables[key()].status).toBe('open');
 await check(page,started+limit);expect(env.data().tables[key()].status).toBe('closed');
 expect(env.data().tables.unknown.status).toBe('open');expect(env.data().tables.paid.autoClosed).toBeUndefined();
 await page.evaluate(async date=>{await window.reopenTable(date,'1');},date());
 const reopened=env.data().tables[key()];expect(reopened.status).toBe('open');expect(reopened.openedAt).toBeGreaterThanOrEqual(started);expect(reopened.autoClosed).toBeUndefined();expect(reopened.closedAt).toBeUndefined();
 await check(page,reopened.openedAt+limit-1);expect(env.data().tables[key()].status).toBe('open');expect(env.errors).toEqual([]);
});

test('failed automatic close retries safely and a competing new session is not closed',async({page})=>{
 const started=Date.now(),env=await setup(page,{tables:{[key()]:meta(started)}});await staff(page);
 await page.evaluate(()=>{window.__failTables=true;});await check(page,started+limit);
 expect(env.data().tables[key()].status).toBe('open');expect(env.data().tables[key()].closedSessions).toBeUndefined();
 const newer={...meta(started+limit),sid:'new-session'};
 await page.evaluate(race=>{window.__tableRace=race;},{path:'tables/'+key(),value:newer});
 await check(page,started+limit);expect(env.data().tables[key()]).toEqual(newer);
 await check(page,started+2*limit);expect(env.data().tables[key()].status).toBe('closed');expect(env.data().tables[key()].closedSessions).toHaveLength(1);
 expect(env.errors).toEqual([]);
});

test('minute timer closes an open table and a rejected reopen leaves it closed',async({page})=>{
 const started=Date.now(),env=await setup(page,{tables:{[key()]:meta(started-limit+30000)}});
 await page.clock.install({time:new Date(started)});await staff(page);
 expect(env.data().tables[key()].status).toBe('open');
 await page.clock.fastForward(61000);await expect.poll(()=>env.data().tables[key()].status).toBe('closed');
 await page.evaluate(async date=>{window.__failTables=true;await window.reopenTable(date,'1');},date());
 await expect(page.locator('#fErr')).toContainText('Не удалось переоткрыть');expect(env.data().tables[key()].status).toBe('closed');expect(env.errors).toEqual([]);
});
