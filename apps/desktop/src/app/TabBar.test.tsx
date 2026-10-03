import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { TabBar } from "./TabBar";
import { useTabs } from "./tabStore";

describe("TabBar", () => {
  beforeEach(() => useTabs.setState({ tabs: [], activeId: null }));

  it("invites the user to open a terminal when nothing is open", () => {
    render(<TabBar />);
    expect(screen.getByRole("button", { name: /new terminal/i })).toBeInTheDocument();
  });

  it("marks a private tab so it is never mistaken for an ordinary one", () => {
    useTabs.getState().openPrivateTab("Scratch");
    render(<TabBar />);
    const tab = screen.getByRole("tab", { name: /Scratch/ });
    expect(within(tab).getByText(/private/i)).toBeInTheDocument();
    expect(tab).toHaveAccessibleName(/private/i);
  });

  it("marks a tab with a pane on another machine", () => {
    useTabs.getState().openRemoteTab("host-1", "prod");
    render(<TabBar />);
    const tab = screen.getByRole("tab", { name: /prod/ });
    expect(within(tab).getByText(/remote/i)).toBeInTheDocument();
    expect(tab).toHaveAccessibleName(/remote/i);
  });

  it("does not mark an ordinary tab as remote", () => {
    useTabs.getState().openTab("terminal", "Terminal 1");
    render(<TabBar />);
    expect(within(screen.getByRole("tab", { name: /Terminal 1/ })).queryByText(/remote/i)).toBeNull();
  });

  it("shows an open tab and marks it selected", () => {
    useTabs.getState().openTab("terminal", "Terminal 1");
    render(<TabBar />);
    expect(screen.getByRole("tab", { name: /Terminal 1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("focuses a tab when it is clicked", async () => {
    const a = useTabs.getState().openTab("terminal", "Terminal 1");
    useTabs.getState().openTab("terminal", "Terminal 2");
    render(<TabBar />);

    await userEvent.setup().click(screen.getByRole("tab", { name: /Terminal 1/ }));
    expect(useTabs.getState().activeId).toBe(a);
  });

  it("closes a tab by clicking its close glyph", async () => {
    useTabs.getState().openTab("terminal", "Terminal 1");
    useTabs.getState().openTab("terminal", "Terminal 2");
    render(<TabBar />);

    const tab = screen.getByRole("tab", { name: /Terminal 1/ });
    await userEvent.setup().click(within(tab).getByText("\u00d7"));
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(["Terminal 2"]);
  });

  it("closes the focused tab with Delete", async () => {
    useTabs.getState().openTab("terminal", "Terminal 1");
    useTabs.getState().openTab("terminal", "Terminal 2");
    render(<TabBar />);

    const user = userEvent.setup();
    screen.getByRole("tab", { name: /Terminal 1/ }).focus();
    await user.keyboard("{Delete}");
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(["Terminal 2"]);
  });

  it("advertises the delete shortcut to assistive technology", () => {
    useTabs.getState().openTab("terminal", "Terminal 1");
    render(<TabBar />);
    expect(screen.getByRole("tab", { name: /Terminal 1/ })).toHaveAttribute(
      "aria-keyshortcuts",
      "Delete",
    );
  });

  it("opens a new terminal from the add control", async () => {
    render(<TabBar />);
    await userEvent.setup().click(screen.getByRole("button", { name: /new terminal/i }));
    expect(useTabs.getState().tabs).toHaveLength(1);
  });
});
