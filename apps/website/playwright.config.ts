import { defineConfig, devices } from "@playwright/test";

/*
 * Smoke tests against the built site, served the way GitHub Pages serves it:
 * static files under the /jky-terminal/ base path. Run after `astro build`.
 */
const PORT = 4329;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // Two at a time: each page runs a WebGL field, and on a CPU renderer more
  // than two starve each other into timeouts that are not the site's fault.
  workers: 2,
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
    // Firefox and WebKit — Safari's engine — run where their system libraries
    // install cleanly: CI's Ubuntu runner, or any machine with ALL_BROWSERS=1.
    ...(process.env.CI || process.env.ALL_BROWSERS
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } },
          { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
        ]
      : []),
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
