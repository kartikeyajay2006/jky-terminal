import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabs } from "../../../app/tabStore";
import { PaneTree } from "./PaneTree";
import { leaves, type Pane } from "./tree";

/*
 * A terminal is a shell in a canvas, and none of what this component is
 * responsible for needs one. Standing one up would drag in the whole xterm
 * mock to test arithmetic about rectangles.
 */
vi.mock("../Terminal", () => ({
  Terminal: ({ paneId, focused }: { paneId: string; focused?: boolean }) => (
    <div data-testid="terminal" data-pane={paneId} data-focused={focused ? "true" : "false"} />
  ),
}));

function openSplitTab(): { tabId: string; panes: string[] } {
  useTabs.setState({ tabs: [], activeId: null });
  const tabId = useTabs.getState().openTab("terminal", "one");
  useTabs.getState().splitPane(tabId, tabId, "row");
  return { tabId, panes: leaves(useTabs.getState().tabs[0].layout) };
}

const treeOf = (tabId: string): Pane => useTabs.getState().tabs.find((t) => t.id === tabId)!.layout;

describe("PaneTree", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: [], activeId: null });
  });

  it("draws one terminal per leaf", () => {
    const { tabId, panes } = openSplitTab();
    render(<PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[1]} live />);

    const terminals = screen.getAllByTestId("terminal");
    expect(terminals.map((t) => t.dataset.pane)).toEqual(panes);
  });

  it("marks exactly one pane focused", () => {
    const { tabId, panes } = openSplitTab();
    render(<PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[1]} live />);

    const focused = screen.getAllByTestId("terminal").filter((t) => t.dataset.focused === "true");
    expect(focused).toHaveLength(1);
    expect(focused[0].dataset.pane).toBe(panes[1]);
  });

  it("focuses nothing while its tab is in the background", () => {
    // Every tab stays mounted so its shells keep running. Without this, a
    // keystroke would land in whichever hidden tab most recently rendered.
    const { tabId, panes } = openSplitTab();
    render(<PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[1]} live={false} />);

    expect(screen.getAllByTestId("terminal").every((t) => t.dataset.focused === "false")).toBe(true);
  });

  it("places the two halves side by side, losing none of the box", () => {
    const { tabId, panes } = openSplitTab();
    const { container } = render(
      <PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[0]} live />,
    );

    const boxes = Array.from(container.querySelectorAll<HTMLElement>(".panes__pane"));
    expect(boxes[0].style.left).toBe("0%");
    expect(boxes[0].style.width).toBe("50%");
    expect(boxes[1].style.left).toBe("50%");
    expect(boxes[1].style.width).toBe("50%");
  });

  it("offers one separator per split, and none when nothing is split", () => {
    const { tabId, panes } = openSplitTab();
    const { container, rerender } = render(
      <PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[0]} live />,
    );
    expect(container.querySelectorAll(".panes__splitter")).toHaveLength(1);

    useTabs.getState().closePane(tabId, panes[1]);
    rerender(<PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[0]} live />);
    expect(container.querySelectorAll(".panes__splitter")).toHaveLength(0);
  });

  it("resizes from the keyboard, so a split can be balanced without a mouse", async () => {
    const user = userEvent.setup();
    const { tabId, panes } = openSplitTab();
    render(<PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[0]} live />);

    const separator = screen.getByRole("separator");
    separator.focus();
    await user.keyboard("{ArrowRight}");

    const split = treeOf(tabId) as Extract<Pane, { kind: "split" }>;
    expect(split.ratio).toBeGreaterThan(0.5);
  });

  it("says which way each separator moves, for assistive technology", () => {
    const { tabId, panes } = openSplitTab();
    render(<PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[0]} live />);

    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuenow", "50");
  });

  it("moves focus to the pane that was clicked", async () => {
    const user = userEvent.setup();
    const { tabId, panes } = openSplitTab();
    const { container } = render(
      <PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[1]} live />,
    );

    await user.click(container.querySelectorAll<HTMLElement>(".panes__pane")[0]);
    expect(useTabs.getState().tabs[0].focusedPane).toBe(panes[0]);
  });
});
