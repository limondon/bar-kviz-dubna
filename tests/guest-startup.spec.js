const {test,expect}=require('@playwright/test');
const {setup,guest}=require('./spark-fixture.cjs');

test('startup waits for connection without a false offline warning and falls back before 30 seconds',async({page})=>{
  const env=await setup(page);
  await page.addInitScript(()=>{window.__connected=false;window.__databaseReady=false;});
  await page.goto('https://bar.test/guest.html?table=1&token=test-token');
  await expect(page.locator('#screen-loading')).toBeVisible();
  await expect(page.locator('#offlineBanner')).toBeHidden();
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('[data-action=addItem]').first()).toBeVisible({timeout:7000});
  expect(await page.evaluate(()=>window.__longPollingFallbacks)).toBe(1);
  await expect(page.locator('#offlineBanner')).toBeHidden();
  expect(env.data().orders).toEqual({});expect(env.errors).toEqual([]);
});

test('guest starts independent access, table and menu reads together',async({page})=>{
  const env=await setup(page);
  await page.addInitScript(()=>{window.__waitForParallelBoot=true;});
  await guest(page);
  expect(await page.evaluate(()=>window.__parallelBootReleased)).toBe(true);
  expect(await page.evaluate(()=>window.__longPollingFallbacks||0)).toBe(0);
  expect(env.data().orders).toEqual({});expect(env.errors).toEqual([]);
});
