import { beforeEach, describe, expect, it } from "vitest";
import {
  CARDS,
  STORAGE_KEY,
  defaultCardLayout,
  loadCardLayout,
  moveCard,
  reconcileCards,
  restoreAllCards,
  saveCardLayout,
  setCardHidden,
  setCardSize,
  shownCards,
} from "./cards";

const ids = (l: { items: { id: string }[] }) => l.items.map((i) => i.id);

describe("the card registry", () => {
  it("gives every card an id, a title and a tone", () => {
    for (const card of CARDS) {
      expect(card.id).toMatch(/^[a-z][a-z-]*$/);
      expect(card.title.trim()).not.toBe("");
      expect(card.tone.trim()).not.toBe("");
    }
  });

  it("gives each card its own colour, so colour identifies it", () => {
    const tones = CARDS.map((c) => c.tone);
    expect(new Set(tones).size).toBe(tones.length);
  });

  it("has no duplicate ids", () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
  });
});

describe("defaultCardLayout", () => {
  it("places every card, shown", () => {
    const layout = defaultCardLayout();
    expect(ids(layout).sort()).toEqual(CARDS.map((c) => c.id).sort());
    expect(layout.items.every((i) => !i.hidden)).toBe(true);
  });

  /*
   * The calendar leads and is the tall one, which is the arrangement the
   * board already had: it is the only card that is never empty, because
   * dates exist whether or not anything has been written yet.
   */
  it("leads with the calendar, and makes it the tall one", () => {
    const layout = defaultCardLayout();
    expect(layout.items[0].id).toBe("calendar");
    expect(layout.items[0].size).toBe("medium");
    expect(layout.items.filter((i) => i.size !== "small")).toHaveLength(1);
  });
});

describe("moving", () => {
  it("reorders", () => {
    const layout = defaultCardLayout();
    const moved = moveCard(layout, "todos", 0);
    expect(ids(moved)[0]).toBe("todos");
    expect(ids(moved)).toHaveLength(CARDS.length);
  });

  // Dropping past the end is how anyone asks for "last".
  it("takes an index past the end as the end", () => {
    const layout = defaultCardLayout();
    expect(ids(moveCard(layout, "calendar", 99)).at(-1)).toBe("calendar");
  });

  it("ignores a move of something that is not there", () => {
    const layout = defaultCardLayout();
    expect(moveCard(layout, "nope", 0)).toEqual(layout);
  });
});

describe("sizing", () => {
  it("changes one card and no other", () => {
    const layout = setCardSize(defaultCardLayout(), "notes", "large");
    expect(layout.items.find((i) => i.id === "notes")!.size).toBe("large");
    expect(layout.items.find((i) => i.id === "todos")!.size).toBe("small");
  });

  it("refuses a size that is not one", () => {
    const layout = defaultCardLayout();
    // @ts-expect-error a stored layout is data from disk, and disk contents
    // are not typed.
    expect(setCardSize(layout, "notes", "gigantic")).toEqual(layout);
  });
});

describe("hiding, and getting things back", () => {
  it("hides a card without losing it", () => {
    const layout = setCardHidden(defaultCardLayout(), "notes", true);
    expect(shownCards(layout).map((i) => i.id)).not.toContain("notes");
    expect(ids(layout)).toContain("notes");
  });

  it("brings everything back", () => {
    let layout = setCardHidden(defaultCardLayout(), "notes", true);
    layout = setCardHidden(layout, "todos", true);
    expect(shownCards(restoreAllCards(layout))).toHaveLength(CARDS.length);
  });

  /*
   * The board can be emptied, and that has to be a state it can come back
   * from. A dashboard showing nothing with no visible way to restore it is
   * one you would have to clear storage to fix.
   */
  it("can be emptied and refilled", () => {
    let layout = defaultCardLayout();
    for (const card of CARDS) layout = setCardHidden(layout, card.id, true);
    expect(shownCards(layout)).toHaveLength(0);
    expect(shownCards(restoreAllCards(layout))).toHaveLength(CARDS.length);
  });
});

describe("reconcileCards", () => {
  it("places a card the stored layout never heard of", () => {
    const layout = { version: 1 as const, items: [{ id: "notes", size: "small" as const, hidden: false }] };
    expect(ids(reconcileCards(layout))).toEqual(expect.arrayContaining(CARDS.map((c) => c.id)));
  });

  it("drops one that no longer exists", () => {
    const layout = {
      version: 1 as const,
      items: [...defaultCardLayout().items, { id: "gone", size: "small" as const, hidden: false }],
    };
    expect(ids(reconcileCards(layout))).not.toContain("gone");
  });

  // A card hidden on purpose should not reappear because something else
  // changed.
  it("leaves a hidden card hidden", () => {
    const layout = setCardHidden(defaultCardLayout(), "notes", true);
    expect(reconcileCards(layout).items.find((i) => i.id === "notes")!.hidden).toBe(true);
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());

  it("survives a round trip", () => {
    saveCardLayout(setCardSize(defaultCardLayout(), "notes", "large"));
    expect(loadCardLayout().items.find((i) => i.id === "notes")!.size).toBe("large");
  });

  it("falls back to the default when nothing is stored", () => {
    expect(loadCardLayout()).toEqual(defaultCardLayout());
  });

  /*
   * A corrupt layout must give back a working board. The failure mode
   * otherwise is a dashboard that opens to nothing and cannot be fixed from
   * inside the app.
   */
  it("falls back rather than breaking on nonsense", () => {
    for (const junk of ["", "not json", "[]", '{"items":"no"}', '{"version":9,"items":[]}']) {
      localStorage.setItem(STORAGE_KEY, junk);
      expect(shownCards(loadCardLayout())).toHaveLength(CARDS.length);
    }
  });
});
