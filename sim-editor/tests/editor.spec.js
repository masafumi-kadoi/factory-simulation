// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://localhost';

// Test scenario data
const TEST_SCENARIO = {
    id: 'test-scenario-1',
    name: 'Test Scenario',
    description: 'A test scenario',
    stations: [
        { id: 'source-1', type: 'source', x: 200, y: 200, config: { name: 'Source1', cycleTime: 10, bufferCapacity: 5, signalType: 'workFull', inputCount: 0, outputCount: 1 } },
        { id: 'proc-1', type: 'processing', x: 400, y: 200, config: { name: 'Proc1', cycleTime: 15, bufferCapacity: 3, signalType: 'workFull', inputCount: 1, outputCount: 1 } },
        { id: 'drain-1', type: 'drain', x: 600, y: 200, config: { name: 'Drain1', cycleTime: 5, bufferCapacity: 1, signalType: 'workFull', inputCount: 1, outputCount: 0 } },
    ],
    connections: [
        { from: 'source-1', to: 'proc-1', condition: 'default', fromPortIndex: -1, toPortIndex: -1 },
        { from: 'proc-1', to: 'drain-1', condition: 'default', fromPortIndex: -1, toPortIndex: -1 },
    ],
};

test.beforeEach(async ({ page }) => {
    // Ignore HTTPS certificate errors
    // Seed localStorage with a test scenario before navigating
    await page.goto(`${BASE_URL}/editor/editor.html?id=test-scenario-1`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((scenario) => {
        localStorage.setItem('sim-editor-scenarios', JSON.stringify([scenario]));
    }, TEST_SCENARIO);
    // Reload so editor picks up the scenario
    await page.goto(`${BASE_URL}/editor/editor.html?id=test-scenario-1`, { waitUntil: 'networkidle' });
});

test.describe('Editor initialization', () => {
    test('should load without JS errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));

        // Wait for editor to fully initialize
        await page.waitForTimeout(2000);

        // Check no JS errors
        expect(errors).toEqual([]);
    });

    test('should show menubar', async ({ page }) => {
        await page.waitForTimeout(1000);
        const menubar = page.locator('#menubar');
        await expect(menubar).toBeVisible();

        // Check menu items exist
        const menuItems = menubar.locator('.menu-item');
        const count = await menuItems.count();
        expect(count).toBeGreaterThanOrEqual(4); // シナリオ, 編集, 表示, SimDB, ヘルプ
    });

    test('should show scenario name in menubar', async ({ page }) => {
        await page.waitForTimeout(1000);
        const nameInput = page.locator('#scenario-name');
        await expect(nameInput).toBeVisible();
        await expect(nameInput).toHaveValue('Test Scenario');
    });

    test('should render stations on canvas', async ({ page }) => {
        await page.waitForTimeout(1000);
        const stations = page.locator('#stations-layer .station');
        const count = await stations.count();
        expect(count).toBe(3);
    });

    test('should render connections on canvas', async ({ page }) => {
        await page.waitForTimeout(1000);
        const connections = page.locator('#connections-layer .connection');
        const count = await connections.count();
        expect(count).toBe(2);
    });

    test('should show properties panel with scenario info', async ({ page }) => {
        await page.waitForTimeout(1000);
        const propsContent = page.locator('#properties-content');
        await expect(propsContent).toBeVisible();
        // Should show scenario name in properties
        const scenarioNameInput = page.locator('#prop-scenario-name');
        await expect(scenarioNameInput).toHaveValue('Test Scenario');
    });
});

test.describe('Tool palette', () => {
    test('should switch to Source tool on click', async ({ page }) => {
        await page.waitForTimeout(1000);
        const sourceBtn = page.locator('.tool-btn[data-tool="source"]');
        await sourceBtn.click();
        await expect(sourceBtn).toHaveClass(/active/);
        // Select button should not be active
        const selectBtn = page.locator('.tool-btn[data-tool="select"]');
        await expect(selectBtn).not.toHaveClass(/active/);
    });

    test('should switch to Processing tool on click', async ({ page }) => {
        await page.waitForTimeout(1000);
        const btn = page.locator('.tool-btn[data-tool="processing"]');
        await btn.click();
        await expect(btn).toHaveClass(/active/);
    });

    test('should switch to Connect tool on click', async ({ page }) => {
        await page.waitForTimeout(1000);
        const btn = page.locator('.tool-btn[data-tool="connect"]');
        await btn.click();
        await expect(btn).toHaveClass(/active/);
    });

    test('should switch back to Select tool', async ({ page }) => {
        await page.waitForTimeout(1000);
        // First switch to source
        await page.locator('.tool-btn[data-tool="source"]').click();
        // Then switch back to select
        const selectBtn = page.locator('.tool-btn[data-tool="select"]');
        await selectBtn.click();
        await expect(selectBtn).toHaveClass(/active/);
    });

    test('should place station when canvas clicked with tool', async ({ page }) => {
        await page.waitForTimeout(1000);
        // Switch to source tool
        await page.locator('.tool-btn[data-tool="source"]').click();

        // Click on canvas to place station
        const canvas = page.locator('#canvas');
        await canvas.click({ position: { x: 300, y: 300 } });

        await page.waitForTimeout(500);
        const stations = page.locator('#stations-layer .station');
        const count = await stations.count();
        expect(count).toBe(4); // 3 original + 1 new
    });

    test('auto-layout button should work', async ({ page }) => {
        await page.waitForTimeout(1000);
        const btn = page.locator('#auto-layout-btn');
        await expect(btn).toBeVisible();
        await btn.click();
        await page.waitForTimeout(500);
        // Stations should still be rendered
        const stations = page.locator('#stations-layer .station');
        const count = await stations.count();
        expect(count).toBe(3);
    });
});

test.describe('Station selection and properties', () => {
    test('should select station on click', async ({ page }) => {
        await page.waitForTimeout(1000);
        // Click on first station
        const station = page.locator('#stations-layer .station').first();
        await station.click();

        await page.waitForTimeout(300);
        // Station should be selected (has .selected class)
        await expect(station).toHaveClass(/selected/);

        // Properties panel should show station properties
        const propsContent = page.locator('#properties-content');
        const text = await propsContent.textContent();
        expect(text).toContain('Source');
    });

    test('should show SimDB settings in scenario properties', async ({ page }) => {
        await page.waitForTimeout(1000);
        // Click empty area to deselect
        // Properties should show scenario info with SimDB
        const simdbHost = page.locator('#prop-simdb-host');
        await expect(simdbHost).toBeVisible();
    });
});

test.describe('Context menu', () => {
    test('should show context menu on right-click station', async ({ page }) => {
        await page.waitForTimeout(1000);
        const station = page.locator('#stations-layer .station').first();
        await station.click({ button: 'right' });

        await page.waitForTimeout(300);
        const contextMenu = page.locator('.context-menu');
        await expect(contextMenu).toBeVisible();
    });

    test('should show context menu on right-click empty canvas', async ({ page }) => {
        await page.waitForTimeout(1000);
        const canvas = page.locator('#canvas');
        await canvas.click({ button: 'right', position: { x: 100, y: 400 } });

        await page.waitForTimeout(300);
        const contextMenu = page.locator('.context-menu');
        await expect(contextMenu).toBeVisible();
    });
});

test.describe('Menu bar', () => {
    test('should open シナリオ menu', async ({ page }) => {
        await page.waitForTimeout(1000);
        const menuItem = page.locator('.menu-item').first();
        await menuItem.click();

        await page.waitForTimeout(300);
        const dropdown = page.locator('.menu-dropdown');
        const visible = await dropdown.first().isVisible();
        expect(visible).toBeTruthy();
    });

    test('should open ヘルプ > ショートカット dialog', async ({ page }) => {
        await page.waitForTimeout(1000);
        // Find Help menu
        const helpMenu = page.locator('.menu-item').last();
        await helpMenu.click();
        await page.waitForTimeout(300);

        // Click shortcuts item
        const shortcutItem = page.locator('.menu-dropdown-item:has-text("ショートカット")');
        if (await shortcutItem.isVisible()) {
            await shortcutItem.click();
            await page.waitForTimeout(300);
            const modal = page.locator('.modal-overlay');
            await expect(modal).toBeVisible();
        }
    });
});

test.describe('Keyboard shortcuts', () => {
    test('Cmd+A should select all stations', async ({ page }) => {
        await page.waitForTimeout(1000);
        await page.keyboard.press('Meta+a');
        await page.waitForTimeout(300);

        const selected = page.locator('#stations-layer .station.selected');
        const count = await selected.count();
        expect(count).toBe(3);
    });
});
