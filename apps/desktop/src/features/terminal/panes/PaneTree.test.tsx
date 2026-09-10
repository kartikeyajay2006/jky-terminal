import { fireEvent, render, screen } from "@testing-library/react";
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

/*
 * A pointer event carrying coordinates.
 *
 * jsdom implements no PointerEvent, so `fireEvent.pointerMove` produces a
 * plain Event with no clientX on it — and the drag arithmetic quietly
 * becomes NaN. A MouseEvent has the coordinates and the same type name,
 * which is all the listener reads.
 */
const pointer = (type: string, x: number, y: number) =>
  fireEvent(window, new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

describe("resizing and moving", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: [], activeId: null });
  });

  it("drags a divider with the pointer", async () => {
    const { tabId, panes } = openSplitTab();
    const { container } = render(
      <PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[0]} live />,
    );

    const separator = container.querySelector<HTMLElement>(".panes__splitter")!;
    // jsdom has no layout, so the box the drag measures against is stubbed.
    const surface = container.querySelector<HTMLElement>(".panes")!;
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 500 }) as DOMRect;

    fireEvent.pointerDown(separator);
    pointer("pointermove", 750, 250);
    pointer("pointerup", 750, 250);

    const split = treeOf(tabId) as Extract<Pane, { kind: "split" }>;
    expect(split.ratio).toBeCloseTo(0.75, 2);
  });

  it("keeps dragging when the pointer outruns the divider", () => {
    // A two-pixel target and a fast hand: the drag is tracked on the window,
    // so leaving the divider does not drop it.
    const { tabId, panes } = openSplitTab();
    const { container } = render(
      <PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[0]} live />,
    );

    const separator = container.querySelector<HTMLElement>(".panes__splitter")!;
    const surface = container.querySelector<HTMLElement>(".panes")!;
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 500 }) as DOMRect;

    fireEvent.pointerDown(separator);
    // Far outside the 15px grab area, and vertically off it entirely.
    pointer("pointermove", 300, 480);
    pointer("pointerup", 300, 480);

    expect((treeOf(tabId) as Extract<Pane, { kind: "split" }>).ratio).toBeCloseTo(0.3, 2);
  });

  it("swaps two terminals when one is Ctrl-dragged onto the other", () => {
    const { tabId, panes } = openSplitTab();
    const { container } = render(
      <PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[0]} live />,
    );

    const boxes = container.querySelectorAll<HTMLElement>(".panes__pane");
    // elementsFromPoint has no meaning without layout, so the drop target is
    // named directly — the geometry is xterm's problem, not this component's.
    document.elementsFromPoint = () => [boxes[1]];

    fireEvent.mouseDown(boxes[0], { ctrlKey: true });
    pointer("pointermove", 800, 100);
    pointer("pointerup", 800, 100);

    expect(leaves(useTabs.getState().tabs[0].layout)).toEqual([panes[1], panes[0]]);
  });

  it("does not start a move on a plain drag, which is a text selection", () => {
    const { tabId, panes } = openSplitTab();
    const { container } = render(
      <PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[0]} live />,
    );

    const boxes = container.querySelectorAll<HTMLElement>(".panes__pane");
    document.elementsFromPoint = () => [boxes[1]];

    fireEvent.mouseDown(boxes[0]);
    pointer("pointerup", 800, 100);

    expect(leaves(useTabs.getState().tabs[0].layout)).toEqual(panes);
  });

  it("abandons the move when Ctrl is let go", () => {
    const { tabId, panes } = openSplitTab();
    const { container } = render(
      <PaneTree tabId={tabId} tree={treeOf(tabId)} focused={panes[0]} live />,
    );

    const boxes = container.querySelectorAll<HTMLElement>(".panes__pane");
    document.elementsFromPoint = () => [boxes[1]];

    fireEvent.mouseDown(boxes[0], { ctrlKey: true });
    fireEvent.keyUp(window, { key: "Control" });
    pointer("pointerup", 800, 100);

    expect(leaves(useTabs.getState().tabs[0].layout)).toEqual(panes);
  });

  it("offers no move at all when a tab holds one terminal", () => {
    useTabs.setState({ tabs: [], activeId: null });
    const tabId = useTabs.getState().openTab("terminal", "one");
    const { container } = render(
      <PaneTree tabId={tabId} tree={treeOf(tabId)} focused={tabId} live />,
    );

    const box = container.querySelector<HTMLElement>(".panes__pane")!;
    fireEvent.mouseDown(box, { ctrlKey: true });
    expect(container.querySelector(".panes__hint")).toBeNull();
  });
});
