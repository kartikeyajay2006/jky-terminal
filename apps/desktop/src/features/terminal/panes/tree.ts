/**
 * The shape of a split terminal.
 *
 * A tab is not one terminal any more; it is a tree whose leaves are
 * terminals and whose branches are the lines drawn between them. Every
 * operation here is pure and returns a new tree, which is what makes the
 * awkward cases — closing the pane you are focused on, collapsing a branch
 * that has only one child left — testable without a DOM.
 */

/** Which way a split lays its two children out. */
export type Direction = "row" | "column";

/**
 * One terminal, or one line with a tree on each side.
 *
 * Splits carry an id of their own, not just their children. Without one
 * there is no way to name the divider being dragged, and dragging would
 * have to address a branch by its path — which changes the moment anything
 * above it closes.
 */
export type Pane =
  | { kind: "leaf"; id: string }
  | { kind: "split"; id: string; dir: Direction; ratio: number; a: Pane; b: Pane };

/** Where a pane ended up, in fractions of the box the tree was given. */
export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How small a pane is allowed to get, as a fraction of its parent.
 *
 * Not zero. A pane dragged to nothing is a terminal you cannot see and
 * cannot get back without closing it, and a shell is still running in it.
 */
export const MIN_RATIO = 0.1;
export const MAX_RATIO = 1 - MIN_RATIO;

export function leaf(id: string): Pane {
  return { kind: "leaf", id };
}

/** Every terminal in the tree, left to right and top to bottom. */
export function leaves(pane: Pane): string[] {
  if (pane.kind === "leaf") return [pane.id];
  return [...leaves(pane.a), ...leaves(pane.b)];
}

export function countLeaves(pane: Pane): number {
  return pane.kind === "leaf" ? 1 : countLeaves(pane.a) + countLeaves(pane.b);
}

export function hasLeaf(pane: Pane, id: string): boolean {
  if (pane.kind === "leaf") return pane.id === id;
  return hasLeaf(pane.a, id) || hasLeaf(pane.b, id);
}

/**
 * Put a new terminal beside an existing one.
 *
 * The new pane always takes the second half, so a split reads the way it was
 * asked for: "split right" puts the new terminal on the right, every time,
 * rather than wherever the tree happened to be balanced.
 */
export function splitLeaf(
  pane: Pane,
  targetId: string,
  newId: string,
  dir: Direction,
  splitId: string,
): Pane {
  if (pane.kind === "leaf") {
    if (pane.id !== targetId) return pane;
    return { kind: "split", id: splitId, dir, ratio: 0.5, a: pane, b: leaf(newId) };
  }
  return {
    ...pane,
    a: splitLeaf(pane.a, targetId, newId, dir, splitId),
    b: splitLeaf(pane.b, targetId, newId, dir, splitId),
  };
}

/**
 * Take a terminal out of the tree.
 *
 * Null means the tab has nothing left in it — the caller closes the tab.
 * A split that loses one child is replaced by the other rather than kept
 * with a hole in it, or the tree would grow a spine of one-child branches
 * that each still draw a divider.
 */
export function closeLeaf(pane: Pane, id: string): Pane | null {
  if (pane.kind === "leaf") return pane.id === id ? null : pane;

  const a = closeLeaf(pane.a, id);
  const b = closeLeaf(pane.b, id);
  if (a === null) return b;
  if (b === null) return a;
  if (a === pane.a && b === pane.b) return pane;
  return { ...pane, a, b };
}

/**
 * Exchange two terminals' places.
 *
 * The leaves swap ids; the shape of the tree does not change at all. That is
 * what makes it safe to do to a running terminal — nothing is created,
 * destroyed or re-parented, so no shell is disturbed and no scrollback moves.
 * The pane you were looking at is simply somewhere else now.
 */
export function swapLeaves(pane: Pane, a: string, b: string): Pane {
  if (a === b) return pane;
  if (!hasLeaf(pane, a) || !hasLeaf(pane, b)) return pane;

  const exchange = (node: Pane): Pane => {
    if (node.kind === "leaf") {
      if (node.id === a) return leaf(b);
      if (node.id === b) return leaf(a);
      return node;
    }
    return { ...node, a: exchange(node.a), b: exchange(node.b) };
  };

  return exchange(pane);
}

/** Move one divider. The ratio is clamped, so a pane cannot be dragged away. */
export function setRatio(pane: Pane, splitId: string, ratio: number): Pane {
  if (pane.kind === "leaf") return pane;
  if (pane.id === splitId) {
    return { ...pane, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) };
  }
  return { ...pane, a: setRatio(pane.a, splitId, ratio), b: setRatio(pane.b, splitId, ratio) };
}

/**
 * Where every pane sits, in fractions of the whole.
 *
 * Fractions rather than pixels because the tree does not know how big the
 * window is, and the two consumers — the renderer, which turns them into
 * percentages, and directional focus, which only compares them — both work
 * fine without knowing either.
 */
export function layout(pane: Pane, box: Omit<Rect, "id"> = { x: 0, y: 0, w: 1, h: 1 }): Rect[] {
  if (pane.kind === "leaf") return [{ id: pane.id, ...box }];

  if (pane.dir === "row") {
    const left = box.w * pane.ratio;
    return [
      ...layout(pane.a, { ...box, w: left }),
      ...layout(pane.b, { ...box, x: box.x + left, w: box.w - left }),
    ];
  }

  const top = box.h * pane.ratio;
  return [
    ...layout(pane.a, { ...box, h: top }),
    ...layout(pane.b, { ...box, y: box.y + top, h: box.h - top }),
  ];
}

/** A draggable line, and the box its two children share. */
export interface Divider {
  id: string;
  dir: Direction;
  ratio: number;
  /** The area the split occupies, so a drag in pixels becomes a ratio. */
  box: Omit<Rect, "id">;
}

/**
 * Every line between two panes.
 *
 * Returned flat, with geometry, for the same reason `layout` is: the
 * renderer draws panes and dividers as two flat lists rather than as nested
 * elements. Nesting would move a terminal in the React tree every time the
 * shape changed, and a terminal that moves is a terminal that unmounts —
 * which disposes its display and kills the shell running in it. Splitting a
 * pane must not cost you the session you split.
 */
export function dividers(
  pane: Pane,
  box: Omit<Rect, "id"> = { x: 0, y: 0, w: 1, h: 1 },
): Divider[] {
  if (pane.kind === "leaf") return [];

  const here: Divider = { id: pane.id, dir: pane.dir, ratio: pane.ratio, box };

  if (pane.dir === "row") {
    const left = box.w * pane.ratio;
    return [
      here,
      ...dividers(pane.a, { ...box, w: left }),
      ...dividers(pane.b, { ...box, x: box.x + left, w: box.w - left }),
    ];
  }

  const top = box.h * pane.ratio;
  return [
    here,
    ...dividers(pane.a, { ...box, h: top }),
    ...dividers(pane.b, { ...box, y: box.y + top, h: box.h - top }),
  ];
}

export type Side = "left" | "right" | "up" | "down";

/**
 * The pane one step in a direction, or null at the edge.
 *
 * Geometric rather than structural: "the pane to my right" means the one
 * that is drawn to the right, which is not always this pane's sibling. In a
 * tab split right and then split down on the left, moving right from either
 * left pane should reach the right-hand one, and the tree says they are not
 * related at all.
 *
 * Ties — two panes equally to the right — are broken by whichever overlaps
 * this pane's midpoint, so moving right and then left comes back.
 */
export function neighbour(pane: Pane, fromId: string, side: Side): string | null {
  const rects = layout(pane);
  const from = rects.find((r) => r.id === fromId);
  if (!from) return null;

  const horizontal = side === "left" || side === "right";
  const midCross = horizontal ? from.y + from.h / 2 : from.x + from.w / 2;

  let best: Rect | null = null;
  let bestGap = Infinity;

  for (const r of rects) {
    if (r.id === fromId) continue;

    // Must lie in the direction asked for, sharing some of the other axis:
    // a pane below and to the right is neither right nor down.
    const gap =
      side === "right"
        ? r.x - (from.x + from.w)
        : side === "left"
          ? from.x - (r.x + r.w)
          : side === "down"
            ? r.y - (from.y + from.h)
            : from.y - (r.y + r.h);
    if (gap < -1e-9) continue;

    const overlaps = horizontal
      ? r.y < from.y + from.h - 1e-9 && r.y + r.h > from.y + 1e-9
      : r.x < from.x + from.w - 1e-9 && r.x + r.w > from.x + 1e-9;
    if (!overlaps) continue;

    const spansMid = horizontal
      ? r.y <= midCross && r.y + r.h >= midCross
      : r.x <= midCross && r.x + r.w >= midCross;

    // Nearer wins; at the same distance the one under the midpoint wins,
    // which is the one that looks like it is straight ahead.
    if (gap < bestGap - 1e-9 || (Math.abs(gap - bestGap) < 1e-9 && spansMid)) {
      best = r;
      bestGap = gap;
    }
  }

  return best?.id ?? null;
}

/**
 * The pane to focus once `id` has gone.
 *
 * Its sibling, or the nearest leaf inside that sibling. Focus has to land
 * somewhere the moment a pane closes, and leaving it on a terminal that no
 * longer exists is how a keystroke ends up going nowhere.
 */
export function focusAfterClose(pane: Pane, id: string): string | null {
  const remaining = closeLeaf(pane, id);
  if (remaining === null) return null;

  const sibling = siblingOf(pane, id);
  if (sibling) return leaves(sibling)[0] ?? null;
  return leaves(remaining)[0] ?? null;
}

function siblingOf(pane: Pane, id: string): Pane | null {
  if (pane.kind === "leaf") return null;
  if (pane.a.kind === "leaf" && pane.a.id === id) return pane.b;
  if (pane.b.kind === "leaf" && pane.b.id === id) return pane.a;
  return siblingOf(pane.a, id) ?? siblingOf(pane.b, id);
}

/**
 * Read a tree back from storage.
 *
 * Anything that is not a tree becomes null rather than throwing: a layout
 * saved by a newer build, or half-written when the machine went down, must
 * not stop the app from starting.
 */
export function parsePane(value: unknown): Pane | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;

  if (p.kind === "leaf") {
    return typeof p.id === "string" ? leaf(p.id) : null;
  }
  if (p.kind !== "split") return null;
  if (typeof p.id !== "string") return null;
  if (p.dir !== "row" && p.dir !== "column") return null;
  if (typeof p.ratio !== "number" || !Number.isFinite(p.ratio)) return null;

  const a = parsePane(p.a);
  const b = parsePane(p.b);
  if (!a || !b) return null;

  return {
    kind: "split",
    id: p.id,
    dir: p.dir,
    ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, p.ratio)),
    a,
    b,
  };
}
