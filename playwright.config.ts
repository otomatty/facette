import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const isCI = !!process.env.CI;
/** 起動済みのサーバー（開発サーバーなど）に対して実行するときに指定する */
const externalBase = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: externalBase ?? `http://localhost:${PORT}`,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: externalBase
    ? undefined
    : {
        command: `pnpm db:reset:local && pnpm build && pnpm preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: !isCI,
        timeout: 180_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
