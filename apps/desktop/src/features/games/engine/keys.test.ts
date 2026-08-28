import { describe, expect, it } from "vitest";
import { directionFor, GAME_KEYS, isActionKey } from "./keys";

describe("reading a direction", () => {
  it("takes the arrow keys", () => {
    expect(directionFor("ArrowUp")).toBe("up");
    expect(directionFor("ArrowDown")).toBe("down");
    expect(directionFor("ArrowLeft")).toBe("left");
    expect(directionFor("ArrowRight")).toBe("right");
  });

  it("takes WASD too, because half of everyone reaches for it", () => {
    expect(directionFor("w")).toBe("up");
    expect(directionFor("s")).toBe("down");
    expect(directionFor("a")).toBe("left");
    expect(directionFor("d")).toBe("right");
  });

  it("takes WASD with caps lock on", () => {
    expect(directionFor("W")).toBe("up");
    expect(directionFor("D")).toBe("right");
  });

  it("says nothing for a key that means nothing", () => {
    for (const key of ["q", "Escape", "1", "Shift", ""]) {
      expect(directionFor(key)).toBeNull();
    }
  });
});

describe("the action key", () => {
  it("accepts space and enter, which is what people press to begin", () => {
    expect(isActionKey(" ")).toBe(true);
    expect(isActionKey("Enter")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const key of ["a", "ArrowUp", "Escape"]) {
      expect(isActionKey(key)).toBe(false);
    }
  });
});

describe("the claimed keys", () => {
  it("covers everything a game acts on, so the page does not also act", () => {
    // Space scrolls a page and arrows move a caret. A game that reads them
    // without claiming them gets both behaviours at once.
    for (const key of [" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      expect(GAME_KEYS.has(key)).toBe(true);
    }
  });

  it("claims no letter, so typing anywhere else is untouched", () => {
    for (const key of ["w", "a", "s", "d", "q"]) {
      expect(GAME_KEYS.has(key)).toBe(false);
    }
  });
});
