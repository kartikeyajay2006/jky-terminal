import { describe, expect, it } from "vitest";
import {
  closeLeaf,
  dividers,
  countLeaves,
  focusAfterClose,
  hasLeaf,
  layout,
  leaf,
  leaves,
  MAX_RATIO,
  MIN_RATIO,
  neighbour,
  parsePane,
  setRatio,
  splitLeaf,
  swapLeaves,
  type Pane,
} from "./tree";

/** One terminal, split right, then the left half split down. */
function tee(): Pane {
  const right = splitLeaf(leaf("a"), "a", "b", "row", "s1");
  return splitLeaf(right, "a", "c", "column", "s2");
}

describe("splitting", () => {
  it("puts the new terminal in the second half, whichever way it goes", () => {
    const split = splitLeaf(leaf("a"), "a", "b", "row", "s1");
    expect(split).toMatchObject({ kind: "split", dir: "row", a: { id: "a" }, b: { id: "b" } });
  });

  it("starts a split even", () => {
    const split = splitLeaf(leaf("a"), "a", "b", "row", "s1");
    expect(split.kind === "split" && split.ratio).toBe(0.5);
  });

  it("splits a leaf buried in the tree, and leaves the rest alone", () => {
    const before = tee();
    const after = splitLeaf(before, "b", "d", "column", "s3");
    expect(leaves(after)).toEqual(["a", "c", "b", "d"]);
    expect(countLeaves(after)).toBe(4);
  });

  it("does nothing when the target is not there", () => {
    const before = tee();
    expect(splitLeaf(before, "zz", "d", "row", "s3")).toEqual(before);
  });
});

describe("closing", () => {
  it("replaces a split with its survivor rather than leaving a hole", () => {
    const split = splitLeaf(leaf("a"), "a", "b", "row", "s1");
    expect(closeLeaf(split, "b")).toEqual(leaf("a"));
  });

  it("says null when the last terminal goes, so the tab can close", () => {
    expect(closeLeaf(leaf("a"), "a")).toBeNull();
  });

  it("collapses only the branch that lost a child", () => {
    const after = closeLeaf(tee(), "c");
    expect(after).toMatchObject({ kind: "split", id: "s1", a: { id: "a" }, b: { id: "b" } });
  });

  it("leaves the tree alone when the id is not in it", () => {
    const before = tee();
    expect(closeLeaf(before, "zz")).toBe(before);
  });
});

describe("ratios", () => {
  it("moves the divider it was asked for and no other", () => {
    const moved = setRatio(tee(), "s2", 0.25);
    const outer = moved as Extract<Pane, { kind: "split" }>;
    expect(outer.ratio).toBe(0.5);
    expect((outer.a as Extract<Pane, { kind: "split" }>).ratio).toBe(0.25);
  });

  it("refuses to drag a pane away to nothing", () => {
    const split = splitLeaf(leaf("a"), "a", "b", "row", "s1");
    expect((setRatio(split, "s1", 0) as Extract<Pane, { kind: "split" }>).ratio).toBe(MIN_RATIO);
    expect((setRatio(split, "s1", 1) as Extract<Pane, { kind: "split" }>).ratio).toBe(MAX_RATIO);
  });
});

describe("layout", () => {
  it("gives a lone terminal the whole box", () => {
    expect(layout(leaf("a"))).toEqual([{ id: "a", x: 0, y: 0, w: 1, h: 1 }]);
  });

  it("divides the box and loses none of it", () => {
    const rects = layout(tee());
    const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(area).toBeCloseTo(1, 10);
  });

  it("puts the second half to the right of the first in a row", () => {
    const [a, b] = layout(splitLeaf(leaf("a"), "a", "b", "row", "s1"));
    expect(a).toEqual({ id: "a", x: 0, y: 0, w: 0.5, h: 1 });
    expect(b).toEqual({ id: "b", x: 0.5, y: 0, w: 0.5, h: 1 });
  });

  it("puts the second half below the first in a column", () => {
    const [a, b] = layout(splitLeaf(leaf("a"), "a", "b", "column", "s1"));
    expect(a).toEqual({ id: "a", x: 0, y: 0, w: 1, h: 0.5 });
    expect(b).toEqual({ id: "b", x: 0, y: 0.5, w: 1, h: 0.5 });
  });
});

describe("directional focus", () => {
  it("reaches a pane that is drawn alongside but is not a sibling", () => {
    // a and c are stacked on the left; b is the whole right-hand side. The
    // tree says b is nobody's sibling, and the eye says it is to the right
    // of both.
    expect(neighbour(tee(), "a", "right")).toBe("b");
    expect(neighbour(tee(), "c", "right")).toBe("b");
  });

  it("comes back to where it started", () => {
    const t = tee();
    const right = neighbour(t, "a", "right");
    expect(right).toBe("b");
    // From b, left lands on whichever of a/c is under b's midpoint.
    expect(neighbour(t, right!, "left")).toBe("c");
  });

  it("stops at the edge instead of wrapping", () => {
    expect(neighbour(tee(), "b", "right")).toBeNull();
    expect(neighbour(tee(), "a", "up")).toBeNull();
  });

  it("moves down between stacked panes", () => {
    expect(neighbour(tee(), "a", "down")).toBe("c");
    expect(neighbour(tee(), "c", "up")).toBe("a");
  });

  it("says nothing when asked about a pane that is not there", () => {
    expect(neighbour(tee(), "zz", "left")).toBeNull();
  });
});

describe("focus after a close", () => {
  it("lands on the sibling", () => {
    const split = splitLeaf(leaf("a"), "a", "b", "row", "s1");
    expect(focusAfterClose(split, "b")).toBe("a");
  });

  it("lands inside the sibling when the sibling is itself split", () => {
    expect(focusAfterClose(tee(), "b")).toBe("a");
  });

  it("says null when nothing is left", () => {
    expect(focusAfterClose(leaf("a"), "a")).toBeNull();
  });
});

describe("reading a saved layout", () => {
  it("comes back the same", () => {
    const before = tee();
    expect(parsePane(JSON.parse(JSON.stringify(before)))).toEqual(before);
  });

  it("refuses a tree with a missing half rather than half-drawing it", () => {
    expect(parsePane({ kind: "split", id: "s", dir: "row", ratio: 0.5, a: leaf("a") })).toBeNull();
  });

  it("refuses nonsense", () => {
    expect(parsePane(null)).toBeNull();
    expect(parsePane("tab-1")).toBeNull();
    expect(parsePane({ kind: "leaf" })).toBeNull();
    expect(parsePane({ kind: "split", id: "s", dir: "sideways", ratio: 0.5, a: leaf("a"), b: leaf("b") })).toBeNull();
    expect(parsePane({ kind: "split", id: "s", dir: "row", ratio: Number.NaN, a: leaf("a"), b: leaf("b") })).toBeNull();
  });

  it("clamps a ratio that would hide a pane", () => {
    const parsed = parsePane({ kind: "split", id: "s", dir: "row", ratio: 0.99, a: leaf("a"), b: leaf("b") });
    expect((parsed as Extract<Pane, { kind: "split" }>).ratio).toBe(MAX_RATIO);
  });
});

describe("membership", () => {
  it("finds a leaf anywhere in the tree", () => {
    expect(hasLeaf(tee(), "c")).toBe(true);
    expect(hasLeaf(tee(), "zz")).toBe(false);
  });
});

describe("dividers", () => {
  it("has none when there is nothing to divide", () => {
    expect(dividers(leaf("a"))).toEqual([]);
  });

  it("names one line per split, with the box its children share", () => {
    const lines = dividers(tee());
    expect(lines.map((d) => d.id)).toEqual(["s1", "s2"]);
    expect(lines[0]).toMatchObject({ dir: "row", ratio: 0.5, box: { x: 0, y: 0, w: 1, h: 1 } });
    // The inner split only owns the left half, so a drag there is measured
    // against half the window rather than all of it.
    expect(lines[1]).toMatchObject({ dir: "column", box: { x: 0, y: 0, w: 0.5, h: 1 } });
  });

  it("gives every pane a line for each split above it", () => {
    const deep = splitLeaf(tee(), "b", "d", "row", "s3");
    expect(dividers(deep)).toHaveLength(3);
    expect(countLeaves(deep)).toBe(4);
  });
});

describe("exchanging two terminals", () => {
  it("puts each where the other was", () => {
    const split = splitLeaf(leaf("a"), "a", "b", "row", "s1");
    expect(leaves(swapLeaves(split, "a", "b"))).toEqual(["b", "a"]);
  });

  it("changes the shape of the tree not at all", () => {
    // Which is what makes it safe to do to a running terminal: nothing is
    // created, destroyed or re-parented, so no shell is disturbed.
    const before = tee();
    const after = swapLeaves(before, "a", "b");

    expect(dividers(after).map((d) => ({ id: d.id, dir: d.dir, ratio: d.ratio }))).toEqual(
      dividers(before).map((d) => ({ id: d.id, dir: d.dir, ratio: d.ratio })),
    );
    expect(countLeaves(after)).toBe(countLeaves(before));
  });

  it("exchanges two that are nowhere near each other in the tree", () => {
    expect(leaves(swapLeaves(tee(), "c", "b"))).toEqual(["a", "b", "c"]);
  });

  it("does nothing when a pane is asked to swap with itself", () => {
    const before = tee();
    expect(swapLeaves(before, "a", "a")).toBe(before);
  });

  it("does nothing when either pane is not in the tree", () => {
    const before = tee();
    expect(swapLeaves(before, "a", "zz")).toBe(before);
    expect(swapLeaves(before, "zz", "a")).toBe(before);
  });

  it("comes back to where it started when done twice", () => {
    const before = tee();
    expect(swapLeaves(swapLeaves(before, "a", "b"), "a", "b")).toEqual(before);
  });
});
