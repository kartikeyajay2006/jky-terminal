import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { News, sinceLabel } from "./News";
import { createWebPlatform, __setPlatformForTests } from "../../../platform";
import type { Platform } from "../../../platform/types";

function platformWith(overrides: Partial<Platform["apps"]>, opened?: string[]): Platform {
  const base = createWebPlatform();
  return {
    ...base,
    apps: { ...base.apps, ...overrides },
    openExternal: async (url: string) => {
      opened?.push(url);
    },
  };
}

describe("News", () => {
  beforeEach(() => {
    __setPlatformForTests(platformWith({}));
  });
  afterEach(() => {
    __setPlatformForTests(null);
  });

  it("lists the headlines it fetched", async () => {
    render(<News />);
    const list = await screen.findByRole("list", { name: /headlines/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText(/preview headline 1/i)).toBeInTheDocument();
  });

  it("shows where a link goes before you follow it", async () => {
    render(<News />);
    await screen.findByRole("list", { name: /headlines/i });
    expect(screen.getAllByText("example.com").length).toBeGreaterThan(0);
  });

  it("shows the score and the number of replies", async () => {
    render(<News />);
    const list = await screen.findByRole("list", { name: /headlines/i });
    expect(within(list).getByText(/100 points/i)).toBeInTheDocument();
    expect(within(list).getByText(/10 comments/i)).toBeInTheDocument();
  });

  // The article is not embedded — there is no Browser app yet — so following
  // a headline hands the URL to the OS, the same path a terminal link takes.
  it("hands a headline's link to the operating system", async () => {
    const opened: string[] = [];
    __setPlatformForTests(platformWith({}, opened));
    const user = userEvent.setup();
    render(<News />);
    await screen.findByRole("list", { name: /headlines/i });

    await user.click(screen.getByRole("button", { name: /preview headline 1/i }));
    expect(opened).toEqual(["https://example.com/1"]);
  });

  it("opens the discussion rather than the article when asked", async () => {
    const opened: string[] = [];
    __setPlatformForTests(platformWith({}, opened));
    const user = userEvent.setup();
    render(<News />);
    await screen.findByRole("list", { name: /headlines/i });

    const first = within(await screen.findByRole("list", { name: /headlines/i })).getAllByRole(
      "listitem",
    )[0];
    await user.click(within(first).getByRole("button", { name: /10 comments/i }));
    expect(opened).toEqual(["https://news.ycombinator.com/item?id=1"]);
  });

  // An Ask HN post has no article: the discussion is the article, so the
  // headline itself must lead there rather than doing nothing.
  it("sends a post with no link to its discussion instead", async () => {
    const opened: string[] = [];
    __setPlatformForTests(platformWith({}, opened));
    const user = userEvent.setup();
    render(<News />);
    await screen.findByRole("list", { name: /headlines/i });

    await user.click(screen.getByRole("button", { name: /preview headline 2/i }));
    expect(opened).toEqual(["https://news.ycombinator.com/item?id=2"]);
  });

  it("fetches again when refreshed", async () => {
    let calls = 0;
    const base = createWebPlatform();
    __setPlatformForTests(
      platformWith({
        news: async (limit) => {
          calls += 1;
          return base.apps.news(limit);
        },
      }),
    );
    const user = userEvent.setup();
    render(<News />);
    await screen.findByRole("list", { name: /headlines/i });
    expect(calls).toBe(1);

    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await screen.findByRole("list", { name: /headlines/i });
    expect(calls).toBe(2);
  });

  it("says so and offers a retry when the fetch fails", async () => {
    let attempts = 0;
    const base = createWebPlatform();
    __setPlatformForTests(
      platformWith({
        news: async (limit) => {
          attempts += 1;
          if (attempts === 1) throw new Error("could not reach the news service: offline");
          return base.apps.news(limit);
        },
      }),
    );
    const user = userEvent.setup();
    render(<News />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("list", { name: /headlines/i })).toBeInTheDocument();
  });
});

describe("sinceLabel", () => {
  const NOW = 1_700_000_000;

  it("counts the first minute in seconds", () => {
    expect(sinceLabel(NOW - 5, NOW)).toBe("just now");
    expect(sinceLabel(NOW - 59, NOW)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(sinceLabel(NOW - 60, NOW)).toBe("1m ago");
    expect(sinceLabel(NOW - 3600, NOW)).toBe("1h ago");
    expect(sinceLabel(NOW - 7200, NOW)).toBe("2h ago");
    expect(sinceLabel(NOW - 86_400, NOW)).toBe("1d ago");
  });

  // Clocks disagree, and a story stamped a few seconds in the future should
  // read as new rather than as "-1m ago".
  it("reads a future timestamp as just now", () => {
    expect(sinceLabel(NOW + 30, NOW)).toBe("just now");
  });
});
