// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: '.',
    timeout: 30000,
    retries: 0,
    use: {
        ignoreHTTPSErrors: true,
        headless: true,
        viewport: { width: 1400, height: 900 },
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
});
