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
    const local = /^(?:\/jky-terminal\/)?#(.+)$/.exec(href);
    if (local) {
      if ((await page.locator(`[id="${local[1]}"]`).count()) === 0) problems.push(`no element for ${href}`);
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
  // The field counts its own draws. Left alone, a still field draws no more.
  const draws = () =>
    page.evaluate(() => (document.querySelector("canvas[data-field]") as HTMLCanvasElement & { jkyDraws?: number }).jkyDraws ?? 0);
  await page.waitForTimeout(800);
  const before = await draws();
  await page.waitForTimeout(1500);
  expect(before).toBeGreaterThan(0);
  expect(await draws()).toBe(before);
});

test("an unknown address gets the terminal's 404, with a way home", async ({ page }) => {
  const response = await page.goto("./no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.locator(".nf__term")).toContainText("no such file or directory: /no-such-page");
  await expect(page.locator(".nf__home")).toHaveAttribute("href", "/jky-terminal/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
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

test.describe("the terminal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("./#try");
    await page.locator('[data-terminal][data-ready="true"]').waitFor();
    await page.locator("[data-screen]").click();
  });

  const run = async (page: Page, command: string) => {
    await page.keyboard.type(command, { delay: 5 });
    await page.keyboard.press("Enter");
  };

  test("answers help", async ({ page }) => {
    await run(page, "help");
    await expect(page.locator("[data-log]")).toContainText("What this terminal knows");
  });

  test("builds the docker panel beneath the raw table, which stays", async ({ page }) => {
    await run(page, "docker ps");
    await expect(page.locator("[data-log]")).toContainText("CONTAINER ID");
    await expect(page.locator('.panel[data-kind="docker"] .dk__card')).toHaveCount(4);
  });

  test("a panel's button types its command and runs nothing", async ({ page }) => {
    await run(page, "docker ps");
    const echoes = page.locator(".ln--echo");
    const before = await echoes.count();
    await page.locator(".dk__card").first().getByRole("button", { name: "logs" }).click();
    await expect(page.locator("[data-prompt]")).toContainText("docker logs db");
    await expect(echoes).toHaveCount(before);
  });

  test("jky theme re-themes the whole page, and remembers it", async ({ page }) => {
    await run(page, "jky theme nord");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "nord");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "nord");
  });

  test("a destructive proposal cannot be approved until it is typed back", async ({ page }) => {
    await run(page, "ask clean the build");
    const approve = page.locator("[data-log] .ap__btn--go");
    await expect(approve).toBeDisabled();
    await page.locator("[data-log] .ap__confirm").fill("dist");
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page.locator("[data-log] .ap__status")).toContainText("Approved");
  });
});
