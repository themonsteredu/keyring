const { defineConfig } = require('@playwright/test');
const { existsSync } = require('node:fs');
const executablePath = process.env.CHROMIUM_PATH ||
  (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
module.exports = defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:8765', browserName: 'chromium',
    viewport: { width: 390, height: 844 }, trace: 'retain-on-failure',
    launchOptions: { executablePath,
      args: ['--no-sandbox'] } },
  webServer: { command: 'python3 tools/dev_server.py --port 8765 --mock',
    url: 'http://127.0.0.1:8765', reuseExistingServer: false },
});
