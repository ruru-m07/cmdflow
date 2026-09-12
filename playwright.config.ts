import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4321", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: This root Playwright command is not a cached Turbo task.
    ...(process.env.CMDFLOW_E2E_DOM_ONLY
      ? []
      : [
          {
            command: "bun run --cwd=apps/web start --hostname 127.0.0.1 --port 4321",
            url: "http://127.0.0.1:4321",
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          },
        ]),
    {
      command: "bun e2e/server.ts",
      url: "http://127.0.0.1:4322",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
