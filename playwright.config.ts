import { defineConfig } from '@playwright/test';

const PORT = 4790;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  use: { baseURL: BASE_URL },
  webServer: {
    command: `mise x -- bun bin/pinpoint.ts serve --port ${PORT} --state-dir .e2e-state`,
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    env: { PINPOINT_NO_OPEN: '1' },
  },
});
