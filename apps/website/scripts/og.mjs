#!/usr/bin/env node
/**
 * Renders the share card — src/pages/og.astro — into public/og.png.
 *
 * Social sites want a bitmap, and the card's emblem is drawn by the glyph
 * field at run time, so the only faithful way to make the image is to open
 * the page and photograph it. Run after `astro build`, then commit the PNG:
 *
 *   pnpm --filter @jky/website build && node scripts/og.mjs
 */
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const PORT = 4333;
const server = spawn("npx", ["astro", "preview", "--port", String(PORT), "--ignore-lock"], {
  stdio: "ignore",
  shell: process.platform === "win32",
});

try {
  const url = `http://localhost:${PORT}/jky-terminal/og/`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("html[data-ready]", { timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "public/og.png", type: "png" });
  await browser.close();
  console.log("og: wrote public/og.png");
} finally {
  server.kill();
}
