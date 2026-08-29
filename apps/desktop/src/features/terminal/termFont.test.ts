import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FONT,
  DEFAULT_SIZE,
  MAX_SIZE,
  MIN_SIZE,
  TERM_FONTS,
  TERM_FONT_EVENT,
  announceTermFont,
  clampSize,
  isFontAvailable,
  isKnownFamily,
  loadTermFont,
  primaryFace,
  saveTermFont,
  stackFor,
} from "./termFont";

describe("the size range", () => {
  it("keeps a sensible size", () => {
    expect(clampSize(14)).toBe(14);
  });

  it("refuses a size too small to line up box-drawing characters", () => {
    // Below this, something like htop becomes unreadable.
    expect(clampSize(2)).toBe(MIN_SIZE);
  });

  it("refuses a size that would not fit eighty columns", () => {
    expect(clampSize(400)).toBe(MAX_SIZE);
  });

  it("rounds, since a font size of 13.7 helps nobody", () => {
    expect(clampSize(13.7)).toBe(14);
  });

  it("falls back rather than storing a NaN", () => {
    expect(clampSize(Number.NaN)).toBe(DEFAULT_SIZE);
    expect(clampSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIZE);
  });

  it("brackets the default inside the range", () => {
    expect(DEFAULT_SIZE).toBeGreaterThanOrEqual(MIN_SIZE);
    expect(DEFAULT_SIZE).toBeLessThanOrEqual(MAX_SIZE);
  });
});

describe("the faces on offer", () => {
  it("offers more than one", () => {
    expect(TERM_FONTS.length).toBeGreaterThan(3);
  });

  it("gives each a unique id", () => {
    const ids = TERM_FONTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ends every stack in a generic monospace", () => {
    // A missing face must degrade to some monospace, never to a proportional
    // font — in a terminal that is not cosmetic, it is unusable.
    for (const f of TERM_FONTS) {
      if (!f.stack) continue;
      expect(f.stack.trim().endsWith("monospace"), f.id).toBe(true);
    }
  });

  it("says something about each, rather than listing bare names", () => {
    for (const f of TERM_FONTS) {
      expect(f.note.length, f.id).toBeGreaterThan(10);
    }
  });

  it("recognises its own ids and nothing else", () => {
    expect(isKnownFamily("jetbrains")).toBe(true);
    expect(isKnownFamily("comic-sans")).toBe(false);
    expect(isKnownFamily("")).toBe(false);
  });
});

describe("remembering the choice", () => {
  beforeEach(() => localStorage.clear());

  it("starts at the default", () => {
    expect(loadTermFont()).toEqual(DEFAULT_FONT);
  });

  it("comes back after a restart", () => {
    saveTermFont({ size: 16, family: "fira" });
    expect(loadTermFont()).toEqual({ size: 16, family: "fira" });
  });

  it("clamps a size on the way in", () => {
    saveTermFont({ size: 900, family: "system" });
    expect(loadTermFont().size).toBe(MAX_SIZE);
  });

  it("refuses a face it does not offer", () => {
    saveTermFont({ size: 13, family: "not-a-font" });
    expect(loadTermFont().family).toBe(DEFAULT_FONT.family);
  });

  it("treats a corrupt store as the default rather than crashing", () => {
    localStorage.setItem("jky.terminal.font", "{ not json");
    expect(() => loadTermFont()).not.toThrow();
    expect(loadTermFont()).toEqual(DEFAULT_FONT);
  });

  it("ignores a stored value of the wrong shape", () => {
    localStorage.setItem(
      "jky.terminal.font",
      JSON.stringify({ size: "big", family: 42 }),
    );
    expect(loadTermFont()).toEqual(DEFAULT_FONT);
  });

  it("hands back a fresh object, not a shared one", () => {
    const a = loadTermFont();
    a.size = 99;
    expect(loadTermFont().size).toBe(DEFAULT_SIZE);
  });
});

describe("resolving a stack", () => {
  it("gives a named face its own stack", () => {
    expect(stackFor("fira")).toContain("Fira Code");
  });

  it("follows the app's token for the default, rather than pinning a copy", () => {
    // A copy would drift the moment the token changed.
    document.documentElement.style.setProperty("--font-mono", '"Test Mono", monospace');
    expect(stackFor("system")).toContain("Test Mono");
    document.documentElement.style.removeProperty("--font-mono");
  });

  it("falls back to monospace when the token is unset", () => {
    document.documentElement.style.removeProperty("--font-mono");
    expect(stackFor("system")).toContain("monospace");
  });

  it("falls back for a face it does not know", () => {
    expect(stackFor("not-a-font")).toContain("monospace");
  });
});

describe("telling open terminals", () => {
  it("announces the new setting, so a change needs no new tab", () => {
    const heard = vi.fn();
    window.addEventListener(TERM_FONT_EVENT, heard);

    announceTermFont({ size: 18, family: "fira" });

    expect(heard).toHaveBeenCalled();
    const event = heard.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ size: 18, family: "fira" });

    window.removeEventListener(TERM_FONT_EVENT, heard);
  });
});

describe("naming the face in a stack", () => {
  it("takes the first, which is the one being asked for", () => {
    expect(primaryFace('"Fira Code", ui-monospace, monospace')).toBe("Fira Code");
  });

  it("strips the quotes a CSS stack needs and a font name does not", () => {
    expect(primaryFace('"JetBrains Mono", monospace')).toBe("JetBrains Mono");
    expect(primaryFace("Consolas, monospace")).toBe("Consolas");
  });

  it("copes with an empty stack", () => {
    expect(primaryFace("")).toBe("");
  });
});

describe("detecting whether a face is installed", () => {
  it("says it cannot tell when there is no canvas to measure with", () => {
    // jsdom has no 2d context. "I do not know" and "it is missing" must not
    // look the same to a caller — one of them would put a wrong warning on
    // screen.
    expect(isFontAvailable("Fira Code")).toBeNull();
  });

  it("says it cannot tell for an empty name", () => {
    expect(isFontAvailable("")).toBeNull();
    expect(isFontAvailable("   ")).toBeNull();
  });

  it("never throws, whatever it is handed", () => {
    for (const name of ["a,b", " ", "x".repeat(500)]) {
      expect(() => isFontAvailable(name)).not.toThrow();
    }
  });

  it("reads a difference in width as the face being present", () => {
    // The measurement itself, against a stub context: a candidate that
    // resolves to something other than the generic measures differently, and
    // one that is missing measures identically because it fell back.
    const stub = {
      font: "",
      measureText(text: string) {
        void text;
        return { width: stub.font.includes("Installed") ? 200 : 100 };
      },
    };

    const original = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error a deliberately narrow stub
    HTMLCanvasElement.prototype.getContext = () => stub;

    expect(isFontAvailable("Installed")).toBe(true);
    expect(isFontAvailable("Missing")).toBe(false);

    HTMLCanvasElement.prototype.getContext = original;
  });
});

describe("the faces offered", () => {
  it("covers all three platforms, not only the one it was written on", () => {
    const ids = TERM_FONTS.map((f) => f.id);
    expect(ids).toContain("consolas");
    expect(ids).toContain("menlo");
    expect(ids).toContain("dejavu");
  });

  it("includes faces that are genuinely common, not only designer ones", () => {
    // The first version offered four faces that are on almost no Linux box,
    // so most of the menu silently fell back and read as a broken setting.
    const ids = TERM_FONTS.map((f) => f.id);
    for (const common of ["dejavu", "liberation", "noto", "courier"]) {
      expect(ids, common).toContain(common);
    }
  });
});
