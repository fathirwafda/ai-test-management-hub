import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4173);

/**
 * E2E tests run against the built app (API serving the built web UI) with a freshly seeded database in
 * .e2e-data and the offline mock AI provider. Build first: `npm run build`.
 */
export default defineConfig({
  testDir: "e2e",
  // Specs share one database, so they run one after another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node apps/api/dist/seed/run.js --reset && node apps/api/dist/server.js",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      DATA_DIR: ".e2e-data",
      LLM_PROVIDER: "mock",
      LOG_LEVEL: "warn",
    },
  },
});
