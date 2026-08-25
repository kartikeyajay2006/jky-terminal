import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, loadTheme, saveTheme, THEMES, DEFAULT_THEME } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("ships the six launch themes", () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      "cyberpunk",
      "dracula",
      "nord",
      "solarized",
      "light",
      "contrast",
    ]);
  });

  it("gives every theme a human-readable name", () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.label).not.toBe(t.id);
    }
  });

  it("applies a theme by stamping the root element", () => {
    applyTheme("nord");
    expect(document.documentElement.getAttribute("data-theme")).toBe("nord");
  });

  it("remembers the chosen theme across reloads", () => {
    saveTheme("dracula");
    expect(loadTheme()).toBe("dracula");
  });

  it("falls back to the default when nothing is stored", () => {
    expect(loadTheme()).toBe(DEFAULT_THEME);
  });

  it("falls back to the default when the stored value is not a real theme", () => {
    localStorage.setItem("jky.theme", "vaporwave");
    expect(loadTheme()).toBe(DEFAULT_THEME);
  });

  it("survives storage being unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    expect(() => loadTheme()).not.toThrow();
    expect(loadTheme()).toBe(DEFAULT_THEME);
    expect(() => saveTheme("nord")).not.toThrow();
    if (original) Object.defineProperty(window, "localStorage", original);
  });
});
