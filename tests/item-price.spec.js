const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function loadUtilsPriceHelpers() {
  const src = fs.readFileSync(path.join(root, 'js', 'utils.js'), 'utf8')
    .replace(/export const /g, 'const ')
    .replace(/export async function /g, 'async function ')
    .replace(/export function /g, 'function ');
  const sandbox = {
    document: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    Date,
    String,
    Number,
    Math,
  };
  vm.runInNewContext(`${src}; result={baseItemName,itemKey,itemExtraPrice};`, sandbox);
  return sandbox.result;
}

test('item price helpers keep base item and paid addons', () => {
  const { baseItemName, itemKey, itemExtraPrice } = loadUtilsPriceHelpers();

  expect(baseItemName('Corona Extra — С лаймом')).toBe('Corona Extra');
  expect(itemKey('Corona Extra — С лаймом')).toBe('corona extra');
  expect(itemExtraPrice('Corona Extra — С лаймом')).toBe(0);
  expect(itemExtraPrice('Corona Extra — С лаймом +50')).toBe(50);
  expect(itemExtraPrice('Сенча + лимон, мята')).toBe(100);
});
