import { chromium } from 'playwright';
import { default as fs } from 'fs';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
const page = await context.newPage();

const jsErrors = [];
page.on('pageerror', err => jsErrors.push(err.message));

await page.goto('https://localhost/factory-visualizer/index.html', { waitUntil: 'domcontentloaded', ignoreHTTPSErrors: true });
await page.waitForTimeout(2000);
await page.selectOption('#factory-select', { index: 1 });
await page.waitForTimeout(2000);
await page.click('.toolbar-tab[data-gvtab="gv-3d-edit"]');
await page.waitForTimeout(800);
await page.click('.g3d-sidebar-item[data-group="placement"]');
await page.waitForTimeout(1000);

const panelInfo = await page.evaluate(() => {
  const panel = document.getElementById('g3d-floating');
  const saveBtn = document.getElementById('gf-save-placement');
  const exitBtn = document.getElementById('gf-exit-placement');
  return {
    panelVisible: panel ? !panel.classList.contains('hidden') : false,
    saveBtnExists: !!saveBtn,
    saveBtnText: saveBtn?.textContent,
    exitBtnExists: !!exitBtn,
  };
});
console.log('Panel info:', JSON.stringify(panelInfo, null, 2));
console.log('JS errors:', jsErrors);

const shot = await page.screenshot({ type: 'jpeg', quality: 85 });
fs.writeFileSync('/tmp/fv-placement-fixed.jpg', shot);
await browser.close();
