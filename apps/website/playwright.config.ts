import { defineConfig, devices } from "@playwright/test";

/*
 * Smoke tests against the built site, served the way GitHub Pages serves it:
 * static files under the /jky-terminal/ base path. Run after `astro build`.
 */
const PORT = 4329;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}/jky-terminal/`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // --ignore-lock: a preview someone already has running on another port
    // must not stop the tests from starting their own.
    command: `npx astro preview --port ${PORT} --ignore-lock`,
    url: `http://localhost:${PORT}/jky-terminal/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
