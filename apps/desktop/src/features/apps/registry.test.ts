import { describe, expect, it } from "vitest";
import { APPS, findApp } from "./registry";

describe("the app registry", () => {
  it("gives every app a unique id", () => {
    const ids = APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The id reaches the switcher's keyboard hints, the palette and, later, an
  // iframe URL. Keeping it to a plain slug means none of those has to escape it.
  it("keeps every id a lowercase slug", () => {
    for (const app of APPS) {
      expect(app.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("gives every app a name, a glyph and a blurb", () => {
    for (const app of APPS) {
      expect(app.name.trim()).not.toBe("");
      expect(app.glyph.trim()).not.toBe("");
      expect(app.blurb.trim()).not.toBe("");
    }
  });

  it("declares a known render mode and auth kind for every app", () => {
    for (const app of APPS) {
      expect(["local", "data", "frame"]).toContain(app.mode);
      expect(["none", "google", "github", "reddit"]).toContain(app.auth);
    }
  });

  // A `local` app touches no network by definition, so requiring an account
  // for one would be a contradiction the grid would render as a dead tile.
  it("never asks a local app to authenticate", () => {
    for (const app of APPS.filter((a) => a.mode === "local")) {
      expect(app.auth).toBe("none");
    }
  });

  // Each app carries its own colour, so the grid, the switcher and the open
  // panel all identify it the same way. The value is a theme token name, never
  // a literal: a hex value here would be wrong in six of the seven themes.
  it("gives every app an accent from the theme's own palette", () => {
    // `accent-dim` is a real accent, not a shade: the dashboard already uses
    // it as a distinct event colour and the contrast test verifies it in all
    // seven themes.
    const PALETTE = [
      "accent",
      "accent-dim",
      "violet",
      "magenta",
      "mint",
      "warn",
      "lime",
      "text-muted",
    ];
    for (const app of APPS) {
      expect(PALETTE, `${app.name} has an unknown accent`).toContain(app.accent);
    }
  });

  // `danger` is reserved for things that went wrong. An app permanently
  // wearing the error colour would make a real error unreadable.
  it("never dresses an app in the error colour", () => {
    for (const app of APPS) {
      expect(app.accent).not.toBe("danger");
    }
  });

  /*
   * Colour identifies an app, so no two share one.
   *
   * This briefly became a per-section rule, when six developer tools were
   * living in this grid and fourteen apps did not fit in eight colours. They
   * have their own section now, and the simple rule is true again — which is
   * the better outcome: a rule with an exception in it is one nobody can
   * apply without looking it up.
   */
  it("gives each app a distinct accent, so colour identifies it", () => {
    const used = APPS.map((a) => a.accent);
    expect(new Set(used).size).toBe(used.length);
  });

  it("includes github as a data app that needs an account", () => {
    expect(findApp("github")).toMatchObject({
      id: "github",
      mode: "data",
      auth: "github",
    });
  });

  // A browser is a frame app in the literal sense: it hosts a page from
  // somewhere else. It needs no account of its own.
  it("includes the browser as a frame app needing no account", () => {
    expect(findApp("browser")).toMatchObject({
      id: "browser",
      mode: "frame",
      auth: "none",
    });
  });

  it("finds an app by id", () => {
    expect(findApp("calculator")?.name).toBe("Calculator");
  });

  it("returns nothing for an id it does not have", () => {
    expect(findApp("nope")).toBeUndefined();
  });

  // Map is the one app that renders another origin inside the window, which
  // is what `frame` means and why the CSP names its host.
  it("includes the map as a frame app needing no account", () => {
    expect(findApp("map")).toMatchObject({ id: "map", mode: "frame", auth: "none" });
  });

  it("includes news as a data app needing no account", () => {
    expect(findApp("news")).toMatchObject({ id: "news", mode: "data", auth: "none" });
  });

  // Weather fetches, but through Rust and from a service that needs no key —
  // so it is a `data` app that still asks the user for nothing.
  it("includes weather as a data app needing no account", () => {
    expect(findApp("weather")).toMatchObject({ id: "weather", mode: "data", auth: "none" });
  });

  it("includes the timer as a local app needing no account", () => {
    expect(findApp("timer")).toMatchObject({ id: "timer", mode: "local", auth: "none" });
  });

  it("includes the calculator as a local app needing no account", () => {
    const calc = findApp("calculator");
    expect(calc).toMatchObject({ id: "calculator", mode: "local", auth: "none" });
  });
});
