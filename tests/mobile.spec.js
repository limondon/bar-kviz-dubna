const {test,expect}=require('@playwright/test');
const {setup,guest}=require('./browser-fixture.cjs');
test.afterEach(async({page,context})=>{if(!page.isClosed())await page.close();await context.close();});
test.afterAll(async({browser})=>{await browser.close();});
test('mobile archive paginates safely, escapes notes and recovers after lost connection',async({page})=>{
  const env=await setup(page),date='2026-07-01';
  env.root().archiveTestRows=Array.from({length:102},(_,i)=>({key:String(i).padStart(3,'0'),order:{id:String(i),num:i+1,table:'1',date,total:300,note:'<img src=x onerror=alert(1)>',items:{a:{name:'Corona',qty:1,price:300,status:'done'}}}}));
  await page.goto('https://bar.test/');await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('done'));
  await page.locator('.archive-panel summary').click();await page.locator('#archiveDate').fill(date);
  env.fail();await page.locator('#archiveLoad').click();await expect(page.locator('#archiveMessage')).toContainText('Не удалось');
  await page.locator('#archiveLoad').click();await expect(page.locator('.archive-receipt')).toHaveCount(100);
  await expect(page.locator('#archiveResults img')).toHaveCount(0);await expect(page.locator('#archiveResults button')).toHaveCount(0);
  await page.locator('#archiveMore').click();await expect(page.locator('.archive-receipt')).toHaveCount(102);await expect(page.locator('#archiveMore')).toBeHidden();
  await page.locator('#archiveDate').fill('2026-07-02');await page.locator('#archiveLoad').click();await expect(page.locator('.archive-receipt')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(env.errors).toEqual([]);
});
test('mobile guest recovers a committed order after lost response and page reload',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();await page.locator('#orderNote').fill('Без льда');
  env.lose();await page.locator('#placeBtn').click();await expect(page.locator('#placeBtn')).toHaveText('ПРОВЕРИТЬ ОТПРАВКУ');
  await page.reload();await page.locator('#placeBtn').click();await expect(page.locator('#screen-confirm')).toHaveClass(/active/);
  expect(Object.keys(env.root().orders)).toHaveLength(1);expect(env.root().menu2[0].items[0].stock).toBe(4);expect(Object.values(env.root().orders)[0].note).toBe('Без льда');expect(env.errors).toEqual([]);
});
test('mobile delayed submission stays locked and does not double-submit',async({page})=>{
  const env=await setup(page);await guest(page);await page.locator('[data-action=addItem]').first().click();await page.locator('#cartBar').click();
  let release;const blocked=new Promise(resolve=>release=resolve);
  await page.route('**/__api',async route=>{await blocked;await route.fallback();});
  await page.locator('#placeBtn').click();await expect(page.locator('#placeBtn')).toBeDisabled();
  await expect(page.locator('#orderNote')).not.toBeEditable();
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));release();
  await expect(page.locator('#screen-confirm')).toHaveClass(/active/);expect(Object.keys(env.root().orders)).toHaveLength(1);expect(env.errors).toEqual([]);
});
test('mobile manager can reach maintenance controls without horizontal overflow',async({page})=>{
  const env=await setup(page);await page.goto('https://bar.test/');await page.waitForFunction(()=>!!window.toggleSettingsMenu);
  const mobileSettings=page.locator('#bn-settings');if(await mobileSettings.isVisible())await mobileSettings.click();else await page.evaluate(()=>toggleSettingsMenu());
  await page.locator('#settingsPopup').getByText(/Режим обслуживания/).click();await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#maintenanceBanner')).toBeVisible();await expect(page.locator('#maintenanceResume')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(env.root().maintenance?.enabled).toBe(true);expect(env.errors).toEqual([]);await page.close();
});
