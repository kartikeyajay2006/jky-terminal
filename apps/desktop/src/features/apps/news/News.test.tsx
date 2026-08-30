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

const stories = () => screen.findByRole("list", { name: /stories/i });

describe("News", () => {
  beforeEach(() => {
    __setPlatformForTests(platformWith({}));
  });
  afterEach(() => {
    __setPlatformForTests(null);
  });

  it("lists the stories it fetched", async () => {
    render(<News />);
    const list = await stories();
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText(/preview headline 1/i)).toBeInTheDocument();
  });

  it("offers the papers the backend knows about", async () => {
    render(<News />);
    const papers = await screen.findByRole("tablist", { name: /papers/i });
    expect(within(papers).getByRole("tab", { name: /^all$/i })).toBeInTheDocument();
    expect(within(papers).getByRole("tab", { name: /the hindu/i })).toBeInTheDocument();
    expect(within(papers).getByRole("tab", { name: /bbc world/i })).toBeInTheDocument();
  });

  it("starts on every paper at once", async () => {
    const asked: (string | null)[] = [];
    const base = createWebPlatform();
    __setPlatformForTests(
      platformWith({
        news: async (source, limit) => {
          asked.push(source);
          return base.apps.news(source, limit);
        },
      }),
    );
    render(<News />);
    await stories();
    expect(asked).toEqual([null]);
  });

  it("fetches just one paper when it is chosen", async () => {
    const asked: (string | null)[] = [];
    const base = createWebPlatform();
    __setPlatformForTests(
      platformWith({
        news: async (source, limit) => {
          asked.push(source);
          return base.apps.news(source, limit);
        },
      }),
    );
    const user = userEvent.setup();
    render(<News />);
    await stories();

    await user.click(screen.getByRole("tab", { name: /bbc world/i }));
    await stories();
    expect(asked).toEqual([null, "bbc"]);
  });

  it("marks the paper being shown", async () => {
    const user = userEvent.setup();
    render(<News />);
    await stories();
    await user.click(screen.getByRole("tab", { name: /bbc world/i }));
    expect(screen.getByRole("tab", { name: /bbc world/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows the section, the paper and where the link goes", async () => {
    render(<News />);
    const list = await stories();
    const first = within(list).getAllByRole("listitem")[0];
    expect(within(first).getByText("National")).toBeInTheDocument();
    expect(within(first).getByText(/the hindu/i)).toBeInTheDocument();
    expect(within(first).getByText("example.com")).toBeInTheDocument();
  });

  it("shows the summary where the paper sent one", async () => {
    render(<News />);
    const list = await stories();
    expect(within(list).getByText(/a short line about story 1/i)).toBeInTheDocument();
  });

  // The story is not embedded — there is no Browser app — so following one
  // hands the URL to the OS, the same path a terminal link takes.
  it("hands a story's link to the operating system", async () => {
    const opened: string[] = [];
    __setPlatformForTests(platformWith({}, opened));
    const user = userEvent.setup();
    render(<News />);
    await stories();

    await user.click(screen.getByRole("button", { name: /preview headline 1/i }));
    expect(opened).toEqual(["https://example.com/1"]);
  });

  it("fetches again when refreshed", async () => {
    let calls = 0;
    const base = createWebPlatform();
    __setPlatformForTests(
      platformWith({
        news: async (source, limit) => {
          calls += 1;
          return base.apps.news(source, limit);
        },
      }),
    );
    const user = userEvent.setup();
    render(<News />);
    await stories();
    expect(calls).toBe(1);

    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await stories();
    expect(calls).toBe(2);
  });

  it("says so and offers a retry when the fetch fails", async () => {
    let attempts = 0;
    const base = createWebPlatform();
    __setPlatformForTests(
      platformWith({
        news: async (source, limit) => {
          attempts += 1;
          if (attempts === 1) throw new Error("none of the papers could be reached");
          return base.apps.news(source, limit);
        },
      }),
    );
    const user = userEvent.setup();
    render(<News />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/none of the papers/i);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await stories()).toBeInTheDocument();
  });

  // Losing the source list should not take the headlines with it: the tabs
  // are a convenience, the stories are the point.
  it("still shows the news when the paper list cannot be loaded", async () => {
    __setPlatformForTests(
      platformWith({
        newsSources: async () => {
          throw new Error("could not list the papers");
        },
      }),
    );
    render(<News />);
    expect(await stories()).toBeInTheDocument();
  });
});

describe("sinceLabel", () => {
  const NOW = Date.parse("Sun, 30 Aug 2026 12:00:00 +0000");

  it("reads the date format feeds actually send", () => {
    expect(sinceLabel("Sun, 30 Aug 2026 11:00:00 +0000", NOW)).toBe("1h ago");
  });

  it("counts minutes, hours and days", () => {
    expect(sinceLabel("Sun, 30 Aug 2026 11:58:00 +0000", NOW)).toBe("2m ago");
    expect(sinceLabel("Sun, 30 Aug 2026 09:00:00 +0000", NOW)).toBe("3h ago");
    expect(sinceLabel("Fri, 28 Aug 2026 12:00:00 +0000", NOW)).toBe("2d ago");
  });

  it("respects the offset a paper publishes in", () => {
    // 17:30 in +05:30 is 12:00 UTC — the same instant, not five hours ago.
    expect(sinceLabel("Sun, 30 Aug 2026 17:30:00 +0530", NOW)).toBe("just now");
  });

  it("reads a future timestamp as just now, because clocks disagree", () => {
    expect(sinceLabel("Sun, 30 Aug 2026 12:05:00 +0000", NOW)).toBe("just now");
  });

  it("says nothing when the paper sent no date it can read", () => {
    expect(sinceLabel(null, NOW)).toBeNull();
    expect(sinceLabel("whenever", NOW)).toBeNull();
  });
});
