import { defineConfig, devices } from '@playwright/test';

/**
 * E2E su build di produzione servite da `vite preview`.
 * - 4173: build standard (ospite, archivio locale)
 * - 4174: build con Supabase configurato verso un backend simulato nel test
 * - 4175: build per GitHub Pages servita nella sottocartella /dt.github.io/
 * Browser: Microsoft Edge installato nel sistema (nessun download).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: { channel: 'msedge', trace: 'retain-on-failure', locale: 'it-IT', timezoneId: 'Europe/Rome' },
  projects: [
    { name: 'desktop', testIgnore: /mobile/, use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', testMatch: /mobile/, use: { ...devices['Pixel 7'], channel: 'msedge', defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    { command: 'npm run preview -w @mdt/web', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run preview:sb -w @mdt/web', url: 'http://localhost:4174', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run preview:pages -w @mdt/web', url: 'http://localhost:4175/dt.github.io/', reuseExistingServer: true, timeout: 60_000 },
  ],
});
