import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitHub, relativeDay } from "./GitHub";
import { createWebPlatform, __setPlatformForTests } from "../../../platform";
import type { Platform } from "../../../platform/types";

function platformWith(overrides: Partial<Platform["apps"]["github"]>, opened?: string[]): Platform {
  const base = createWebPlatform();
  return {
    ...base,
    apps: { ...base.apps, github: { ...base.apps.github, ...overrides } },
    openExternal: async (url: string) => {
      opened?.push(url);
    },
  };
}

/** Instant typing; the flow's own polling is the only wait here. */
const typist = () => userEvent.setup({ delay: null });

/** A device-flow start, for tests that drive the poll outcome directly. */
const START = {
  user_code: "WDJB-MJHT",
  verification_uri: "https://github.com/login/device",
  interval_s: 1,
  expires_in_s: 900,
};

describe("GitHub", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
  });
  afterEach(() => {
    __setPlatformForTests(null);
  });

  describe("out of the box", () => {
    // An OAuth app ships with the build, so someone who has just installed
    // this can sign in without registering anything first.
    it("goes straight to signing in, with nothing to set up", async () => {
      render(<GitHub />);
      expect(
        await screen.findByRole("button", { name: /sign in to github/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: /client id/i })).not.toBeInTheDocument();
    });

    // Still reachable for anyone who would rather run against their own app.
    it("lets someone use their own OAuth app instead", async () => {
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /use your own oauth app/i }));

      const setup = screen.getByRole("region", { name: /set up github/i });
      expect(within(setup).getByRole("textbox", { name: /client id/i })).toBeInTheDocument();
      expect(setup).toHaveTextContent(/enable device flow/i);
      expect(setup).toHaveTextContent(/no client secret/i);
    });

    it("saves a client id of your own and returns to signing in", async () => {
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /use your own oauth app/i }));
      await user.type(screen.getByRole("textbox", { name: /client id/i }), "Ov23liMINE");
      await user.click(screen.getByRole("button", { name: /save/i }));

      expect(await screen.findByRole("button", { name: /sign in to github/i })).toBeInTheDocument();
    });

    it("comes back from the setup screen without changing anything", async () => {
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /use your own oauth app/i }));
      await user.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(await screen.findByRole("button", { name: /sign in to github/i })).toBeInTheDocument();
    });
  });

  describe("signing in", () => {
    async function configured() {
      const base = createWebPlatform();
      __setPlatformForTests(base);
      return base;
    }

    it("shows the code to type and where to type it", async () => {
      await configured();
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /sign in to github/i }));

      expect(await screen.findByText("WDJB-MJHT")).toBeInTheDocument();
      expect(screen.getByText(/github\.com\/login\/device/i)).toBeInTheDocument();
    });

    // The code is useless unless it can be typed somewhere. Opening the page
    // is the one step this app cannot do for the person.
    it("opens the approval page in the real browser", async () => {
      const base = createWebPlatform();
      const opened: string[] = [];
      __setPlatformForTests({
        ...base,
        openExternal: async (url: string) => {
          opened.push(url);
        },
      });

      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /sign in to github/i }));
      await screen.findByText("WDJB-MJHT");
      await user.click(screen.getByRole("button", { name: /open github/i }));

      expect(opened).toEqual(["https://github.com/login/device"]);
    });

    it("keeps polling until the sign-in is approved, then shows the account", async () => {
      await configured();
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /sign in to github/i }));

      // The mock needs two polls at a one-second interval, which is longer
      // than findBy waits by default.
      expect(
        await screen.findByRole("region", { name: /account/i }, { timeout: 5000 }),
      ).toBeInTheDocument();
    });

    it("says so when the sign-in was refused", async () => {
      __setPlatformForTests(
        platformWith({
          status: async () => ({ configured: true, connected: false }),
          connectStart: async () => START,
          connectPoll: async () => ({ state: "denied" as const }),
        }),
      );
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /sign in to github/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/refused|denied/i);
    });

    it("says so when the code ran out before it was approved", async () => {
      __setPlatformForTests(
        platformWith({
          status: async () => ({ configured: true, connected: false }),
          connectStart: async () => START,
          connectPoll: async () => ({ state: "expired" as const }),
        }),
      );
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /sign in to github/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/expired|ran out/i);
    });

    it("stops polling once the flow has ended, rather than asking for ever", async () => {
      let polls = 0;
      __setPlatformForTests(
        platformWith({
          status: async () => ({ configured: true, connected: false }),
          connectStart: async () => START,
          connectPoll: async () => {
            polls += 1;
            return { state: "denied" as const };
          },
        }),
      );
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /sign in to github/i }));
      await screen.findByRole("alert");

      const settled = polls;
      await new Promise((r) => setTimeout(r, 600));
      expect(polls).toBe(settled);
    });
  });

  describe("once connected", () => {
    async function connected() {
      const base = createWebPlatform();
      await base.apps.github.connectStart();
      await base.apps.github.connectPoll();
      await base.apps.github.connectPoll();
      __setPlatformForTests(base);
      return base;
    }

    it("shows who is signed in", async () => {
      await connected();
      render(<GitHub />);
      const card = await screen.findByRole("region", { name: /account/i });
      expect(within(card).getByText("preview-user")).toBeInTheDocument();
    });

    it("lists repositories, and marks the private ones", async () => {
      await connected();
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /^repositories$/i }));
      const repos = await screen.findByRole("list", { name: /repositories/i });
      expect(within(repos).getByText("jky-terminal")).toBeInTheDocument();
      expect(within(repos).getByText(/private/i)).toBeInTheDocument();
    });

    it("lists open issues and pull requests in sections of their own", async () => {
      await connected();
      const user = typist();
      render(<GitHub />);

      await user.click(await screen.findByRole("button", { name: /^issues$/i }));
      const issues = await screen.findByRole("list", { name: /issues/i });
      expect(within(issues).getByText(/preview issue/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /^pull requests$/i }));
      const pulls = await screen.findByRole("list", { name: /pull requests/i });
      expect(within(pulls).getByText(/preview pull request/i)).toBeInTheDocument();
    });

    it("marks a draft pull request as one", async () => {
      await connected();
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /^pull requests$/i }));
      const pulls = await screen.findByRole("list", { name: /pull requests/i });
      expect(within(pulls).getByText(/draft/i)).toBeInTheDocument();
    });

    // Clicking a repository now opens it here — the files are the reason
    // someone clicks one. Leaving for the browser is a deliberate second step.
    it("opens the repository in the panel rather than the browser", async () => {
      const base = createWebPlatform();
      await base.apps.github.connectStart();
      await base.apps.github.connectPoll();
      await base.apps.github.connectPoll();
      const opened: string[] = [];
      __setPlatformForTests({
        ...base,
        openExternal: async (url: string) => {
          opened.push(url);
        },
      });

      const user = typist();
      render(<GitHub />);
      const repos = await screen.findByRole("list", { name: /repositories/i });
      await user.click(within(repos).getByRole("button", { name: /jky-terminal/i }));

      await screen.findByRole("heading", { name: /preview-user\/jky-terminal/i });
      expect(opened).toEqual([]);
    });

    it("leaves for GitHub only when asked to", async () => {
      const base = createWebPlatform();
      await base.apps.github.connectStart();
      await base.apps.github.connectPoll();
      await base.apps.github.connectPoll();
      const opened: string[] = [];
      __setPlatformForTests({
        ...base,
        openExternal: async (url: string) => {
          opened.push(url);
        },
      });

      const user = typist();
      render(<GitHub />);
      const repos = await screen.findByRole("list", { name: /repositories/i });
      await user.click(within(repos).getByRole("button", { name: /jky-terminal/i }));
      await user.click(await screen.findByRole("button", { name: /open on github/i }));

      expect(opened).toEqual(["https://github.com/preview-user/jky-terminal"]);
    });

    it("shows notifications, with the reason each one is in front of you", async () => {
      await connected();
      const user = typist();
      render(<GitHub />);
      await user.click(await screen.findByRole("button", { name: /^notifications/i }));
      const list = await screen.findByRole("list", { name: /notifications/i });
      expect(within(list).getByText(/something needs your eyes/i)).toBeInTheDocument();
      expect(within(list).getByText(/mention/i)).toBeInTheDocument();
    });

    describe("the dashboard", () => {
      it("shows the profile card with the name and bio", async () => {
        await connected();
        render(<GitHub />);
        const card = await screen.findByRole("region", { name: /account/i });
        expect(within(card).getByText("preview-user")).toBeInTheDocument();
        expect(within(card).getByText(/focus . build . ship/i)).toBeInTheDocument();
      });

      // The counts a GitHub profile leads with, each in its own box.
      it("shows the overview tiles", async () => {
        await connected();
        render(<GitHub />);
        const overview = await screen.findByRole("region", { name: /overview/i });
        for (const [label, value] of [
          ["Repositories", "27"],
          ["Followers", "142"],
          ["Following", "98"],
          ["Stars", "12"],
          ["Contributions", "1,337"],
        ]) {
          const tile = within(overview).getByRole("group", { name: new RegExp(label, "i") });
          expect(within(tile).getByText(value)).toBeInTheDocument();
        }
      });

      it("draws the contribution heatmap", async () => {
        await connected();
        render(<GitHub />);
        const heat = await screen.findByRole("img", { name: /contributions in the last year/i });
        expect(heat.querySelectorAll("[data-level]").length).toBe(42);
      });

      // A heatmap that renders a blank grid when GraphQL declines looks
      // broken. Saying so is better than showing an empty year.
      it("says so when the heatmap could not be loaded", async () => {
        const base = createWebPlatform();
        await base.apps.github.connectStart();
        await base.apps.github.connectPoll();
        await base.apps.github.connectPoll();
        const full = await base.apps.github.summary();
        __setPlatformForTests({
          ...base,
          apps: {
            ...base.apps,
            github: {
              ...base.apps.github,
              summary: async () => ({ ...full, contributions: null }),
            },
          },
        });
        render(<GitHub />);
        await screen.findByRole("region", { name: /overview/i });
        expect(screen.queryByRole("img", { name: /contributions/i })).not.toBeInTheDocument();
        expect(screen.getByText(/contribution graph is unavailable/i)).toBeInTheDocument();
      });

      it("shows the activity feed as sentences", async () => {
        await connected();
        render(<GitHub />);
        const feed = await screen.findByRole("list", { name: /activity/i });
        expect(within(feed).getByText(/pushed to/i)).toBeInTheDocument();
        expect(within(feed).getByText(/merged pr/i)).toBeInTheDocument();
      });

      it("lists the sections in a sidebar you can move between", async () => {
        await connected();
        const user = typist();
        render(<GitHub />);
        const nav = await screen.findByRole("navigation", { name: /github sections/i });
        expect(within(nav).getByRole("button", { name: /dashboard/i })).toBeInTheDocument();

        await user.click(within(nav).getByRole("button", { name: /repositories/i }));
        expect(await screen.findByRole("list", { name: /repositories/i })).toBeInTheDocument();
        // The overview belongs to the dashboard, so moving away leaves it.
        expect(screen.queryByRole("region", { name: /overview/i })).not.toBeInTheDocument();
      });

      it("marks the section being shown", async () => {
        await connected();
        const user = typist();
        render(<GitHub />);
        const nav = await screen.findByRole("navigation", { name: /github sections/i });
        await user.click(within(nav).getByRole("button", { name: /pull requests/i }));
        expect(within(nav).getByRole("button", { name: /pull requests/i })).toHaveAttribute(
          "aria-current",
          "true",
        );
      });

      it("counts unread notifications beside the sidebar entry", async () => {
        await connected();
        render(<GitHub />);
        const nav = await screen.findByRole("navigation", { name: /github sections/i });
        expect(within(nav).getByRole("button", { name: /notifications/i })).toHaveTextContent("1");
      });
    });

    describe("browsing a repository", () => {
      // The dashboard shows the five most recent; the section shows them all.
      // Either is a fine way in, and the dashboard is fewer clicks.
      async function openRepo(user: ReturnType<typeof userEvent.setup>) {
        const repos = await screen.findByRole("list", { name: /repositories/i });
        await user.click(within(repos).getByRole("button", { name: /jky-terminal/i }));
      }

      it("opens the repository when its row is chosen", async () => {
        await connected();
        const user = typist();
        render(<GitHub />);
        await openRepo(user);

        expect(
          await screen.findByRole("heading", { name: /preview-user\/jky-terminal/i }),
        ).toBeInTheDocument();
      });

      it("lists the files at the root", async () => {
        await connected();
        const user = typist();
        render(<GitHub />);
        await openRepo(user);

        const files = await screen.findByRole("list", { name: /files/i });
        expect(within(files).getByText("src")).toBeInTheDocument();
        expect(within(files).getByText("README.md")).toBeInTheDocument();
      });

      it("walks into a folder and back out again", async () => {
        await connected();
        const user = typist();
        render(<GitHub />);
        await openRepo(user);

        const files = await screen.findByRole("list", { name: /files/i });
        await user.click(within(files).getByRole("button", { name: /src/i }));
        expect(
          await within(await screen.findByRole("list", { name: /files/i })).findByText("main.rs"),
        ).toBeInTheDocument();

        // The breadcrumb is how you get back; a browser with no way up is a
        // browser you have to leave and re-enter.
        await user.click(screen.getByRole("button", { name: /^root$/i }));
        expect(
          await within(await screen.findByRole("list", { name: /files/i })).findByText("README.md"),
        ).toBeInTheDocument();
      });

      it("shows a file's contents when it is chosen", async () => {
        await connected();
        const user = typist();
        render(<GitHub />);
        await openRepo(user);

        const files = await screen.findByRole("list", { name: /files/i });
        await user.click(within(files).getByRole("button", { name: /README\.md/i }));

        expect(await screen.findByText(/contents shown by the browser build/i)).toBeInTheDocument();
      });

      it("shows the commits", async () => {
        await connected();
        const user = typist();
        render(<GitHub />);
        await openRepo(user);
        await user.click(await screen.findByRole("tab", { name: /commits/i }));

        const commits = await screen.findByRole("list", { name: /commits/i });
        expect(within(commits).getByText(/a preview commit/i)).toBeInTheDocument();
        expect(within(commits).getByText("9f6aaa2")).toBeInTheDocument();
      });

      it("shows the branches, and marks the protected one", async () => {
        await connected();
        const user = typist();
        render(<GitHub />);
        await openRepo(user);
        await user.click(await screen.findByRole("tab", { name: /branches/i }));

        const branches = await screen.findByRole("list", { name: /branches/i });
        expect(within(branches).getByText("main")).toBeInTheDocument();
        expect(within(branches).getByText(/protected/i)).toBeInTheDocument();
      });

      it("comes back to the account from a repository", async () => {
        await connected();
        const user = typist();
        render(<GitHub />);
        await openRepo(user);
        await screen.findByRole("heading", { name: /preview-user\/jky-terminal/i });

        await user.click(screen.getByRole("button", { name: /back to your account/i }));
        expect(await screen.findByRole("list", { name: /repositories/i })).toBeInTheDocument();
      });
    });

    it("signs out and comes back to the sign-in screen", async () => {
      await connected();
      const user = typist();
      render(<GitHub />);
      await screen.findByRole("region", { name: /account/i });

      await user.click(screen.getByRole("button", { name: /sign out/i }));
      expect(await screen.findByRole("button", { name: /sign in to github/i })).toBeInTheDocument();
    });

    it("says so and offers a retry when the account cannot be loaded", async () => {
      let attempts = 0;
      const base = createWebPlatform();
      await base.apps.github.connectStart();
      await base.apps.github.connectPoll();
      await base.apps.github.connectPoll();
      __setPlatformForTests({
        ...base,
        apps: {
          ...base.apps,
          github: {
            ...base.apps.github,
            summary: async () => {
              attempts += 1;
              if (attempts === 1) throw new Error("could not reach GitHub");
              return base.apps.github.summary();
            },
          },
        },
      });

      const user = typist();
      render(<GitHub />);
      expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
      await user.click(screen.getByRole("button", { name: /try again/i }));
      await waitFor(() =>
        expect(screen.getByRole("region", { name: /account/i })).toBeInTheDocument(),
      );
    });
  });
});

describe("relativeDay", () => {
  const NOW = Date.parse("2026-08-30T12:00:00Z");

  it("says today for something from this morning", () => {
    expect(relativeDay("2026-08-30T09:00:00Z", NOW)).toBe("today");
  });

  it("says yesterday, then counts days", () => {
    expect(relativeDay("2026-08-29T09:00:00Z", NOW)).toBe("yesterday");
    expect(relativeDay("2026-08-25T09:00:00Z", NOW)).toBe("5 days ago");
  });

  it("switches to weeks and months rather than counting to ninety", () => {
    expect(relativeDay("2026-08-09T09:00:00Z", NOW)).toBe("3 weeks ago");
    expect(relativeDay("2026-05-30T09:00:00Z", NOW)).toBe("3 months ago");
  });

  it("says nothing it cannot work out", () => {
    expect(relativeDay("", NOW)).toBeNull();
    expect(relativeDay("whenever", NOW)).toBeNull();
  });
});
