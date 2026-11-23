const {test,expect}=require('@playwright/test');
const {setup,staff,guest}=require('./spark-fixture.cjs');

test('staff can add a classic hookah to a table at its saved price',async({page})=>{
  const env=await setup(page);
  await staff(page);
  await page.locator('#inpTable').fill('1');
  await page.getByRole('button',{name:/ВЫБРАТЬ ИЗ МЕНЮ/}).click();
  await page.getByRole('button',{name:'Кальяны',exact:true}).click();
  await page.locator('[data-picker-action="plus"][data-item="Кальян классический"]').click();
  await page.locator('#menuPickerBtn').click();
  await page.locator('.btn-add').click();
  await expect(page.locator('#fOk')).toContainText('Заказ');
  const order=Object.values(env.data().orders)[0];
  expect(Object.values(order.items)[0]).toMatchObject({name:'Кальян классический',qty:1,price:1300});
  await page.evaluate(()=>sw('tables'));
  await page.locator('.tb-header').click();
  await expect(page.locator('.sum-total')).toContainText('1300₽');
  await page.locator('[data-action=cashTransfer]').click();
  await expect(page.locator('.cash-transfer-lines')).toContainText('Кальян классический ×1 — 1300 ₽');
  await guest(page);
  await expect(page.locator('#catTabs')).not.toContainText('Кальяны');
});
