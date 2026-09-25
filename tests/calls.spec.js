const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');
const oldCalls=()=>({old:{table:'1',status:'done',calledAt:1},pending:{table:'2',status:'pending',calledAt:2}});
async function openCalls(page){await staff(page);await page.evaluate(()=>sw('calls'));await expect(page.locator('.call-card')).toHaveCount(2);}

test('clear deletes confirmed calls and preserves calls arriving during confirmation',async({page})=>{
  const env=await setup(page,{waiterCalls:oldCalls()});await openCalls(page);
  await page.locator('.calls-clear').click();await expect(page.locator('#confirmOverlay')).toBeVisible();
  await page.evaluate(()=>window.__remoteSet('waiterCalls/new',{table:'3',status:'pending',calledAt:3}));
  await page.locator('#confirmOkBtn').click();
  await expect(page.locator('.call-card')).toHaveCount(1);
  await expect(page.locator('.call-table')).toContainText('3');
  expect(Object.keys(env.data().waiterCalls)).toEqual(['new']);
  await page.reload();await page.waitForFunction(()=>!!window.sw);await page.evaluate(()=>sw('calls'));
  await expect(page.locator('.call-card')).toHaveCount(1);expect(env.errors).toEqual([]);
  await page.locator('.calls-clear').click();await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#callsContent')).toContainText('Вызовов пока не было');
  expect(Object.keys(env.data().waiterCalls||{})).toEqual([]);expect(env.external).toEqual([]);
});

test('cancel leaves calls unchanged',async({page})=>{
  const env=await setup(page,{waiterCalls:oldCalls()});await openCalls(page);
  await page.locator('.calls-clear').click();await page.evaluate(()=>closeConfirmModal());
  await expect(page.locator('#confirmOverlay')).toBeHidden();
  await expect(page.locator('.call-card')).toHaveCount(2);expect(env.data().waiterCalls).toEqual(oldCalls());
});

test('failed clear reports the error, retains calls and allows a retry',async({page})=>{
  const env=await setup(page,{waiterCalls:oldCalls()});await openCalls(page);
  await page.evaluate(()=>{window.__failCalls=true;});
  await page.locator('.calls-clear').click();await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#fErr')).toContainText('Не удалось очистить вызовы');
  await expect(page.locator('.call-card')).toHaveCount(2);expect(env.data().waiterCalls).toEqual(oldCalls());
  await page.locator('.calls-clear').click();await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#callsContent')).toContainText('Вызовов пока не было');expect(env.errors).toEqual([]);
});
