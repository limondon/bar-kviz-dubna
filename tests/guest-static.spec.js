const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

test('guest page is split and does not use inline onclick handlers', async ({ page }) => {
  const html = fs.readFileSync(path.join(root, 'guest.html'), 'utf8');
  const guestJs = fs.readFileSync(path.join(root, 'js', 'guest.js'), 'utf8');

  await page.setContent(html);

  await expect(page.locator('link[href="guest.css"]')).toHaveCount(1);
  await expect(page.locator('script[src="js/guest.js"]')).toHaveCount(1);
  await expect(page.locator('[onclick]')).toHaveCount(0);
  expect(guestJs).not.toContain('onclick=');
  expect(guestJs).toContain('data-action');
});
