import { expect, test, type Page } from "@playwright/test";

async function openTerminal(page: Page) {
  await page.goto("./#try");
  await page.locator('[data-terminal][data-ready="true"]').waitFor();
  await page.locator("[data-screen]").click();
}

async function run(page: Page, command: string) {
  await page.locator("[data-input]").fill(command);
  await page.locator("[data-input]").press("Enter");
  await expect(page.locator("[data-prompt]")).toBeVisible();
}

test("starts in High Contrast, including with an invalid saved theme", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
  await expect(page.locator("[data-tp-label]")).toHaveText("High Contrast");
  await page.evaluate(() => localStorage.setItem("jky.theme", "invalid-theme"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
});

test("loads the timeline engine only when a story approaches", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\/scene-motion\.[^/]+\.js$/.test(new URL(request.url()).pathname)) requests.push(request.url());
  });
  await page.goto("./");
  await page.evaluate(() => document.fonts.ready);
  expect(requests).toEqual([]);
  await page.goto("./#persist");
  // Scene setup waits for fonts and a deferred module. A cold WebKit runner
  // can need more than the ordinary five-second DOM assertion timeout.
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#persist")).toHaveAttribute("data-scene-ready", "true", { timeout: 15_000 });
  expect(requests).toHaveLength(1);
});

test("the unattended demo keeps the visitor's chosen theme", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => localStorage.setItem("jky.theme", "nord"));
  await page.goto("./#try");
  await page.reload();
  await expect(page.locator("[data-log]")).toContainText("Your turn", { timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "nord");
  await expect(page.locator("[data-theme-name]")).toHaveText("Nord");
});

test("wheel scrolls terminal output, then the page at both edges", async ({ page }) => {
  await openTerminal(page);
  await run(page, "help");
  await run(page, "help");
  const screen = page.locator("[data-screen]");
  const readTop = () => screen.evaluate((el) => el.scrollTop);
  await screen.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const bottom = await readTop();
  expect(bottom).toBeGreaterThan(100);
  await screen.hover();
  const pageY = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -120);
  await expect.poll(readTop).toBeLessThan(bottom - 20);
  expect(Math.abs(await page.evaluate(() => scrollY) - pageY)).toBeLessThan(3);

  await screen.evaluate((el) => { el.scrollTop = 0; });
  await page.mouse.wheel(0, -180);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(pageY - 20);

  await screen.hover();
  await screen.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const beforeDown = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforeDown + 20);
});

test("reading earlier output stops streamed output pulling the scroll back down", async ({ page }) => {
  await openTerminal(page);
  await run(page, "help");
  await run(page, "help");
  const screen = page.locator("[data-screen]");
  // With autoplay stopped early, one help response can barely overflow.
  // Ensure position 20 is older output, rather than the current bottom.
  await expect.poll(() => screen.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);
  await page.locator("[data-input]").fill("help");
  await page.locator("[data-input]").press("Enter");
  await screen.hover();
  // A wheel's native scrolling happens in the same event cycle. Splitting
  // these into two browser tasks lets an old bottom-scroll event resume
  // following before the synthetic scroll has happened.
  await screen.evaluate((el) => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    el.scrollTop = 20;
  });
  await expect(page.locator("[data-prompt]")).toBeVisible();
  await expect.poll(() => screen.evaluate((el) => el.scrollTop)).toBeLessThan(40);
  await run(page, "pwd");
  await expect.poll(() => screen.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(4);
});

test("the comparison stays readable and allows page scrolling under the pointer", async ({ page }) => {
  await page.goto("./#compare");
  const table = page.getByRole("region", { name: "Comparison table — scrolls sideways" });
  await expect(page.getByRole("heading", { name: "How JKY compares. Honestly." })).toHaveCSS("opacity", "1");
  await expect(table).toHaveCSS("opacity", "1");
  await table.hover();
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 20);
  if (await table.evaluate((el) => el.scrollWidth > el.clientWidth)) {
    await table.hover();
    await page.mouse.wheel(220, 0);
    await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("story tracks stick, finish, and adapt to a short viewport without covering the next section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./#persist");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#persist")).toHaveAttribute("data-scene-ready", "true", { timeout: 15_000 });
  const grid = page.locator("#persist .story__grid");
  await expect(grid).toHaveCSS("position", "sticky");
  // Exercise the visitor's wheel path through Lenis. A synthetic scrollTo
  // can race the initial fragment alignment without marking user interaction.
  await page.mouse.move(10, 100);
  await expect.poll(async () => {
    const remaining = await page.evaluate(() => {
      const track = document.querySelector("#persist .story__track")!;
      return track.getBoundingClientRect().bottom - innerHeight;
    });
    if (remaining >= 0) await page.mouse.wheel(0, Math.max(180, remaining + 32));
    // Mobile emulation can scale wheel distances; measure where we landed.
    return remaining;
  }, { timeout: 15_000, intervals: [500] }).toBeLessThan(0);
  await expect(page.locator("#persist [data-pct]")).toHaveText("100");
  await page.setViewportSize({ width: 1440, height: 650 });
  await expect(grid).toHaveCSS("position", "static");
  await page.goto("./#compare");
  const navBottom = await page.locator(".nav").evaluate((el) => el.getBoundingClientRect().bottom);
  const heading = page.locator("#compare-title");
  await expect(heading).toHaveCSS("opacity", "1");
  expect(await heading.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(navBottom);
});

test("scrolls every section without runtime errors or invisible headings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("./");
  for (const id of ["try", "persist", "panels", "assistant", "security", "themes", "sections", "compare", "install"]) {
    const section = page.locator(`#${id}`);
    await section.evaluate((el) => el.scrollIntoView());
    const heading = section.locator("h2").first();
    // On phones the scene comes before its heading and can fill a screen.
    // Bring the heading into view before judging its viewport reveal.
    await heading.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect(heading).toHaveCSS("opacity", "1");
  }
  expect(errors).toEqual([]);
});

test("reduced motion shows the finished stories and comparison immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./#persist");
  await expect(page.locator("#persist .story__grid")).toHaveCSS("position", "static");
  await expect(page.locator("#persist [data-pct]")).toHaveText("100");
  await expect(page.locator("#persist-title")).toHaveCSS("opacity", "1");
  await page.goto("./#compare");
  await expect(page.locator("#compare-title")).toHaveCSS("opacity", "1");
  await expect(page.locator(".cmp__scroll")).toHaveCSS("opacity", "1");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("shows the default theme and all section content", async ({ page }) => {
    await page.goto("./#compare");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "contrast");
    await expect(page.locator("#compare-title")).toHaveCSS("opacity", "1");
    await expect(page.locator(".cmp__scroll")).toHaveCSS("opacity", "1");
    await expect(page.locator("#persist .story__grid")).toHaveCSS("position", "static");
  });
});
