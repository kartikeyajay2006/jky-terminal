import { render, screen } from "@testing-library/react";
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

  it("closes a tab from its close control without focusing it first", async () => {
    useTabs.getState().openTab("terminal", "Terminal 1");
    useTabs.getState().openTab("terminal", "Terminal 2");
    render(<TabBar />);

    await userEvent.setup().click(screen.getByRole("button", { name: /close terminal 1/i }));
    expect(useTabs.getState().tabs.map((t) => t.title)).toEqual(["Terminal 2"]);
  });

  it("opens a new terminal from the add control", async () => {
    render(<TabBar />);
    await userEvent.setup().click(screen.getByRole("button", { name: /new terminal/i }));
    expect(useTabs.getState().tabs).toHaveLength(1);
  });
});
