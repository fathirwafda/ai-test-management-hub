import { defineConfig, devices } from "@playwright/test";

const PORT = 4174;

/** `npm run screenshots`: captures the README screenshots from a freshly seeded app into docs/screenshots. */
export default defineConfig({
  testDir: "scripts/screenshots",
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, colorScheme: "light" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: "node apps/api/dist/seed/run.js --reset && node apps/api/dist/server.js",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), DATA_DIR: ".screenshots-data", LLM_PROVIDER: "mock", LOG_LEVEL: "warn" },
  },
});
