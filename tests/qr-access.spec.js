const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');

test('first activation is available before printing and printing preserves the chosen mode and codes',async({page})=>{
  const env=await setup(page);
  await staff(page);
  await page.evaluate(()=>sw('menu'));
  await expect(page.locator('#qrEventStatus')).toContainText('выключены');
  await expect(page.locator('#qrEnable')).toBeEnabled();
  await page.locator('#qrEnable').click();
  await expect(page.locator('#qrEventStatus')).toContainText('включены');
  const first=await page.evaluate(async()=>{
    const {permanentQrTokens}=await import('/js/qr.js');
    return permanentQrTokens([1]);
  });
  expect(env.data().quiz_tokens._settings.enabled).toBe(true);
  const again=await page.evaluate(async()=>{
    const {permanentQrTokens}=await import('/js/qr.js');
    return permanentQrTokens([1]);
  });
  expect(again).toEqual(first);
  await page.locator('#qrDisable').click();
  await expect(page.locator('#qrEventStatus')).toContainText('выключены');
  expect(env.data().quiz_tokens._tables['1']).toBe(first['1']);
  expect(env.data().quiz_tokens[first['1']].permanent).toBe(true);
  await page.goto('https://bar.test/guest.html?table=1&token='+first['1']);
  await expect(page.locator('#invalidTitle')).toHaveText('QR-заказы сейчас выключены');
  expect(Object.keys(env.data().orders)).toHaveLength(0);
  expect(env.errors).toEqual([]);
});

test('a failed visit write is shown as an access-check error, not an invalid printed code',async({page})=>{
  const env=await setup(page,{tables:{}});
  await staff(page);
  const token=await page.evaluate(async()=>{
    const {permanentQrTokens}=await import('/js/qr.js');
    const codes=await permanentQrTokens([1]);
    await prepareQuiz();
    return codes['1'];
  });
  await page.addInitScript(()=>{window.__failTables=true;});
  await page.goto('https://bar.test/guest.html?table=1&token='+token);
  await expect(page.locator('#invalidTitle')).toHaveText('Не удалось проверить доступ');
  await expect(page.locator('#app')).toBeHidden();
  expect(env.data().quiz_tokens._tables['1']).toBe(token);
  expect(Object.keys(env.data().orders)).toHaveLength(0);
  expect(env.errors).toEqual([]);
});
