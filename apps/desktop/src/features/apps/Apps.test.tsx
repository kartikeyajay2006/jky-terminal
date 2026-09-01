import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Apps } from "./Apps";
import { APPS } from "./registry";
import { useNav } from "../../app/navStore";

function switcher() {
  return screen.getByRole("dialog", { name: /switch app/i });
}

describe("Apps", () => {
  beforeEach(() => {
    useNav.setState({ pending: null });
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("shows every app on the grid", () => {
    render(<Apps />);
    const grid = screen.getByRole("region", { name: /^apps$/i });
    for (const app of APPS) {
      expect(within(grid).getByText(app.name)).toBeInTheDocument();
    }
  });

  /*
   * "8 apps · no account needed" stopped being true the moment GitHub
   * arrived, and stayed on screen through Gmail. The counts are derived from
   * the registry now, so the header cannot go stale behind the list again.
   */
  it("counts what is here without claiming none of it needs an account", () => {
    render(<Apps />);
    const head = screen.getByRole("banner", { name: /apps/i });
    expect(head).not.toHaveTextContent(/no account needed/i);
    expect(head).toHaveTextContent(String(APPS.length));
    expect(head).toHaveTextContent(String(APPS.filter((a) => a.auth === "none").length));
  });

  /*
   * The one thing worth knowing before clicking a tile is whether it will ask
   * you to sign in. That fact is already in the registry, so the grid is laid
   * out by it — structure carrying something true rather than eight tiles in
   * an undifferentiated rack.
   */
  it("separates the apps that need an account from the ones that do not", () => {
    render(<Apps />);
    const ready = screen.getByRole("list", { name: /ready to use/i });
    const accounts = screen.getByRole("list", { name: /your accounts/i });

    for (const app of APPS) {
      const where = app.auth === "none" ? ready : accounts;
      expect(within(where).getByText(app.name), `${app.name} is in the wrong group`)
        .toBeInTheDocument();
    }
    expect(within(accounts).getByText("GitHub")).toBeInTheDocument();
    expect(within(accounts).getByText("Gmail")).toBeInTheDocument();
  });

  it("shows every app exactly once", () => {
    const { container } = render(<Apps />);
    const tiles = container.querySelectorAll(".apps__tile");
    expect(tiles).toHaveLength(APPS.length);
  });

  // A group with nothing in it is a heading over empty space.
  it("shows no group heading it has no apps for", () => {
    render(<Apps />);
    for (const name of [/ready to use/i, /your accounts/i]) {
      const list = screen.getByRole("list", { name });
      expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);
    }
  });

  it("opens an app when its tile is chosen", async () => {
    const user = userEvent.setup();
    render(<Apps />);
    await user.click(screen.getByRole("button", { name: new RegExp(APPS[0].name, "i") }));
    expect(screen.getByRole("heading", { name: APPS[0].name })).toBeInTheDocument();
  });

  it("goes back to the grid from an open app", async () => {
    const user = userEvent.setup();
    render(<Apps />);
    await user.click(screen.getByRole("button", { name: new RegExp(APPS[0].name, "i") }));
    await user.click(screen.getByRole("button", { name: /all apps/i }));
    expect(screen.getByRole("region", { name: /^apps$/i })).toBeInTheDocument();
  });

  it("has no switcher open to begin with", async () => {
    const user = userEvent.setup();
    render(<Apps />);
    await user.click(screen.getByRole("button", { name: new RegExp(APPS[0].name, "i") }));
    expect(screen.queryByRole("dialog", { name: /switch app/i })).not.toBeInTheDocument();
  });

  it("opens the switcher from the control beside the open app", async () => {
    const user = userEvent.setup();
    render(<Apps />);
    await user.click(screen.getByRole("button", { name: new RegExp(APPS[0].name, "i") }));
    await user.click(screen.getByRole("button", { name: /switch app/i }));
    expect(switcher()).toBeInTheDocument();
  });

  // The user's requirement, taken literally: switching happens from where you
  // already are, so the switcher lists everything rather than only the rest.
  it("lists every app in the switcher", async () => {
    const user = userEvent.setup();
    render(<Apps />);
    await user.click(screen.getByRole("button", { name: new RegExp(APPS[0].name, "i") }));
    await user.click(screen.getByRole("button", { name: /switch app/i }));
    for (const app of APPS) {
      expect(within(switcher()).getByText(app.name)).toBeInTheDocument();
    }
  });

  it("marks the app that is already open", async () => {
    const user = userEvent.setup();
    render(<Apps />);
    await user.click(screen.getByRole("button", { name: new RegExp(APPS[0].name, "i") }));
    await user.click(screen.getByRole("button", { name: /switch app/i }));
    const current = within(switcher()).getByRole("button", {
      name: new RegExp(APPS[0].name, "i"),
    });
    expect(current).toHaveAttribute("aria-current", "true");
  });

  it("closes the switcher on Escape", async () => {
    const user = userEvent.setup();
    render(<Apps />);
    await user.click(screen.getByRole("button", { name: new RegExp(APPS[0].name, "i") }));
    await user.click(screen.getByRole("button", { name: /switch app/i }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /switch app/i })).not.toBeInTheDocument();
  });

  it("opens the switcher with Ctrl+Shift+A", async () => {
    const user = userEvent.setup();
    render(<Apps />);
    await user.click(screen.getByRole("button", { name: new RegExp(APPS[0].name, "i") }));
    await user.keyboard("{Control>}{Shift>}A{/Shift}{/Control}");
    expect(switcher()).toBeInTheDocument();
  });

  it("closes the switcher once an app has been chosen from it", async () => {
    const user = userEvent.setup();
    render(<Apps />);
    await user.click(screen.getByRole("button", { name: new RegExp(APPS[0].name, "i") }));
    await user.click(screen.getByRole("button", { name: /switch app/i }));
    await user.click(
      within(switcher()).getByRole("button", { name: new RegExp(APPS[0].name, "i") }),
    );
    expect(screen.queryByRole("dialog", { name: /switch app/i })).not.toBeInTheDocument();
  });

  describe("more than one at a time", () => {
    // Scoped to the grid: once an app is open its tab carries the same name,
    // so an unscoped query would match both.
    async function open(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
      const grid = screen.getByRole("region", { name: /^apps$/i });
      await user.click(within(grid).getByRole("button", { name }));
    }

    function tabs() {
      return screen.getByRole("tablist", { name: /open apps/i });
    }

    /** Tabs are closed by their glyph or by Delete, as the terminal's are. */
    async function close(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
      const tab = within(tabs()).getByRole("tab", { name });
      await user.click(within(tab).getByText("×"));
    }

    it("keeps the first app open when a second is opened", async () => {
      const user = userEvent.setup();
      render(<Apps />);
      await open(user, /calculator/i);
      await user.click(screen.getByRole("button", { name: /all apps/i }));
      await open(user, /timer/i);

      expect(within(tabs()).getByRole("tab", { name: /calculator/i })).toBeInTheDocument();
      expect(within(tabs()).getByRole("tab", { name: /timer/i })).toBeInTheDocument();
    });

    it("shows the app whose tab is chosen", async () => {
      const user = userEvent.setup();
      render(<Apps />);
      await open(user, /calculator/i);
      await user.click(screen.getByRole("button", { name: /all apps/i }));
      await open(user, /timer/i);

      await user.click(within(tabs()).getByRole("tab", { name: /calculator/i }));
      expect(within(tabs()).getByRole("tab", { name: /calculator/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    // The whole point of having two open: leaving one does not reset it.
    it("keeps what was typed when you switch away and back", async () => {
      const user = userEvent.setup();
      render(<Apps />);
      await open(user, /calculator/i);
      await user.type(screen.getByRole("textbox", { name: /expression/i }), "6*7");

      await user.click(screen.getByRole("button", { name: /all apps/i }));
      await open(user, /timer/i);
      await user.click(within(tabs()).getByRole("tab", { name: /calculator/i }));

      expect(screen.getByRole("textbox", { name: /expression/i })).toHaveValue("6*7");
    });

    it("opening an app that is already open focuses it rather than opening it twice", async () => {
      const user = userEvent.setup();
      render(<Apps />);
      await open(user, /calculator/i);
      await user.click(screen.getByRole("button", { name: /all apps/i }));
      await open(user, /calculator/i);

      expect(within(tabs()).getAllByRole("tab", { name: /calculator/i })).toHaveLength(1);
    });

    it("closes one app and leaves the other", async () => {
      const user = userEvent.setup();
      render(<Apps />);
      await open(user, /calculator/i);
      await user.click(screen.getByRole("button", { name: /all apps/i }));
      await open(user, /timer/i);

      await close(user, /calculator/i);
      expect(within(tabs()).queryByRole("tab", { name: /calculator/i })).not.toBeInTheDocument();
      expect(within(tabs()).getByRole("tab", { name: /timer/i })).toBeInTheDocument();
    });

    // The close glyph is decorative and hidden from assistive technology, so
    // the keyboard needs its own way out. aria-keyshortcuts advertises it.
    it("closes the focused tab with Delete", async () => {
      const user = userEvent.setup();
      render(<Apps />);
      await open(user, /calculator/i);
      await user.click(screen.getByRole("button", { name: /open another app/i }));
      await open(user, /timer/i);

      within(tabs()).getByRole("tab", { name: /timer/i }).focus();
      await user.keyboard("{Delete}");
      expect(within(tabs()).queryByRole("tab", { name: /timer/i })).not.toBeInTheDocument();
    });

    it("returns to the grid when the last app is closed", async () => {
      const user = userEvent.setup();
      render(<Apps />);
      await open(user, /calculator/i);
      await close(user, /calculator/i);
      expect(screen.getByRole("region", { name: /^apps$/i })).toBeInTheDocument();
    });

    it("moves to a neighbour when the app being shown is closed", async () => {
      const user = userEvent.setup();
      render(<Apps />);
      await open(user, /calculator/i);
      await user.click(screen.getByRole("button", { name: /all apps/i }));
      await open(user, /timer/i);

      await close(user, /timer/i);
      expect(within(tabs()).getByRole("tab", { name: /calculator/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("opens an app from the switcher without closing what is already open", async () => {
      const user = userEvent.setup();
      render(<Apps />);
      await open(user, /calculator/i);
      await user.keyboard("{Control>}{Shift>}A{/Shift}{/Control}");
      await user.click(
        within(screen.getByRole("dialog", { name: /switch app/i })).getByRole("button", {
          name: /timer/i,
        }),
      );

      expect(within(tabs()).getByRole("tab", { name: /calculator/i })).toBeInTheDocument();
      expect(within(tabs()).getByRole("tab", { name: /timer/i })).toBeInTheDocument();
    });

    it("goes back to the grid without closing anything", async () => {
      const user = userEvent.setup();
      render(<Apps />);
      await open(user, /calculator/i);
      await user.click(screen.getByRole("button", { name: /all apps/i }));

      expect(screen.getByRole("region", { name: /^apps$/i })).toBeInTheDocument();
      expect(within(tabs()).getByRole("tab", { name: /calculator/i })).toBeInTheDocument();
    });

    it("brings the open apps back after a remount", async () => {
      const user = userEvent.setup();
      const first = render(<Apps />);
      await open(user, /calculator/i);
      await user.click(screen.getByRole("button", { name: /all apps/i }));
      await open(user, /timer/i);
      first.unmount();

      render(<Apps />);
      expect(within(tabs()).getByRole("tab", { name: /calculator/i })).toBeInTheDocument();
      expect(within(tabs()).getByRole("tab", { name: /timer/i })).toBeInTheDocument();
    });
  });

  it("opens the app the palette asked for", () => {
    useNav.getState().go("apps", APPS[0].id);
    render(<Apps />);
    expect(screen.getByRole("heading", { name: APPS[0].name })).toBeInTheDocument();
  });

  it("remembers the app that was open across a remount", async () => {
    const user = userEvent.setup();
    const first = render(<Apps />);
    await user.click(screen.getByRole("button", { name: new RegExp(APPS[0].name, "i") }));
    first.unmount();

    render(<Apps />);
    expect(screen.getByRole("heading", { name: APPS[0].name })).toBeInTheDocument();
  });
});
