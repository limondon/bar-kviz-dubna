const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');

function date(){return new Date().toLocaleDateString('en-CA');}
function order(){return {id:'one',table:'1',date:date(),sid:'session',num:1,createdAt:Date.now(),status:'new',items:{water:{id:'water',name:'Вода',qty:1,status:'new'}}};}

test('failed table close stays open, reports the error and allows retry',async({page})=>{
  const env=await setup(page,{orders:{one:order()}});await staff(page);await page.evaluate(()=>sw('tables'));
  await page.locator('.tb-header').click();
  await expect(page.locator('.btn-pay')).toBeVisible();
  await page.evaluate(()=>{window.__failTables=true;});
  await page.locator('.btn-pay').click();await page.locator('#confirmOkBtn').click();

  await expect(page.locator('#fErr')).toContainText('Не удалось закрыть стол');
  await expect(page.locator('.tb-st')).toContainText('Открыт');
  expect(env.data().tables[date()+'_1'].status).toBe('open');

  await page.locator('.tb-header').click();
  await page.locator('.btn-pay').click();await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#fOk')).toContainText('Стол 1 закрыт');
  expect(env.data().tables[date()+'_1'].status).toBe('closed');
  expect(env.errors).toEqual([]);expect(env.external).toEqual([]);
});
