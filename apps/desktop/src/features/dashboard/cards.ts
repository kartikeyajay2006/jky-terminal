import type { EventColour } from "../../platform";

/**
 * The overview board: which cards, in what order, at what size.
 *
 * The same shape as the Apps layout and for the same reasons — plain data,
 * pure operations, reconciled against the registry on every load — but
 * without groups. The overview is one board; a group of one board would be a
 * concept with nothing to do, and "pin" would be a second name for dragging
 * something to the top.
 *
 * The registry is data rather than components. A card's *contents* are React
 * and live in `Overview.tsx`; what is here is everything the editor and the
 * tests need, which is what keeps this readable without rendering anything.
 */

export type CardSize = "small" | "medium" | "large";

const SIZES: CardSize[] = ["small", "medium", "large"];

export interface CardDef {
  id: string;
  title: string;
  glyph: string;
  /** One of the six event colours, so a card is found before it is read. */
  tone: EventColour;
}

export const CARDS: CardDef[] = [
  { id: "calendar", title: "Calendar", glyph: "▦", tone: "azure" },
  { id: "notes", title: "Notes", glyph: "▤", tone: "amber" },
  { id: "reminders", title: "Reminders", glyph: "◔", tone: "violet" },
  { id: "events", title: "Upcoming Events", glyph: "★", tone: "cyan" },
  { id: "todos", title: "Todos", glyph: "☑", tone: "mint" },
  { id: "quick", title: "Quick Actions", glyph: "⚡", tone: "rose" },
];

export interface CardPlacement {
  id: string;
  size: CardSize;
  hidden: boolean;
}

export interface CardLayout {
  version: 1;
  items: CardPlacement[];
}

export const STORAGE_KEY = "jky.dashboard.cards";

/**
 * The board everyone starts with.
 *
 * The arrangement it already had: the calendar first and tall, everything
 * else beside it. The calendar is the only card that is never empty — dates
 * exist whether or not anything has been written yet — which is what makes it
 * the anchor and what stops a new install reading as broken rather than new.
 */
export function defaultCardLayout(): CardLayout {
  return {
    version: 1,
    items: CARDS.map((card) => ({
      id: card.id,
      size: card.id === "calendar" ? "medium" : "small",
      hidden: false,
    })),
  };
}

function copy(layout: CardLayout): CardLayout {
  return { version: 1, items: layout.items.map((i) => ({ ...i })) };
}

/** What the board shows, in the order it shows it. */
export function shownCards(layout: CardLayout): CardPlacement[] {
  return layout.items.filter((i) => !i.hidden);
}

export function moveCard(layout: CardLayout, id: string, toIndex: number): CardLayout {
  const next = copy(layout);
  const from = next.items.findIndex((i) => i.id === id);
  if (from === -1) return layout;

  const [item] = next.items.splice(from, 1);
  // Past the end means the end: dragging into the space below the last card
  // is how anyone asks for "last".
  next.items.splice(Math.min(Math.max(toIndex, 0), next.items.length), 0, item);
  return next;
}

export function setCardSize(layout: CardLayout, id: string, size: CardSize): CardLayout {
  if (!SIZES.includes(size)) return layout;
  const next = copy(layout);
  const item = next.items.find((i) => i.id === id);
  if (!item) return layout;
  item.size = size;
  return next;
}

export function setCardHidden(layout: CardLayout, id: string, hidden: boolean): CardLayout {
  const next = copy(layout);
  const item = next.items.find((i) => i.id === id);
  if (!item) return layout;
  item.hidden = hidden;
  return next;
}

/** Everything hidden becomes visible again. The way back from an empty board. */
export function restoreAllCards(layout: CardLayout): CardLayout {
  const next = copy(layout);
  for (const item of next.items) item.hidden = false;
  return next;
}

/**
 * Bring a stored board up to date with the registry.
 *
 * Cards added since it was saved are appended; ones that no longer exist are
 * dropped. A card that is present but hidden stays hidden — it was hidden on
 * purpose, and re-showing it would make hiding useless the moment anything
 * else changed.
 */
export function reconcileCards(layout: CardLayout): CardLayout {
  const known = new Set(CARDS.map((c) => c.id));
  const next = copy(layout);
  next.items = next.items.filter((i) => known.has(i.id));

  const placed = new Set(next.items.map((i) => i.id));
  for (const card of CARDS) {
    if (!placed.has(card.id)) {
      next.items.push({ id: card.id, size: "small", hidden: false });
    }
  }
  return next;
}

function isCardLayout(value: unknown): value is CardLayout {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.items)) return false;

  return v.items.every((i: unknown) => {
    if (typeof i !== "object" || i === null) return false;
    const item = i as Record<string, unknown>;
    return (
      typeof item.id === "string" &&
      SIZES.includes(item.size as CardSize) &&
      typeof item.hidden === "boolean"
    );
  });
}

export function saveCardLayout(layout: CardLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // A private window has no storage. The arrangement lasts the session.
  }
}

/**
 * The stored board, reconciled — or the default if there is none, or if what
 * is stored is not one.
 *
 * Falling back rather than throwing matters: the failure mode otherwise is a
 * dashboard that opens to nothing, with no way to fix it from inside the app.
 */
export function loadCardLayout(): CardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isCardLayout(parsed)) return reconcileCards(parsed);
    }
  } catch {
    // Unreadable storage, or JSON that is not. Either way, start clean.
  }
  return defaultCardLayout();
}
