const { test, expect } = require('@playwright/test');
const BASE_URL = 'https://localhost';
const TEST_SCENARIO = {
    id: 'test-scenario-1', name: 'Test', stations: [
        { id: 'source-1', type: 'source', x: 400, y: 300, config: { name: 'S1' } },
    ], connections: [],
};

test.beforeEach(async ({ page }) => {
    page.on('dialog', async d => await d.dismiss());
    await page.goto(`${BASE_URL}/editor/editor.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.evaluate((s) => localStorage.setItem('sim-editor-scenarios', JSON.stringify([s])), TEST_SCENARIO);
    await page.goto(`${BASE_URL}/editor/editor.html?id=test-scenario-1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
});

test('debug right-click on station', async ({ page }) => {
    // Check station exists
    const stationCount = await page.locator('#stations-layer .station').count();
    console.log('Stations:', stationCount);

    // Try right-clicking the station element
    const station = page.locator('#stations-layer .station').first();
    const box = await station.boundingBox();
    console.log('Station bounding box:', box);

    if (box) {
        // Right-click at station center
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
        await page.waitForTimeout(500);

        const menus = await page.locator('.context-menu').count();
        console.log('Context menus found:', menus);
    }

    // Try right-click on SVG directly
    const svg = page.locator('#canvas');
    const svgBox = await svg.boundingBox();
    console.log('SVG box:', svgBox);

    if (svgBox) {
        await page.mouse.click(svgBox.x + 50, svgBox.y + 50, { button: 'right' });
        await page.waitForTimeout(500);

        const menus = await page.locator('.context-menu').count();
        console.log('Context menus after empty click:', menus);
    }

    // Check if contextmenu event fires using page.evaluate
    const result = await page.evaluate(() => {
        return new Promise((resolve) => {
            const svg = document.getElementById('canvas');
            let fired = false;
            svg.addEventListener('contextmenu', () => { fired = true; }, { once: true });
            const evt = new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 });
            svg.dispatchEvent(evt);
            setTimeout(() => resolve({ fired, contextMenus: document.querySelectorAll('.context-menu').length }), 200);
        });
    });
    console.log('Dispatch result:', result);
});
