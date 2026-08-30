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
    const grid = screen.getByRole("list", { name: /apps/i });
    for (const app of APPS) {
      expect(within(grid).getByText(app.name)).toBeInTheDocument();
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
    expect(screen.getByRole("list", { name: /apps/i })).toBeInTheDocument();
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
