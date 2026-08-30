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

  it("finds an app by id", () => {
    expect(findApp("calculator")?.name).toBe("Calculator");
  });

  it("returns nothing for an id it does not have", () => {
    expect(findApp("nope")).toBeUndefined();
  });

  it("includes the timer as a local app needing no account", () => {
    expect(findApp("timer")).toMatchObject({ id: "timer", mode: "local", auth: "none" });
  });

  it("includes the calculator as a local app needing no account", () => {
    const calc = findApp("calculator");
    expect(calc).toMatchObject({ id: "calculator", mode: "local", auth: "none" });
  });
});
