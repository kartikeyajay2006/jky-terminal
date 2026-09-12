import { beforeEach, describe, expect, it } from "vitest";
import { useHud } from "./hudStore";

describe("focus mode", () => {
  beforeEach(() => useHud.setState({ on: false }));

  it("starts off", () => {
    expect(useHud.getState().on).toBe(false);
  });

  it("goes both ways on the same key", () => {
    useHud.getState().toggle();
    expect(useHud.getState().on).toBe(true);
    useHud.getState().toggle();
    expect(useHud.getState().on).toBe(false);
  });

  it("leaves without having to know whether it was on", () => {
    useHud.getState().leave();
    expect(useHud.getState().on).toBe(false);
    useHud.getState().toggle();
    useHud.getState().leave();
    expect(useHud.getState().on).toBe(false);
  });

  it("is forgotten by the next launch", () => {
    useHud.getState().toggle();
    // Nothing written anywhere. A window that came back with no navigation
    // and no status bar would look like an app that failed to start.
    expect(Object.keys(localStorage).filter((k) => k.includes("hud"))).toEqual([]);
  });
});
