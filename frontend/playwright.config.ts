import { defineConfig, devices } from "@playwright/test";

// Smoke-test scope: just the public /login page. No backend/scheduler/DB
// dependency. Catches bundle errors, broken imports, blank-page regressions.
//
// To extend coverage to authenticated flows later, add a globalSetup that
// creates a Session row directly via Prisma and writes the cookie to
// `storageState`. See backend/src/middleware/session.ts for the cookie shape.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    // Reuse the dev server if one is already running (matches local workflow
    // where Vite is up in another terminal). CI starts fresh.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
