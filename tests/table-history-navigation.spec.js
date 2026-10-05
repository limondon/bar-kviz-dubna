const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');
const date=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return d.toLocaleDateString('en-CA');};
function seed(count=12){
 const day=date(-1),tables={},orders={};
 for(let i=1;i<=count;i++){
  tables[day+'_'+i]={date:day,tNum:String(i),sid:'session-'+i,status:'closed',token:'token-'+i,openedAt:Date.now()-21*3600000,closedAt:Date.now(),autoClosed:true,closedSessions:[{sid:'session-'+i,closedAt:Date.now(),autoClosed:true}]};
  for(let j=0;j<(i===count?1:2);j++){const id='order-'+i+'-'+j;orders[id]={id,num:Object.keys(orders).length+1,date:day,table:String(i),sid:'session-'+i,createdAt:Date.now()-20*3600000,status:'done',items:{drink:{id:'drink',name:'Напиток',qty:1,status:'done'}}};}
 }
 return {tables,orders};
}
test('closed yesterday orders are discoverable from tables without claiming that orders disappeared',async({page},testInfo)=>{
 const data=seed(),env=await setup(page,data);await staff(page);await page.evaluate(day=>{sw('tables');jumpDate(day);},date(-1));
 const list=page.locator('#tablesBillList');await expect(list).not.toContainText('Нет заказов');
 await expect(list).toContainText('23 заказа');
 await page.screenshot({path:testInfo.outputPath('closed-orders-link.png')});
 await list.getByRole('button',{name:'Посмотреть закрытые заказы',exact:true}).click();
 await expect(page.locator('#page-done')).toHaveClass(/active/);await expect(page.locator('#closedDateLabel')).toContainText('Вчера');
 await expect(page.locator('#closedTablesList .table-bill')).toHaveCount(12);await expect(page.locator('#closedTablesList .tbo-item')).toHaveCount(23);
 await expect(page.locator('#closedTablesList .tb-st').first()).toContainText('Закрыт автоматически');
 await page.screenshot({path:testInfo.outputPath('yesterday-orders.png'),fullPage:true});
 expect(env.data().orders).toEqual(data.orders);expect(env.data().tables).toEqual(data.tables);expect(env.errors).toEqual([]);
});
test('mixed open and closed tables keep working tables visible and link to history of the selected day',async({page})=>{
 const data=seed(2),day=date(-1);data.tables[day+'_1']={...data.tables[day+'_1'],status:'open',openedAt:Date.now(),closedSessions:[],autoClosed:false};
 const env=await setup(page,data);await staff(page);await page.evaluate(day=>{sw('tables');jumpDate(day);},day);
 await expect(page.locator('#tablesBillList .table-bill')).toHaveCount(1);await expect(page.locator('#tablesBillList .tb-st')).toContainText('Открыт');
 await page.getByRole('button',{name:'Посмотреть закрытые заказы',exact:true}).click();
 await expect(page.locator('#closedTablesList .table-bill')).toHaveCount(1);await expect(page.locator('#closedTablesList .tb-num')).toContainText('2');
 expect(env.data().orders).toEqual(data.orders);expect(env.errors).toEqual([]);
});
test('a genuinely empty date still says there are no orders and has no history link',async({page})=>{
 const env=await setup(page);await staff(page);await page.evaluate(day=>{sw('tables');jumpDate(day);},date(-1));
 await expect(page.locator('#tablesBillList')).toContainText('Нет заказов');await expect(page.getByRole('button',{name:'Посмотреть закрытые заказы',exact:true})).toHaveCount(0);expect(env.errors).toEqual([]);
});
