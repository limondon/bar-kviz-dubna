const {test,expect}=require('@playwright/test');
const {setup,staff}=require('./spark-fixture.cjs');
test.afterEach(async({page})=>{await page.goto('about:blank');});
const menu=[{cat:'Листовой чай',items:[{name:'Сенча',price:500},{name:'Ассам',price:500}]}];
const card=(name,price,fingerprint)=>({name,priceKopecks:price,fingerprint,supported:true,category:'Чай',type:'SERVICE',tax:'NO_VAT'});
const catalog={schema:1,moneyFormat:'kopecks-v1',deviceId:'terminal-test',deviceName:'Касса зала',exportedAt:Date.now(),items:{tea:card('чай 1л',50000,'tea-v1'),lemon:card('Добавка лимон',5000,'lemon-v1'),water:card('Вода',10000,'water-v1'),marked:{...card('Маркированный',50000,'marked'),supported:false}}};
async function open(page,initial=true,sourceMenu=menu){
 const env=await setup(page,{menu2:sourceMenu});await staff(page);
 if(initial)await page.evaluate(c=>window.__remoteSet('config/evotor/v1/devices/terminal-test/catalog',c),catalog);
 await page.evaluate(()=>openCashSettings());await expect(page.getByRole('dialog',{name:'Касса Эвотор'})).toBeVisible();return env;
}
async function addCard(page,uuid){await page.getByRole('combobox',{name:'Карточка Эвотора'}).selectOption(uuid);const add=page.getByRole('button',{name:'Добавить карточку',exact:true});if(await add.isVisible())await add.click();}
const rows=page=>page.locator('.cash-settings-row');

test('tapping the product row selects it immediately and does not toggle twice',async({page},testInfo)=>{
 const env=await open(page);await expect(rows(page)).toHaveCount(2);
 const row=rows(page).filter({hasText:'Сенча'}),checkbox=row.getByRole('checkbox');
 const tap=async locator=>testInfo.project.use.isMobile?locator.tap():locator.click();
 await tap(row.getByText('Сенча',{exact:true}));await expect(checkbox).toBeChecked();
 expect(await checkbox.evaluate(el=>getComputedStyle(el).appearance)).not.toBe('none');
 await expect(row).toHaveClass(/is-selected/);
 await page.screenshot({path:testInfo.outputPath('cash-checkbox-selected.png'),fullPage:true});
 await expect(page.getByRole('button',{name:'Назначить выбранным (1)'})).toBeEnabled();
 await tap(row.getByText('Не настроено',{exact:true}));await expect(checkbox).not.toBeChecked();
 await tap(checkbox);await expect(checkbox).toBeChecked();
 await row.getByRole('button',{name:'Настроить',exact:true}).click();await expect(page.locator('.cash-rule-editor')).toBeVisible();
 await page.getByRole('button',{name:'Назад',exact:true}).click();await expect(checkbox).toBeChecked();
 expect(env.data().config.evotor.v1.devices['terminal-test'].settings).toBeUndefined();expect(env.errors).toEqual([]);
});

test('legacy catalog requires corrected APK instead of displaying prices a hundred times too high',async({page})=>{
 const env=await open(page,false);const old=structuredClone(catalog);delete old.moneyFormat;old.items.tea.priceKopecks=5000000;
 await page.evaluate(c=>window.__remoteSet('config/evotor/v1/devices/terminal-test/catalog',c),old);
 await expect(page.getByRole('region',{name:'Подключение кассы'})).toContainText('версии 0.4');
 await expect(rows(page)).toHaveCount(0);expect(env.data().config.evotor.v1.devices['terminal-test'].settings).toBeUndefined();
 await page.evaluate(c=>window.__remoteSet('config/evotor/v1/devices/terminal-test/catalog',c),catalog);await expect(rows(page)).toHaveCount(2);
});

test('exact matches are suggestions until confirmed and single-card selection needs no add step',async({page},testInfo)=>{
 const env=await open(page,true,[{cat:'Пиво',items:[{name:'Hoegaarden',price:250}]}]);
 const current={...catalog,items:{beer:card('Hoegaarden',25000,'beer-v1')}};
 await page.evaluate(c=>window.__remoteSet('config/evotor/v1/devices/terminal-test/catalog',c),current);
 await expect(rows(page)).toContainText('Совпало название и цена');expect(env.data().config.evotor.v1.devices['terminal-test'].settings).toBeUndefined();
 await rows(page).getByRole('button',{name:'Настроить',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Карточка Эвотора'})).toHaveValue('beer');
 await expect(page.getByRole('button',{name:'Добавить карточку',exact:true})).toBeHidden();
 await expect(page.locator('[data-units]')).toBeHidden();await expect(page.locator('[data-total]')).toHaveText('На кассе: 250 ₽');
 await page.screenshot({path:testInfo.outputPath('cash-simple-choice.png'),fullPage:true});
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.locator('.cash-rule-state.good')).toHaveCount(1);
 expect(Object.values(env.data().config.evotor.v1.devices['terminal-test'].settings.products)[0].parts).toEqual([{uuid:'beer',units:1,fingerprint:'beer-v1'}]);
 await page.evaluate(c=>window.__remoteSet('config/evotor/v1/devices/terminal-test/catalog',c),{...current,items:{...current.items,another:card('Hoegaarden',25000,'beer-v2')}});
 const suggestion=await page.evaluate(async c=>{const {cashSuggestion}=await import('/js/cash-rules.js');return cashSuggestion({name:'Hoegaarden',price:250},c);},{...current,items:{...current.items,another:card('Hoegaarden',25000,'beer-v2')}});
 expect(suggestion).toBeNull();expect(env.errors).toEqual([]);
});
test('empty setup explains catalog import, and real cards arrive without reload',async({page},testInfo)=>{
 const env=await open(page,false);await expect(page.getByRole('dialog')).toContainText('Каталог ещё не получен');
 await expect(page.getByRole('region',{name:'Подключение кассы'})).toContainText('На терминале обновите');
 await expect(page.getByRole('region',{name:'Подключение кассы'})).toContainText('список товаров появится здесь автоматически');
 await expect(rows(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'Наши товары',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/Назначить выбранным/})).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('cash-connect.png'),fullPage:true});
 await page.evaluate(c=>window.__remoteSet('config/evotor/v1/devices/terminal-test/catalog',c),catalog);
 await expect(page.getByRole('region',{name:'Подключение кассы'})).toHaveCount(0);
 await expect(rows(page)).toHaveCount(2);await page.getByRole('button',{name:'Обновить каталог кассы',exact:true}).click();
 await expect(page.locator('.cash-settings-status')).toContainText('Откройте');
 const request=env.data().config.evotor.v1.devices['terminal-test'].refreshRequest;expect(request.id).toBeTruthy();
 expect(env.errors).toEqual([]);
});

test('header and close remain visible while long product list and editor scroll',async({page},testInfo)=>{
 const env=await open(page,true,[{cat:'Чай',items:Array.from({length:70},(_,i)=>({name:'Чай '+i,price:500}))}]);
 await expect(rows(page)).toHaveCount(70);
 const head=page.locator('.cash-settings-head'),close=page.getByRole('button',{name:'Закрыть',exact:true});
 const top=(await head.boundingBox()).y;
 await page.locator('.cash-settings-body').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 expect(await page.locator('.cash-settings-body').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await expect(close).toBeInViewport();expect((await head.boundingBox()).y).toBeCloseTo(top,1);
 await page.screenshot({path:testInfo.outputPath('cash-settings-scrolled.png'),fullPage:true});
 await rows(page).last().getByRole('button',{name:'Настроить',exact:true}).click();
 await expect(page.locator('.cash-rule-editor')).toBeVisible();
 const editorTop=(await head.boundingBox()).y;
 await page.locator('.cash-settings-body').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 await expect(close).toBeInViewport();expect((await head.boundingBox()).y).toBeCloseTo(editorTop,1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await close.click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(env.errors).toEqual([]);
});
test('group assignment persists, a newly added menu item appears, and cashier selection is by UUID',async({page},testInfo)=>{
 const env=await open(page);await page.getByRole('button',{name:'Выбрать найденные (2)'}).click();await page.getByRole('button',{name:'Назначить выбранным (2)'}).click();
 await expect(page.locator('[data-card] option[value=marked]')).toHaveCount(0);await addCard(page,'tea');await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(page.locator('.cash-rule-state.good')).toHaveCount(2);
 const bounds=await page.evaluate(()=>({copy:document.querySelector('.cash-settings-head p').getBoundingClientRect().bottom,toolbar:document.querySelector('.cash-settings-toolbar').getBoundingClientRect().top}));
 expect(bounds.toolbar).toBeGreaterThan(bounds.copy);
 await expect(page.getByRole('button',{name:'Закрыть',exact:true})).toBeInViewport();
 expect(Object.values(env.data().config.evotor.v1.devices['terminal-test'].settings.products).map(r=>r.parts[0].uuid)).toEqual(['tea','tea']);
 await page.screenshot({path:testInfo.outputPath('cash-settings.png'),fullPage:true});
 await page.evaluate(()=>window.__remoteSet('menu2/0/items/2',{name:'Новый чай',price:500}));await expect(rows(page)).toHaveCount(3);
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.reload();await page.waitForFunction(()=>!!window.openCashSettings);await page.evaluate(()=>openCashSettings());
 await expect(page.locator('.cash-rule-state.good')).toHaveCount(2);expect(env.errors).toEqual([]);
});
test('custom modifiers and multiple cash cards can be configured without code',async({page})=>{
 const env=await open(page);await page.getByRole('button',{name:'Добавки',exact:true}).click();await page.getByRole('button',{name:'Добавить соответствие',exact:true}).click();
 await page.locator('[data-name]').fill('Лимон');await page.locator('[data-price]').fill('50');await addCard(page,'lemon');await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(rows(page)).toContainText('лимон');
 await page.getByRole('button',{name:'Наши товары',exact:true}).click();await page.getByRole('button',{name:'Добавить соответствие',exact:true}).click();
 await page.locator('[data-name]').fill('Сенча + лимон');await page.locator('[data-price]').fill('550');await addCard(page,'tea');await page.getByRole('button',{name:'Составить из нескольких товаров',exact:true}).click();await addCard(page,'lemon');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(rows(page).filter({hasText:'Сенча + лимон'})).toContainText('чай 1л + Добавка лимон');
 const settings=env.data().config.evotor.v1.devices['terminal-test'].settings;expect(Object.keys(settings.addons)).toHaveLength(1);expect(Object.values(settings.products)[0].parts).toHaveLength(2);
 expect(env.errors).toEqual([]);
});
test('price mismatch and stale catalogs cannot be saved; configuration failures retain the editor',async({page})=>{
 const env=await open(page);await rows(page).filter({hasText:'Сенча'}).getByRole('button',{name:'Настроить',exact:true}).click();
 await addCard(page,'water');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.locator('[data-error]')).toContainText('Цена кассы не совпадает');
 expect(env.data().config.evotor.v1.devices['terminal-test'].settings).toBeUndefined();
 await addCard(page,'tea');
 await page.evaluate(()=>{window.__failCash=true;});await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.locator('[data-error]')).not.toBeEmpty();
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.locator('.cash-rule-state.good')).toHaveCount(1);
 await page.evaluate(c=>window.__remoteSet('config/evotor/v1/devices/terminal-test/catalog/items/tea',c),{...catalog.items.tea,fingerprint:'tea-v2'});
 await expect(rows(page).filter({hasText:'Сенча'})).toContainText('Нужно проверить');expect(env.errors).toEqual([]);
});
test('concurrent edits are preserved and a stale editor cannot overwrite the same mapping',async({page})=>{
 const env=await open(page);await rows(page).filter({hasText:'Сенча'}).getByRole('button',{name:'Настроить',exact:true}).click();await addCard(page,'tea');
 const remote={name:'Сенча',expectedKopecks:50000,parts:[{uuid:'tea',units:1,fingerprint:'tea-v1'}],updatedAt:1};
 const key=await page.evaluate(async()=>{const {cashRuleKey}=await import('/js/cash-rules.js');return cashRuleKey('Сенча');});
 await page.evaluate(({key,remote})=>window.__remoteSet('config/evotor/v1/devices/terminal-test/settings',{schema:1,revision:1,products:{[key]:remote}}),{key,remote});
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.locator('[data-error]')).toContainText('другом устройстве');
 expect(env.data().config.evotor.v1.devices['terminal-test'].settings.products[key]).toEqual(remote);
 await page.getByRole('button',{name:'Назад',exact:true}).click();await rows(page).filter({hasText:'Ассам'}).getByRole('button',{name:'Настроить',exact:true}).click();await addCard(page,'tea');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.locator('.cash-rule-state.good')).toHaveCount(2);
 expect(env.data().config.evotor.v1.devices['terminal-test'].settings.products[key]).toEqual(remote);expect(env.errors).toEqual([]);
});
test('settings are accessible through manager navigation and hidden for other roles',async({page})=>{
 await setup(page,{menu2:menu});await staff(page);await page.evaluate(()=>toggleSettingsMenu());
 await page.locator('#settingsPopup').getByText('Касса Эвотор').click();await expect(page.getByRole('dialog',{name:'Касса Эвотор'})).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.evaluate(()=>{pickRole('barman');confirmRole();toggleSettingsMenu();});await expect(page.locator('#settingsPopup')).not.toContainText('Касса Эвотор');
 await page.evaluate(()=>openCashSettings());await expect(page.getByRole('dialog')).toHaveCount(0);
});
