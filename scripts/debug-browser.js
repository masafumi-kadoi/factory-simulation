#!/usr/bin/env node
/**
 * Chrome remote debugging launcher
 * Usage: node scripts/debug-browser.js [url]
 * Default URL: http://localhost:8085 (sim-portal)
 */

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2] || "https://localhost/portal/";

(async () => {
  const browser = await chromium.launch({
    headless: false,
    devtools: true,
    args: [
      "--remote-debugging-port=9222",
      "--start-maximized",
      "--ignore-certificate-errors",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Log console messages from the page
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "error") {
      console.error(`[PAGE ERROR] ${text}`);
    } else if (type === "warn") {
      console.warn(`[PAGE WARN] ${text}`);
    } else {
      console.log(`[PAGE LOG] ${text}`);
    }
  });

  page.on("pageerror", (err) => {
    console.error(`[PAGE EXCEPTION] ${err.message}`);
  });

  page.on("requestfailed", (req) => {
    console.error(`[REQ FAILED] ${req.url()} - ${req.failure()?.errorText}`);
  });

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  console.log(`Opened: ${TARGET_URL}`);
  console.log(`DevTools: chrome://inspect (port 9222)`);
  console.log(`Available pages:`);
  console.log(`  Portal:             https://localhost/portal/`);
  console.log(`  3D Visualizer:      https://localhost/visualizer/`);
  console.log(`  Factory Visualizer: https://localhost/factory-visualizer/`);
  console.log(`  Editor:             https://localhost/editor/`);
  console.log(`  Executor:           https://localhost/executor/`);
  console.log("Press Ctrl+C to close");

  // Keep alive
  await new Promise(() => {});
})();
