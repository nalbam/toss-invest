import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config. Boots the Next.js dev server on a fixed port (3100)
 * with dummy Toss credentials — the specs intercept every `/api/*` request in
 * the browser before it reaches the server, so no real upstream call or live
 * secret is ever needed. Kept separate from the Vitest gates (`testDir: 'e2e'`,
 * which Vitest excludes) so `pnpm test`/`build` never run these specs.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "next dev -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: "3100",
      TOSS_CLIENT_ID: "e2e",
      TOSS_CLIENT_SECRET: "e2e",
      TOSS_ACCOUNT_SEQ: "1",
      TOSS_API_BASE: "http://127.0.0.1:9",
      DRY_RUN: "true",
      KILL_SWITCH: "false",
    },
  },
});
