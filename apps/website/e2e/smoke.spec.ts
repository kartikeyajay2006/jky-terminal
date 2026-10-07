import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { repoRoot } from "../src/lib/facts";

const release = JSON.parse(readFileSync(join(import.meta.dirname, "../src/data/release.json"), "utf8")) as {
  tag: string;
  assets: { name: string; url: string }[];
};

const REPO_BLOB = "https://github.com/kartikeyajay2006/jky-terminal/blob/main/";
const REPO_TREE = "https://github.com/kartikeyajay2006/jky-terminal/tree/main/";

/** Collects console errors and every request that leaves localhost. */
function watch(page: Page) {
  const errors: string[] = [];
  const offsite: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol !== "data:") offsite.push(r.url());
  });
  return { errors, offsite };
}

test("loads with no console errors and no request to another host", async ({ page }) => {
  const seen = watch(page);
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(500);
  expect(seen.errors).toEqual([]);
  expect(seen.offsite).toEqual([]);
});

test("enforces the app's own rule: connect-src 'self'", async ({ page }) => {
  await page.goto("./");
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("default-src 'self'");
});

test("has no serious accessibility violations", async ({ page }) => {
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("never scrolls sideways", async ({ page }) => {
  await page.goto("./");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("every link goes somewhere real", async ({ page }) => {
  await page.goto("./");
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  const root = repoRoot();
  const assets = new Set(release.assets.map((a) => a.url));
  const problems: string[] = [];

  for (const href of new Set(hrefs)) {
    if (href.startsWith("#")) {
      if ((await page.locator(`[id="${href.slice(1)}"]`).count()) === 0) problems.push(`no element for ${href}`);
    } else if (href.startsWith(REPO_BLOB) || href.startsWith(REPO_TREE)) {
      const path = href.slice(REPO_BLOB.length).split("#")[0];
      if (!existsSync(join(root, path))) problems.push(`no file in the repo for ${href}`);
    } else if (href.includes("/releases/download/")) {
      if (!assets.has(href)) problems.push(`not an asset of ${release.tag}: ${href}`);
    } else if (!/^(https:\/\/|\/jky-terminal\/)/.test(href)) {
      problems.push(`unexpected link ${href}`);
    }
  }
  expect(problems).toEqual([]);
});

test("the hero always shows the emblem: in glyphs where WebGL2 runs, as a vector where not", async ({ page }) => {
  await page.goto("./");
  const hero = page.locator("[data-hero]");
  const started = await hero
    .and(page.locator('[data-field="on"]'))
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  const emblem = page.locator("[data-emblem]");
  if (started) {
    await expect(page.locator("canvas[data-field]")).toHaveCSS("opacity", "1");
  } else {
    await expect(emblem).toBeVisible();
    await expect(emblem).not.toHaveCSS("opacity", "0");
  }
});

test("asked for less motion, the field is one still frame", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  const started = await page
    .locator('[data-hero][data-field="on"]')
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!started, "no WebGL2 here; the still SVG emblem is what shows");
  const canvas = page.locator("canvas[data-field]");
  await page.waitForTimeout(300);
  const first = await canvas.screenshot();
  await page.waitForTimeout(1200);
  const second = await canvas.screenshot();
  expect(second.equals(first)).toBe(true);
});

test("the install command copies exactly what it shows", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only in Playwright");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("./");
  const panel = page.locator('[data-install] [role="tabpanel"]:not([hidden])').first();
  const shown = (await panel.locator(".install__code").textContent())?.trim();
  await panel.getByRole("button", { name: /copy/i }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(shown);
  expect(copied).toMatch(/install\.(sh|ps1)/);
});
