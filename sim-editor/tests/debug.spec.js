// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://localhost';

const TEST_SCENARIO = {
    id: 'test-scenario-1',
    name: 'Test Scenario',
    description: 'A test scenario',
    stations: [
        { id: 'source-1', type: 'source', x: 200, y: 200, config: { name: 'Source1', cycleTime: 10, bufferCapacity: 5 } },
        { id: 'proc-1', type: 'processing', x: 400, y: 200, config: { name: 'Proc1', cycleTime: 15, bufferCapacity: 3 } },
        { id: 'drain-1', type: 'drain', x: 600, y: 200, config: { name: 'Drain1', cycleTime: 5, bufferCapacity: 1 } },
    ],
    connections: [
        { from: 'source-1', to: 'proc-1', condition: 'default', fromPortIndex: -1, toPortIndex: -1 },
        { from: 'proc-1', to: 'drain-1', condition: 'default', fromPortIndex: -1, toPortIndex: -1 },
    ],
};

test('diagnose editor state', async ({ page }) => {
    const consoleMessages = [];
    const pageErrors = [];
    const dialogs = [];

    page.on('console', (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.dismiss();
    });

    // Step 1: Set localStorage on any page on the same origin
    await page.goto(`${BASE_URL}/editor/editor.html`, { waitUntil: 'domcontentloaded' });
    // Wait a moment for any dialogs
    await page.waitForTimeout(1000);

    console.log('--- After first load ---');
    console.log('Dialogs:', dialogs);
    console.log('URL:', page.url());

    // Set localStorage
    await page.evaluate((scenario) => {
        localStorage.setItem('sim-editor-scenarios', JSON.stringify([scenario]));
    }, TEST_SCENARIO);

    // Verify localStorage was set
    const stored = await page.evaluate(() => localStorage.getItem('sim-editor-scenarios'));
    console.log('localStorage set:', stored ? 'yes (' + stored.length + ' chars)' : 'no');

    // Clear dialogs
    dialogs.length = 0;
    consoleMessages.length = 0;

    // Step 2: Navigate to editor with scenario ID
    await page.goto(`${BASE_URL}/editor/editor.html?id=test-scenario-1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    console.log('\n--- After second load ---');
    console.log('URL:', page.url());
    console.log('Dialogs:', dialogs);
    console.log('Console:', consoleMessages.slice(0, 10));
    console.log('Errors:', pageErrors);

    // Check DOM state
    const scenarioName = await page.evaluate(() => {
        const el = document.getElementById('scenario-name');
        return el ? el.value : 'ELEMENT NOT FOUND';
    });
    console.log('scenario-name value:', scenarioName);

    const editorState = await page.evaluate(() => {
        // Check if the global editor instance is accessible
        const scenarios = JSON.parse(localStorage.getItem('sim-editor-scenarios') || '[]');
        const stationsCount = document.querySelectorAll('#stations-layer .station').length;
        const connectionsCount = document.querySelectorAll('#connections-layer .connection').length;
        const toolBtnActive = document.querySelector('.tool-btn.active');
        const propsContent = document.getElementById('properties-content');
        return {
            scenariosInStorage: scenarios.length,
            scenarioIds: scenarios.map(s => s.id),
            stationsRendered: stationsCount,
            connectionsRendered: connectionsCount,
            activeToolBtn: toolBtnActive ? toolBtnActive.dataset.tool : 'none',
            propsVisible: propsContent ? propsContent.offsetHeight > 0 : false,
            propsHTML: propsContent ? propsContent.innerHTML.substring(0, 200) : 'NOT FOUND',
        };
    });
    console.log('\nEditor DOM state:', JSON.stringify(editorState, null, 2));

    // Take a screenshot
    await page.screenshot({ path: 'test-results/debug-screenshot.png', fullPage: true });

    // Now test if tool buttons work
    const sourceBtn = page.locator('.tool-btn[data-tool="source"]');
    await sourceBtn.click();
    await page.waitForTimeout(300);
    const sourceClass = await sourceBtn.getAttribute('class');
    console.log('\nAfter clicking source btn, class:', sourceClass);

    const selectBtnClass = await page.locator('.tool-btn[data-tool="select"]').getAttribute('class');
    console.log('Select btn class:', selectBtnClass);

    // Check if editor instance exists
    const hasEditor = await page.evaluate(() => {
        return typeof window !== 'undefined' && document.querySelectorAll('.editor-container').length > 0;
    });
    console.log('Editor container exists:', hasEditor);
});
